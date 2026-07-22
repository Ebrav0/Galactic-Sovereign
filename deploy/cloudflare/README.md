# Cloudflare edge ops for Galactic Sovereign

These settings live in the Cloudflare dashboard (not on the CT). They keep a branded page and email alerts available even when the home server is powered off.

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
