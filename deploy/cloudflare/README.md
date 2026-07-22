# Cloudflare edge ops for Galactic Sovereign

These settings live in the Cloudflare dashboard (not on the CT). They keep a branded page and email alerts available even when the home server is powered off.

## Admin hostname provisioning

`admin.galacticsovereign.xyz` shares the same remotely managed Cloudflare Tunnel and loopback gateway as `play.galacticsovereign.xyz` (`http://127.0.0.1:8080`). Provision (or reconcile) tunnel ingress, proxied DNS, and Zero Trust Access with:

```bash
export CLOUDFLARE_API_TOKEN='…'          # required
export CF_ACCESS_OWNER_EMAIL='you@…'     # required when the script must create an Access app
# optional overrides:
# export CF_ACCOUNT_ID='…'
# export CF_TUNNEL_ID='…'

./deploy/cloudflare/provision-admin-hostname.mjs
```

The script:

1. Resolves zone `galacticsovereign.xyz`
2. Ensures tunnel ingress includes both `play.` and `admin.` → `http://127.0.0.1:8080`, plus catch-all `http_status:404`
3. Ensures a proxied DNS `CNAME` `admin` → `{tunnel_id}.cfargotunnel.com`
4. Lists Access apps; if none already cover `admin.galacticsovereign.xyz`, creates a self-hosted Access app for the **whole admin host** (all paths). Prefer copying allow-list emails from an existing play `/admin` Access app when present; otherwise allow `CF_ACCESS_OWNER_EMAIL`
5. Prints a JSON summary of actions (never prints the API token)

**Access must cover the entire admin host** (`admin.galacticsovereign.xyz`), not path fragments alone — so the admin UI and `/api/v1/admin/*` share one Access audience. Do not put Access on the whole `play.` host (players need the public game).

### Required API token permissions

Create a scoped API token with at least:

| Scope | Permission |
| --- | --- |
| Account | Cloudflare Tunnel — Edit (or Cloudflare One Connector: cloudflared — Edit) |
| Account | Access: Apps and Policies — Edit |
| Zone (`galacticsovereign.xyz`) | DNS — Edit |

Also set `CF_ACCESS_OWNER_EMAIL` to the owner email allowed through Access OTP when the admin Access app does not already exist.

## Custom Errors downtime page

1. Open the zone that serves `play.galacticsovereign.xyz`.
2. Go to **Rules → Custom Errors** (or **Error Pages**).
3. Create / upload a custom error asset using [`offline.html`](offline.html).
4. Add Custom Error rules (or Error Page mappings) for:
   - `502` (tunnel up, gateway down)
   - `530` (origin errors)
   - `1033` (Cloudflare Tunnel disconnected)
5. Point each rule at the offline asset so visitors see **Galactic Sovereign / Re-establishing subspace link** instead of the default Cloudflare page.
6. Confirm the page auto-refreshes; when the CT and tunnel return, players land back in the live game.

Smoke test (restore immediately after):

```bash
# From the CT as gs-admin:
sudo gsctl logs tunnel
# Briefly stop gateway → expect branded 502 at play.galacticsovereign.xyz
sudo systemctl stop galactic-sovereign-gateway.service
# Restore:
sudo gsctl ensure-units
```

## Email alerts

In Cloudflare **Notifications**:

1. **Tunnel Health Alert**
   - Scope: the galactic-sovereign tunnel
   - Delivery: email to the owner account
   - Fires when tunnel status leaves Healthy (Down / Degraded / Inactive)

2. **Health Check** on `https://play.galacticsovereign.xyz/healthz`
   - Expected: HTTP 200, JSON body with `"ok":true`
   - Interval: 60s (or dashboard default)
   - Notification: email on failure / recovery
   - Catches “tunnel healthy but gateway dead”

Optional later: add a webhook destination (Discord/SMS) to the same notifications.
