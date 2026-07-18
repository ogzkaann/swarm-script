import { DEFAULT_SCRIPTS, ROBOT_ROLES, type RobotRole } from '@swarm-script/shared';
import { compileScript, type Program } from '@swarm-script/scripting';
import { describe, expect, it } from 'vitest';
import { SeededRandom, SwarmSimulation } from './index';

function programs(): Record<RobotRole, Program> {
  return Object.fromEntries(
    ROBOT_ROLES.map((role) => [role, compileScript(DEFAULT_SCRIPTS[role]).program!]),
  ) as Record<RobotRole, Program>;
}

function complete(seed: number): SwarmSimulation {
  const simulation = new SwarmSimulation({ seed, programs: programs(), shortRun: true });
  simulation.start();
  for (
    let index = 0;
    index < 20_000 && !['victory', 'defeat'].includes(simulation.getPhase());
    index += 1
  ) {
    simulation.step();
    if (simulation.getPhase() === 'upgrade')
      simulation.chooseUpgrade(simulation.getUpgradeOptions()[0]!.id);
  }
  return simulation;
}

describe('deterministic simulation', () => {
  it('repeats the same run checksum for the same seed and scripts', () => {
    expect(complete(43110).checksum()).toBe(complete(43110).checksum());
  });

  it('allows different seeds to produce different results', () => {
    expect(complete(1).checksum()).not.toBe(complete(2).checksum());
  });

  it('uses a repeatable PRNG', () => {
    const left = new SeededRandom(42);
    const right = new SeededRandom(42);
    expect([left.next(), left.next(), left.next()]).toEqual([
      right.next(),
      right.next(),
      right.next(),
    ]);
  });

  it('moves, attacks, applies cooldowns and damage, kills enemies, and completes waves', () => {
    const simulation = complete(91);
    const snapshot = simulation.snapshot();
    expect(snapshot.phase).toBe('victory');
    expect(snapshot.metrics.wavesCompleted).toBe(3);
    expect(snapshot.metrics.totalDamage).toBeGreaterThan(0);
    expect(snapshot.metrics.enemiesDestroyed).toBe(3);
    expect(snapshot.metrics.commandsExecuted).toBeGreaterThan(0);
    expect(snapshot.entities.filter((entity) => entity.kind === 'enemy')).toHaveLength(0);
  });

  it('pauses, resumes, and applies deterministic upgrades', () => {
    const simulation = new SwarmSimulation({ seed: 7, programs: programs(), shortRun: true });
    simulation.start();
    const tick = simulation.snapshot().tick;
    simulation.pause();
    simulation.step();
    expect(simulation.snapshot().tick).toBe(tick);
    simulation.resume();
    expect(simulation.step().traces).toHaveLength(3);
    while (simulation.getPhase() === 'running') simulation.step();
    const options = simulation.getUpgradeOptions();
    expect(options).toHaveLength(3);
    expect(simulation.chooseUpgrade(options[0]!.id)).toBe(true);
    expect(simulation.getPhase()).toBe('running');
  });

  it('can transition to defeat with a passive squad', () => {
    const passive = compileScript('otherwise { wait(); }').program!;
    const simulation = new SwarmSimulation({
      seed: 3,
      programs: { striker: passive, guardian: passive, scout: passive },
      shortRun: true,
    });
    simulation.start();
    for (let index = 0; index < 20_000 && simulation.getPhase() !== 'defeat'; index += 1)
      simulation.step();
    expect(simulation.getPhase()).toBe('defeat');
    expect(simulation.snapshot().metrics.damageReceived).toBeGreaterThan(0);
  });

  it('keeps the default full run in the intended three-to-five-minute envelope', () => {
    const simulation = new SwarmSimulation({ seed: 43110, programs: programs() });
    simulation.start();
    for (
      let index = 0;
      index < 100_000 && !['victory', 'defeat'].includes(simulation.getPhase());
      index += 1
    ) {
      simulation.step();
      if (simulation.getPhase() === 'upgrade')
        simulation.chooseUpgrade(simulation.getUpgradeOptions()[0]!.id);
    }
    const snapshot = simulation.snapshot();
    expect(
      snapshot.phase,
      `Default run ended after ${snapshot.simulationTime.toFixed(1)} seconds with ${snapshot.metrics.enemiesDestroyed} kills.`,
    ).toBe('victory');
    expect(snapshot.simulationTime).toBeGreaterThanOrEqual(180);
    expect(snapshot.simulationTime).toBeLessThanOrEqual(300);
  });
});
