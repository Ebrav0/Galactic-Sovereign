import {
  ArrowClockwise,
  CaretRight,
  ChartLineUp,
  CheckCircle,
  CloudCheck,
  Database,
  Gauge,
  GlobeHemisphereWest,
  HardDrives,
  House,
  Info,
  LockKey,
  SignOut,
  Pulse,
  ShieldCheck,
  Users,
  Warning,
  X,
  XCircle,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type ServiceState = 'operational' | 'offline' | 'unknown';
type OverallState = 'operational' | 'degraded' | 'critical' | 'offline' | 'unknown';
type Tab = 'overview' | 'systems' | 'activity' | 'recovery';

type Status = {
  state: OverallState;
  freshness: 'live' | 'stale' | 'offline' | 'awaiting';
  generatedAt: number;
  lastReportAt: number | null;
  heartbeatAgeSeconds: number | null;
  readiness: number | null;
  services: Record<'gateway' | 'coop' | 'site' | 'tunnel' | 'firewall' | 'backup', ServiceState>;
  findings: Array<{ key: string; severity: 'warning' | 'critical'; message: string }>;
  metrics: { playersOnline: number | null; diskUsePercent: number | null; backupAgeSeconds: number | null };
  recovery: { localRestoreTestAt: number | null; offsiteRestoreTestAt: number | null; upsState: string | null };
  releases: { game: string | null; website: string | null };
  source: { kind: string; normalIntervalSeconds: number; staleAfterSeconds: number };
};

type Session = { identity: { email: string | null; expiresAt: number }; logoutUrl: string };
type TrendPoint = { timestamp: number; backupAgeSeconds: number; diskUsePercent: number; playersOnline: number; servicesAvailable: number };

const tabs: Array<{ id: Tab; label: string; Icon: typeof House }> = [
  { id: 'overview', label: 'Overview', Icon: House },
  { id: 'systems', label: 'Systems', Icon: Pulse },
  { id: 'activity', label: 'Activity', Icon: ChartLineUp },
  { id: 'recovery', label: 'Recovery', Icon: ShieldCheck },
];

const serviceLabels: Record<keyof Status['services'], { name: string; detail: string; Icon: typeof House }> = {
  site: { name: 'Main website', detail: 'galacticsovereign.xyz', Icon: GlobeHemisphereWest },
  gateway: { name: 'Play gateway', detail: 'Accounts, saves, and game access', Icon: LockKey },
  coop: { name: 'Co-op universe', detail: 'Persistent multiplayer simulation', Icon: Users },
  tunnel: { name: 'Cloudflare tunnel', detail: 'Private route to the command node', Icon: CloudCheck },
  firewall: { name: 'Firewall policy', detail: 'Approved host network rules', Icon: ShieldCheck },
  backup: { name: 'Backup freshness', detail: 'Newest protected recovery copy', Icon: Database },
};

function api<T>(path: string): Promise<T> {
  return fetch(path, { credentials: 'same-origin', headers: { accept: 'application/json' } }).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload as T;
  });
}

function relativeTime(timestampSeconds: number | null): string {
  if (!timestampSeconds) return 'Never';
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestampSeconds);
  if (seconds < 10) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function duration(seconds: number | null): string {
  if (seconds === null) return 'Unavailable';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

function fullDate(timestampSeconds: number | null): string {
  if (!timestampSeconds) return 'No verification recorded';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(timestampSeconds * 1000);
}

function StateIcon({ state, size = 22 }: { state: ServiceState | OverallState; size?: number }) {
  if (state === 'operational') return <CheckCircle size={size} weight="fill" aria-hidden="true" />;
  if (state === 'unknown') return <Info size={size} weight="fill" aria-hidden="true" />;
  return state === 'degraded' ? <Warning size={size} weight="fill" aria-hidden="true" /> : <XCircle size={size} weight="fill" aria-hidden="true" />;
}

function StatePill({ state }: { state: ServiceState | OverallState }) {
  const label = state === 'operational' ? 'Healthy' : state === 'offline' ? 'Offline' : state === 'unknown' ? 'Unknown' : state === 'degraded' ? 'Degraded' : 'Action needed';
  return <span className={`state-pill state-pill--${state}`}><StateIcon state={state} size={15} />{label}</span>;
}

function MetricCard({ label, value, detail, Icon }: { label: string; value: string; detail: string; Icon: typeof House }) {
  return (
    <article className="metric-card">
      <Icon size={21} weight="duotone" aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function Overview({ status }: { status: Status }) {
  const title = status.state === 'operational' ? 'All systems operational' : status.state === 'unknown' ? 'Awaiting first report' : status.state === 'offline' ? 'Command node offline' : 'Attention required';
  const description = status.freshness === 'live'
    ? status.findings.length ? `${status.findings.length} finding${status.findings.length === 1 ? '' : 's'} need review.` : 'Every monitored production system is reporting normally.'
    : status.freshness === 'awaiting' ? 'No signed production heartbeat is available yet.' : 'Last-known values are shown below and are not treated as current.';

  return (
    <div className="screen-stack">
      <section className={`command-card command-card--${status.state}`}>
        <div className="command-card__mark"><img src="/assets/brand-sigil.png" alt="" /></div>
        <p className="eyebrow">Production posture</p>
        <h1>{title}</h1>
        <p>{description}</p>
        <div className="command-card__footer">
          <StatePill state={status.state} />
          <span>Report {relativeTime(status.lastReportAt)}</span>
        </div>
      </section>

      <div className="metric-grid" aria-label="Key metrics">
        <MetricCard Icon={Gauge} label="Readiness" value={status.readiness === null ? '—' : `${status.readiness}%`} detail={status.freshness === 'live' ? 'Current report' : 'Last report'} />
        <MetricCard Icon={Users} label="Pilots online" value={status.metrics.playersOnline === null ? '—' : String(status.metrics.playersOnline)} detail="Authenticated co-op" />
        <MetricCard Icon={HardDrives} label="Disk used" value={status.metrics.diskUsePercent === null ? '—' : `${Math.round(status.metrics.diskUsePercent)}%`} detail="Command node" />
        <MetricCard Icon={Database} label="Backup age" value={status.metrics.backupAgeSeconds === null ? '—' : duration(status.metrics.backupAgeSeconds)} detail="Target under 30m" />
      </div>

      <section className="section-card">
        <div className="section-heading">
          <div><p className="eyebrow">Needs attention</p><h2>{status.findings.length ? 'Active findings' : 'Clear flight path'}</h2></div>
          <span className="count-badge">{status.findings.length}</span>
        </div>
        <div className="finding-list">
          {status.findings.length ? status.findings.map((finding) => (
            <div className={`finding finding--${finding.severity}`} key={finding.key}>
              {finding.severity === 'critical' ? <XCircle size={22} weight="fill" aria-hidden="true" /> : <Warning size={22} weight="fill" aria-hidden="true" />}
              <span><strong>{finding.severity === 'critical' ? 'Critical' : 'Warning'}</strong><small>{finding.message}</small></span>
            </div>
          )) : (
            <div className="finding finding--clear">
              <CheckCircle size={22} weight="fill" aria-hidden="true" />
              <span><strong>No active incidents</strong><small>All signed checks are within their healthy thresholds.</small></span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Systems({ status }: { status: Status }) {
  return (
    <div className="screen-stack">
      <header className="screen-heading"><p className="eyebrow">Live matrix</p><h1>Production systems</h1><p>Values become unknown when telemetry is stale so an old healthy report can never look current.</p></header>
      <section className="service-list" aria-label="Production service states">
        {(Object.keys(serviceLabels) as Array<keyof typeof serviceLabels>).map((key) => {
          const service = serviceLabels[key];
          return (
            <article className="service-row" key={key}>
              <span className={`service-icon service-icon--${status.services[key]}`}><service.Icon size={24} weight="duotone" aria-hidden="true" /></span>
              <span className="service-copy"><strong>{service.name}</strong><small>{service.detail}</small></span>
              <StatePill state={status.services[key]} />
            </article>
          );
        })}
      </section>
      <section className="truth-card">
        <Info size={22} weight="fill" aria-hidden="true" />
        <div><strong>Signed at the source</strong><p>Every value comes from the home command node’s HMAC-signed heartbeat. The app cannot modify game or server state.</p></div>
      </section>
    </div>
  );
}

function TrendChart({ points }: { points: TrendPoint[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !points.length) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);
    context.strokeStyle = 'rgba(104,216,255,.14)';
    context.lineWidth = 1;
    for (let row = 1; row < 4; row += 1) {
      const y = (height / 4) * row;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
    const series = [
      { color: '#68d8ff', values: points.map((point) => Math.min(100, point.diskUsePercent)) },
      { color: '#65d887', values: points.map((point) => Math.min(100, point.playersOnline * 10)) },
      { color: '#f6bd4b', values: points.map((point) => Math.min(100, point.backupAgeSeconds / 36)) },
    ];
    for (const item of series) {
      context.beginPath();
      context.strokeStyle = item.color;
      context.lineWidth = 2;
      item.values.forEach((value, index) => {
        const x = item.values.length === 1 ? width / 2 : (index / (item.values.length - 1)) * width;
        const y = height - (value / 100) * (height - 12) - 6;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
    }
  }, [points]);
  return <canvas ref={ref} className="trend-chart" role="img" aria-label="Disk, player, and backup telemetry trend" />;
}

function Activity({ status, history, period, setPeriod }: { status: Status; history: TrendPoint[]; period: string; setPeriod: (period: string) => void }) {
  return (
    <div className="screen-stack">
      <header className="screen-heading"><p className="eyebrow">Telemetry</p><h1>Capacity & activity</h1><p>Sanitized operational samples. No player identities or network addresses are stored here.</p></header>
      <section className="section-card">
        <div className="period-picker" role="group" aria-label="Trend period">
          {['24h', '7d', '30d'].map((value) => <button key={value} type="button" className={period === value ? 'is-active' : ''} onClick={() => setPeriod(value)}>{value}</button>)}
        </div>
        {history.length ? <TrendChart points={history} /> : <div className="empty-chart"><ChartLineUp size={31} weight="duotone" /><strong>Trend history is building</strong><small>New signed samples will appear here automatically.</small></div>}
        <div className="chart-legend"><span className="legend-cyan">Disk use</span><span className="legend-green">Players</span><span className="legend-gold">Backup age</span></div>
      </section>
      <section className="section-card release-card">
        <p className="eyebrow">Active releases</p>
        <div><span>Game</span><strong>{status.releases.game || 'Unknown'}</strong></div>
        <div><span>Website</span><strong>{status.releases.website || 'Unknown'}</strong></div>
      </section>
    </div>
  );
}

function Recovery({ status }: { status: Status }) {
  const rows = [
    { title: 'Local restore test', value: fullDate(status.recovery.localRestoreTestAt), ok: Boolean(status.recovery.localRestoreTestAt), Icon: HardDrives },
    { title: 'Offsite restore test', value: fullDate(status.recovery.offsiteRestoreTestAt), ok: Boolean(status.recovery.offsiteRestoreTestAt), Icon: CloudCheck },
    { title: 'Newest backup', value: status.metrics.backupAgeSeconds === null ? 'Freshness unavailable' : `${duration(status.metrics.backupAgeSeconds)} old`, ok: status.services.backup === 'operational', Icon: Database },
    { title: 'UPS state', value: status.recovery.upsState || 'Unavailable', ok: !status.recovery.upsState || !/\bLB\b|LOW/i.test(status.recovery.upsState), Icon: Pulse },
  ];
  return (
    <div className="screen-stack">
      <header className="screen-heading"><p className="eyebrow">Continuity</p><h1>Recovery posture</h1><p>Backup existence is not enough. These checks track whether protected data can actually be restored.</p></header>
      <section className="recovery-list">
        {rows.map((row) => (
          <article className="recovery-row" key={row.title}>
            <span className="recovery-icon"><row.Icon size={24} weight="duotone" aria-hidden="true" /></span>
            <span><strong>{row.title}</strong><small>{row.value}</small></span>
            {row.ok ? <CheckCircle className="state-good" size={22} weight="fill" aria-label="Healthy" /> : <Warning className="state-warning" size={22} weight="fill" aria-label="Review" />}
          </article>
        ))}
      </section>
      <section className="truth-card">
        <ShieldCheck size={22} weight="fill" aria-hidden="true" />
        <div><strong>Read-only by design</strong><p>Restarts, rollbacks, player controls, credentials, and backup contents are intentionally unavailable from this mobile app.</p></div>
      </section>
    </div>
  );
}

function AccountSheet({ session, close }: { session: Session; close: () => void }) {
  return (
    <div className="sheet-backdrop" role="presentation" onClick={close}>
      <section className="account-sheet" role="dialog" aria-modal="true" aria-labelledby="account-title" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-handle" />
        <button type="button" className="sheet-close" onClick={close} aria-label="Close account"><X size={22} /></button>
        <span className="account-mark"><ShieldCheck size={30} weight="duotone" /></span>
        <p className="eyebrow">Verified access</p>
        <h2 id="account-title">Owner session</h2>
        <p>{session.identity.email || 'Local authenticated preview'}</p>
        <small>Session expires {new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' }).format(session.identity.expiresAt)}</small>
        <a className="signout-button" href={session.logoutUrl}><SignOut size={20} />Sign out</a>
      </section>
    </div>
  );
}

function LoadingScreen() {
  return <main className="loading-screen"><img src="/assets/brand-sigil.png" alt="" /><p className="eyebrow">Secure command link</p><h1>Authenticating</h1><span className="loading-line" /></main>;
}

function ErrorScreen({ message, retry }: { message: string; retry: () => void }) {
  return (
    <main className="loading-screen error-screen">
      <XCircle size={46} weight="duotone" />
      <p className="eyebrow">Command link unavailable</p>
      <h1>Could not load status</h1>
      <p>{message}</p>
      <button type="button" onClick={retry}><ArrowClockwise size={20} />Try again</button>
    </main>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>('overview');
  const [status, setStatus] = useState<Status | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [history, setHistory] = useState<TrendPoint[]>([]);
  const [period, setPeriodState] = useState('24h');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [accountOpen, setAccountOpen] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const touchStart = useRef<number | null>(null);

  const load = useCallback(async (showSpinner = false, nextPeriod = period) => {
    if (showSpinner) setRefreshing(true);
    try {
      const [sessionPayload, statusPayload, historyPayload] = await Promise.all([
        api<Session & { ok: true }>('/api/session'),
        api<{ ok: true; status: Status }>('/api/status'),
        api<{ ok: true; points: TrendPoint[] }>(`/api/history?period=${nextPeriod}`),
      ]);
      setSession(sessionPayload);
      setStatus(statusPayload.status);
      setHistory(historyPayload.points);
      setError('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Secure status request failed');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [period]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [load]);

  const selectPeriod = useCallback((value: string) => {
    setPeriodState(value);
    void load(true, value);
  }, [load]);

  useEffect(() => {
    window.render_game_to_text = () => JSON.stringify({
      app: 'galactic-sovereign-mobile-status',
      activeTab: tab,
      loading,
      online,
      error: error || null,
      status: status ? {
        state: status.state,
        freshness: status.freshness,
        lastReportAt: status.lastReportAt,
        services: status.services,
        findings: status.findings.map((finding) => finding.key),
        metrics: status.metrics,
      } : null,
    });
    window.advanceTime = () => undefined;
  }, [error, loading, online, status, tab]);

  const screen = useMemo(() => {
    if (!status) return null;
    if (tab === 'systems') return <Systems status={status} />;
    if (tab === 'activity') return <Activity status={status} history={history} period={period} setPeriod={selectPeriod} />;
    if (tab === 'recovery') return <Recovery status={status} />;
    return <Overview status={status} />;
  }, [history, period, selectPeriod, status, tab]);

  if (loading) return <LoadingScreen />;
  if (error && !status) return <ErrorScreen message={error} retry={() => void load(true)} />;
  if (!status || !session) return <ErrorScreen message="The status response was incomplete." retry={() => void load(true)} />;

  return (
    <div
      className="app-shell"
      onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientY ?? null; }}
      onTouchEnd={(event) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (start !== null && start < 90 && (event.changedTouches[0]?.clientY ?? start) - start > 72) void load(true);
      }}
    >
      <header className="app-bar">
        <div className="brand-mini"><img src="/assets/brand-sigil.png" alt="" /><span><strong>GS Status</strong><small>{online ? 'Secure link active' : 'Phone offline'}</small></span></div>
        <button className="icon-button" type="button" onClick={() => void load(true)} aria-label="Refresh status"><ArrowClockwise className={refreshing ? 'is-spinning' : ''} size={22} /></button>
        <button className="account-button" type="button" onClick={() => setAccountOpen(true)} aria-label="Open owner account"><ShieldCheck size={23} weight="duotone" /><CaretRight size={15} /></button>
      </header>
      {refreshing && <div className="refresh-indicator" role="status">Refreshing signed telemetry…</div>}
      {!online && <div className="offline-banner" role="status">Your phone is offline. Showing the last loaded report.</div>}
      {error && <div className="offline-banner offline-banner--error" role="status">{error}</div>}
      <main className="app-content">{screen}</main>
      <nav className="bottom-nav" aria-label="Status sections">
        {tabs.map(({ id, label, Icon }) => (
          <button type="button" key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => { setTab(id); window.scrollTo({ top: 0, behavior: 'auto' }); }}>
            <Icon size={24} weight={tab === id ? 'fill' : 'regular'} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {accountOpen && <AccountSheet session={session} close={() => setAccountOpen(false)} />}
    </div>
  );
}

declare global {
  interface Window {
    render_game_to_text: () => string;
    advanceTime: (milliseconds: number) => void;
  }
}
