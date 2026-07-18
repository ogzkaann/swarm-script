import type { DecisionTrace, EntitySnapshot, WorldSnapshot } from '@swarm-script/shared';
import Phaser from 'phaser';
import { ARENA_HEIGHT, ARENA_WIDTH } from '@swarm-script/simulation';
import { gameBridge } from './GameBridge';

interface LabelState {
  text: Phaser.GameObjects.Text;
  expiresAt: number;
}
interface Burst {
  x: number;
  y: number;
  age: number;
  color: number;
}

export class BattleScene extends Phaser.Scene {
  private worldGraphics!: Phaser.GameObjects.Graphics;
  private fxGraphics!: Phaser.GameObjects.Graphics;
  private snapshot: WorldSnapshot | null = null;
  private snapshotReceivedAt = 0;
  private labels = new Map<string, LabelState>();
  private bursts: Burst[] = [];
  private hitStopUntil = 0;
  private reducedMotion = false;
  private unsubscribe: (() => void)[] = [];

  constructor() {
    super('BattleScene');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#071116');
    this.drawArena();
    this.worldGraphics = this.add.graphics();
    this.fxGraphics = this.add.graphics();
    this.unsubscribe.push(
      gameBridge.onSnapshot((snapshot, receivedAt) => this.acceptSnapshot(snapshot, receivedAt)),
    );
    this.unsubscribe.push(gameBridge.onTrace((traces) => this.showTraces(traces)));
    const stopListeners = (): void => this.unsubscribe.splice(0).forEach((stop) => stop());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, stopListeners);
    this.events.once(Phaser.Scenes.Events.DESTROY, stopListeners);
  }

  override update(_time: number, delta: number): void {
    if (!this.snapshot) return;
    if (performance.now() < this.hitStopUntil) return;
    this.drawWorld(this.snapshot, Math.min(1, (performance.now() - this.snapshotReceivedAt) / 66));
    this.drawEffects(delta);
    this.updateLabels();
  }

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
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

  private acceptSnapshot(snapshot: WorldSnapshot, receivedAt: number): void {
    const nextIds = new Set(snapshot.entities.map((entity) => entity.id));
    if (!this.reducedMotion) {
      for (const entity of this.snapshot?.entities ?? []) {
        if (entity.kind === 'enemy' && !nextIds.has(entity.id)) {
          this.bursts.push({ x: entity.x, y: entity.y, age: 0, color: 0xff5d52 });
          this.hitStopUntil = performance.now() + 38;
          this.cameras.main.shake(55, 0.0018);
        }
      }
    }
    this.snapshot = snapshot;
    this.snapshotReceivedAt = receivedAt;
  }

  private drawWorld(snapshot: WorldSnapshot, interpolation: number): void {
    const graphics = this.worldGraphics;
    graphics.clear();
    for (const entity of snapshot.entities) {
      const x = Phaser.Math.Linear(entity.previousX, entity.x, interpolation);
      const y = Phaser.Math.Linear(entity.previousY, entity.y, interpolation);
      if (entity.kind === 'projectile') {
        this.drawProjectile(graphics, entity, x, y);
        continue;
      }
      this.drawActor(graphics, entity, x, y);
    }
  }

  private drawProjectile(
    graphics: Phaser.GameObjects.Graphics,
    entity: EntitySnapshot,
    x: number,
    y: number,
  ): void {
    const color = entity.team === 'squad' ? 0x71f5e8 : 0xff8a58;
    graphics.lineStyle(entity.team === 'squad' ? 3 : 4, color, 0.45);
    graphics.lineBetween(entity.previousX, entity.previousY, x, y);
    graphics.fillStyle(color, 1).fillCircle(x, y, entity.radius);
  }

  private drawActor(
    graphics: Phaser.GameObjects.Graphics,
    entity: EntitySnapshot,
    x: number,
    y: number,
  ): void {
    const friendly = entity.team === 'squad';
    const color = entity.flash ? 0xffffff : friendly ? roleColor(entity.role) : 0xff554d;
    graphics
      .fillStyle(0x000000, 0.36)
      .fillEllipse(x + 3, y + entity.radius + 6, entity.radius * 2.2, 8);
    graphics.fillStyle(color, 1);
    if (entity.kind === 'enemy') {
      graphics
        .beginPath()
        .moveTo(x, y - entity.radius)
        .lineTo(x + entity.radius, y)
        .lineTo(x, y + entity.radius)
        .lineTo(x - entity.radius, y)
        .closePath()
        .fillPath();
      graphics.lineStyle(2, 0x2b090d, 0.9).strokePath();
    } else if (entity.role === 'guardian') {
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
        x,
        y - entity.radius,
        x + entity.radius,
        y + entity.radius,
        x - entity.radius,
        y + entity.radius,
      );
    } else {
      graphics.fillCircle(x, y, entity.radius);
      graphics.lineStyle(3, 0xe7ffff, 0.75).strokeCircle(x, y, entity.radius);
    }
    const width = entity.radius * 2.4;
    graphics
      .fillStyle(0x020809, 0.9)
      .fillRoundedRect(x - width / 2, y - entity.radius - 10, width, 4, 2);
    graphics
      .fillStyle(friendly ? 0x5ee6bf : 0xff766e, 1)
      .fillRoundedRect(
        x - width / 2,
        y - entity.radius - 10,
        width * Math.max(0, entity.health / entity.maxHealth),
        4,
        2,
      );
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
            backgroundColor: '#061114cc',
            padding: { x: 5, y: 3 },
          })
          .setOrigin(0.5, 1)
          .setDepth(10);
        state = { text, expiresAt: 0 };
        this.labels.set(trace.robotId, state);
      }
      state.text.setText(`${trace.command}()`);
      state.expiresAt = performance.now() + 540;
    }
  }

  private updateLabels(): void {
    const now = performance.now();
    for (const [id, state] of this.labels) {
      const entity = this.snapshot?.entities.find((candidate) => candidate.id === id);
      state.text.setVisible(Boolean(entity) && now < state.expiresAt);
      if (entity) state.text.setPosition(entity.x, entity.y - entity.radius - 13);
    }
  }

  private drawEffects(delta: number): void {
    this.fxGraphics.clear();
    const next: Burst[] = [];
    for (const burst of this.bursts) {
      burst.age += delta;
      if (burst.age > 420) continue;
      const progress = burst.age / 420;
      this.fxGraphics
        .lineStyle(2, burst.color, 1 - progress)
        .strokeCircle(burst.x, burst.y, 8 + progress * 28);
      for (let index = 0; index < 6; index += 1) {
        const angle = (index / 6) * Math.PI * 2;
        this.fxGraphics
          .fillStyle(burst.color, 1 - progress)
          .fillCircle(
            burst.x + Math.cos(angle) * progress * 30,
            burst.y + Math.sin(angle) * progress * 30,
            2,
          );
      }
      next.push(burst);
    }
    this.bursts = next;
  }
}

function roleColor(role: EntitySnapshot['role']): number {
  if (role === 'striker') return 0x4de8ff;
  if (role === 'guardian') return 0x9b8cff;
  return 0xf7c95c;
}
