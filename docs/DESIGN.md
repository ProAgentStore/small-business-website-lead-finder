# Design

## What it does

Finds local small businesses whose Google listing has **no website — or a website that is listed but
unreachable/broken** — and compiles them as leads for website-building outreach. Category-agnostic
(cafés, salons, plumbers, …); the business type is just a search filter.

The wedge: **"no reachable website"** is the signal that a business is a prospect for a tiny website.

## The sweep (recipe)

1. **Tile** the target metro into a grid of lat/lng cells (Nearby Search returns ≤ 60 results per
   point across 3 pages, so a city must be covered cell-by-cell).
2. For each cell: **Google Places Nearby/Text Search** for the chosen business type(s).
3. For each place: **Place Details** → read `websiteUri`.
4. **Classify the website signal:**
   - no `websiteUri` → `website_status = "none"` → **lead**
   - has `websiteUri` → HTTP-check it → if unreachable/broken (timeout, DNS fail, 4xx/5xx) →
     `website_status = "unreachable"` → **lead**; if it loads OK → **skip** (not a lead)
5. **Dedupe** by `place_id`.
6. **`insert_record`** each lead into the `leads` collection (see DATA-MODEL.md).

## Runtime shape

- PAGS `cron` agent (scaffolded from the `cron` template). A scheduled sweep advances the grid
  tile-by-tile so a single run never blows the Places quota.
- Tools used: `fetch_url` (Places API + website reachability checks) and `insert_record` /
  `query_records` (the leads DB).
- Google Places API key lives in SOPS and is provided to `fetch_url` via the key vault /
  caller-creds pattern (same approach as the creator-os IG token).

## Non-goals / boundaries

- No scraping of Google Maps HTML (brittle + against Google ToS) — we use the Places API.
- Absence of `websiteUri` is a strong proxy, not proof; some real sites are just not listed. Good
  enough for prospecting.
