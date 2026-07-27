export const HEARTBEAT_STALE_SECONDS = 15 * 60;
export const HEARTBEAT_OFFLINE_SECONDS = 60 * 60;

export type ServiceKey = 'gateway' | 'coop' | 'site' | 'tunnel';
export type ServiceState = 'operational' | 'offline' | 'unknown';

export type Heartbeat = {
  timestamp: number;
  services: Record<ServiceKey, boolean>;
  backupAgeSeconds: number;
  diskUsePercent: number;
  firewallOk: boolean;
  restoreTestAt: number;
  offsiteRestoreTestAt: number;
  upsState: string;
  release: string;
  siteRelease: string;
  playersOnline: number;
};

export type Finding = {
  key: string;
  severity: 'warning' | 'critical';
  message: string;
};

export type StatusSnapshot = {
  schemaVersion: 1;
  state: 'operational' | 'degraded' | 'critical' | 'offline' | 'unknown';
  freshness: 'live' | 'stale' | 'offline' | 'awaiting';
  generatedAt: number;
  lastReportAt: number | null;
  heartbeatAgeSeconds: number | null;
  readiness: number | null;
  services: Record<ServiceKey | 'firewall' | 'backup', ServiceState>;
  findings: Finding[];
  metrics: {
    playersOnline: number | null;
    diskUsePercent: number | null;
    backupAgeSeconds: number | null;
  };
  recovery: {
    localRestoreTestAt: number | null;
    offsiteRestoreTestAt: number | null;
    upsState: string | null;
  };
  releases: {
    game: string | null;
    website: string | null;
  };
  source: {
    kind: 'signed-home-server-heartbeat';
    normalIntervalSeconds: 300;
    staleAfterSeconds: number;
  };
};

const serviceKeys: ServiceKey[] = ['gateway', 'coop', 'site', 'tunnel'];
const safeRelease = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

function boundedNumber(value: unknown, minimum: number, maximum: number, integer = false): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < minimum || value > maximum) return null;
  if (integer && !Number.isInteger(value)) return null;
  return value;
}

export function validateHeartbeat(value: unknown): Heartbeat | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const servicesInput = input.services;
  if (!servicesInput || typeof servicesInput !== 'object' || Array.isArray(servicesInput)) return null;

  const timestamp = boundedNumber(input.timestamp, 1, 4_102_444_800, true);
  const backupAgeSeconds = boundedNumber(input.backupAgeSeconds, 0, 365 * 86400, true);
  const diskUsePercent = boundedNumber(input.diskUsePercent, 0, 100);
  const restoreTestAt = boundedNumber(input.restoreTestAt, 0, 4_102_444_800, true);
  const offsiteRestoreTestAt = boundedNumber(input.offsiteRestoreTestAt, 0, 4_102_444_800, true);
  const playersOnline = boundedNumber(input.playersOnline, 0, 1000, true);
  if (timestamp === null || backupAgeSeconds === null || diskUsePercent === null || restoreTestAt === null || offsiteRestoreTestAt === null || playersOnline === null) return null;

  const services = {} as Record<ServiceKey, boolean>;
  for (const key of serviceKeys) {
    const serviceValue = (servicesInput as Record<string, unknown>)[key];
    if (typeof serviceValue !== 'boolean') return null;
    services[key] = serviceValue;
  }

  if (typeof input.firewallOk !== 'boolean') return null;
  if (typeof input.upsState !== 'string' || input.upsState.length > 32 || /[\u0000-\u001f]/.test(input.upsState)) return null;
  if (typeof input.release !== 'string' || !safeRelease.test(input.release)) return null;
  if (typeof input.siteRelease !== 'string' || !safeRelease.test(input.siteRelease)) return null;

  return {
    timestamp,
    services,
    backupAgeSeconds,
    diskUsePercent,
    firewallOk: input.firewallOk,
    restoreTestAt,
    offsiteRestoreTestAt,
    upsState: input.upsState,
    release: input.release,
    siteRelease: input.siteRelease,
    playersOnline,
  };
}

export function findings(heartbeat: Heartbeat, nowSeconds: number): Finding[] {
  const output: Finding[] = [];
  for (const [name, ok] of Object.entries(heartbeat.services)) {
    if (!ok) output.push({ key: `service-${name}`, severity: 'critical', message: `${name} service is unavailable` });
  }
  if (heartbeat.backupAgeSeconds > 1800) output.push({ key: 'backup-stale', severity: 'critical', message: `Newest backup is ${Math.round(heartbeat.backupAgeSeconds / 60)} minutes old` });
  if (heartbeat.diskUsePercent >= 90) output.push({ key: 'disk-critical', severity: 'critical', message: `Disk use is ${heartbeat.diskUsePercent}%` });
  else if (heartbeat.diskUsePercent >= 80) output.push({ key: 'disk-warning', severity: 'warning', message: `Disk use is ${heartbeat.diskUsePercent}%` });
  if (!heartbeat.firewallOk) output.push({ key: 'firewall-drift', severity: 'critical', message: 'Firewall is missing or differs from the approved policy' });
  if (!heartbeat.restoreTestAt) output.push({ key: 'restore-missing', severity: 'critical', message: 'No local restore verification has been recorded' });
  else if (nowSeconds - heartbeat.restoreTestAt > 8 * 86400) output.push({ key: 'restore-stale', severity: 'critical', message: 'Local restore verification is overdue' });
  if (!heartbeat.offsiteRestoreTestAt) output.push({ key: 'offsite-restore-missing', severity: 'critical', message: 'No offsite restore verification has been recorded' });
  else if (nowSeconds - heartbeat.offsiteRestoreTestAt > 35 * 86400) output.push({ key: 'offsite-restore-stale', severity: 'critical', message: 'Offsite clean-room restore is overdue' });
  if (/\bLB\b|LOW/i.test(heartbeat.upsState)) output.push({ key: 'ups-low', severity: 'critical', message: `UPS reports ${heartbeat.upsState}` });
  return output;
}

function freshnessFor(ageSeconds: number | null): StatusSnapshot['freshness'] {
  if (ageSeconds === null) return 'awaiting';
  if (ageSeconds <= HEARTBEAT_STALE_SECONDS) return 'live';
  if (ageSeconds <= HEARTBEAT_OFFLINE_SECONDS) return 'stale';
  return 'offline';
}

export function statusSnapshot(heartbeat: Heartbeat | null, nowSeconds: number): StatusSnapshot {
  const ageSeconds = heartbeat ? Math.max(0, nowSeconds - heartbeat.timestamp) : null;
  const freshness = freshnessFor(ageSeconds);
  const currentFindings = heartbeat ? findings(heartbeat, nowSeconds) : [];
  if (freshness === 'stale') currentFindings.unshift({ key: 'heartbeat-stale', severity: 'critical', message: 'Server telemetry is more than 15 minutes old' });
  if (freshness === 'offline') currentFindings.unshift({ key: 'heartbeat-offline', severity: 'critical', message: 'The home command node has not reported for more than one hour' });

  const trustworthy = Boolean(heartbeat && freshness === 'live');
  const serviceState = (healthy: boolean): ServiceState => trustworthy ? (healthy ? 'operational' : 'offline') : 'unknown';
  const criticalCount = currentFindings.filter((item) => item.severity === 'critical').length;
  const warningCount = currentFindings.length - criticalCount;
  const state: StatusSnapshot['state'] = !heartbeat
    ? 'unknown'
    : freshness === 'offline'
      ? 'offline'
      : criticalCount
        ? 'critical'
        : warningCount
          ? 'degraded'
          : 'operational';

  return {
    schemaVersion: 1,
    state,
    freshness,
    generatedAt: nowSeconds,
    lastReportAt: heartbeat?.timestamp ?? null,
    heartbeatAgeSeconds: ageSeconds,
    readiness: heartbeat ? Math.max(0, 100 - criticalCount * 25 - warningCount * 8) : null,
    services: {
      gateway: serviceState(heartbeat?.services.gateway ?? false),
      coop: serviceState(heartbeat?.services.coop ?? false),
      site: serviceState(heartbeat?.services.site ?? false),
      tunnel: serviceState(heartbeat?.services.tunnel ?? false),
      firewall: serviceState(heartbeat?.firewallOk ?? false),
      backup: serviceState(Boolean(heartbeat && heartbeat.backupAgeSeconds <= 1800)),
    },
    findings: currentFindings,
    metrics: {
      playersOnline: trustworthy ? heartbeat?.playersOnline ?? null : null,
      diskUsePercent: trustworthy ? heartbeat?.diskUsePercent ?? null : null,
      backupAgeSeconds: trustworthy ? heartbeat?.backupAgeSeconds ?? null : null,
    },
    recovery: {
      localRestoreTestAt: heartbeat?.restoreTestAt || null,
      offsiteRestoreTestAt: heartbeat?.offsiteRestoreTestAt || null,
      upsState: heartbeat?.upsState || null,
    },
    releases: {
      game: heartbeat?.release ?? null,
      website: heartbeat?.siteRelease ?? null,
    },
    source: {
      kind: 'signed-home-server-heartbeat',
      normalIntervalSeconds: 300,
      staleAfterSeconds: HEARTBEAT_STALE_SECONDS,
    },
  };
}

export type TrendPoint = Pick<Heartbeat, 'timestamp' | 'backupAgeSeconds' | 'diskUsePercent' | 'playersOnline'> & {
  servicesAvailable: number;
};

export function trendPoint(heartbeat: Heartbeat): TrendPoint {
  return {
    timestamp: heartbeat.timestamp,
    backupAgeSeconds: heartbeat.backupAgeSeconds,
    diskUsePercent: heartbeat.diskUsePercent,
    playersOnline: heartbeat.playersOnline,
    servicesAvailable: Object.values(heartbeat.services).filter(Boolean).length,
  };
}

export function aggregateTrendPoints(points: TrendPoint[], bucketSeconds: number): TrendPoint[] {
  const buckets = new Map<number, { count: number; backup: number; disk: number; players: number; services: number }>();
  for (const point of points) {
    const timestamp = Math.floor(point.timestamp / bucketSeconds) * bucketSeconds;
    const bucket = buckets.get(timestamp) ?? { count: 0, backup: 0, disk: 0, players: 0, services: 0 };
    bucket.count += 1;
    bucket.backup += point.backupAgeSeconds;
    bucket.disk += point.diskUsePercent;
    bucket.players += point.playersOnline;
    bucket.services += point.servicesAvailable;
    buckets.set(timestamp, bucket);
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([timestamp, bucket]) => ({
      timestamp,
      backupAgeSeconds: Math.round(bucket.backup / bucket.count),
      diskUsePercent: Number((bucket.disk / bucket.count).toFixed(2)),
      playersOnline: Number((bucket.players / bucket.count).toFixed(2)),
      servicesAvailable: Number((bucket.services / bucket.count).toFixed(2)),
    }));
}
