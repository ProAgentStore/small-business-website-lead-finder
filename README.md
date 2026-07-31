# Small Business Website Lead Finder

Finds local small businesses with no website — or a broken, unreachable one — on Google, and compiles them as ready-to-pitch leads for website building. Search by city and business type; exports name, address, phone, and Maps link.

## AI billing

This generated agent does not use the ProAgentStore Cloudflare Workers AI binding by default. AI calls require caller-provided Cloudflare Workers AI credentials:

- `X-CF-Account-ID`
- `X-CF-AI-Token`

That makes inference spend bill to the caller's Cloudflare account, not the ProAgentStore platform account.

## Development

```bash
pnpm install
pnpm dev
```

## Deploy

```bash
pnpm deploy
```
