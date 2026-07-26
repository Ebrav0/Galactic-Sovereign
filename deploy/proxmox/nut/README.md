# UPS activation

The Proxmox host is prepared for a NUT-compatible UPS, but activation requires the physical UPS, its driver, and its USB or network identifier.

1. Connect the UPS to the Proxmox host and keep the host, router, and modem/ONT on battery-backed outlets.
2. Install `nut-server nut-client`, select the vendor driver, and define the UPS as `galactic-ups`.
3. Create a dedicated NUT monitor password in the password manager and replace the placeholder in `upsmon.conf.example` before installing it as `/etc/nut/upsmon.conf` with mode `0640`.
4. Configure `MODE=standalone` in `/etc/nut/nut.conf`, enable the driver, server, and monitor services, then verify `upsc galactic-ups@localhost`.
5. Simulate `LOWBATT`. Confirm a final immutable archive, clean CT shutdown, Proxmox shutdown, and automatic recovery after AC power returns.

Do not enable the sample until the UPS name, driver, and credentials are known.
