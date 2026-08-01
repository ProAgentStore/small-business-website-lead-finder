// Small Business Website Lead Finder — scheduled sweep.
//
// Finds local small businesses whose Google listing has NO website, or a listed-but-
// unreachable one, and stores them as leads. Deterministic code (no LLM): grid-tile a
// metro → Places API (New) searchNearby with a FieldMask that returns websiteUri inline
// (so no separate Place Details call) → classify → reachability-check → dedupe by
// place_id → persist in this Durable Object's storage.
//
// Endpoints (proxied to the DO):
//   GET  /                              → status
//   POST /sweep?type=cafe&batch=3       → run `batch` grid cells now (manual pilot)
//   GET  /leads?status=none&limit=200   → list stored leads
//   GET  /stats                         → counts
// scheduled(): advances the grid a few cells per tick so a run never blows the quota.

export interface Env {
	LEADS: DurableObjectNamespace;
	GOOGLE_PLACES_API_KEY?: string;
	SWEEP_TOKEN?: string; // shared secret guarding /sweep (spends money), /leads, /stats
}

// ── Pilot metro grid: inner Melbourne (CBD + inner suburbs) ──
const GRID = {
	city: "Melbourne, AU",
	latMin: -37.855, latMax: -37.77,
	lngMin: 144.93, lngMax: 145.01,
	stepLat: 0.012, stepLng: 0.015, // ~1.3km spacing
	radius: 900, // metres per cell
};

function cells(): { lat: number; lng: number }[] {
	const out: { lat: number; lng: number }[] = [];
	for (let lat = GRID.latMin; lat <= GRID.latMax; lat += GRID.stepLat)
		for (let lng = GRID.lngMin; lng <= GRID.lngMax; lng += GRID.stepLng)
			out.push({ lat: +lat.toFixed(6), lng: +lng.toFixed(6) });
	return out;
}

interface Lead {
	place_id: string; name: string; category: string; address: string; phone: string;
	lat: number; lng: number; maps_url: string;
	website_status: "none" | "unreachable"; website_url: string;
	city: string; checked_at: string; status: "new";
}

const json = (data: unknown, status = 200) =>
	new Response(JSON.stringify(data, null, 2), { status, headers: { "Content-Type": "application/json" } });

export default {
	async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
		ctx.waitUntil(stub(env).fetch("https://do/sweep?batch=6").then(() => {}));
	},
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/")
			return json({ agent: "small-business-website-lead-finder", status: "ok", grid: GRID.city, cells: cells().length });
		// /sweep spends Places API quota and /leads exposes data — require the shared token.
		if (!env.SWEEP_TOKEN || url.searchParams.get("token") !== env.SWEEP_TOKEN)
			return json({ error: "unauthorized — pass ?token=" }, 403);
		// proxy everything else to the singleton DO
		return stub(env).fetch(new Request("https://do" + url.pathname + url.search, request));
	},
};

function stub(env: Env): DurableObjectStub {
	return env.LEADS.get(env.LEADS.idFromName("main"));
}

export class LeadsDO {
	constructor(private state: DurableObjectState, private env: Env) {}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		try {
			if (url.pathname === "/sweep") {
				const batch = Math.max(1, Math.min(20, Number(url.searchParams.get("batch") ?? "3")));
				const type = url.searchParams.get("type") || "cafe";
				return json(await this.sweep(batch, type));
			}
			if (url.pathname === "/leads") {
				const status = url.searchParams.get("status");
				const limit = Math.min(1000, Number(url.searchParams.get("limit") ?? "200"));
				const map = await this.state.storage.list<Lead>({ prefix: "lead:", limit: 1000 });
				let leads = [...map.values()];
				if (status) leads = leads.filter((l) => l.website_status === status);
				return json({ count: leads.length, leads: leads.slice(0, limit) });
			}
			if (url.pathname === "/stats") {
				const map = await this.state.storage.list<Lead>({ prefix: "lead:", limit: 1000 });
				const leads = [...map.values()];
				const cursor = (await this.state.storage.get<number>("cursor")) ?? 0;
				const by = (k: string) => leads.filter((l) => l.website_status === k).length;
				return json({ total: leads.length, none: by("none"), unreachable: by("unreachable"), cursor, totalCells: cells().length, city: GRID.city });
			}
			if (url.pathname === "/reset") {
				await this.state.storage.deleteAll();
				return json({ ok: true, reset: true });
			}
			return json({ error: "not found" }, 404);
		} catch (e) {
			return json({ error: String((e as Error).message || e) }, 500);
		}
	}

	private async sweep(batch: number, type: string) {
		const key = this.env.GOOGLE_PLACES_API_KEY;
		if (!key) return { error: "GOOGLE_PLACES_API_KEY not set" };
		const all = cells();
		let cursor = (await this.state.storage.get<number>("cursor")) ?? 0;
		const scanned: number[] = [];
		let searched = 0, added = 0, skippedHasSite = 0, seen = 0;

		for (let i = 0; i < batch; i++) {
			const idx = cursor % all.length;
			const cell = all[idx];
			scanned.push(idx);
			const places = await this.searchNearby(cell.lat, cell.lng, type, key);
			searched++;
			// New (not-yet-stored) places only, then reachability-check their sites CONCURRENTLY
			// (bounds wall-clock vs. sequential timeouts; keeps us under Worker limits).
			const fresh: any[] = [];
			for (const p of places) {
				seen++;
				if (!p.id) continue;
				if (await this.state.storage.get(`lead:${p.id}`)) continue; // dedupe
				fresh.push(p);
			}
			const reach = await mapLimit(fresh, 6, (p) => (p.websiteUri ? reachable(p.websiteUri) : Promise.resolve(true)));
			for (let j = 0; j < fresh.length; j++) {
				const p = fresh[j];
				const placeId: string = p.id;
				const site: string | undefined = p.websiteUri;
				let websiteStatus: "none" | "unreachable" | null = null;
				if (!site) websiteStatus = "none";
				else if (!reach[j]) websiteStatus = "unreachable";
				else { skippedHasSite++; continue; } // has a working site → not a lead
				const lead: Lead = {
					place_id: placeId,
					name: p.displayName?.text ?? "",
					category: type,
					address: p.formattedAddress ?? "",
					phone: p.nationalPhoneNumber ?? "",
					lat: p.location?.latitude ?? cell.lat,
					lng: p.location?.longitude ?? cell.lng,
					maps_url: p.googleMapsUri ?? "",
					website_status: websiteStatus,
					website_url: site ?? "",
					city: GRID.city,
					checked_at: new Date().toISOString(),
					status: "new",
				};
				await this.state.storage.put(`lead:${placeId}`, lead);
				added++;
			}
			cursor = idx + 1;
		}
		await this.state.storage.put("cursor", cursor);
		return { ok: true, type, cellsScanned: scanned, placesSeen: seen, leadsAdded: added, skippedHasWorkingSite: skippedHasSite, searchCalls: searched, cursor, totalCells: all.length };
	}

	private async searchNearby(lat: number, lng: number, type: string, key: string): Promise<any[]> {
		const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Goog-Api-Key": key,
				"X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.location,places.googleMapsUri",
			},
			body: JSON.stringify({
				includedTypes: [type],
				maxResultCount: 20,
				locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: GRID.radius } },
			}),
		});
		if (!res.ok) throw new Error(`Places ${res.status}: ${(await res.text()).slice(0, 200)}`);
		const data = (await res.json()) as { places?: any[] };
		return data.places ?? [];
	}
}

// Run `fn` over items with bounded concurrency (avoids firing dozens of fetches at once,
// which caused queued-fetch timeouts → false "unreachable").
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let i = 0;
	const worker = async () => {
		while (i < items.length) {
			const idx = i++;
			out[idx] = await fn(items[idx]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return out;
}

// Reachability, conservative: returns false (= a "site down" LEAD) ONLY on a definitive dead
// signal (HTTP 404/410/5xx). Any other outcome — 2xx/3xx/401/403/429, a timeout, or a connection
// error — is treated as reachable, so we never pitch "your site is down" to a business whose site
// is actually fine (the earlier bug flagged ~75% of live sites). Browser UA + one retry + 12s.
async function reachable(rawUrl: string): Promise<boolean> {
	const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const res = await fetch(rawUrl, {
				method: "GET",
				redirect: "follow",
				headers: { "User-Agent": UA, Accept: "text/html,*/*" },
				signal: AbortSignal.timeout(12000),
			});
			if (res.status === 404 || res.status === 410 || res.status >= 500) return false; // definitively dead
			return true; // any other response → site is up
		} catch {
			if (attempt === 1) return true; // timeout / connection error → ambiguous, don't false-flag
		}
	}
	return true;
}
