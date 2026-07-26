#!/usr/bin/env bash
set -euo pipefail

[[ "$(id -u)" == 0 ]] || { echo 'run as root inside the application CT' >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl sqlite3 restic rclone openssl nftables unattended-upgrades

install -d -m 0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' \
  > /etc/apt/sources.list.d/cloudflared.list
apt-get update
apt-get install -y cloudflared
id cloudflared >/dev/null 2>&1 || useradd --system --home-dir /var/lib/cloudflared --shell /usr/sbin/nologin cloudflared

if ! command -v node >/dev/null || [[ "$(node -p 'Number(process.versions.node.split(`.`)[0])')" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

getent group galactic-sovereign >/dev/null || groupadd --system galactic-sovereign
id galactic-sovereign >/dev/null 2>&1 || useradd --system --gid galactic-sovereign --home-dir /var/lib/galactic-sovereign --shell /usr/sbin/nologin galactic-sovereign
getent group galactic-sovereign-site >/dev/null || groupadd --system galactic-sovereign-site
id galactic-sovereign-site >/dev/null 2>&1 || useradd --system --gid galactic-sovereign-site --home-dir /nonexistent --shell /usr/sbin/nologin galactic-sovereign-site
id gs-admin >/dev/null 2>&1 || useradd --create-home --shell /bin/bash gs-admin
passwd -l gs-admin >/dev/null

install -d -o root -g root -m 0755 /opt/galactic-sovereign /opt/galactic-sovereign/releases /opt/galactic-sovereign/site-releases
install -d -o galactic-sovereign -g galactic-sovereign -m 0700 \
  /var/lib/galactic-sovereign /var/lib/galactic-sovereign/accounts /var/lib/galactic-sovereign/multiplayer
install -d -o root -g root -m 0700 /var/lib/galactic-sovereign/backups /etc/galactic-sovereign/credentials
install -d -o root -g root -m 0700 /var/lib/galactic-sovereign/pre-migration /var/lib/galactic-sovereign/recovery
install -d -o root -g root -m 0755 /usr/local/libexec/galactic-sovereign

if [[ ! -s /etc/galactic-sovereign/credentials/gateway-secret ]]; then
  umask 077
  openssl rand -base64 48 > /etc/galactic-sovereign/credentials/gateway-secret
fi
if [[ ! -s /etc/galactic-sovereign/credentials/session-pepper ]]; then
  umask 077
  openssl rand -base64 48 > /etc/galactic-sovereign/credentials/session-pepper
fi
chmod 0600 /etc/galactic-sovereign/credentials/* 2>/dev/null || true

install -o root -g root -m 0644 deploy/security/20auto-upgrades /etc/apt/apt.conf.d/20auto-upgrades
install -o root -g root -m 0644 deploy/security/52galactic-sovereign-unattended-upgrades /etc/apt/apt.conf.d/52galactic-sovereign-unattended-upgrades

install -o root -g root -m 0755 deploy/gsctl /usr/local/sbin/gsctl
install -o root -g root -m 0755 deploy/gs-backup /usr/local/libexec/galactic-sovereign/gs-backup
install -o root -g root -m 0755 deploy/gs-offsite-backup /usr/local/libexec/galactic-sovereign/gs-offsite-backup
install -o root -g root -m 0755 deploy/gs-restore-test /usr/local/libexec/galactic-sovereign/gs-restore-test
install -o root -g root -m 0755 deploy/gs-restore /usr/local/libexec/galactic-sovereign/gs-restore
install -o root -g root -m 0755 deploy/gs-health-watch /usr/local/libexec/galactic-sovereign/gs-health-watch
install -o root -g root -m 0755 deploy/gs-restic-maintain /usr/local/libexec/galactic-sovereign/gs-restic-maintain
install -o root -g root -m 0755 deploy/gs-offsite-restore-test /usr/local/libexec/galactic-sovereign/gs-offsite-restore-test
install -o root -g root -m 0755 deploy/gs-immutable-archive /usr/local/libexec/galactic-sovereign/gs-immutable-archive
install -o root -g root -m 0755 deploy/gs-firewall-apply /usr/local/libexec/galactic-sovereign/gs-firewall-apply
install -o root -g root -m 0755 deploy/gs-firewall-rollback /usr/local/libexec/galactic-sovereign/gs-firewall-rollback
for unit in galactic-sovereign-web.service galactic-sovereign-coop.service; do
  if [[ -f "/etc/systemd/system/$unit" && ! -f "/var/lib/galactic-sovereign/pre-migration/$unit" ]]; then
    install -o root -g root -m 0600 "/etc/systemd/system/$unit" "/var/lib/galactic-sovereign/pre-migration/$unit"
  fi
done
install -o root -g root -m 0644 deploy/systemd/* /etc/systemd/system/

cat >/etc/sudoers.d/galactic-sovereign-admin <<'SUDOERS'
gs-admin ALL=(root) NOPASSWD: /usr/local/sbin/gsctl
SUDOERS
chmod 0440 /etc/sudoers.d/galactic-sovereign-admin
visudo -cf /etc/sudoers.d/galactic-sovereign-admin

/usr/local/sbin/gsctl ensure-units
systemctl disable --now postfix.service 2>/dev/null || true

if command -v systemctl >/dev/null; then
  systemctl enable --now tailscaled.service 2>/dev/null || true
fi
if command -v tailscale >/dev/null; then
  tailscale set --ssh --accept-risk=lose-ssh
fi

echo 'CT bootstrap complete. Keep OpenSSH enabled until direct Tailscale SSH as gs-admin is verified.'
