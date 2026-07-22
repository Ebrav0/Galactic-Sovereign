# Security

Galactic Sovereign is designed for **self-hosting on a home server** behind an outbound **Cloudflare Tunnel**, with administration over **Tailscale**. This document describes the intended threat model, operational controls, and the findings from the 2026-07 hardening pass.

## Threat model (intended)

| Surface | Exposure |
|---|---|
| Public players | HTTPS only via Cloudflare Tunnel → authenticated gateway (`127.0.0.1:8080`) |
| Persistent multiplayer | Loopback co-op host (`127.0.0.1:9090`), reachable only through the gateway WebSocket relay |
| Administration | Owner session in the app **plus** Cloudflare Access on `/admin` (recommended) |
| Operator / SSH | Tailscale only (`gs-admin`); traditional SSH should be disabled once Tailscale SSH is verified |
| Secrets | Root-owned files under `/etc/galactic-sovereign/credentials/`, loaded via systemd `LoadCredential` |

**Never** publish ports `8080` or `9090` on the router, LAN firewall, or Cloudflare ingress origin. The tunnel must be the only public path.

## Secure self-hosting

1. Run the packaged release under systemd (`galactic-sovereign-gateway`, `galactic-sovereign-coop`, `cloudflared-galactic-sovereign`).
2. Keep both Node processes on loopback. Production refuses to start the co-op host without a gateway secret and a loopback bind.
3. Create the first owner with `server/admin-cli.mjs` on the recovery console; force password change on first login.
4. Verify `curl -sf http://127.0.0.1:8080/healthz` and `curl -sf http://127.0.0.1:9090/health` before enabling the tunnel.
5. Use `sudo gsctl status|logs|backup|restore-test` for operations — do not run ad-hoc `npm run coop` on the CT.

See also [`server/README.md`](server/README.md) and [`deploy/`](deploy/).

## Cloudflare Tunnel recommendations

- Use an **outbound-only** tunnel token stored as `cloudflare-tunnel-token` in the credentials directory.
- Map a single public hostname to `http://127.0.0.1:8080`.
- Do **not** create Public Hostname routes to `:9090`.
- Enable Cloudflare **Access** (Zero Trust) in front of `/admin` and optionally `/api/v1/admin/*`:
  - Policy: allow only your admin identity provider emails / groups.
  - App session cookies remain required inside Access — Access is a second gate, not a replacement for owner auth.
- Configure Custom Errors / offline page from [`deploy/cloudflare/`](deploy/cloudflare/).
- Prefer “Full (strict)” TLS between Cloudflare and the origin only if you terminate TLS on the CT; with loopback HTTP behind the tunnel, the usual pattern is Cloudflare edge TLS + encrypted tunnel to origin.

## Tailscale recommendations

- Join the CT to your tailnet; enable Tailscale SSH for `gs-admin`.
- Keep game ports unreachable except via the tunnel; use Tailscale for SSH, Proxmox, and recovery.
- Start from [`deploy/tailscale-policy.hujson.example`](deploy/tailscale-policy.hujson.example) and deny broad ACL access to `8080`/`9090`.
- After Tailscale SSH is proven, disable password/open SSH on the public internet.

## Backup strategy

| Layer | Mechanism |
|---|---|
| Local | Hourly + daily timers (`gs-backup`) under `/var/lib/galactic-sovereign/backups` |
| Offsite | Restic → R2 (or compatible) via `gs-offsite-backup` when credentials are present |
| Integrity | `gs-restore-test` timer; manual `sudo gsctl restore latest` for disasters |

Back up accounts SQLite, multiplayer `world.json`, and credentials **separately** (credentials are root-only and must not enter player-facing backups without encryption).

## Secret management

| Secret | Location |
|---|---|
| `gateway-secret` | Shared by gateway + co-op; never in git or `.env` in production |
| `session-pepper` | Required whenever gateway auth is configured |
| Cloudflare tunnel token | Credential file / cloudflared unit |
| Restic / R2 keys | Credential files read only by backup units |

Rules:

- `.env` / `.env.*` are gitignored; [`.env.example`](.env.example) holds **placeholders only**.
- Workstation deploy targets live in ignored `.deploy.local.env`.
- Rotate gateway secret by rewriting the credential file and restarting both units together.
- Temporary owner/player passwords are shown **once** in the admin UI and never stored in plaintext.

## Deployment checklist

- [ ] CT bootstrap complete; `galactic-sovereign` + locked `gs-admin` users exist
- [ ] Credential files present with mode `0600` / directory `0700`
- [ ] systemd units enabled; `NODE_ENV=production`; loopback binds
- [ ] Owner account created; temporary password changed
- [ ] Loopback healthz/health green
- [ ] Cloudflare Tunnel healthy; public `/healthz` green
- [ ] Cloudflare Access protecting `/admin`
- [ ] Tailscale SSH verified; public SSH disabled
- [ ] Local backup timer succeeded at least once
- [ ] Offsite restic backup (if configured) succeeded
- [ ] `gsctl restore-test` passed recently
- [ ] No `?coop=` invite links that embed passwords

## Admin dashboard (Access-backed)

The in-app **Account Administration** panel (`/admin`) is for the owner role. Recommended layout:

1. Put Cloudflare Access in front of `/admin*`.
2. Require a normal owner login + CSRF for every mutating API call.
3. Show metadata only: users, last login / last seen, session counts (never raw tokens), save slot summaries (never envelopes), coop health/online roster, audit events, backup file names/sizes, aggregate analytics.
4. Password resets mint a one-time temporary password; hashes are never returned.

## Prioritized findings (2026-07 audit)

### Critical — remediated
| Finding | Status |
|---|---|
| `devAction` cheats callable by any authenticated coop pilot | Blocked when `NODE_ENV=production` or gateway secret is set |
| Production co-op could start without gateway secret | Process refuses to start |
| Default co-op bind `0.0.0.0` | Default is now `127.0.0.1`; production requires loopback |

### High — remediated
| Finding | Status |
|---|---|
| Silent auto-join to arbitrary `?coop=` endpoints | Flag-style auto-join only; custom URLs require confirmation |
| Passwords in `?coopPass=` | Ignored; stripped from invite flow |
| Missing `maxPayload` on coop WebSocket | Explicit cap (default 256 KiB) |
| No hello / password rate limit | 5 failures / 15 minutes per client address |
| Plaintext reconnect tokens in `world.json` | Stored hashed (legacy plaintext accepted once, then upgraded) |

### Medium — remediated / mitigated
| Finding | Status |
|---|---|
| Weak WS message schema | Type allowlist + size/depth/forbidden-key checks |
| Password / reconnect token `===` compares | Timing-safe compares |
| Session pepper only when `NODE_ENV=production` | Also required whenever gateway secret is set |
| Health CORS `*` | Disabled in production |
| Prototype pollution via delta paths | `__proto__` / `constructor` / `prototype` rejected |
| Dev Panel default-on in shipped builds | Opt-in via `?dev=1` / localStorage |

### Low — accepted / documented
| Finding | Notes |
|---|---|
| Production hostname in systemd unit | Operational convenience; not a secret |
| CSP `style-src 'unsafe-inline'` | Needed by current UI; scripts remain `'self'` |
| Bootstrap `curl \| bash` NodeSource install | Documented supply-chain tradeoff for CT bootstrap |
| Login rate-limit trusts `cf-connecting-ip` | Safe only because the app stays on loopback behind Tunnel |

## Reporting issues

If you discover a vulnerability in a private deployment of this game:

1. Do **not** open a public issue with exploit details.
2. Contact the repository owner privately with reproduction steps and impact.
3. Prefer coordinated disclosure after a fix is available on the self-hosted release channel.
