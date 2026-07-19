import type {
  CombatEvent,
  DecisionTrace,
  EnemyArchetype,
  EntitySnapshot,
  WorldSnapshot,
} from '@swarm-script/shared';
import { ARENA_HEIGHT, ARENA_WIDTH } from '@swarm-script/simulation';
import Phaser from 'phaser';
import { audioEngine } from './AudioEngine';
import { gameBridge } from './GameBridge';

interface LabelState {
  text: Phaser.GameObjects.Text;
  expiresAt: number;
}

interface EffectBurst {
  x: number;
  y: number;
  age: number;
  duration: number;
  color: number;
  kind: 'impact' | 'death' | 'ability' | 'wave' | 'shot';
  intensity: CombatEvent['intensity'];
  seed: number;
}

interface DeathEcho {
  x: number;
  y: number;
  age: number;
  duration: number;
  radius: number;
  color: number;
  archetype?: EnemyArchetype;
}

interface Position {
  x: number;
  y: number;
  facing: number;
}

export class BattleScene extends Phaser.Scene {
  private worldGraphics!: Phaser.GameObjects.Graphics;
  private fxGraphics!: Phaser.GameObjects.Graphics;
  private snapshot: WorldSnapshot | null = null;
  private transitionStartedAt = 0;
  private transitionDuration = 34;
  private lastSnapshotAt = 0;
  private latestRenderedTick = 0;
  private startPositions = new Map<string, Position>();
  private renderedPositions = new Map<string, Position>();
  private labels = new Map<string, LabelState>();
  private bursts: EffectBurst[] = [];
  private deathEchoes: DeathEcho[] = [];
  private processedEventIds = new Set<number>();
  private recoilUntil = new Map<string, number>();
  private hitStopUntil = 0;
  private slowMotionUntil = 0;
  private reducedMotion = false;
  private lastMetricsAt = 0;
  private unsubscribe: (() => void)[] = [];

  constructor() {
    super('BattleScene');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#071116');
    this.drawArena();
    this.worldGraphics = this.add.graphics();
    this.fxGraphics = this.add.graphics();
    this.unsubscribe.push(gameBridge.onTrace((traces) => this.showTraces(traces)));
    const stopListeners = (): void => this.unsubscribe.splice(0).forEach((stop) => stop());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, stopListeners);
    this.events.once(Phaser.Scenes.Events.DESTROY, stopListeners);
  }

  override update(time: number, delta: number): void {
    const pending = gameBridge.consumeLatestSnapshot();
    if (pending) this.acceptSnapshot(pending.snapshot, pending.receivedAt);
    if (!this.snapshot) return;

    const now = performance.now();
    const stopped = now < this.hitStopUntil;
    const interpolation = Math.min(
      1,
      Math.max(0, (now - this.transitionStartedAt) / this.transitionDuration),
    );
    if (!stopped) {
      this.drawWorld(this.snapshot, interpolation);
      const effectDelta = !this.reducedMotion && now < this.slowMotionUntil ? delta * 0.36 : delta;
      this.drawEffects(effectDelta);
      this.updateLabels();
      this.latestRenderedTick = Math.round(
        Phaser.Math.Linear(
          Math.max(0, this.latestRenderedTick),
          this.snapshot.tick,
          Math.max(0.16, interpolation),
        ),
      );
    }
    if (time - this.lastMetricsAt > 100) {
      this.lastMetricsAt = time;
      gameBridge.reportRender({
        latestRenderedTick: this.latestRenderedTick,
        snapshotAge: Math.max(0, now - this.lastSnapshotAt),
        renderFps: Math.round(this.game.loop.actualFps),
      });
    }
  }

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
  }

  private acceptSnapshot(snapshot: WorldSnapshot, receivedAt: number): void {
    for (const entity of snapshot.entities) {
      const rendered = this.renderedPositions.get(entity.id);
      this.startPositions.set(
        entity.id,
        rendered ?? {
          x: entity.previousX,
          y: entity.previousY,
          facing: entity.facing,
        },
      );
    }
    const arrivalGap = this.lastSnapshotAt > 0 ? receivedAt - this.lastSnapshotAt : 34;
    this.transitionDuration = Phaser.Math.Clamp(arrivalGap * 1.08, 18, 58);
    this.transitionStartedAt = performance.now();
    this.lastSnapshotAt = receivedAt;
    this.snapshot = snapshot;
    this.processEvents(snapshot.events);
  }

  private processEvents(events: CombatEvent[]): void {
    for (const event of events) {
      if (this.processedEventIds.has(event.id)) continue;
      this.processedEventIds.add(event.id);
      audioEngine.play(event);
      const color = eventColor(event);
      if (event.type === 'death') this.presentDeath(event, color);
      if (event.type === 'impact')
        this.bursts.push({
          x: event.x,
          y: event.y,
          age: 0,
          duration: event.intensity === 'medium' ? 170 : 115,
          color,
          kind: 'impact',
          intensity: event.intensity,
          seed: event.id,
        });
      if (event.type === 'ability')
        this.bursts.push({
          x: event.x,
          y: event.y,
          age: 0,
          duration: 520,
          color: abilityColor(event.ability),
          kind: 'ability',
          intensity: 'heavy',
          seed: event.id,
        });
      if (event.type === 'wave-start' || event.type === 'wave-end')
        this.bursts.push({
          x: event.x,
          y: event.y,
          age: 0,
          duration: 720,
          color: event.type === 'wave-start' ? 0x61e8d5 : 0xf7c95c,
          kind: 'wave',
          intensity: event.intensity,
          seed: event.id,
        });
      if (event.type === 'shot') {
        if (event.targetId) this.recoilUntil.set(event.targetId, performance.now() + 95);
        this.bursts.push({
          x: event.x,
          y: event.y,
          age: 0,
          duration: 95,
          color,
          kind: 'shot',
          intensity: 'light',
          seed: event.id,
        });
      }
    }
    if (this.processedEventIds.size > 520) {
      const newest = [...this.processedEventIds].sort((a, b) => b - a).slice(0, 300);
      this.processedEventIds = new Set(newest);
    }
  }

  private presentDeath(event: CombatEvent, color: number): void {
    const entity = this.snapshot?.entities.find((candidate) => candidate.id === event.targetId);
    const radius = entity?.radius ?? (event.intensity === 'boss' ? 28 : 15);
    const duration = event.intensity === 'boss' ? 620 : event.intensity === 'heavy' ? 430 : 320;
    this.deathEchoes.push({
      x: event.x,
      y: event.y,
      age: 0,
      duration,
      radius,
      color,
      ...(event.archetype ? { archetype: event.archetype } : {}),
    });
    this.bursts.push({
      x: event.x,
      y: event.y,
      age: 0,
      duration,
      color,
      kind: 'death',
      intensity: event.intensity,
      seed: event.id,
    });
    const stop = this.reducedMotion
      ? 0
      : event.intensity === 'boss'
        ? 105
        : event.intensity === 'heavy'
          ? 38
          : 0;
    this.hitStopUntil = Math.max(this.hitStopUntil, performance.now() + stop);
    if (event.finalInWave && !this.reducedMotion)
      this.slowMotionUntil = Math.max(this.slowMotionUntil, performance.now() + 320);
    if (!this.reducedMotion) {
      const durationMs = event.intensity === 'boss' ? 170 : event.intensity === 'heavy' ? 90 : 48;
      const intensity =
        event.intensity === 'boss' ? 0.007 : event.intensity === 'heavy' ? 0.0028 : 0.0008;
      if (event.intensity !== 'medium' || event.archetype !== 'swarmer')
        this.cameras.main.shake(durationMs, intensity);
    }
    const label = event.targetId ? this.labels.get(event.targetId) : undefined;
    label?.text.destroy();
    if (event.targetId) this.labels.delete(event.targetId);
  }

  private drawArena(): void {
    const graphics = this.add.graphics();
    graphics.fillStyle(0x071116, 1).fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    graphics.lineStyle(1, 0x153b42, 0.42);
    for (let x = 30; x < ARENA_WIDTH; x += 45) graphics.lineBetween(x, 0, x, ARENA_HEIGHT);
    for (let y = 10; y < ARENA_HEIGHT; y += 45) graphics.lineBetween(0, y, ARENA_WIDTH, y);
    graphics
      .lineStyle(2, 0x2bbfc1, 0.22)
      .strokeRoundedRect(20, 20, ARENA_WIDTH - 40, ARENA_HEIGHT - 40, 18);
    graphics.lineStyle(1, 0x2bbfc1, 0.16).strokeCircle(ARENA_WIDTH / 2, ARENA_HEIGHT / 2, 118);
    graphics.lineBetween(
      ARENA_WIDTH / 2 - 160,
      ARENA_HEIGHT / 2,
      ARENA_WIDTH / 2 + 160,
      ARENA_HEIGHT / 2,
    );
    graphics.lineBetween(
      ARENA_WIDTH / 2,
      ARENA_HEIGHT / 2 - 160,
      ARENA_WIDTH / 2,
      ARENA_HEIGHT / 2 + 160,
    );
  }

  private drawWorld(snapshot: WorldSnapshot, interpolation: number): void {
    const graphics = this.worldGraphics;
    graphics.clear();
    const liveIds = new Set<string>();
    for (const entity of snapshot.entities) {
      liveIds.add(entity.id);
      const start = this.startPositions.get(entity.id) ?? {
        x: entity.previousX,
        y: entity.previousY,
        facing: entity.facing,
      };
      const x = Phaser.Math.Linear(start.x, entity.x, smoothstep(interpolation));
      const y = Phaser.Math.Linear(start.y, entity.y, smoothstep(interpolation));
      const facing = turnAngle(start.facing, entity.facing, smoothstep(interpolation));
      this.renderedPositions.set(entity.id, { x, y, facing });
      if (entity.kind === 'projectile') this.drawProjectile(graphics, entity, x, y, facing);
      else this.drawActor(graphics, entity, x, y, facing);
    }
    for (const id of this.renderedPositions.keys())
      if (!liveIds.has(id)) this.renderedPositions.delete(id);
  }

  private drawProjectile(
    graphics: Phaser.GameObjects.Graphics,
    entity: EntitySnapshot,
    x: number,
    y: number,
    facing: number,
  ): void {
    const color = entity.team === 'squad' ? 0x71f5e8 : 0xff8a58;
    const trail = entity.team === 'squad' ? 18 : 23;
    const tailX = x - Math.cos(facing) * trail;
    const tailY = y - Math.sin(facing) * trail;
    graphics
      .lineStyle(entity.team === 'squad' ? 3 : 4, color, 0.22)
      .lineBetween(tailX, tailY, x, y);
    graphics.lineStyle(2, color, 0.62).lineBetween((tailX + x) / 2, (tailY + y) / 2, x, y);
    graphics.fillStyle(0xffffff, 0.92).fillCircle(x, y, Math.max(2, entity.radius - 1));
  }

  private drawActor(
    graphics: Phaser.GameObjects.Graphics,
    entity: EntitySnapshot,
    x: number,
    y: number,
    facing: number,
  ): void {
    const recoilUntil = this.recoilUntil.get(entity.id) ?? 0;
    if (recoilUntil > performance.now()) {
      const recoil = Math.min(1, (recoilUntil - performance.now()) / 95) * 6;
      x -= Math.cos(facing) * recoil;
      y -= Math.sin(facing) * recoil;
    } else if (recoilUntil) this.recoilUntil.delete(entity.id);
    const friendly = entity.team === 'squad';
    const color = entity.flash
      ? 0xffffff
      : friendly
        ? roleColor(entity.role)
        : enemyColor(entity.archetype);
    graphics
      .fillStyle(0x000000, 0.36)
      .fillEllipse(x + 3, y + entity.radius + 6, entity.radius * 2.2, 8);
    if (entity.marked) {
      graphics.lineStyle(2, 0xf7c95c, 0.9).strokeCircle(x, y, entity.radius + 8);
      graphics.lineBetween(x - 4, y - entity.radius - 12, x + 4, y - entity.radius - 12);
    }
    if (entity.shielded) {
      graphics
        .fillStyle(0x8f85ff, 0.07)
        .fillCircle(x, y, entity.role === 'guardian' ? 118 : entity.radius + 9);
      graphics
        .lineStyle(entity.role === 'guardian' ? 2 : 1, 0x9b8cff, 0.58)
        .strokeCircle(x, y, entity.role === 'guardian' ? 118 : entity.radius + 7);
    }
    if (entity.telegraph && entity.telegraph > 0) {
      const length = 130 + entity.telegraph * 120;
      graphics
        .lineStyle(2, 0xff786c, 0.28 + entity.telegraph * 0.5)
        .lineBetween(x, y, x + Math.cos(facing) * length, y + Math.sin(facing) * length);
      graphics
        .lineStyle(1, 0xffc45c, 0.8)
        .strokeCircle(x, y, entity.radius + 7 + entity.telegraph * 5);
    }
    graphics.fillStyle(color, 1);
    if (entity.kind === 'enemy') this.drawEnemyShape(graphics, entity, x, y, facing);
    else if (entity.role === 'guardian') {
      graphics.fillRoundedRect(
        x - entity.radius,
        y - entity.radius,
        entity.radius * 2,
        entity.radius * 2,
        5,
      );
      graphics
        .lineStyle(3, 0xdffeff, 0.7)
        .strokeRoundedRect(
          x - entity.radius,
          y - entity.radius,
          entity.radius * 2,
          entity.radius * 2,
          5,
        );
    } else if (entity.role === 'scout') {
      graphics.fillTriangle(
        x + Math.cos(facing) * entity.radius,
        y + Math.sin(facing) * entity.radius,
        x + Math.cos(facing + 2.4) * entity.radius,
        y + Math.sin(facing + 2.4) * entity.radius,
        x + Math.cos(facing - 2.4) * entity.radius,
        y + Math.sin(facing - 2.4) * entity.radius,
      );
    } else {
      graphics.fillCircle(x, y, entity.radius);
      graphics.lineStyle(3, 0xe7ffff, 0.75).strokeCircle(x, y, entity.radius);
      graphics
        .lineStyle(3, 0x061114, 0.8)
        .lineBetween(
          x,
          y,
          x + Math.cos(facing) * entity.radius,
          y + Math.sin(facing) * entity.radius,
        );
    }
    if (entity.abilityActive === 'overcharge') {
      const pulse = 3 + Math.sin(performance.now() * 0.022) * 2;
      graphics.lineStyle(2, 0x4de8ff, 0.72).strokeCircle(x, y, entity.radius + 5 + pulse);
    }
    const width = entity.radius * 2.45;
    graphics
      .fillStyle(0x020809, 0.9)
      .fillRoundedRect(x - width / 2, y - entity.radius - 11, width, 4, 2);
    graphics
      .fillStyle(friendly ? 0x5ee6bf : 0xff766e, 1)
      .fillRoundedRect(
        x - width / 2,
        y - entity.radius - 11,
        width * Math.max(0, entity.health / entity.maxHealth),
        4,
        2,
      );
  }

  private drawEnemyShape(
    graphics: Phaser.GameObjects.Graphics,
    entity: EntitySnapshot,
    x: number,
    y: number,
    facing: number,
  ): void {
    const radius = entity.radius;
    if (entity.archetype === 'swarmer' || entity.archetype === 'splitter-child') {
      graphics.fillTriangle(
        x + Math.cos(facing) * radius,
        y + Math.sin(facing) * radius,
        x + Math.cos(facing + 2.35) * radius,
        y + Math.sin(facing + 2.35) * radius,
        x + Math.cos(facing - 2.35) * radius,
        y + Math.sin(facing - 2.35) * radius,
      );
    } else if (entity.archetype === 'sniper') {
      graphics.fillCircle(x, y, radius);
      graphics
        .lineStyle(3, 0x2b090d, 0.9)
        .lineBetween(
          x,
          y,
          x + Math.cos(facing) * radius * 1.7,
          y + Math.sin(facing) * radius * 1.7,
        );
    } else {
      graphics
        .beginPath()
        .moveTo(x, y - radius)
        .lineTo(x + radius, y)
        .lineTo(x, y + radius)
        .lineTo(x - radius, y)
        .closePath()
        .fillPath();
      graphics
        .lineStyle(entity.elite ? 4 : 2, entity.elite ? 0xf7c95c : 0x2b090d, 0.9)
        .strokePath();
      if (entity.archetype === 'bulwark' || entity.archetype === 'commander')
        graphics
          .lineStyle(4, 0xffb26b, 0.85)
          .lineBetween(
            x + Math.cos(facing - 0.72) * radius,
            y + Math.sin(facing - 0.72) * radius,
            x + Math.cos(facing + 0.72) * radius,
            y + Math.sin(facing + 0.72) * radius,
          );
    }
  }

  private showTraces(traces: DecisionTrace[]): void {
    if (!this.sys.isActive()) return;
    for (const trace of traces) {
      let state = this.labels.get(trace.robotId);
      if (!state) {
        const text = this.add
          .text(0, 0, '', {
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '11px',
            color: '#d9fffb',
            backgroundColor: '#061114dd',
            padding: { x: 5, y: 3 },
          })
          .setOrigin(0.5, 1)
          .setDepth(10);
        state = { text, expiresAt: 0 };
        this.labels.set(trace.robotId, state);
      }
      state.text.setText(
        trace.executed ? `${trace.command}()` : `${trace.command}() // ${trace.reason}`,
      );
      state.text.setColor(trace.executed ? '#d9fffb' : '#ff9b8f');
      state.expiresAt = performance.now() + (trace.executed ? 560 : 920);
    }
  }

  private updateLabels(): void {
    const now = performance.now();
    for (const [id, state] of this.labels) {
      const entity = this.snapshot?.entities.find((candidate) => candidate.id === id);
      if (!entity) {
        state.text.destroy();
        this.labels.delete(id);
        continue;
      }
      const rendered = this.renderedPositions.get(id);
      state.text.setVisible(now < state.expiresAt);
      if (rendered) state.text.setPosition(rendered.x, rendered.y - entity.radius - 14);
    }
  }

  private drawEffects(delta: number): void {
    const graphics = this.fxGraphics;
    graphics.clear();
    const speedFactor = this.transitionDuration < 25 ? 1.45 : 1;
    const nextBursts: EffectBurst[] = [];
    for (const burst of this.bursts) {
      burst.age += delta * speedFactor;
      if (burst.age >= burst.duration) continue;
      const progress = burst.age / burst.duration;
      const alpha = 1 - progress;
      if (burst.kind === 'impact') {
        graphics.lineStyle(2, burst.color, alpha).strokeCircle(burst.x, burst.y, 4 + progress * 13);
        graphics.fillStyle(0xffffff, alpha * 0.7).fillCircle(burst.x, burst.y, (1 - progress) * 5);
      }
      if (burst.kind === 'shot') {
        graphics.fillStyle(burst.color, alpha).fillCircle(burst.x, burst.y, 3 + alpha * 4);
      }
      if (burst.kind === 'ability') {
        graphics
          .lineStyle(3, burst.color, alpha * 0.9)
          .strokeCircle(burst.x, burst.y, 12 + progress * 74);
        graphics
          .lineStyle(1, 0xffffff, alpha * 0.45)
          .strokeCircle(burst.x, burst.y, 7 + progress * 45);
      }
      if (burst.kind === 'wave') {
        graphics
          .lineStyle(3, burst.color, alpha * 0.55)
          .strokeCircle(burst.x, burst.y, 45 + progress * 330);
      }
      if (burst.kind === 'death') {
        const fragments = burst.intensity === 'boss' ? 14 : burst.intensity === 'heavy' ? 10 : 7;
        graphics
          .lineStyle(2, burst.color, alpha)
          .strokeCircle(burst.x, burst.y, 6 + progress * (burst.intensity === 'boss' ? 58 : 34));
        for (let index = 0; index < fragments; index += 1) {
          const angle = seededAngle(burst.seed, index, fragments);
          const distance = progress * (burst.intensity === 'boss' ? 72 : 42);
          const size = Math.max(1, (1 - progress) * (burst.intensity === 'boss' ? 5 : 3));
          graphics
            .fillStyle(index % 2 ? burst.color : 0xffffff, alpha)
            .fillRect(
              burst.x + Math.cos(angle) * distance - size / 2,
              burst.y + Math.sin(angle) * distance - size / 2,
              size,
              size,
            );
        }
      }
      nextBursts.push(burst);
    }
    this.bursts = nextBursts.slice(-70);

    const nextEchoes: DeathEcho[] = [];
    for (const echo of this.deathEchoes) {
      echo.age += delta * speedFactor;
      if (echo.age >= echo.duration) continue;
      const progress = echo.age / echo.duration;
      const scale = Math.max(0, 1 - progress * 1.25);
      graphics.fillStyle(progress < 0.18 ? 0xffffff : echo.color, (1 - progress) * 0.72);
      graphics.fillCircle(echo.x, echo.y, echo.radius * scale);
      nextEchoes.push(echo);
    }
    this.deathEchoes = nextEchoes.slice(-28);
  }
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function turnAngle(start: number, target: number, amount: number): number {
  const delta = Math.atan2(Math.sin(target - start), Math.cos(target - start));
  return start + delta * amount;
}

function seededAngle(seed: number, index: number, count: number): number {
  return (index / count) * Math.PI * 2 + ((seed * 37) % 100) / 100;
}

function roleColor(role: EntitySnapshot['role']): number {
  if (role === 'striker') return 0x4de8ff;
  if (role === 'guardian') return 0x9b8cff;
  return 0xf7c95c;
}

function enemyColor(archetype: EntitySnapshot['archetype']): number {
  if (archetype === 'sniper') return 0xff9f58;
  if (archetype === 'splitter' || archetype === 'splitter-child') return 0xff6fae;
  if (archetype === 'bulwark') return 0xb978ff;
  if (archetype === 'commander') return 0xffc95c;
  return 0xff554d;
}

function eventColor(event: CombatEvent): number {
  if (event.team === 'squad') return 0x61e8d5;
  return enemyColor(event.archetype);
}

function abilityColor(ability: CombatEvent['ability']): number {
  if (ability === 'overcharge') return 0x4de8ff;
  if (ability === 'shield') return 0x9b8cff;
  return 0xf7c95c;
}
