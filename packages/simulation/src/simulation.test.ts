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
    expect(snapshot.metrics.enemiesDestroyed).toBe(5);
    expect(snapshot.metrics.splitChildrenDestroyed).toBe(2);
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
    });
    simulation.start();
    for (let index = 0; index < 20_000 && simulation.getPhase() !== 'defeat'; index += 1)
      simulation.step();
    expect(simulation.getPhase()).toBe('defeat');
    expect(simulation.snapshot().metrics.damageReceived).toBeGreaterThan(0);
  });

  it('keeps a representative default full run in the intended two-to-three-minute envelope', () => {
    const simulation = new SwarmSimulation({ seed: 43105, programs: programs() });
    simulation.start();
    for (
      let index = 0;
      index < 100_000 && !['victory', 'defeat'].includes(simulation.getPhase());
      index += 1
    ) {
      simulation.step();
      if (simulation.getPhase() === 'upgrade')
        simulation.chooseUpgrade(simulation.getUpgradeOptions()[1]!.id);
    }
    const snapshot = simulation.snapshot();
    expect(
      snapshot.phase,
      `Default run ended after ${snapshot.simulationTime.toFixed(1)} seconds with ${snapshot.metrics.enemiesDestroyed} kills.`,
    ).toBe('victory');
    expect(snapshot.simulationTime).toBeGreaterThanOrEqual(120);
    expect(snapshot.simulationTime).toBeLessThanOrEqual(180);
  });

  it('applies role-specific ability costs, cooldowns, durations, mark amplification, and shield protection', () => {
    const abilityProgram = (ability: 'overcharge' | 'shield' | 'mark') =>
      compileScript(
        `when ability_ready == 1 { ${ability}(); } when enemy.distance <= attack_range { attack(); } otherwise { approach(); }`,
      ).program!;
    const simulation = new SwarmSimulation({
      seed: 12,
      programs: {
        striker: abilityProgram('overcharge'),
        guardian: abilityProgram('shield'),
        scout: abilityProgram('mark'),
      },
    });
    simulation.start();
    const first = simulation.step();
    expect(first.traces.every((trace) => trace.executed)).toBe(true);
    const active = simulation.snapshot();
    const robots = active.entities.filter((entity) => entity.kind === 'robot');
    expect(robots.find((robot) => robot.role === 'striker')).toMatchObject({
      energy: 55,
      abilityActive: 'overcharge',
    });
    expect(robots.find((robot) => robot.role === 'guardian')).toMatchObject({
      energy: 60,
      abilityActive: 'shield',
      shielded: true,
    });
    expect(robots.find((robot) => robot.role === 'scout')).toMatchObject({
      energy: 70,
      abilityActive: 'mark',
    });
    expect(active.entities.some((entity) => entity.kind === 'enemy' && entity.marked)).toBe(true);
    expect(active.metrics.abilitiesUsed).toEqual({ striker: 1, guardian: 1, scout: 1 });
    for (let tick = 0; tick < 100; tick += 1) simulation.step();
    expect(
      simulation.snapshot().entities.find((entity) => entity.role === 'striker')?.abilityActive,
    ).toBeUndefined();
    expect(simulation.snapshot().metrics.markedBonusDamage).toBeGreaterThan(0);
    expect(simulation.snapshot().metrics.shieldDamageBlocked).toBeGreaterThan(0);
  });

  it('introduces every enemy archetype, deterministic splitting, and a telegraphed commander', () => {
    const simulation = new SwarmSimulation({ seed: 43105, programs: programs() });
    simulation.start();
    expect(new Set(simulation.snapshot().entities.map((entity) => entity.archetype))).toEqual(
      new Set([undefined, 'swarmer', 'splitter']),
    );
    while (simulation.getPhase() === 'running') simulation.step();
    simulation.chooseUpgrade(simulation.getUpgradeOptions()[0]!.id);
    const waveTwoTypes = simulation
      .snapshot()
      .entities.map((entity) => entity.archetype)
      .filter(Boolean);
    expect(waveTwoTypes).toEqual(
      expect.arrayContaining(['swarmer', 'sniper', 'splitter', 'bulwark']),
    );
    while (simulation.getPhase() === 'running') simulation.step();
    simulation.chooseUpgrade(simulation.getUpgradeOptions()[0]!.id);
    expect(simulation.snapshot().entities.some((entity) => entity.archetype === 'commander')).toBe(
      true,
    );
    for (
      let tick = 0;
      tick < 500 && !simulation.snapshot().entities.some((entity) => entity.telegraph);
      tick += 1
    )
      simulation.step();
    expect(simulation.snapshot().entities.some((entity) => entity.telegraph)).toBe(true);
  });

  it('emits exactly one authoritative death event per destroyed enemy', () => {
    const simulation = new SwarmSimulation({ seed: 91, programs: programs(), shortRun: true });
    simulation.start();
    const events = new Map<number, ReturnType<SwarmSimulation['snapshot']>['events'][number]>();
    for (
      let tick = 0;
      tick < 20_000 && !['victory', 'defeat'].includes(simulation.getPhase());
      tick += 1
    ) {
      simulation.step();
      for (const event of simulation.snapshot().events) events.set(event.id, event);
      if (simulation.getPhase() === 'upgrade')
        simulation.chooseUpgrade(simulation.getUpgradeOptions()[0]!.id);
    }
    const deathEvents = [...events.values()].filter((event) => event.type === 'death');
    expect(new Set(deathEvents.map((event) => event.targetId)).size).toBe(deathEvents.length);
    expect(deathEvents).toHaveLength(simulation.snapshot().metrics.enemiesDestroyed);
    expect(deathEvents.filter((event) => event.finalInWave)).toHaveLength(3);
  });

  it('generates deterministic non-repeating upgrade choices and includes the final build', () => {
    const left = new SwarmSimulation({ seed: 77, programs: programs(), shortRun: true });
    const right = new SwarmSimulation({ seed: 77, programs: programs(), shortRun: true });
    for (const simulation of [left, right]) {
      simulation.start();
      while (simulation.getPhase() === 'running') simulation.step();
    }
    expect(left.getUpgradeOptions()).toEqual(right.getUpgradeOptions());
    const selected = left.getUpgradeOptions()[0]!;
    left.chooseUpgrade(selected.id);
    expect(left.snapshot().appliedUpgrades).toContainEqual(selected);
  });
});
