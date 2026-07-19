import {
  DEFAULT_SCRIPTS,
  ROBOT_ROLES,
  type MainToWorkerMessage,
  type WorkerToMainMessage,
} from '@swarm-script/shared';
import { describe, expect, it } from 'vitest';
import { SimulationHost } from './SimulationHost';

const scripts = ROBOT_ROLES.map((robot) => ({ robot, source: DEFAULT_SCRIPTS[robot] }));

describe('worker protocol host', () => {
  it('compiles and supports start, pause, resume, upgrades, and reset', () => {
    const messages: WorkerToMainMessage[] = [];
    const host = new SimulationHost((message) => messages.push(message));
    host.handle({ type: 'COMPILE_SCRIPTS', scripts });
    expect(messages.at(-1)).toMatchObject({ type: 'COMPILE_RESULT', success: true });
    host.handle({
      type: 'START_RUN',
      config: { seed: 45, scripts, reducedMotion: false, shortRun: true },
    });
    expect(messages.some((message) => message.type === 'RUN_STARTED')).toBe(true);
    host.handle({ type: 'PAUSE_RUN' });
    host.advanceFrame();
    const paused = [...messages].reverse().find((message) => message.type === 'WORLD_SNAPSHOT');
    expect(paused).toMatchObject({ type: 'WORLD_SNAPSHOT', snapshot: { phase: 'paused' } });
    host.handle({ type: 'RESUME_RUN' });
    host.handle({ type: 'SET_SPEED', speed: 4 });
    for (
      let index = 0;
      index < 5000 && !messages.some((message) => message.type === 'UPGRADE_OPTIONS');
      index += 1
    )
      host.advanceFrame();
    const upgrade = messages.find((message) => message.type === 'UPGRADE_OPTIONS');
    expect(upgrade?.type).toBe('UPGRADE_OPTIONS');
    if (upgrade?.type === 'UPGRADE_OPTIONS')
      host.handle({ type: 'CHOOSE_UPGRADE', upgradeId: upgrade.options[0]!.id });
    host.handle({ type: 'RESET_RUN' });
    const before = messages.length;
    host.advanceFrame();
    expect(messages).toHaveLength(before);
  });

  it('returns friendly compile errors without starting', () => {
    const messages: WorkerToMainMessage[] = [];
    const host = new SimulationHost((message) => messages.push(message));
    const bad: MainToWorkerMessage = {
      type: 'COMPILE_SCRIPTS',
      scripts: [{ robot: 'striker', source: 'eval()' }],
    };
    host.handle(bad);
    expect(messages[0]).toMatchObject({ type: 'COMPILE_RESULT', success: false });
  });

  it('completes a deterministic short run through both upgrade choices', () => {
    const messages: WorkerToMainMessage[] = [];
    const host = new SimulationHost((message) => messages.push(message));
    host.handle({
      type: 'START_RUN',
      config: { seed: 43110, scripts, reducedMotion: false, shortRun: true },
    });
    let handledUpgradeMessages = 0;
    for (
      let frame = 0;
      frame < 10_000 && !messages.some((message) => message.type === 'RUN_COMPLETED');
      frame += 1
    ) {
      host.advanceFrame();
      const upgradeMessages = messages.filter((message) => message.type === 'UPGRADE_OPTIONS');
      if (upgradeMessages.length > handledUpgradeMessages) {
        const latest = upgradeMessages.at(-1);
        if (latest?.type === 'UPGRADE_OPTIONS')
          host.handle({ type: 'CHOOSE_UPGRADE', upgradeId: latest.options[0]!.id });
        handledUpgradeMessages = upgradeMessages.length;
      }
    }
    expect(handledUpgradeMessages).toBe(2);
    expect(messages.find((message) => message.type === 'RUN_COMPLETED')).toMatchObject({
      type: 'RUN_COMPLETED',
      result: { phase: 'victory', metrics: { wavesCompleted: 3 } },
    });
  });

  it('switches 1×, 2×, and 4× speed without coupling simulation ticks to render frames', () => {
    const messages: WorkerToMainMessage[] = [];
    const host = new SimulationHost((message) => messages.push(message));
    host.handle({
      type: 'START_RUN',
      config: { seed: 43105, scripts, reducedMotion: false, shortRun: true },
    });
    host.handle({ type: 'SET_SPEED', speed: 1 });
    host.advanceFrame();
    host.advanceFrame();
    host.handle({ type: 'SET_SPEED', speed: 4 });
    host.advanceFrame();
    host.handle({ type: 'SET_SPEED', speed: 2 });
    host.advanceFrame();
    const ticks = messages
      .filter((message) => message.type === 'WORLD_SNAPSHOT')
      .map((message) => message.snapshot.tick);
    expect(ticks).toEqual([0, 2, 6, 8]);
    host.handle({ type: 'PAUSE_RUN' });
    host.advanceFrame();
    const paused = messages.filter((message) => message.type === 'WORLD_SNAPSHOT').at(-1);
    expect(paused).toMatchObject({
      type: 'WORLD_SNAPSHOT',
      snapshot: { tick: 8, phase: 'paused' },
    });
  });
});
