# Secure hosted runtime

The production runtime has two loopback-only Node processes:

| Process | Bind | Purpose |
|---|---|---|
| Authenticated gateway | `127.0.0.1:8080` | Static build, accounts, solo saves, admin API, WebSocket relay |
| Persistent co-op host | `127.0.0.1:9090` | Continuously ticking server-authoritative universe |

Only the gateway is published, through an outbound Cloudflare Tunnel. Public hostnames:

| Hostname | Purpose |
|---|---|
| `https://play.galacticsovereign.xyz` | Game client |
| `https://admin.galacticsovereign.xyz` | Owner ops dashboard (Cloudflare Access + app owner role) |

The co-op port, databases, SSH, and hypervisor are never Cloudflare or router ingress targets.

## Owner admin dashboard

Owners who sign in on play are handed off to `GS_ADMIN_ORIGIN` via a one-time token (cookies are `__Host-` scoped and cannot cross subdomains).

Provision / repair the admin hostname:

```bash
export CLOUDFLARE_API_TOKEN=...   # Tunnel Edit + DNS Edit + Access apps
export CF_ACCESS_OWNER_EMAIL=you@example.com   # if Access app must be created
node deploy/cloudflare/provision-admin-hostname.mjs
```

See [deploy/cloudflare/README.md](../deploy/cloudflare/README.md).

Local same-origin admin UI (no DNS): leave `GS_ADMIN_ORIGIN` empty and open `/admin.html` on the gateway.

## Local development

```bash
GS_COOP_RESET=1 npm run coop
npm run dev
```

Direct co-op mode without a gateway is deliberately a local-development compatibility path. Production sets a shared systemd credential in both services; once present, the co-op host rejects every connection that did not come through the authenticated gateway.

## Production deployment

1. Copy `.deploy.local.env.example` to the ignored `.deploy.local.env` and fill in the private Proxmox route.
2. Run `scripts/deploy-secure-home.sh <release-id>`.
3. Create the first owner locally through the recovery console. Read the
   temporary password without echoing it, pass it on standard input, and clear
   the shell variable immediately:

   ```bash
   read -rsp 'Temporary owner password: ' gs_owner_password
   printf '%s' "$gs_owner_password" | runuser -u galactic-sovereign -- env \
     GS_DATA_DIR=/var/lib/galactic-sovereign/accounts \
     node /opt/galactic-sovereign/current/server/admin-cli.mjs \
     create-owner <username> '<display name>' --password-stdin
   unset gs_owner_password
   ```

   The owner must replace that temporary password on first login.

4. Verify loopback health, direct Tailscale SSH as `gs-admin`, and rollback before disabling traditional SSH.
5. Add the root-owned Cloudflare Tunnel credential, then run `sudo gsctl ensure-units` so gateway, coop, tunnel, health watch, and backup timers are enabled for boot.

Routine administrators can run only the root-owned `sudo gsctl` wrapper. Valid commands are `deploy`, `rollback`, `ensure-units`, `status`, `logs`, `backup`, `restore-test`, `restore`, and `restart`.

## Zero-touch recovery

After a power loss or CT reboot, the full game stack is expected to return without SSH:

1. Proxmox starts the CT (`onboot=1`).
2. `tailscaled` returns Tailscale SSH for `gs-admin`.
3. systemd starts `galactic-sovereign-coop`, `galactic-sovereign-gateway`, and `cloudflared-galactic-sovereign` (`Restart=always`).
4. Backup / restic / restore-test / health timers resume (`Persistent=true`).
5. `gs-health-watch` probes loopback health every minute and rate-limits automatic restarts.

Verify:

```bash
sudo gsctl status
curl -sf http://127.0.0.1:8080/healthz
curl -sf http://127.0.0.1:9090/health
curl -sf https://play.galacticsovereign.xyz/healthz
```

### Outage runbook

| Symptom | Expected automatic behavior | Manual only if stuck |
|---|---|---|
| Host power blip | CT onboot → units + tunnel restart → public healthz green | `sudo gsctl ensure-units` |
| Gateway/coop crash | `Restart=always` + health watch restart | `sudo gsctl restart` / `sudo gsctl logs …` |
| Public site down, CT up | Health watch may bounce cloudflared; Cloudflare emails fire | Check tunnel token + `sudo gsctl logs tunnel` |
| Disk / world corruption | Local hourly+daily snapshots; restic offsite | `sudo gsctl restore latest` (or a named snapshot) |
| Total disk loss | Restore restic snapshot to a temp path, then `gsctl restore /path/to/snapshot-….tar.gz` | Also re-run bootstrap if the CT is rebuilt |

While the CT or tunnel cannot answer, Cloudflare Custom Errors should serve [`deploy/cloudflare/offline.html`](../deploy/cloudflare/offline.html). Configure alerts and the downtime page using [`deploy/cloudflare/README.md`](../deploy/cloudflare/README.md).

Disaster restore (rare; not needed for normal power blips):

```bash
sudo gsctl backup
sudo gsctl restore latest
sudo gsctl status
```

## Data and credentials

- Releases: `/opt/galactic-sovereign/releases/<release-id>`
- Atomic current link: `/opt/galactic-sovereign/current`
- Accounts and saves: `/var/lib/galactic-sovereign/accounts`
- Multiplayer world: `/var/lib/galactic-sovereign/multiplayer`
- Local backups: `/var/lib/galactic-sovereign/backups`
- Root-only credentials: `/etc/galactic-sovereign/credentials`

Never add real deployment targets, tailnet addresses, CT identifiers, tunnel tokens, R2 credentials, Restic passwords, databases, worlds, or backups to this repository.

## Verification

```bash
npm run build
npm run verify:hosted-auth
npm run verify:hosted-ui
npm run verify:world-migration
```

The hosted authentication verifier covers save isolation, revision conflicts, account-derived multiplayer identity, and immediate disabled-session revocation. The browser verifier covers login, password replacement, local-save copying, owner administration, multiplayer, and reload recovery.
