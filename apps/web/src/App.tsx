import {
  DEFAULT_SCRIPTS,
  ROBOT_ROLES,
  type MainToWorkerMessage,
  type RobotRole,
  type ScriptDiagnostic,
  type UpgradeEffect,
  type WorkerToMainMessage,
  type WorldSnapshot,
} from '@swarm-script/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { gameBridge } from './game/GameBridge';
import { Arena } from './ui/Arena';
import { CodeEditor } from './ui/CodeEditor';
import { ResultOverlay } from './ui/ResultOverlay';

interface FeedItem {
  id: number;
  text: string;
  tone?: 'good' | 'warn';
}

export default function App(): React.JSX.Element {
  const worker = useRef<Worker | null>(null);
  const [scripts, setScripts] = useState<Record<RobotRole, string>>({ ...DEFAULT_SCRIPTS });
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
  const [seed, setSeed] = useState(43110);
  const [speed, setSpeed] = useState<1 | 2 | 4>(1);
  const [reducedMotion, setReducedMotion] = useState(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [feed, setFeed] = useState<FeedItem[]>([
    { id: 1, text: 'Squad link initialized.', tone: 'good' },
  ]);
  const [latency, setLatency] = useState(0);
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
        setLatency(Math.max(0, Date.now() - message.sentAt));
        const phaseChanged = message.snapshot.phase !== phaseRef.current;
        phaseRef.current = message.snapshot.phase;
        if (performance.now() - hudAt.current > 180 || phaseChanged) {
          hudAt.current = performance.now();
          setSnapshot(message.snapshot);
        }
      }
      if (message.type === 'DECISION_TRACE') gameBridge.publishTraces(message.traces);
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
    const timer = window.setTimeout(() => send({ type: 'COMPILE_SCRIPTS', scripts: sources }), 180);
    return () => clearTimeout(timer);
  }, [send, sources]);

  const run = (): void => {
    setResult(null);
    setUpgrades([]);
    setAppliedUpgrades([]);
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

  return (
    <main className="app-shell">
      <header className="brand-bar">
        <div className="brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div>
          <p>TACTICAL AUTOMATION ROGUELITE</p>
          <h1>
            SWARM <span>SCRIPT</span>
          </h1>
        </div>
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
            onChange={(value) => setScripts((current) => ({ ...current, [activeRobot]: value }))}
          />
          <div
            className={`compile-status ${compileSuccess ? 'valid' : 'invalid'}`}
            data-testid="compile-status"
          >
            <i /> <strong>{compileSuccess ? 'ALL SYSTEMS VALID' : 'SCRIPT NEEDS ATTENTION'}</strong>
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
              ally_lowest_health
            </p>
            <p>
              <b>Commands</b> attack() · approach() · retreat() · guard() · wait()
            </p>
          </details>
        </aside>

        <Arena
          snapshot={snapshot}
          upgrades={upgrades}
          onUpgrade={chooseUpgrade}
          reducedMotion={reducedMotion}
          latency={latency}
          messageRate={messageRate}
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
          <label className="motion-toggle">
            <input
              type="checkbox"
              checked={reducedMotion}
              onChange={(event) => setReducedMotion(event.target.checked)}
            />
            <span /> REDUCED MOTION
          </label>
        </aside>
      </div>
      {result && <ResultOverlay result={result} observations={observations} onReset={reset} />}
    </main>
  );
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
