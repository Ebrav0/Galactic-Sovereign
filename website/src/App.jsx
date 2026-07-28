import {
  ArrowRight,
  ArrowUpRight,
  CalendarBlank,
  CheckCircle,
  GameController,
  LockKey,
  Planet,
  ShieldCheck,
  Sparkle,
} from "@phosphor-icons/react";

const PLAY_URL = "https://play.galacticsovereign.xyz";
const ADMIN_URL = "https://admin.galacticsovereign.xyz";
const STATUS_URL = "https://mobile.galacticsovereign.xyz";

const releases = [
  {
    version: "0.1.0-dev.20260722",
    date: "July 22, 2026",
    title: "Hosted command network",
    summary: "Added authenticated hosted play, account-bound saves, a protected relay, and production operations for the home command node.",
    added: ["Hosted player accounts and server-side save slots", "Authenticated multiplayer gateway identity", "Atomic local and encrypted offsite backups"],
    changed: ["Save data now follows the player account", "Production traffic stays behind Cloudflare Tunnel"],
    fixed: ["Immediate session revocation across live multiplayer connections"],
    known: ["This remains an active development build rather than a public release."],
  },
  {
    version: "0.1.0-dev.20260720",
    date: "July 20, 2026",
    title: "Tactical Combat 2.0",
    summary: "Expanded flagship combat, the Helioclast weapon suite, tactical targeting, cinematic effects, and a licensed production audio system.",
    added: ["Tactical battle ownership and retreat flow", "Helioclast arsenal and explicit target lock", "Native Web Audio mixer with licensed cues"],
    changed: ["Combat actions now expose availability, cost, and state feedback", "Battle presentation is clearer and more cinematic"],
    fixed: ["Duplicate strategic and tactical unit rendering", "Missing flagship presentation during active battles"],
    known: ["Large-scale balance remains under active tuning."],
  },
  {
    version: "0.1.0-dev.20260716",
    date: "July 16, 2026",
    title: "Diplomacy and empire growth",
    summary: "Deepened faction diplomacy, strategic planning, trade, sanctions, AI relations, and the wider empire technology web.",
    added: ["Consequential treaties, councils, sanctions, and war goals", "AI-to-AI diplomacy and strategic reactions", "Expanded empire structures and logistics"],
    changed: ["Diplomacy now affects movement, trade, combat, and capture", "Research and production decisions span the whole empire"],
    fixed: ["Save migration alignment for the expanded strategic state"],
    known: ["Long-running bulk production orders are still being expanded."],
  },
  {
    version: "0.1.0-dev.20260714",
    date: "July 14, 2026",
    title: "Fleet and flagship systems",
    summary: "Introduced the flagship wing, advanced drones, broader combat doctrine, and the foundations of shared co-op command.",
    added: ["Flagship escorts and wing behavior", "Construction-drone planning", "Host-authoritative co-op foundations"],
    changed: ["Fleet doctrine and capital battle-line behavior", "Save format advanced with migration coverage"],
    fixed: ["Focused fleet, drone, and flagship verification gaps"],
    known: ["Co-op was still an internal development surface in this build."],
  },
];

function Brand({ compact = false }) {
  return (
    <a className={`brand ${compact ? "brand--compact" : ""}`} href="/" aria-label="Galactic Sovereign home">
      <img src="/assets/brand-sigil.png" alt="" width="48" height="48" />
      <span>Galactic Sovereign</span>
    </a>
  );
}

function Header() {
  return (
    <header className="site-header">
      <Brand />
      <nav aria-label="Primary navigation">
        <a href="/">Home</a>
        <a href="/changelog/">Changelog</a>
        <a href={STATUS_URL}>Status</a>
        <a href={PLAY_URL}>Play</a>
        <a href={ADMIN_URL}>Admin</a>
      </nav>
    </header>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <Brand compact />
      <p>Forge your empire across the stars.</p>
      <nav aria-label="Footer navigation">
        <a href={PLAY_URL}>Play</a>
        <a href={ADMIN_URL}>Admin</a>
        <a href={STATUS_URL}>Status</a>
        <a href="/changelog/">Changelog</a>
        <a href="/privacy/">Privacy</a>
      </nav>
      <small>© 2026 Galactic Sovereign. Active development build.</small>
    </footer>
  );
}

function ReleaseBadge({ children, tone = "cyan" }) {
  return <span className={`release-badge release-badge--${tone}`}>{children}</span>;
}

function ReleaseCard({ release, detailed = false }) {
  return (
    <article className={`release-card ${detailed ? "release-card--detailed" : ""}`}>
      <div className="release-card__head">
        <div>
          <p className="eyebrow">Development build</p>
          <h3>{release.title}</h3>
        </div>
        <div className="release-card__meta">
          <code>{release.version}</code>
          <span><CalendarBlank weight="duotone" aria-hidden="true" />{release.date}</span>
        </div>
      </div>
      <p>{release.summary}</p>
      {detailed ? (
        <div className="release-grid">
          <div><ReleaseBadge tone="gold">Added</ReleaseBadge><ul>{release.added.map((item) => <li key={item}>{item}</li>)}</ul></div>
          <div><ReleaseBadge>Changed</ReleaseBadge><ul>{release.changed.map((item) => <li key={item}>{item}</li>)}</ul></div>
          <div><ReleaseBadge tone="ice">Fixed</ReleaseBadge><ul>{release.fixed.map((item) => <li key={item}>{item}</li>)}</ul></div>
          <div><ReleaseBadge tone="muted">Known issues</ReleaseBadge><ul>{release.known.map((item) => <li key={item}>{item}</li>)}</ul></div>
        </div>
      ) : (
        <div className="release-card__badges">
          <ReleaseBadge tone="gold">Added</ReleaseBadge>
          <ReleaseBadge>Changed</ReleaseBadge>
          <ReleaseBadge tone="ice">Fixed</ReleaseBadge>
        </div>
      )}
    </article>
  );
}

function HomePage() {
  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__backdrop" aria-hidden="true" />
        <Header />
        <div className="hero__content">
          <img className="hero__sigil" src="/assets/brand-sigil.png" alt="" width="104" height="104" />
          <p className="eyebrow">Your empire. Your command.</p>
          <h1 id="hero-title">Galactic<br />Sovereign</h1>
          <p className="hero__tagline">Forge your empire across the stars.</p>
          <div className="hero__actions">
            <a className="button button--primary" href={PLAY_URL}><GameController weight="fill" aria-hidden="true" />Play game<ArrowUpRight aria-hidden="true" /></a>
            <a className="button button--secondary" href={ADMIN_URL}><ShieldCheck weight="duotone" aria-hidden="true" />Admin portal</a>
          </div>
          <a className="hero__status" href={STATUS_URL}><span aria-hidden="true" />Open mobile system status <ArrowRight aria-hidden="true" /></a>
        </div>
      </section>

      <main>
        <section className="intro section" aria-labelledby="intro-title">
          <div>
            <p className="eyebrow">A living galactic strategy sandbox</p>
            <h2 id="intro-title">Build an empire that answers to you.</h2>
          </div>
          <p>Restore a fallen command, expand across hundreds of systems, shape diplomacy, automate industry, and take direct control when fleets collide. Galactic Sovereign combines long-form empire strategy with tactical command and shared co-op play.</p>
          <div className="feature-row">
            <div><Planet weight="duotone" aria-hidden="true" /><strong>Explore</strong><span>Chart systems, wormholes, and strategic routes.</span></div>
            <div><Sparkle weight="duotone" aria-hidden="true" /><strong>Build</strong><span>Grow industry, research, fleets, and megastructures.</span></div>
            <div><ShieldCheck weight="duotone" aria-hidden="true" /><strong>Command</strong><span>Direct diplomacy, logistics, and tactical battles.</span></div>
          </div>
        </section>

        <section className="showcase section" aria-labelledby="showcase-title">
          <div className="showcase__copy">
            <p className="eyebrow">From the live build</p>
            <h2 id="showcase-title">One command view. An entire civilization.</h2>
            <p>Every system is part of a larger machine: production queues feed fleets, logistics sustain expansion, diplomacy changes borders, and monumental projects reshape the map.</p>
            <a className="text-link" href={PLAY_URL}>Enter the command network <ArrowRight aria-hidden="true" /></a>
          </div>
          <figure>
            <img src="/assets/gameplay-dyson.png" alt="An in-game Galactic Sovereign command view showing a developed Dyson system, build queues, logistics, fleet controls, and the Helioclast flagship." />
            <figcaption>Actual gameplay capture · Development build</figcaption>
          </figure>
        </section>

        <section className="updates section" aria-labelledby="updates-title">
          <div className="section-heading">
            <div><p className="eyebrow">Development log</p><h2 id="updates-title">Latest transmissions</h2></div>
            <a className="text-link" href="/changelog/">Full changelog <ArrowRight aria-hidden="true" /></a>
          </div>
          <div className="release-list">{releases.slice(0, 3).map((release) => <ReleaseCard key={release.version} release={release} />)}</div>
        </section>

        <section className="final-cta section">
          <img src="/assets/brand-sigil.png" alt="" width="72" height="72" />
          <p className="eyebrow">The sovereignty begins</p>
          <h2>Take command of the stars.</h2>
          <a className="button button--primary" href={PLAY_URL}>Play Galactic Sovereign <ArrowUpRight aria-hidden="true" /></a>
        </section>
      </main>
      <Footer />
    </>
  );
}

function PageShell({ eyebrow, title, intro, children }) {
  return (
    <>
      <div className="page-hero"><Header /><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{intro}</p></div></div>
      <main className="page-main">{children}</main>
      <Footer />
    </>
  );
}

function ChangelogPage() {
  return (
    <PageShell eyebrow="Development log" title="Changelog" intro="A truthful record of active Galactic Sovereign development builds. These entries describe real project milestones; they are not retroactive public release claims.">
      <section className="release-list release-list--full" aria-label="Development build history">
        {releases.map((release) => <ReleaseCard key={release.version} release={release} detailed />)}
      </section>
    </PageShell>
  );
}

function PrivacyPage() {
  return (
    <PageShell eyebrow="Command network" title="Privacy" intro="Plain-language information about the data used to operate Galactic Sovereign.">
      <section className="legal-card">
        <div><LockKey weight="duotone" aria-hidden="true" /><h2>What the service stores</h2><p>Account identity, authentication sessions, server-side save slots, multiplayer identity, operational security logs, and administrator audit events needed to run and protect the game.</p></div>
        <div><ShieldCheck weight="duotone" aria-hidden="true" /><h2>How it is protected</h2><p>The game is self-hosted behind Cloudflare Tunnel, management is restricted through Tailscale, passwords are stored as Argon2id hashes, and encrypted backups are kept offsite.</p></div>
        <div><CheckCircle weight="duotone" aria-hidden="true" /><h2>What is not sold</h2><p>Galactic Sovereign does not sell player information or use third-party advertising trackers. Operational providers process limited network and backup data only to deliver and secure the service.</p></div>
        <div><CalendarBlank weight="duotone" aria-hidden="true" /><h2>Retention and requests</h2><p>Account and save data remain while the account is active or backups are within their protected retention period. Contact the server owner through your existing invitation channel to request access or deletion.</p></div>
      </section>
      <p className="legal-updated">Last updated July 22, 2026.</p>
    </PageShell>
  );
}

function NotFoundPage() {
  return (
    <PageShell eyebrow="Navigation fault" title="Signal lost" intro="That coordinate does not exist in the current star chart.">
      <section className="not-found"><Planet weight="duotone" aria-hidden="true" /><p>Error 404 · Unknown sector</p><a className="button button--secondary" href="/">Return to command</a></section>
    </PageShell>
  );
}

export function App() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return <HomePage />;
  if (path === "/changelog") return <ChangelogPage />;
  if (path === "/privacy") return <PrivacyPage />;
  return <NotFoundPage />;
}
