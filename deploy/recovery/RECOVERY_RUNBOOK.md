# Galactic Sovereign recovery runbook

This package intentionally contains no passwords, API tokens, private keys, or restic password. Retrieve those from the owner password manager or the separately encrypted offline recovery package.

## Recovery order

1. Restore Proxmox networking and private Tailscale management. Do not expose SSH or application ports on the router.
2. Create or restore the CT identified by the private `GS_PVE_CT_ID` setting, enable `onboot=1`, and set startup order `order=2,up=30,down=60`.
3. Restore the CT nftables policy and the Proxmox `ct.fw` policy before exposing application services.
4. Install restic credentials into `/etc/galactic-sovereign/credentials/` with mode `0600`.
5. Run `restic snapshots`, restore the newest verified snapshot into an isolated directory, and validate `SHA256SUMS`, `MANIFEST.json`, SQLite integrity, and `world.json` before copying data into `/var/lib/galactic-sovereign/`.
6. Restore the game and site releases identified by `RELEASES.json`; start co-op, gateway, site, and Tunnel through systemd.
7. Confirm only loopback listeners exist for ports 8080, 8081, and 9090. Confirm LAN access to ports 22, 8080, 8081, and 9090 is denied.
8. Restore the Cloudflare Tunnel ingress with apex first, then Play and Admin, followed by the catch-all 404. Restore the owner-only Access policy on the entire Admin hostname.
9. Verify Play, Admin, site, backups, signed heartbeat, email alerts, and both firewall layers before declaring recovery complete.

## Routine commands

- `sudo gsctl status`
- `sudo gsctl backup`
- `sudo gsctl offsite-backup`
- `sudo gsctl restore-test`
- `sudo gsctl firewall-status`
- `sudo gsctl site-status`

## Recovery acceptance

- The newest restored snapshot is within the 15-minute RPO or the incident explains why it is older.
- SQLite reports `ok`, every manifest checksum matches, and the multiplayer JSON parses.
- Play and co-op use the restored save data and the expected release identifiers.
- Admin rejects missing, expired, tampered, wrong-audience, and wrong-host Access tokens.
- No home-network application or management port is reachable directly from the LAN.
- A signed monitoring heartbeat is fresh and one test alert plus recovery email has been received.
