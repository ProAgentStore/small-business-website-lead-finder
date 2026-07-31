# Docs — Small Business Website Lead Finder

The living documentation home for this agent. Read in this order:

1. [DESIGN.md](DESIGN.md) — what it does and how the sweep works
2. [DATA-MODEL.md](DATA-MODEL.md) — the `leads` collection schema
3. [RUNBOOK.md](RUNBOOK.md) — running a sweep, quota, cost, ToS
4. [DECISIONS.md](DECISIONS.md) — why we built it this way (ADRs)
5. [PROGRESS.md](PROGRESS.md) — running log of everything we work on

Docs live in the repo (versioned with the code). Operational rules the *agent* needs at runtime
(the sweep recipe, the schema, the filter rules) are also mirrored into the PAGS knowledge base so
the agent and these docs stay in sync — one source, two audiences.
