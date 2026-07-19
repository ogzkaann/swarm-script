import type { WorldSnapshot } from '@swarm-script/shared';
import { describe, expect, it } from 'vitest';
import { GameBridge } from './GameBridge';

const snapshot = (tick: number): WorldSnapshot => ({
  tick,
  simulationTime: tick / 30,
  phase: 'running',
  wave: 1,
  entities: [],
  squadHealth: 0,
  events: [],
  appliedUpgrades: [],
  metrics: {
    elapsedSeconds: 0,
    wavesCompleted: 0,
    totalDamage: 0,
    damageReceived: 0,
    enemiesDestroyed: 0,
    commandsExecuted: 0,
    idleDecisions: 0,
    perRobot: Object.fromEntries(
      ['striker', 'guardian', 'scout'].map((role) => [
        role,
        {
          damage: 0,
          damageReceived: 0,
          commands: 0,
          waits: 0,
          retreatsAbove80: 0,
          attacksOutOfRange: 0,
          abilityAttempts: 0,
          abilityFailures: 0,
        },
      ]),
    ) as WorldSnapshot['metrics']['perRobot'],
    abilitiesUsed: { striker: 0, guardian: 0, scout: 0 },
    shieldDamageBlocked: 0,
    markedBonusDamage: 0,
    sniperDamage: 0,
    splitChildrenDestroyed: 0,
  },
});

describe('latest snapshot bridge', () => {
  it('keeps only the newest snapshot and counts dropped stale snapshots', () => {
    const bridge = new GameBridge();
    bridge.publishSnapshot(snapshot(10));
    bridge.publishSnapshot(snapshot(14));
    bridge.publishSnapshot(snapshot(18));
    expect(bridge.consumeLatestSnapshot()?.snapshot.tick).toBe(18);
    expect(bridge.debugState()).toMatchObject({
      latestReceivedTick: 18,
      droppedSnapshots: 2,
      hasPending: false,
    });
  });

  it('never replays an already-consumed snapshot', () => {
    const bridge = new GameBridge();
    bridge.publishSnapshot(snapshot(22));
    expect(bridge.consumeLatestSnapshot()?.snapshot.tick).toBe(22);
    expect(bridge.consumeLatestSnapshot()).toBeNull();
  });
});
