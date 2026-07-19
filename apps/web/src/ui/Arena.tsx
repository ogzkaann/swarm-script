import type { UpgradeEffect, WorldSnapshot } from '@swarm-script/shared';
import { useEffect, useRef, useState } from 'react';
import type Phaser from 'phaser';
import { gameBridge, type RenderMetrics } from '../game/GameBridge';

export function Arena({
  snapshot,
  upgrades,
  onUpgrade,
  reducedMotion,
  messageRate,
  speed,
}: {
  snapshot: WorldSnapshot | null;
  upgrades: UpgradeEffect[];
  onUpgrade: (id: string) => void;
  reducedMotion: boolean;
  messageRate: number;
  speed: 1 | 2 | 4;
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const game = useRef<Phaser.Game | null>(null);
  const [rendererStatus, setRendererStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [renderMetrics, setRenderMetrics] = useState<RenderMetrics>({
    latestReceivedTick: 0,
    latestRenderedTick: 0,
    snapshotAge: 0,
    droppedSnapshots: 0,
    renderFps: 0,
  });
  const motionPreference = useRef(reducedMotion);
  motionPreference.current = reducedMotion;

  useEffect(() => {
    let disposed = false;
    void import('../game/createGame')
      .then(({ createGame }) => {
        if (disposed || !host.current) return;
        const createdGame = createGame(host.current);
        game.current = createdGame;
        createdGame.events.once('ready', () => {
          setSceneReducedMotion(createdGame, motionPreference.current);
          if (!disposed) setRendererStatus('ready');
        });
      })
      .catch(() => {
        if (!disposed) setRendererStatus('error');
      });
    return () => {
      disposed = true;
      game.current?.destroy(true);
      game.current = null;
    };
  }, []);

  useEffect(() => {
    if (game.current) setSceneReducedMotion(game.current, reducedMotion);
  }, [reducedMotion]);

  useEffect(() => gameBridge.onRenderMetrics(setRenderMetrics), []);

  const enemyCount = snapshot?.entities.filter((entity) => entity.kind === 'enemy').length ?? 0;
  const archetypes = [
    ...new Set(
      snapshot?.entities
        .filter((entity) => entity.kind === 'enemy')
        .map((entity) => entity.archetype)
        .filter(Boolean) ?? [],
    ),
  ];
  const waveStartTick = snapshot?.events
    .filter((event) => event.type === 'wave-start')
    .at(-1)?.tick;
  return (
    <section className="arena-shell" aria-label="Combat arena">
      <div className="arena-topline">
        <span>
          <i className="pulse-dot" /> WAVE {snapshot?.wave || 1} / 3
        </span>
        <span className="arena-state">{snapshot?.phase ?? 'READY'}</span>
        <span>{enemyCount.toString().padStart(2, '0')} HOSTILES</span>
      </div>
      <div className="phaser-host" ref={host} data-testid="arena" />
      {rendererStatus !== 'ready' && (
        <div className={`chunk-loading ${rendererStatus === 'error' ? 'error' : ''}`} role="status">
          <i />
          <span>
            {rendererStatus === 'error'
              ? 'Renderer failed to initialize.'
              : 'Initializing arena renderer…'}
          </span>
        </div>
      )}
      <div
        className="debug-overlay"
        aria-label="Development performance overlay"
        data-testid="render-metrics"
      >
        <span>SIM {speed}×</span>
        <span>FPS {renderMetrics.renderFps}</span>
        <span>RX {renderMetrics.latestReceivedTick}</span>
        <span>DRAW {renderMetrics.latestRenderedTick}</span>
        <span>AGE {Math.round(renderMetrics.snapshotAge)}ms</span>
        <span>DROP {renderMetrics.droppedSnapshots}</span>
        <span>MSG {messageRate}/s</span>
      </div>
      {archetypes.length > 0 &&
        snapshot &&
        waveStartTick !== undefined &&
        snapshot.tick - waveStartTick < 180 && (
          <div className="enemy-intel">
            <span>CONTACTS</span>
            {archetypes.map((archetype) => (
              <b key={archetype}>{archetype?.replace('-', ' ')}</b>
            ))}
          </div>
        )}
      {!snapshot && (
        <div className="arena-callout">
          <span>LINK READY</span>
          <strong>Compile the squad. Start the swarm.</strong>
        </div>
      )}
      {snapshot?.phase === 'paused' && (
        <div className="arena-callout">
          <span>SIMULATION HELD</span>
          <strong>Logic paused at tick {snapshot.tick}</strong>
        </div>
      )}
      {upgrades.length > 0 && (
        <div className="upgrade-overlay" role="dialog" aria-label="Choose an upgrade">
          <div className="upgrade-heading">
            <span>WAVE {snapshot?.wave} CLEARED</span>
            <h2>Choose a squad protocol</h2>
          </div>
          <div className="upgrade-grid">
            {upgrades.map((upgrade, index) => (
              <button
                key={upgrade.id}
                className="upgrade-card"
                onClick={() => onUpgrade(upgrade.id)}
              >
                <span>0{index + 1}</span>
                <strong>{upgrade.name}</strong>
                <small>{upgrade.description}</small>
                <b className="synergy-label">BUILD SYNERGY</b>
                <small className="synergy">{upgrade.synergy}</small>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function setSceneReducedMotion(game: Phaser.Game, reducedMotion: boolean): void {
  const scene = game.scene.getScene('BattleScene') as {
    setReducedMotion?: (value: boolean) => void;
  };
  scene.setReducedMotion?.(reducedMotion);
}
