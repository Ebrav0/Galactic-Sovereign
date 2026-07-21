# Co-op host (Milestone 0)

Shared-empire multiplayer host. Simulation runs on the server; clients connect over WebSocket.

## Product model

One website at `:8080` is the entry point:

| Mode | Where | Saves |
|------|--------|--------|
| **Single Player** | Browser-local original game | Per-browser `gs-save-*` slots |
| **Multiplayer** | This coop host (`:9090`) | Shared `world.json` on the CT |

Everyday play: open the site → title doors → Solo or Multiplayer. Invite deep links are optional.

## Home server (CT 909 — preferred)

Proxmox LXC **`galactic-sovereign`** on Tailscale: `100.67.50.44`

| Service | Port | systemd unit |
|---------|------|----------------|
| Static game | `8080` | `galactic-sovereign-web` |
| Co-op host | `9090` | `galactic-sovereign-coop` |

**Play (from any Tailscale device):**

```text
http://100.67.50.44:8080/
```

1. **Single Player** → Continue / Begin Academy / Load (local only).
2. **Multiplayer** → Shared Empire → Pilot Clearance → Request Docking.

Pause overlay includes **Return to Title** (autosaves Solo first; leaves co-op cleanly).

**Dev panel (testing builds):** press `` ` `` (backtick) in-game. Enabled by default on shipped CT builds; disable with `?dev=0` or `localStorage.setItem('gs-dev-panel','0')`. Force-enable with `?dev=1`.

**Optional invite deep link** (auto-joins; query params are stripped after a successful join):

```text
http://100.67.50.44:8080/?coop=ws://100.67.50.44:9090&coopName=alpha
http://100.67.50.44:8080/?coop=ws://100.67.50.44:9090&coopName=beta
```

Or MagicDNS: `http://galactic-sovereign:8080/`

**Deploy / update from your Mac** (via Proxmox host `halcyon`):

```bash
# from the project root
./scripts/deploy-home-ct.sh
```

**Fresh world on the CT:**

```bash
ssh root@100.65.176.48 'pct exec 909 -- bash -lc "
  systemctl stop galactic-sovereign-coop
  mkdir -p /root/backups
  cp -a /root/Galactic-Sovereign/server/data/world.json /root/backups/world-$(date +%Y%m%d-%H%M%S).json 2>/dev/null || true
  rm -f /root/Galactic-Sovereign/server/data/world.json /root/Galactic-Sovereign/server/data/world.json.tmp
  systemctl start galactic-sovereign-coop
"'
```

**Logs:**

```bash
ssh root@100.65.176.48 'pct exec 909 -- journalctl -u galactic-sovereign-coop -f'
```

## Run locally (laptop — optional)

```bash
GS_COOP_RESET=1 npm run coop   # fresh world
npm run dev                    # UI only
```

| Variable | Default | Meaning |
|----------|---------|---------|
| `GS_COOP_PORT` | `9090` | HTTP + WebSocket |
| `GS_COOP_HOST` | `0.0.0.0` | Bind address |
| `GS_COOP_PASSWORD` | _(empty)_ | Join password |
| `GS_COOP_SEED` | time-based | Seed for a **new** world |
| `GS_COOP_RESET` | — | Wipe world on boot |
| `GS_COOP_DATA_DIR` | `server/data` | Save directory |
| `GS_COOP_SUMMARY_EVERY` | `2` | Pose every N ticks (2 ≈ 10 Hz) |

Health: `http://100.67.50.44:9090/health`
