import type { WorldSnapshot } from '@swarm-script/shared';

export function ResultOverlay({
  result,
  observations,
  onReset,
  onPresentation,
}: {
  result: WorldSnapshot;
  observations: string[];
  onReset: () => void;
  onPresentation: () => void;
}): React.JSX.Element {
  const metrics = result.metrics;
  return (
    <div className="result-backdrop" role="dialog" aria-label="Run results">
      <section className="result-panel">
        <p className="eyebrow">RUN ANALYSIS // {result.checksum}</p>
        <h2>{result.phase === 'victory' ? 'Protocol survived.' : 'Squad signal lost.'}</h2>
        <p className="result-lede">
          {result.phase === 'victory'
            ? 'Three waves cleared. Your logic held.'
            : 'Rework the rules, then deploy again.'}
        </p>
        <div className="result-metrics">
          <Metric label="Time" value={formatTime(metrics.elapsedSeconds)} />
          <Metric label="Waves" value={`${metrics.wavesCompleted}/3`} />
          <Metric label="Damage" value={Math.round(metrics.totalDamage).toString()} />
          <Metric label="Received" value={Math.round(metrics.damageReceived).toString()} />
          <Metric label="Destroyed" value={metrics.enemiesDestroyed.toString()} />
          <Metric label="Commands" value={metrics.commandsExecuted.toString()} />
        </div>
        <div className="contribution-list">
          {Object.entries(metrics.perRobot).map(([role, robot]) => (
            <div key={role}>
              <span>{role}</span>
              <b>{Math.round(robot.damage)} dmg</b>
              <small>{robot.commands} decisions</small>
            </div>
          ))}
        </div>
        <div className="ability-summary">
          <span>ABILITY USES</span>
          <b>Overcharge {metrics.abilitiesUsed.striker}</b>
          <b>Shield {metrics.abilitiesUsed.guardian}</b>
          <b>Mark {metrics.abilitiesUsed.scout}</b>
          <small>
            {Math.round(metrics.shieldDamageBlocked)} blocked ·{' '}
            {Math.round(metrics.markedBonusDamage)} marked bonus
          </small>
        </div>
        <section className="final-build" data-testid="final-build">
          <span>FINAL BUILD</span>
          <div>
            {result.appliedUpgrades.length ? (
              result.appliedUpgrades.map((upgrade) => (
                <article key={upgrade.id}>
                  <b>{upgrade.name}</b>
                  <small>{upgrade.synergy}</small>
                </article>
              ))
            ) : (
              <p>No protocols installed.</p>
            )}
          </div>
        </section>
        <div className="observations">
          {observations.map((observation) => (
            <p key={observation}>↳ {observation}</p>
          ))}
        </div>
        <div className="result-actions">
          <button onClick={onPresentation}>← PRESENTATION</button>
          <button className="primary-button" onClick={onReset}>
            REVISE &amp; RUN AGAIN
          </button>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;
}
