// Small Business Website Lead Finder — scheduled + on-demand sweep, any city.
//
// Deterministic (no LLM): geocode a city → tile a grid around its centre → Places API (New)
// searchNearby (websiteUri + addressComponents inline, so no separate Details call) →
// classify (no website / unreachable) → reachability-check → dedupe by place_id →
// persist to this Durable Object with a full per-lead AUDIT trail.
//
// Endpoints (token-guarded, proxied to the DO):
//   GET  /
//   POST /sweep?city=Sydney&type=cafe&batch=4   → run `batch` grid cells of that city now
//   GET  /leads?city=Sydney&status=none&limit=1000
//   GET  /stats
//   POST /reset

export interface Env {
	LEADS: DurableObjectNamespace;
	GOOGLE_PLACES_API_KEY?: string;
	SWEEP_TOKEN?: string;
}

// Bounded grid extent around a city centre (keeps per-run Places cost sane).
const EXTENT = { lat: 0.045, lng: 0.055, stepLat: 0.013, stepLng: 0.016, radius: 900 };

interface Cell {
	lat: number;
	lng: number;
}
function cellsAround(c: { lat: number; lng: number }): Cell[] {
	const out: Cell[] = [];
	for (let lat = c.lat - EXTENT.lat; lat <= c.lat + EXTENT.lat; lat += EXTENT.stepLat)
		for (let lng = c.lng - EXTENT.lng; lng <= c.lng + EXTENT.lng; lng += EXTENT.stepLng)
			out.push({ lat: +lat.toFixed(6), lng: +lng.toFixed(6) });
	return out;
}

interface AuditStep {
	at: string;
	step: string;
	detail: string;
}
interface Lead {
	place_id: string;
	name: string;
	category: string;
	country: string;
	state: string;
	city: string;
	suburb: string;
	address: string;
	phone: string;
	phone_type: string;
	channels: string;
	lat: number;
	lng: number;
	maps_url: string;
	website_status: "none" | "unreachable";
	website_url: string;
	status: "new";
	found_at: string;
	audit: AuditStep[];
}
interface Geo {
	center: { lat: number; lng: number };
	country: string;
	state: string;
	cityName: string;
}

const json = (data: unknown, status = 200) =>
	new Response(JSON.stringify(data, null, 2), { status, headers: { "Content-Type": "application/json" } });

export default {
	async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
		ctx.waitUntil(stub(env).fetch("https://do/sweep?batch=4").then(() => {}));
	},
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/") return json({ agent: "small-business-website-lead-finder", status: "ok" });
		if (!env.SWEEP_TOKEN || url.searchParams.get("token") !== env.SWEEP_TOKEN)
			return json({ error: "unauthorized — pass ?token=" }, 403);
		return stub(env).fetch(new Request("https://do" + url.pathname + url.search, request));
	},
};

function stub(env: Env): DurableObjectStub {
	return env.LEADS.get(env.LEADS.idFromName("main"));
}

export class LeadsDO {
	constructor(
		private state: DurableObjectState,
		private env: Env,
	) {}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		try {
			if (url.pathname === "/sweep") {
				const batch = Math.max(1, Math.min(12, Number(url.searchParams.get("batch") ?? "3")));
				const type = url.searchParams.get("type") || "cafe";
				const city = url.searchParams.get("city") || (await this.state.storage.get<string>("lastCity")) || "Melbourne, Australia";
				return json(await this.sweep(batch, type, city));
			}
			if (url.pathname === "/leads") {
				const status = url.searchParams.get("status");
				const city = url.searchParams.get("city");
				const limit = Math.min(2000, Number(url.searchParams.get("limit") ?? "500"));
				const map = await this.state.storage.list<Lead>({ prefix: "lead:", limit: 5000 });
				let leads = [...map.values()];
				if (status) leads = leads.filter((l) => l.website_status === status);
				if (city) leads = leads.filter((l) => (l.city || "").toLowerCase().includes(city.toLowerCase()));
				return json({ count: leads.length, leads: leads.slice(0, limit) });
			}
			if (url.pathname === "/stats") {
				const map = await this.state.storage.list<Lead>({ prefix: "lead:", limit: 5000 });
				const leads = [...map.values()];
				const byCity: Record<string, number> = {};
				for (const l of leads) byCity[l.city || "?"] = (byCity[l.city || "?"] || 0) + 1;
				return json({
					total: leads.length,
					none: leads.filter((l) => l.website_status === "none").length,
					unreachable: leads.filter((l) => l.website_status === "unreachable").length,
					byCity,
				});
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

	private async geocode(city: string, key: string): Promise<Geo> {
		const cached = await this.state.storage.get<Geo>(`geo:${city}`);
		if (cached) return cached;
		const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Goog-Api-Key": key,
				"X-Goog-FieldMask": "places.location,places.addressComponents,places.displayName",
			},
			body: JSON.stringify({ textQuery: city, maxResultCount: 1 }),
		});
		if (!res.ok) throw new Error(`geocode ${res.status}: ${(await res.text()).slice(0, 160)}`);
		const p = ((await res.json()) as { places?: any[] }).places?.[0];
		if (!p?.location) throw new Error(`could not geocode "${city}"`);
		const g = geoFromComponents(p.addressComponents || []);
		const out: Geo = {
			center: { lat: p.location.latitude, lng: p.location.longitude },
			country: g.country,
			state: g.state,
			cityName: g.city || p.displayName?.text || city,
		};
		await this.state.storage.put(`geo:${city}`, out);
		return out;
	}

	private async sweep(batch: number, type: string, city: string) {
		const key = this.env.GOOGLE_PLACES_API_KEY;
		if (!key) return { error: "GOOGLE_PLACES_API_KEY not set" };
		const geo = await this.geocode(city, key);
		const cityLabel = city.split(",")[0].trim(); // "Sydney, Australia" → "Sydney" (the metro)
		const all = cellsAround(geo.center);
		const ckey = `cursor:${city}:${type}`;
		let cursor = (await this.state.storage.get<number>(ckey)) ?? 0;
		const scanned: number[] = [];
		let searched = 0,
			added = 0,
			skippedHasSite = 0,
			seen = 0;

		for (let i = 0; i < batch; i++) {
			const idx = cursor % all.length;
			const cell = all[idx];
			scanned.push(idx);
			const places = await this.searchNearby(cell.lat, cell.lng, type, key);
			searched++;
			const fresh: any[] = [];
			for (const p of places) {
				seen++;
				if (!p.id) continue;
				if (await this.state.storage.get(`lead:${p.id}`)) continue;
				fresh.push(p);
			}
			const reach = await mapLimit(fresh, 6, (p) =>
				p.websiteUri ? reachable(p.websiteUri) : Promise.resolve({ ok: true, code: null as number | null }),
			);
			for (let j = 0; j < fresh.length; j++) {
				const p = fresh[j];
				const site: string | undefined = p.websiteUri;
				let websiteStatus: "none" | "unreachable" | null = null;
				if (!site) websiteStatus = "none";
				else if (!reach[j].ok) websiteStatus = "unreachable";
				else {
					skippedHasSite++;
					continue;
				}
				const at = new Date().toISOString();
				const pg = geoFromComponents(p.addressComponents || []);
				const phone: string = p.nationalPhoneNumber ?? "";
				const ptype = classifyPhone(phone);
				const chans = channelsFor(ptype, phone);
				const name = p.displayName?.text ?? "";
				const addr = p.formattedAddress ?? "";
				const maps = p.googleMapsUri ?? "";
				const audit: AuditStep[] = [
					{ at, step: "1. discovered", detail: `Google Places Nearby Search (type=${type}) near ${geo.cityName} at cell (${cell.lat}, ${cell.lng}), 900m radius. place_id=${p.id}.` },
					{ at, step: "2. raw input", detail: `name=${name} | address=${addr} | phone=${phone || "(none)"} | google website field=${site || "(none)"} | maps=${maps}` },
					{
						at,
						step: "3. website check",
						detail: site
							? `GET ${site} (browser UA, 12s, 1 retry) → ${reach[j].code != null ? "HTTP " + reach[j].code : "no response (timeout/DNS)"} → ${websiteStatus === "unreachable" ? "UNREACHABLE" : "reachable"}`
							: "Google listing has NO website field.",
					},
					{ at, step: "4. decision", detail: websiteStatus === "none" ? "QUALIFIED as lead — no website at all." : "QUALIFIED as lead — listed website is down/unreachable." },
					{ at, step: "5. channels", detail: `phone ${phone || "(none)"} is ${ptype} → reachable via: ${chans}. Social/email not yet researched.` },
				];
				const lead: Lead = {
					place_id: p.id,
					name,
					category: type,
					country: pg.country || geo.country,
					state: pg.state || geo.state,
					city: cityLabel,
					suburb: pg.sublocality || pg.locality,
					address: addr,
					phone,
					phone_type: ptype,
					channels: chans,
					lat: p.location?.latitude ?? cell.lat,
					lng: p.location?.longitude ?? cell.lng,
					maps_url: maps,
					website_status: websiteStatus,
					website_url: site ?? "",
					status: "new",
					found_at: at,
					audit,
				};
				await this.state.storage.put(`lead:${p.id}`, lead);
				added++;
			}
			cursor = idx + 1;
		}
		await this.state.storage.put(ckey, cursor);
		await this.state.storage.put("lastCity", city);
		return { ok: true, city: geo.cityName, type, cellsScanned: scanned, placesSeen: seen, leadsAdded: added, skippedHasWorkingSite: skippedHasSite, searchCalls: searched, cursor, totalCells: all.length };
	}

	private async searchNearby(lat: number, lng: number, type: string, key: string): Promise<any[]> {
		const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Goog-Api-Key": key,
				"X-Goog-FieldMask":
					"places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.location,places.googleMapsUri,places.addressComponents",
			},
			body: JSON.stringify({
				includedTypes: [type],
				maxResultCount: 20,
				locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: EXTENT.radius } },
			}),
		});
		if (!res.ok) throw new Error(`Places ${res.status}: ${(await res.text()).slice(0, 200)}`);
		return ((await res.json()) as { places?: any[] }).places ?? [];
	}
}

function geoFromComponents(comps: any[]): { country: string; state: string; locality: string; sublocality: string } {
	const get = (t: string) => {
		const c = comps.find((x) => (x.types || []).includes(t));
		return c ? c.longText || c.shortText || "" : "";
	};
	return {
		country: get("country"),
		state: get("administrative_area_level_1"),
		// In AU `locality` IS the suburb (Newtown); in the US it's the city (Austin).
		locality: get("locality") || get("postal_town") || get("administrative_area_level_2"),
		sublocality: get("sublocality") || get("sublocality_level_1") || get("neighborhood") || "",
	};
}

function classifyPhone(phone: string): string {
	let d = (phone || "").replace(/\D/g, "");
	if (!d) return "none";
	if (d.startsWith("61")) d = "0" + d.slice(2);
	if (d.startsWith("04") && d.length === 10) return "mobile";
	if (/^0[2378]/.test(d) && d.length === 10) return "landline";
	return "unknown";
}
function channelsFor(ptype: string, phone: string): string {
	if (ptype === "mobile") return "Call · SMS · WhatsApp";
	if (!phone) return "—";
	return "Call";
}

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

// Conservative: ok=false (= a "site down" lead) ONLY on a definitive dead signal (404/410/5xx).
// Timeouts / connection errors / other statuses → ok=true (don't false-flag). Returns the code for the audit.
async function reachable(rawUrl: string): Promise<{ ok: boolean; code: number | null }> {
	const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const res = await fetch(rawUrl, {
				method: "GET",
				redirect: "follow",
				headers: { "User-Agent": UA, Accept: "text/html,*/*" },
				signal: AbortSignal.timeout(12000),
			});
			if (res.status === 404 || res.status === 410 || res.status >= 500) return { ok: false, code: res.status };
			return { ok: true, code: res.status };
		} catch {
			if (attempt === 1) return { ok: true, code: null };
		}
	}
	return { ok: true, code: null };
}
