# Data model

Leads are stored in a PAGS collection (records live in the platform DB, not the repo).

## Collection: `leads`

| Field | Type | Notes |
|---|---|---|
| `place_id` | string | Google Places ID — the dedupe key |
| `name` | string | Business name |
| `category` | string | Business type searched (e.g. `cafe`, `salon`) |
| `address` | string | Formatted address |
| `phone` | string | Local phone, if present |
| `lat` / `lng` | number | Location |
| `maps_url` | string | Google Maps link |
| `website_status` | enum | `none` \| `unreachable` |
| `website_url` | string | The listed-but-broken URL (only when `unreachable`) |
| `city` | string | Pilot metro this lead came from |
| `checked_at` | string | ISO timestamp of the sweep |
| `status` | enum | `new` \| `contacted` \| `won` \| `dead` (outreach state) |

## ToS note

Store the minimum needed for outreach (name, address, phone, `place_id`, maps link). `place_id` may
be retained indefinitely; other Places fields have caching limits — see RUNBOOK.md.
