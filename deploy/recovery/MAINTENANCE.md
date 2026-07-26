# Maintenance policy

- Routine unattended updates are limited to the operating system's configured security origins and never reboot automatically.
- Planned restart window: Sunday, 04:00–06:00 America/New_York.
- Before a kernel, Proxmox, Cloudflare Tunnel, restic, Node.js, or major application update, create and verify a local snapshot plus an offsite snapshot.
- Update the public site/Admin release first, verify health and alerts, then update Play only when its baseline regression checks pass.
- Keep the previous game and site releases available for immediate atomic-symlink rollback.
