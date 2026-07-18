const gameplayScreenshot = new URL(
  '../../../../docs/screenshots/swarm-script-v0.1.png',
  import.meta.url,
).href;

const githubUrl = 'https://github.com/ogzkaann/swarm-script';

export function SwarmLogo({ compact = false }: { compact?: boolean }): React.JSX.Element {
  return (
    <span className={`swarm-logo ${compact ? 'compact' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 64 64" role="img">
        <path d="M32 3 61 32 32 61 3 32 32 3Z" />
        <path d="m32 15 17 17-17 17-17-17 17-17Z" />
        <circle cx="32" cy="7" r="3" />
        <circle cx="57" cy="32" r="3" />
        <circle cx="7" cy="32" r="3" />
      </svg>
    </span>
  );
}

export function LandingPage({ navigate }: { navigate: (path: string) => void }): React.JSX.Element {
  return (
    <main className="presentation-page">
      <nav className="presentation-nav" aria-label="Primary navigation">
        <a href="/" className="presentation-brand" onClick={(event) => route(event, '/', navigate)}>
          <SwarmLogo compact />
          <span>
            SWARM <b>SCRIPT</b>
          </span>
        </a>
        <div>
          <a href="/play" onClick={(event) => route(event, '/play', navigate)}>
            Play
          </a>
          <a href={githubUrl} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href="/architecture" onClick={(event) => route(event, '/architecture', navigate)}>
            Architecture
          </a>
        </div>
      </nav>

      <section className="landing-hero">
        <div className="hero-copy">
          <p className="landing-kicker">TACTICAL AUTOMATION ROGUELITE // BUILD 0.1</p>
          <SwarmLogo />
          <h1>
            SWARM <span>SCRIPT</span>
          </h1>
          <p className="hero-pitch">Program your squad. Watch the logic fight.</p>
          <p className="hero-detail">
            Write safe behavior rules for three robots, deploy them into a deterministic arena, and
            adapt between waves.
          </p>
          <div className="hero-actions">
            <a
              className="landing-primary"
              href="/play"
              onClick={(event) => route(event, '/play', navigate)}
              data-testid="play-now"
            >
              <span>▶</span> Play now
            </a>
            <a href="/architecture" onClick={(event) => route(event, '/architecture', navigate)}>
              Technical details <span>↗</span>
            </a>
          </div>
        </div>

        <figure className="game-preview">
          <div className="preview-chrome">
            <span>
              <i /> LIVE SIMULATION
            </span>
            <span>SEED 43110</span>
          </div>
          <img
            src={gameplayScreenshot}
            alt="Swarm Script gameplay showing the behavior editor, combat arena, and run controls"
          />
          <figcaption>Three robots. Three scripts. Three waves.</figcaption>
        </figure>
      </section>

      <section className="how-it-works" aria-labelledby="how-heading">
        <div className="section-heading">
          <p>RUN SEQUENCE</p>
          <h2 id="how-heading">Your logic is the loadout.</h2>
        </div>
        <ol>
          <li>
            <span>01</span>
            <div>
              <h3>Edit robot behavior</h3>
              <p>Shape each role with a compact, readable rule language.</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <h3>Run the simulation</h3>
              <p>Watch the same seed resolve the same way, frame after frame.</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <h3>Upgrade and survive</h3>
              <p>Choose a squad protocol between waves and hold through wave three.</p>
            </div>
          </li>
        </ol>
      </section>

      <section className="technical-strip" aria-labelledby="technical-heading">
        <div className="section-heading">
          <p>UNDER THE HOOD</p>
          <h2 id="technical-heading">Built as a game. Engineered as a system.</h2>
        </div>
        <ul>
          <li>
            <i>01</i>
            <span>Safe custom scripting language</span>
          </li>
          <li>
            <i>02</i>
            <span>Deterministic Web Worker simulation</span>
          </li>
          <li>
            <i>03</i>
            <span>Phaser renderer with React UI</span>
          </li>
          <li>
            <i>04</i>
            <span>Tested TypeScript monorepo</span>
          </li>
        </ul>
        <a href="/architecture" onClick={(event) => route(event, '/architecture', navigate)}>
          Read the technical architecture <span>→</span>
        </a>
      </section>

      <footer className="presentation-footer">
        <span>SWARM SCRIPT / PORTFOLIO RELEASE</span>
        <div>
          <a href="/play" onClick={(event) => route(event, '/play', navigate)}>
            Play
          </a>
          <a href={githubUrl} target="_blank" rel="noreferrer">
            GitHub repository
          </a>
          <a href="/architecture" onClick={(event) => route(event, '/architecture', navigate)}>
            Technical architecture
          </a>
        </div>
      </footer>
    </main>
  );
}

export function ArchitecturePage({
  navigate,
}: {
  navigate: (path: string) => void;
}): React.JSX.Element {
  return (
    <main className="presentation-page architecture-page">
      <nav className="presentation-nav" aria-label="Technical navigation">
        <a href="/" className="presentation-brand" onClick={(event) => route(event, '/', navigate)}>
          <SwarmLogo compact />
          <span>
            SWARM <b>SCRIPT</b>
          </span>
        </a>
        <div>
          <a href="/" onClick={(event) => route(event, '/', navigate)}>
            Presentation
          </a>
          <a href="/play" onClick={(event) => route(event, '/play', navigate)}>
            Play
          </a>
          <a href={githubUrl} target="_blank" rel="noreferrer">
            Source
          </a>
        </div>
      </nav>

      <header className="architecture-hero">
        <p className="landing-kicker">TECHNICAL ARCHITECTURE // V0.1</p>
        <h1>
          Logic stays authoritative.
          <br />
          <span>Presentation stays replaceable.</span>
        </h1>
        <p>
          Swarm Script separates editable player code, deterministic combat, and rendering so each
          boundary can be tested on its own.
        </p>
      </header>

      <section className="architecture-flow" aria-label="System data flow">
        <article>
          <span>01</span>
          <h2>React + Monaco</h2>
          <p>Players edit three robot programs and send typed commands.</p>
        </article>
        <i aria-hidden="true">→</i>
        <article>
          <span>02</span>
          <h2>Web Worker</h2>
          <p>The DSL compiles and the fixed-step simulation owns every rule.</p>
        </article>
        <i aria-hidden="true">→</i>
        <article>
          <span>03</span>
          <h2>Phaser view</h2>
          <p>Immutable snapshots become interpolated geometry and effects.</p>
        </article>
      </section>

      <section className="architecture-grid">
        <article>
          <p>SAFE BY CONSTRUCTION</p>
          <h2>No evaluated JavaScript</h2>
          <p>
            Source becomes tokens, a typed AST, static diagnostics, and budgeted interpreter steps.
            Unknown values and commands never reach the simulation.
          </p>
        </article>
        <article>
          <p>DETERMINISTIC CORE</p>
          <h2>Runs are reproducible</h2>
          <p>
            Fixed 30 Hz steps, stable entity ordering, seeded randomness, and final checksums make
            regressions observable.
          </p>
        </article>
        <article>
          <p>RESPONSIVE BOUNDARIES</p>
          <h2>Rendering cannot change combat</h2>
          <p>
            React receives throttled HUD data while Phaser receives snapshots through a thin bridge.
            The worker remains authoritative.
          </p>
        </article>
        <article>
          <p>VERIFIED FLOW</p>
          <h2>Tests cross the real seams</h2>
          <p>
            Vitest covers language, combat, upgrades, determinism, and worker messages. Playwright
            drives the playable loop in Chromium.
          </p>
        </article>
      </section>

      <section className="architecture-cta">
        <div>
          <p>SEE THE SYSTEM MOVE</p>
          <h2>Read the rules. Deploy the swarm.</h2>
        </div>
        <a
          className="landing-primary"
          href="/play"
          onClick={(event) => route(event, '/play', navigate)}
        >
          <span>▶</span> Play now
        </a>
      </section>
    </main>
  );
}

function route(
  event: React.MouseEvent<HTMLAnchorElement>,
  path: string,
  navigate: (path: string) => void,
): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return;
  event.preventDefault();
  navigate(path);
}
