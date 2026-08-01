# Progress log

Newest first. The running record of everything we work on for this agent.

## 2026-08-01 — Shipped: sweep live, reachability fixed, published
- Implemented the sweep worker (Places API New searchNearby + inline websiteUri FieldMask,
  DO storage, dedupe, grid over inner Melbourne, token-guarded /sweep /leads /stats /reset).
- Wired secrets on the worker: `GOOGLE_PLACES_API_KEY` (from SOPS) + `SBWLF_SWEEP_TOKEN`
  (persisted to SOPS `pags.SBWLF_SWEEP_TOKEN`).
- **Reachability bug fixed:** first pass flagged ~75% of live sites "unreachable" (short-timeout
  concurrent fetches). Now conservative: only flag on definitive 404/410/5xx, browser UA + retry,
  bounded concurrency. Re-swept clean: **72 leads from 24/48 cells — 60 no-website, 12 genuinely
  dead** (spot-checked: 9/11 hard-dead, 2 dead-after-redirect).
- **Published** the agent; created an instance (`933ebec5-3e84-492e-8d7c-e1d575e67ef1`).
- Platform: fixed the console model picker (was @cf/* local only) to offer the Claude family,
  default Sonnet 4.6 — deployed to prod.
- **View leads:** `https://small-business-website-lead-finder.proagentstore.online/leads?status=none&token=<SBWLF_SWEEP_TOKEN>`

### Next
- [ ] Sweep the remaining cells (cursor 24/48) — daily cron advances it; tune cron batch to plan limits.
- [ ] Surface leads in the instance chat (currently only via the /leads endpoint).
- [ ] Generalise beyond `type=cafe` (parameterise business types) + more metros.

## 2026-08-01 — Places API key provisioned & tested
- GCP project **proappstore-online**: linked billing (Firebase Payment `015CE5-BF7BF9-9EF996`,
  after "My Billing Account" hit a project-quota block), enabled **Places API (New)**, created a
  Places-restricted key `atiny-smb-lead-places` (uid `286891f3-4149-4f5e-8549-e294c2682991`).
- **Tested live**: Text Search "coffee shop in Fitzroy Melbourne" returned 5 results and correctly
  flagged one with no website (Annie's Fitzroy = lead). End-to-end signal works.
- Key stored in the `ops` repo (SOPS) as `pags.GOOGLE_PLACES_API_KEY` + metadata in `inventory.yaml`.
- Still to do: deliver the key to the agent at runtime (PAGS key vault → `fetch_url`).

## 2026-08-01 — Agent created
- Scaffolded via PAGS MCP (`scaffold_agent`, `auto_deploy: false`).
  - Agent ID: `4d9945ab-26b2-4476-b9c1-89b7f4426f35`
  - Repo: https://github.com/ProAgentStore/small-business-website-lead-finder
  - Worker (not deployed): small-business-website-lead-finder.proagentstore.online
  - Template: `cron`. Category: `Sales`. Visibility: `draft`.
- Upgraded model `@cf/meta/llama-3.2-3b-instruct` → `claude-sonnet-4-6`.
- Seeded `/docs` (this tree). Note: MCP `write_agent_file` 404'd for this repo, so docs were
  committed via git directly (see DECISIONS.md #8).

### Decided
- Generic SMB lead finder (any business type), signal = no/unreachable website.
- Google Places API; PAGS storage; one-metro pilot; docs in repo.

### Blocked / next
- [x] Google Places API key → created (proappstore-online, Places-restricted) + stored in ops SOPS as `pags.GOOGLE_PLACES_API_KEY`
- [ ] Deliver the key to the agent at runtime (PAGS key vault → `fetch_url`)
- [ ] Choose pilot metro (city + country) — tested against Melbourne/Fitzroy
- [ ] Implement the sweep worker (grid tiling, Details, reachability, dedupe, `insert_record`)
- [ ] Create `leads` collection
- [ ] Mirror sweep recipe + schema + rules into the PAGS knowledge base
- [ ] Publish + subscribe (create an instance) + set cron trigger
- [ ] Test on the pilot metro, then decide on scaling
