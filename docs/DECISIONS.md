# Decisions (ADRs)

### 1. Signal = "no reachable website"
A business with no website — or a listed-but-broken one — is the prospect. We check both the
absence of `websiteUri` AND reachability of any listed URL. Absence is a proxy, not proof; accepted.

### 2. Google Places API (not scraping)
Place Details' `websiteUri` is the authoritative Google-profile signal. Scraping Maps is brittle and
against Google ToS. Cost is the tradeoff; mitigated by tiling + scheduling + starting with one metro.

### 3. Platform = PAGS
PAGS gives storage (collections/records) natively and `fetch_url` for external APIs. No Places
integration exists, so we wire the API ourselves. Chosen over an OpenClaw local agent for the hosted
DB + catalog discoverability.

### 4. Generic, not coffee-shops-only
The signal is category-agnostic; business type is a search parameter. Broadens the addressable market
and makes the agent reusable/discoverable in the PAGS catalog.

### 5. Descriptive name for discoverability
Named **Small Business Website Lead Finder** (keyword-rich) so it is findable in the PAGS catalog,
over a brandable-but-obscure name.

### 6. Model = claude-sonnet-4-6
The 3B scaffold default is too weak to orchestrate Places calls + filtering; upgraded to
`claude-sonnet-4-6` (already used by other agents in this account).

### 7. Docs in the agent repo
Documentation lives in this repo's `/docs` (versioned with the code); the agent's runtime rules are
mirrored into the PAGS knowledge base. No separate docs repo.

### 8. Docs seeded via git, not the MCP file tools
`write_agent_file` / `batch_write_agent_files` returned 404 for this repo (the MCP file path could
not resolve the `ProAgentStore`-org repo, though it exists and scaffold populated it). Worked around
by committing docs directly with `gh`/git. Revisit the MCP file tools before relying on them.
