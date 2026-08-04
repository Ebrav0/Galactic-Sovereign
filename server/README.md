# Hosted runtime (gateway + co-op)

Two local Node processes:

| Process | Bind | Purpose |
|---|---|---|
| Authenticated gateway | `127.0.0.1:8080` | Static build, accounts, solo saves API, admin API, WebSocket relay |
| Persistent co-op host | `127.0.0.1:9090` | Continuously ticking server-authoritative universe |

Solo save **envelopes** are stored in Supabase (Postgres metadata + private Storage) when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set. CT/SQLite keeps only users and sessions. Players never create Supabase accounts; the gateway proxies `/api/v1/saves` with the service role.

Proxmox CT bootstrap, systemd units, and deploy scripts live in the **local-only** `deploy/` tree (gitignored). Do not commit them.

## Local development

```bash
GS_COOP_RESET=1 npm run coop
npm run app
# or: npm run dev  (Vite client against a running gateway/coop as needed)
```

Copy `.env.example` to `.env` and set Supabase vars to exercise the save bridge. Without them, the gateway keeps using local SQLite `save_slots` (dev fallback).

Direct co-op without a gateway is a local-development compatibility path. Production sets a shared gateway secret; once present, the co-op host rejects connections that did not come through the authenticated gateway.

## Environment

See [`.env.example`](../.env.example). Server-only secrets:

- `SUPABASE_URL` — e.g. `https://xvtjlgjprvdznvhpbatk.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` — never expose to the client or commit

## Verification

```bash
npm run build
npm run verify:hosted-auth
npm run verify:hosted-ui
npm run verify:world-migration
```

The hosted authentication verifier covers save isolation, revision conflicts, account-derived multiplayer identity, and immediate disabled-session revocation.

## Clean start / wipe solo saves

```bash
# Wipe local SQLite envelopes only (users kept):
node scripts/wipe-ct-solo-saves.mjs

# Or point at a data dir:
GS_DATA_DIR=/var/lib/galactic-sovereign/accounts node scripts/wipe-ct-solo-saves.mjs
```

After enabling the Supabase bridge in production, wipe CT `save_slots` so large JSON no longer lives on disk. Recreate the owner with `npm run admin:create` if you also reset users.

## CT disk prune (ops checklist)

On the CT (via your local ignored `gsctl` / SSH), periodically:

1. Keep only `current` + one prior release under `/opt/galactic-sovereign/releases/`.
2. Cap `/var/lib/galactic-sovereign/backups` retention (restic/R2 remains offsite).
3. After save cutover: `DELETE FROM save_slots;` then `VACUUM;` on `accounts.sqlite`, or run `wipe-ct-solo-saves.mjs`.
