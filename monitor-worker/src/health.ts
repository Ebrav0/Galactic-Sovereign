export type Heartbeat = {
  timestamp: number;
  services: { gateway: boolean; coop: boolean; site: boolean; tunnel: boolean };
  backupAgeSeconds: number;
  diskUsePercent: number;
  firewallOk: boolean;
  restoreTestAt: number;
  offsiteRestoreTestAt: number;
  upsState: string;
  release: string;
  siteRelease: string;
};

export type Finding = { key: string; severity: 'warning' | 'critical'; message: string };

export function validateHeartbeat(value: unknown): Heartbeat | null {
  if (!value || typeof value !== 'object') return null;
  const h = value as Partial<Heartbeat>;
  if (!Number.isFinite(h.timestamp) || !h.services || typeof h.services !== 'object') return null;
  for (const key of ['gateway', 'coop', 'site', 'tunnel'] as const) if (typeof h.services[key] !== 'boolean') return null;
  for (const valueKey of ['backupAgeSeconds', 'diskUsePercent', 'restoreTestAt', 'offsiteRestoreTestAt'] as const) if (!Number.isFinite(h[valueKey])) return null;
  if (typeof h.firewallOk !== 'boolean' || typeof h.upsState !== 'string' || typeof h.release !== 'string' || typeof h.siteRelease !== 'string') return null;
  return h as Heartbeat;
}

export function findings(h: Heartbeat, nowSeconds: number): Finding[] {
  const out: Finding[] = [];
  for (const [name, ok] of Object.entries(h.services)) if (!ok) out.push({ key: `service-${name}`, severity: 'critical', message: `${name} service is unavailable` });
  if (h.backupAgeSeconds > 1800) out.push({ key: 'backup-stale', severity: 'critical', message: `Newest backup is ${Math.round(h.backupAgeSeconds / 60)} minutes old` });
  if (h.diskUsePercent >= 90) out.push({ key: 'disk-critical', severity: 'critical', message: `Disk use is ${h.diskUsePercent}%` });
  else if (h.diskUsePercent >= 80) out.push({ key: 'disk-warning', severity: 'warning', message: `Disk use is ${h.diskUsePercent}%` });
  if (!h.firewallOk) out.push({ key: 'firewall-drift', severity: 'critical', message: 'Firewall is missing or differs from the approved policy' });
  if (h.restoreTestAt && nowSeconds - h.restoreTestAt > 8 * 86400) out.push({ key: 'restore-stale', severity: 'critical', message: 'Local restore verification is overdue' });
  if (h.offsiteRestoreTestAt && nowSeconds - h.offsiteRestoreTestAt > 35 * 86400) out.push({ key: 'offsite-restore-stale', severity: 'critical', message: 'Offsite clean-room restore is overdue' });
  if (/\bLB\b|LOW/i.test(h.upsState)) out.push({ key: 'ups-low', severity: 'critical', message: `UPS reports ${h.upsState}` });
  return out;
}
