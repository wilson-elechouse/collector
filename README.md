# Collector V3 (clean rebuild)

Single-user admin MVP.

## Services
- web (Next.js)  : http://127.0.0.1:7100
- api (Fastify)  : http://127.0.0.1:3000
- db (Postgres)  : internal
- cloudflared     : optional, enabled with `--profile tunnel`

## Quick start
```bash
cd infra
cp .env.example .env
docker compose up --build
```

Default credentials (dev): admin / admin

## Environment
- Keep real secrets in `infra/.env`
- Do not commit `infra/.env`
- For production QBO access, set:
  - `SESSION_SECRET`
  - `QBO_CLIENT_ID`
  - `QBO_CLIENT_SECRET`
  - `QBO_REDIRECT_URI`
  - `QBO_ENV=production`
  - `QBO_USE_MOCK=0`

## Tunnel
Cloudflare Tunnel is disabled by default. Start it only when needed:

```bash
cd infra
docker compose --profile tunnel up -d
```
