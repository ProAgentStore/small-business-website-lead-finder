# Runbook

## Prerequisites

- **Google Places API key** (Places API New enabled) in SOPS, wired to the agent's `fetch_url`.
- A **pilot metro** (city + country) to size the grid.

## Running a sweep

- The cron trigger advances the metro grid one tile per run and inserts new leads. It is
  resumable: each run records the last tile so quota is spread over time.
- Export leads: `query_records` on the `leads` collection (filter `status = new`).

## Cost & quota

- Places **Search** + **Details** are billed per request. Cost ≈ (cells × pages) search calls +
  one Details call per unique place. A metro pilot is bounded; going regional/global multiplies
  cost and storage — scale deliberately, city by city.
- Keep the sweep tiled and scheduled so one run cannot exhaust the daily quota.

## ToS

- Use the Places API, never HTML scraping of Maps.
- Retain minimal fields (see DATA-MODEL.md). Respect Places caching/retention terms.

## Status

Draft — logic not yet implemented. Blocked on the Places API key + pilot city (see PROGRESS.md).
