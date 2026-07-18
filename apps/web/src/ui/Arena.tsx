import type { UpgradeEffect, WorldSnapshot } from '@swarm-script/shared';
import { useEffect, useRef, useState } from 'react';
import type Phaser from 'phaser';

export function Arena({
  snapshot,
  upgrades,
  onUpgrade,
  reducedMotion,
  latency,
  messageRate,
}: {
  snapshot: WorldSnapshot | null;
  upgrades: UpgradeEffect[];
  onUpgrade: (id: string) => void;
  reducedMotion: boolean;
  latency: number;
  messageRate: number;
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const game = useRef<Phaser.Game | null>(null);
  const [rendererStatus, setRendererStatus] = useState<'loading' | 'ready' | 'error'>('loading');
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

  const enemyCount = snapshot?.entities.filter((entity) => entity.kind === 'enemy').length ?? 0;
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
      <div className="debug-overlay" aria-label="Development performance overlay">
        <span>SIM 30 Hz</span>
        <span>RENDER {Math.round(game.current?.loop.actualFps ?? 0)} FPS</span>
        <span>ENT {snapshot?.entities.length ?? 0}</span>
        <span>LAT {Math.round(latency)} ms</span>
        <span>MSG {messageRate}/s</span>
      </div>
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
