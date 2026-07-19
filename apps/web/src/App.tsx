import {
  DEFAULT_SCRIPTS,
  ROBOT_ROLES,
  type DecisionTrace,
  type MainToWorkerMessage,
  type RobotRole,
  type ScriptDiagnostic,
  type UpgradeEffect,
  type WorkerToMainMessage,
  type WorldSnapshot,
} from '@swarm-script/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { audioEngine } from './game/AudioEngine';
import { gameBridge } from './game/GameBridge';
import { Arena } from './ui/Arena';
import { CodeEditor } from './ui/CodeEditor';
import { ArchitecturePage, LandingPage, SwarmLogo } from './ui/Presentation';
import { ResultOverlay } from './ui/ResultOverlay';

interface FeedItem {
  id: number;
  text: string;
  tone?: 'good' | 'warn';
}

export default function App(): React.JSX.Element {
  const [path, setPath] = useState(() => window.location.pathname);
  const navigate = useCallback((nextPath: string) => {
    if (window.location.pathname !== nextPath) window.history.pushState({}, '', nextPath);
    setPath(nextPath);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  useEffect(() => {
    const syncPath = (): void => setPath(window.location.pathname);
    window.addEventListener('popstate', syncPath);
    return () => window.removeEventListener('popstate', syncPath);
  }, []);

  useEffect(() => {
    const onGame = path === '/play';
    const onArchitecture = path === '/architecture';
    document.title = onGame
      ? 'Play Swarm Script — Program the Squad'
      : onArchitecture
        ? 'Technical Architecture — Swarm Script'
        : 'Swarm Script — Program Your Squad';
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute(
        'content',
        onArchitecture
          ? 'Explore the safe scripting, deterministic worker simulation, and renderer architecture behind Swarm Script.'
          : 'Program a three-robot squad with a safe custom language, then watch the deterministic logic fight through three waves.',
      );
  }, [path]);

  if (path === '/play') return <GameScreen navigate={navigate} />;
  if (path === '/architecture') return <ArchitecturePage navigate={navigate} />;
  return <LandingPage navigate={navigate} />;
}

function GameScreen({ navigate }: { navigate: (path: string) => void }): React.JSX.Element {
  const worker = useRef<Worker | null>(null);
  const [scripts, setScripts] = useState<Record<RobotRole, string>>(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.has('e2e') && query.has('passive'))
      return {
        striker: 'otherwise { wait(); }',
        guardian: 'otherwise { wait(); }',
        scout: 'otherwise { wait(); }',
      };
    return { ...DEFAULT_SCRIPTS };
  });
  const [activeRobot, setActiveRobot] = useState<RobotRole>('striker');
  const [diagnostics, setDiagnostics] = useState<Partial<Record<RobotRole, ScriptDiagnostic[]>>>(
    {},
  );
  const [compileSuccess, setCompileSuccess] = useState(false);
  const [snapshot, setSnapshot] = useState<WorldSnapshot | null>(null);
  const [upgrades, setUpgrades] = useState<UpgradeEffect[]>([]);
  const [appliedUpgrades, setAppliedUpgrades] = useState<UpgradeEffect[]>([]);
  const [result, setResult] = useState<WorldSnapshot | null>(null);
  const [observations, setObservations] = useState<string[]>([]);
  const [seed, setSeed] = useState(43105);
  const [speed, setSpeed] = useState<1 | 2 | 4>(1);
  const [reducedMotion, setReducedMotion] = useState(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [volume, setVolume] = useState(() => Number(localStorage.getItem('swarm-volume') ?? 0.34));
  const [muted, setMuted] = useState(() => localStorage.getItem('swarm-muted') === 'true');
  const [activeTraces, setActiveTraces] = useState<Partial<Record<RobotRole, DecisionTrace>>>({});
  const [feed, setFeed] = useState<FeedItem[]>([
    { id: 1, text: 'Squad link initialized.', tone: 'good' },
  ]);
  const [messageRate, setMessageRate] = useState(0);
  const hudAt = useRef(0);
  const phaseRef = useRef<WorldSnapshot['phase'] | null>(null);
  const messageCounter = useRef(0);
  const feedId = useRef(2);

  const sources = useMemo(
    () => ROBOT_ROLES.map((robot) => ({ robot, source: scripts[robot] })),
    [scripts],
  );
  const send = useCallback(
    (message: MainToWorkerMessage) => worker.current?.postMessage(message),
    [],
  );
  const addFeed = useCallback((text: string, tone?: FeedItem['tone']) => {
    setFeed((current) =>
      [{ id: feedId.current++, text, ...(tone ? { tone } : {}) }, ...current].slice(0, 7),
    );
  }, []);

  useEffect(() => {
    const simulationWorker = new Worker(
      new URL('./workers/simulation.worker.ts', import.meta.url),
      { type: 'module' },
    );
    worker.current = simulationWorker;
    simulationWorker.onmessage = (event: MessageEvent<WorkerToMainMessage>) => {
      messageCounter.current += 1;
      const message = event.data;
      if (message.type === 'COMPILE_RESULT') {
        setDiagnostics(message.diagnostics);
        setCompileSuccess(message.success);
      }
      if (message.type === 'RUN_STARTED') addFeed(`Run ${message.seed} deployed.`, 'good');
      if (message.type === 'WORLD_SNAPSHOT') {
        gameBridge.publishSnapshot(message.snapshot);
        const phaseChanged = message.snapshot.phase !== phaseRef.current;
        phaseRef.current = message.snapshot.phase;
        if (performance.now() - hudAt.current > 180 || phaseChanged) {
          hudAt.current = performance.now();
          setSnapshot(message.snapshot);
        }
      }
      if (message.type === 'DECISION_TRACE') {
        gameBridge.publishTraces(message.traces);
        setActiveTraces((current) => ({
          ...current,
          ...Object.fromEntries(message.traces.map((trace) => [trace.robot, trace])),
        }));
      }
      if (message.type === 'WAVE_COMPLETED') addFeed(`Wave ${message.wave} neutralized.`, 'good');
      if (message.type === 'UPGRADE_OPTIONS') {
        setUpgrades(message.options);
        addFeed('Upgrade protocols available.');
      }
      if (message.type === 'RUN_COMPLETED') {
        setSnapshot(message.result);
        setResult(message.result);
        setObservations(message.observations);
        addFeed(
          message.result.phase === 'victory' ? 'Arena secured.' : 'Squad lost.',
          message.result.phase === 'victory' ? 'good' : 'warn',
        );
      }
      if (message.type === 'SIMULATION_ERROR') addFeed(message.message, 'warn');
    };
    const rateTimer = window.setInterval(() => {
      setMessageRate(messageCounter.current);
      messageCounter.current = 0;
    }, 1000);
    return () => {
      clearInterval(rateTimer);
      simulationWorker.terminate();
      worker.current = null;
    };
  }, [addFeed]);

  useEffect(() => {
    audioEngine.setVolume(volume);
    localStorage.setItem('swarm-volume', String(volume));
  }, [volume]);

  useEffect(() => {
    audioEngine.setMuted(muted);
    localStorage.setItem('swarm-muted', String(muted));
  }, [muted]);

  useEffect(() => {
    const timer = window.setTimeout(() => send({ type: 'COMPILE_SCRIPTS', scripts: sources }), 180);
    return () => clearTimeout(timer);
  }, [send, sources]);

  const run = (): void => {
    void audioEngine.unlock();
    gameBridge.reset();
    setResult(null);
    setUpgrades([]);
    setAppliedUpgrades([]);
    setActiveTraces({});
    const shortRun = new URLSearchParams(window.location.search).has('e2e');
    send({
      type: 'START_RUN',
      config: { seed, scripts: sources, reducedMotion, ...(shortRun ? { shortRun: true } : {}) },
    });
  };
  const reset = (): void => {
    send({ type: 'RESET_RUN' });
    setSnapshot(null);
    phaseRef.current = null;
    setResult(null);
    setUpgrades([]);
    setAppliedUpgrades([]);
    setActiveTraces({});
    gameBridge.reset();
    addFeed('Run reset. Scripts retained.');
  };
  const chooseUpgrade = (upgradeId: string): void => {
    const selected = upgrades.find((upgrade) => upgrade.id === upgradeId);
    if (selected) setAppliedUpgrades((current) => [...current, selected]);
    setUpgrades([]);
    send({ type: 'CHOOSE_UPGRADE', upgradeId });
  };
  const togglePause = (): void => {
    if (snapshot?.phase === 'paused') send({ type: 'RESUME_RUN' });
    else send({ type: 'PAUSE_RUN' });
  };
  const changeSpeed = (nextSpeed: 1 | 2 | 4): void => {
    setSpeed(nextSpeed);
    send({ type: 'SET_SPEED', speed: nextSpeed });
  };
  const running = snapshot && ['running', 'paused', 'upgrade'].includes(snapshot.phase);
  const activeDiagnostics = diagnostics[activeRobot] ?? [];
  const activeEntity = snapshot?.entities.find(
    (entity) => entity.kind === 'robot' && entity.role === activeRobot,
  );

  return (
    <>
      <main className="app-shell">
        <header className="brand-bar">
          <SwarmLogo compact />
          <div>
            <p>TACTICAL AUTOMATION ROGUELITE</p>
            <h1>
              SWARM <span>SCRIPT</span>
            </h1>
          </div>
          <nav className="game-nav" aria-label="Game links">
            <a
              href="/"
              onClick={(event) => {
                event.preventDefault();
                navigate('/');
              }}
            >
              Presentation
            </a>
            <a
              href="/architecture"
              onClick={(event) => {
                event.preventDefault();
                navigate('/architecture');
              }}
            >
              About / Technical Details
            </a>
          </nav>
          <div className="system-status">
            <i /> WORKER LINK / ONLINE
          </div>
        </header>
        <div className="game-layout">
          <aside className="script-panel panel-frame">
            <div className="panel-heading">
              <span>01</span>
              <div>
                <p>SQUAD LOGIC</p>
                <h2>Behavior editor</h2>
              </div>
            </div>
            <div className="robot-tabs" role="tablist" aria-label="Robot scripts">
              {ROBOT_ROLES.map((role) => (
                <button
                  key={role}
                  role="tab"
                  aria-selected={activeRobot === role}
                  onClick={() => setActiveRobot(role)}
                >
                  <i className={`role-icon ${role}`} />
                  {role}
                  <small>
                    {diagnostics[role]?.some((item) => item.severity === 'error') ? '!' : '✓'}
                  </small>
                </button>
              ))}
            </div>
            <CodeEditor
              key={activeRobot}
              modelKey={activeRobot}
              value={scripts[activeRobot]}
              diagnostics={activeDiagnostics}
              activeTrace={activeTraces[activeRobot]}
              onChange={(value) => setScripts((current) => ({ ...current, [activeRobot]: value }))}
            />
            <div className="ability-readout" data-testid="ability-readout">
              <span>{roleAbilityLabel(activeRobot)}</span>
              <b>{Math.round(activeEntity?.energy ?? 100)} EN</b>
              <i>
                {activeEntity?.abilityActive
                  ? 'ABILITY ACTIVE'
                  : activeEntity?.abilityCooldown
                    ? `READY IN ${activeEntity.abilityCooldown.toFixed(1)}s`
                    : 'ABILITY READY'}
              </i>
            </div>
            <div
              className={`compile-status ${compileSuccess ? 'valid' : 'invalid'}`}
              data-testid="compile-status"
            >
              <i />{' '}
              <strong>{compileSuccess ? 'ALL SYSTEMS VALID' : 'SCRIPT NEEDS ATTENTION'}</strong>
              <span>
                {activeDiagnostics[0]
                  ? `L${activeDiagnostics[0].span.start.line}:${activeDiagnostics[0].span.start.column} ${activeDiagnostics[0].message}`
                  : '3 robot programs compiled safely'}
              </span>
            </div>
            <details className="command-reference">
              <summary>
                COMMAND REFERENCE <span>+</span>
              </summary>
              <p>
                <b>Values</b> health · health_percent · energy · enemy.distance · attack_range ·
                ally_lowest_health · ability_ready · ability_cooldown · enemy.marked ·
                allies_under_threat
              </p>
              <p>
                <b>Commands</b> attack() · approach() · retreat() · guard() · wait() · overcharge()
                · shield() · mark()
              </p>
            </details>
          </aside>

          <Arena
            snapshot={snapshot}
            upgrades={upgrades}
            onUpgrade={chooseUpgrade}
            reducedMotion={reducedMotion}
            messageRate={messageRate}
            speed={speed}
          />

          <aside className="control-panel panel-frame">
            <div className="panel-heading">
              <span>02</span>
              <div>
                <p>RUN CONTROL</p>
                <h2>Deployment</h2>
              </div>
            </div>
            <label className="seed-field">
              SEED{' '}
              <input
                value={seed}
                disabled={Boolean(running)}
                type="number"
                onChange={(event) => setSeed(Number(event.target.value))}
              />
            </label>
            <button
              className="primary-button run-button"
              disabled={!compileSuccess || Boolean(running)}
              onClick={run}
              data-testid="run-button"
            >
              <span>▶</span> DEPLOY SWARM
            </button>
            <div className="control-row">
              <button
                onClick={togglePause}
                data-testid="pause-button"
                disabled={!snapshot || !['running', 'paused'].includes(snapshot.phase)}
              >
                {snapshot?.phase === 'paused' ? '▶ RESUME' : 'Ⅱ PAUSE'}
              </button>
              <button onClick={reset} disabled={!snapshot}>
                ↻ RESET
              </button>
            </div>
            <div className="speed-control">
              <span>SIM SPEED</span>
              <div>
                {([1, 2, 4] as const).map((value) => (
                  <button
                    key={value}
                    className={speed === value ? 'active' : ''}
                    onClick={() => changeSpeed(value)}
                  >
                    {value}×
                  </button>
                ))}
              </div>
            </div>
            <section className="metrics-block">
              <h3>SQUAD TELEMETRY</h3>
              <MetricLine
                label="Integrity"
                value={`${Math.round(snapshot?.squadHealth ?? 380)}`}
                max={snapshot ? 380 : 380}
              />
              <MetricLine
                label="Damage"
                value={`${Math.round(snapshot?.metrics.totalDamage ?? 0)}`}
              />
              <MetricLine label="Destroyed" value={`${snapshot?.metrics.enemiesDestroyed ?? 0}`} />
              <MetricLine label="Commands" value={`${snapshot?.metrics.commandsExecuted ?? 0}`} />
            </section>
            <section className="upgrade-stack">
              <h3>ACTIVE MODS</h3>
              {appliedUpgrades.length ? (
                appliedUpgrades.map((upgrade) => (
                  <div key={upgrade.id}>
                    <i />{' '}
                    <span>
                      <b>{upgrade.name}</b>
                      <small>{upgrade.description}</small>
                    </span>
                  </div>
                ))
              ) : (
                <p>No protocols installed.</p>
              )}
            </section>
            <section className="event-feed">
              <h3>EVENT STREAM</h3>
              {feed.map((item) => (
                <p key={item.id} className={item.tone}>
                  <time>{String(item.id).padStart(3, '0')}</time>
                  {item.text}
                </p>
              ))}
            </section>
            <div className="accessibility-controls">
              <label className="motion-toggle">
                <input
                  type="checkbox"
                  checked={reducedMotion}
                  onChange={(event) => setReducedMotion(event.target.checked)}
                />
                <span /> REDUCED MOTION
              </label>
              <button
                className="mute-button"
                onClick={() => {
                  void audioEngine.unlock();
                  setMuted((current) => !current);
                }}
                aria-pressed={muted}
              >
                {muted ? 'AUDIO OFF' : 'AUDIO ON'}
              </button>
              <label className="volume-control">
                VOL
                <input
                  aria-label="Sound volume"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={volume}
                  onChange={(event) => {
                    void audioEngine.unlock();
                    setVolume(Number(event.target.value));
                  }}
                />
              </label>
            </div>
          </aside>
        </div>
        {result && (
          <ResultOverlay
            result={result}
            observations={observations}
            onReset={reset}
            onPresentation={() => navigate('/')}
          />
        )}
      </main>
      <section className="unsupported-screen" role="status">
        <SwarmLogo />
        <p>TACTICAL DISPLAY UNAVAILABLE</p>
        <h1>Swarm Script needs a wider screen.</h1>
        <span>
          The behavior editor and arena require at least 1024 pixels. Reopen the game on a desktop
          or expand this window.
        </span>
        <a
          href="/"
          onClick={(event) => {
            event.preventDefault();
            navigate('/');
          }}
        >
          Return to the presentation
        </a>
      </section>
    </>
  );
}

function roleAbilityLabel(role: RobotRole): string {
  if (role === 'striker') return 'OVERCHARGE // 45 EN';
  if (role === 'guardian') return 'SHIELD // 40 EN';
  return 'MARK // 30 EN';
}

function MetricLine({
  label,
  value,
  max,
}: {
  label: string;
  value: string;
  max?: number;
}): React.JSX.Element {
  return (
    <div className="metric-line">
      <span>{label}</span>
      <strong>{value}</strong>
      {max && (
        <i>
          <b style={{ width: `${Math.min(100, (Number(value) / max) * 100)}%` }} />
        </i>
      )}
    </div>
  );
}
