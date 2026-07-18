import type {
  CommandName,
  DecisionTrace,
  EntitySnapshot,
  RobotMetrics,
  RobotRole,
  RunMetrics,
  RunPhase,
  SourceSpan,
  UpgradeEffect,
  WorldSnapshot,
} from '@swarm-script/shared';
import { executeProgram, type Program, type ScriptContext } from '@swarm-script/scripting';
import { SeededRandom } from './random';
import { UPGRADES } from './upgrades';

const ARENA_WIDTH = 900;
const ARENA_HEIGHT = 560;
const FIXED_RATE = 30;
const DECISION_INTERVAL = 6;

interface Actor {
  id: string;
  x: number;
  y: number;
  previousX: number;
  previousY: number;
  radius: number;
  health: number;
  maxHealth: number;
  speed: number;
  damage: number;
  attackRange: number;
  attackCooldown: number;
  cooldownRemaining: number;
  hitFlashTicks: number;
}

interface Robot extends Actor {
  role: RobotRole;
  energy: number;
  maxEnergy: number;
  energyRegen: number;
  command: CommandName;
  guarding: boolean;
}

interface Enemy extends Actor {
  targetId: string;
}

interface Projectile {
  id: string;
  x: number;
  y: number;
  previousX: number;
  previousY: number;
  radius: number;
  targetId: string;
  ownerId: string;
  team: 'squad' | 'hostile';
  damage: number;
  speed: number;
}

type InternalMetrics = RunMetrics;

export interface SimulationOptions {
  seed: number;
  programs: Record<RobotRole, Program>;
  shortRun?: boolean;
}

export interface StepEvents {
  traces: DecisionTrace[];
  waveCompleted?: number;
  upgradeOptions?: UpgradeEffect[];
  runCompleted?: { snapshot: WorldSnapshot; observations: string[] };
}

const emptyRobotMetrics = (): RobotMetrics => ({
  damage: 0,
  damageReceived: 0,
  commands: 0,
  waits: 0,
  retreatsAbove80: 0,
  attacksOutOfRange: 0,
});

export class SwarmSimulation {
  readonly fixedRate = FIXED_RATE;
  private readonly random: SeededRandom;
  private readonly programs: Record<RobotRole, Program>;
  private readonly shortRun: boolean;
  private robots: Robot[] = [];
  private enemies: Enemy[] = [];
  private projectiles: Projectile[] = [];
  private tick = 0;
  private wave = 0;
  private phase: RunPhase = 'idle';
  private nextEntityId = 1;
  private availableUpgrades: UpgradeEffect[] = [];
  private appliedUpgrades: UpgradeEffect[] = [];
  private metrics: InternalMetrics = this.createMetrics();

  constructor(options: SimulationOptions) {
    this.random = new SeededRandom(options.seed);
    this.programs = options.programs;
    this.shortRun = options.shortRun ?? false;
  }

  start(): void {
    this.resetState();
    this.spawnSquad();
    this.spawnWave(1);
    this.phase = 'running';
  }

  pause(): void {
    if (this.phase === 'running') this.phase = 'paused';
  }

  resume(): void {
    if (this.phase === 'paused') this.phase = 'running';
  }

  chooseUpgrade(upgradeId: string): boolean {
    if (this.phase !== 'upgrade') return false;
    const upgrade = this.availableUpgrades.find((candidate) => candidate.id === upgradeId);
    if (!upgrade) return false;
    this.applyUpgrade(upgrade);
    this.appliedUpgrades.push(upgrade);
    this.availableUpgrades = [];
    this.spawnWave(this.wave + 1);
    this.phase = 'running';
    return true;
  }

  step(): StepEvents {
    const events: StepEvents = { traces: [] };
    if (this.phase !== 'running') return events;
    this.tick += 1;
    this.metrics.elapsedSeconds = this.tick / FIXED_RATE;
    this.copyPreviousPositions();
    this.regenerateEnergy();

    if (this.tick % DECISION_INTERVAL === 1) events.traces = this.decideRobotCommands();
    this.moveRobots();
    this.updateEnemyAI();
    this.updateProjectiles();
    this.updateCooldownsAndFlashes();
    this.removeDeadEntities();

    if (this.robots.length === 0) {
      this.phase = 'defeat';
      const snapshot = this.snapshot();
      snapshot.checksum = this.checksum();
      events.runCompleted = { snapshot, observations: this.observations() };
    } else if (
      this.enemies.length === 0 &&
      this.projectiles.every((projectile) => projectile.team !== 'squad')
    ) {
      this.metrics.wavesCompleted = this.wave;
      events.waveCompleted = this.wave;
      if (this.wave >= 3) {
        this.phase = 'victory';
        const snapshot = this.snapshot();
        snapshot.checksum = this.checksum();
        events.runCompleted = { snapshot, observations: this.observations() };
      } else {
        this.phase = 'upgrade';
        this.availableUpgrades = this.selectUpgradeOptions();
        events.upgradeOptions = this.availableUpgrades;
      }
    }
    return events;
  }

  snapshot(): WorldSnapshot {
    const entities: EntitySnapshot[] = [
      ...this.robots.map((robot) => ({
        id: robot.id,
        kind: 'robot' as const,
        role: robot.role,
        x: robot.x,
        y: robot.y,
        previousX: robot.previousX,
        previousY: robot.previousY,
        radius: robot.radius,
        health: robot.health,
        maxHealth: robot.maxHealth,
        team: 'squad' as const,
        flash: robot.hitFlashTicks > 0,
      })),
      ...this.enemies.map((enemy) => ({
        id: enemy.id,
        kind: 'enemy' as const,
        x: enemy.x,
        y: enemy.y,
        previousX: enemy.previousX,
        previousY: enemy.previousY,
        radius: enemy.radius,
        health: enemy.health,
        maxHealth: enemy.maxHealth,
        team: 'hostile' as const,
        flash: enemy.hitFlashTicks > 0,
      })),
      ...this.projectiles.map((projectile) => ({
        id: projectile.id,
        kind: 'projectile' as const,
        x: projectile.x,
        y: projectile.y,
        previousX: projectile.previousX,
        previousY: projectile.previousY,
        radius: projectile.radius,
        health: 1,
        maxHealth: 1,
        team: projectile.team,
        flash: false,
      })),
    ];
    return {
      tick: this.tick,
      simulationTime: this.tick / FIXED_RATE,
      phase: this.phase,
      wave: this.wave,
      entities,
      squadHealth: this.robots.reduce((sum, robot) => sum + robot.health, 0),
      metrics: structuredClone(this.metrics),
    };
  }

  getPhase(): RunPhase {
    return this.phase;
  }
  getUpgradeOptions(): UpgradeEffect[] {
    return [...this.availableUpgrades];
  }
  getAppliedUpgrades(): UpgradeEffect[] {
    return [...this.appliedUpgrades];
  }

  checksum(): string {
    const stable = JSON.stringify({
      tick: this.tick,
      wave: this.wave,
      phase: this.phase,
      robots: this.robots.map((robot) => [
        robot.id,
        round(robot.x),
        round(robot.y),
        round(robot.health),
        round(robot.energy),
      ]),
      enemies: this.enemies.map((enemy) => [
        enemy.id,
        round(enemy.x),
        round(enemy.y),
        round(enemy.health),
      ]),
      metrics: this.metrics,
      upgrades: this.appliedUpgrades.map((upgrade) => upgrade.id),
    });
    let hash = 0x811c9dc5;
    for (let index = 0; index < stable.length; index += 1) {
      hash ^= stable.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  private resetState(): void {
    this.robots = [];
    this.enemies = [];
    this.projectiles = [];
    this.tick = 0;
    this.wave = 0;
    this.phase = 'idle';
    this.nextEntityId = 1;
    this.availableUpgrades = [];
    this.appliedUpgrades = [];
    this.metrics = this.createMetrics();
  }

  private createMetrics(): InternalMetrics {
    return {
      elapsedSeconds: 0,
      wavesCompleted: 0,
      totalDamage: 0,
      damageReceived: 0,
      enemiesDestroyed: 0,
      commandsExecuted: 0,
      idleDecisions: 0,
      perRobot: {
        striker: emptyRobotMetrics(),
        guardian: emptyRobotMetrics(),
        scout: emptyRobotMetrics(),
      },
    };
  }

  private spawnSquad(): void {
    const create = (
      role: RobotRole,
      x: number,
      y: number,
      stats: Pick<Robot, 'maxHealth' | 'speed' | 'damage' | 'attackRange'>,
    ): Robot => ({
      id: `robot-${role}`,
      role,
      x,
      y,
      previousX: x,
      previousY: y,
      radius: role === 'guardian' ? 18 : 15,
      health: stats.maxHealth,
      maxHealth: stats.maxHealth,
      speed: stats.speed,
      damage: stats.damage,
      attackRange: stats.attackRange,
      attackCooldown: role === 'scout' ? 0.72 : 0.9,
      cooldownRemaining: 0,
      energy: 100,
      maxEnergy: 100,
      energyRegen: role === 'scout' ? 13 : 10,
      command: 'wait',
      guarding: false,
      hitFlashTicks: 0,
    });
    this.robots = [
      create('striker', 390, 260, { maxHealth: 115, speed: 92, damage: 27, attackRange: 185 }),
      create('guardian', 355, 310, { maxHealth: 175, speed: 72, damage: 17, attackRange: 155 }),
      create('scout', 420, 330, { maxHealth: 90, speed: 125, damage: 19, attackRange: 165 }),
    ];
  }

  private spawnWave(wave: number): void {
    this.wave = wave;
    const count = this.shortRun ? 1 : ([0, 10, 14, 18][wave] ?? 18);
    for (let index = 0; index < count; index += 1) {
      const edge = index % 4;
      const margin = 34;
      const x =
        edge === 0
          ? margin
          : edge === 2
            ? ARENA_WIDTH - margin
            : this.random.between(70, ARENA_WIDTH - 70);
      const y =
        edge === 1
          ? margin
          : edge === 3
            ? ARENA_HEIGHT - margin
            : this.random.between(70, ARENA_HEIGHT - 70);
      const maxHealth = (this.shortRun ? 180 : 125 + wave * 30) * (index % 5 === 0 ? 1.35 : 1);
      this.enemies.push({
        id: `enemy-${this.nextEntityId++}`,
        x,
        y,
        previousX: x,
        previousY: y,
        radius: index % 5 === 0 ? 18 : 14,
        health: maxHealth,
        maxHealth,
        speed: 34 + wave * 6,
        damage: this.shortRun ? 8 + wave * 2.4 : 0.12 + wave * 0.04,
        attackRange: 94,
        attackCooldown: 1.25,
        cooldownRemaining: this.random.between(0, 0.8),
        hitFlashTicks: 0,
        targetId: '',
      });
    }
  }

  private copyPreviousPositions(): void {
    for (const entity of [...this.robots, ...this.enemies, ...this.projectiles]) {
      entity.previousX = entity.x;
      entity.previousY = entity.y;
    }
  }

  private regenerateEnergy(): void {
    for (const robot of this.robots)
      robot.energy = Math.min(robot.maxEnergy, robot.energy + robot.energyRegen / FIXED_RATE);
  }

  private decideRobotCommands(): DecisionTrace[] {
    const traces: DecisionTrace[] = [];
    const lowestAllyHealth = this.robots.reduce(
      (lowest, robot) => Math.min(lowest, (robot.health / robot.maxHealth) * 100),
      100,
    );
    for (const robot of this.robots) {
      const enemy = nearest(robot, this.enemies);
      const context: ScriptContext = {
        health: robot.health,
        health_percent: (robot.health / robot.maxHealth) * 100,
        energy: robot.energy,
        'enemy.distance': enemy ? distance(robot, enemy) : 9999,
        attack_range: robot.attackRange,
        ally_lowest_health: lowestAllyHealth,
      };
      const decision = executeProgram(this.programs[robot.role], context, 64);
      robot.command = decision.command;
      robot.guarding = decision.command === 'guard';
      this.recordDecision(robot, decision.command, context['enemy.distance']);
      traces.push({
        tick: this.tick,
        robotId: robot.id,
        robot: robot.role,
        command: decision.command,
        span: decision.span,
      });
    }
    return traces;
  }

  private recordDecision(robot: Robot, command: CommandName, enemyDistance: number): void {
    const robotMetrics = this.metrics.perRobot[robot.role];
    robotMetrics.commands += 1;
    this.metrics.commandsExecuted += 1;
    if (command === 'wait') {
      robotMetrics.waits += 1;
      this.metrics.idleDecisions += 1;
    }
    if (command === 'retreat' && robot.health / robot.maxHealth > 0.8)
      robotMetrics.retreatsAbove80 += 1;
    if (command === 'attack' && enemyDistance > robot.attackRange)
      robotMetrics.attacksOutOfRange += 1;
  }

  private moveRobots(): void {
    for (const robot of this.robots) {
      const enemy = nearest(robot, this.enemies);
      if (!enemy) continue;
      if (robot.command === 'attack') this.tryShoot(robot, enemy, 'squad');
      if (robot.command === 'approach')
        moveToward(
          robot,
          enemy.x,
          enemy.y,
          robot.speed / FIXED_RATE,
          Math.max(35, robot.attackRange * 0.78),
        );
      if (robot.command === 'retreat') moveAway(robot, enemy.x, enemy.y, robot.speed / FIXED_RATE);
      if (robot.command === 'guard') {
        const vulnerable = [...this.robots].sort(
          (left, right) => left.health / left.maxHealth - right.health / right.maxHealth,
        )[0];
        if (vulnerable) moveToward(robot, vulnerable.x, vulnerable.y, robot.speed / FIXED_RATE, 38);
      }
      constrain(robot);
    }
  }

  private updateEnemyAI(): void {
    for (const enemy of this.enemies) {
      const target = nearest(enemy, this.robots);
      if (!target) continue;
      enemy.targetId = target.id;
      const separation = distance(enemy, target);
      if (separation <= enemy.attackRange) this.tryShoot(enemy, target, 'hostile');
      else
        moveToward(enemy, target.x, target.y, enemy.speed / FIXED_RATE, enemy.attackRange * 0.82);
      constrain(enemy);
    }
  }

  private tryShoot(owner: Actor, target: Actor, team: 'squad' | 'hostile'): void {
    const energyOwner = 'energy' in owner ? (owner as Robot) : null;
    if (owner.cooldownRemaining > 0 || distance(owner, target) > owner.attackRange) return;
    if (energyOwner && energyOwner.energy < 18) return;
    if (energyOwner) energyOwner.energy -= 18;
    owner.cooldownRemaining = owner.attackCooldown;
    this.projectiles.push({
      id: `projectile-${this.nextEntityId++}`,
      x: owner.x,
      y: owner.y,
      previousX: owner.x,
      previousY: owner.y,
      radius: team === 'squad' ? 4 : 5,
      targetId: target.id,
      ownerId: owner.id,
      team,
      damage: owner.damage,
      speed: team === 'squad' ? 390 : 245,
    });
  }

  private updateProjectiles(): void {
    const remaining: Projectile[] = [];
    for (const projectile of this.projectiles) {
      const targets: Actor[] = projectile.team === 'squad' ? this.enemies : this.robots;
      const target = targets.find((candidate) => candidate.id === projectile.targetId);
      if (!target) continue;
      const step = projectile.speed / FIXED_RATE;
      if (distance(projectile, target) <= step + target.radius) {
        const actualDamage =
          projectile.team === 'hostile' && isRobot(target) && target.guarding
            ? projectile.damage * 0.6
            : projectile.damage;
        target.health -= actualDamage;
        target.hitFlashTicks = 3;
        if (projectile.team === 'squad') {
          this.metrics.totalDamage += actualDamage;
          const owner = this.robots.find((robot) => robot.id === projectile.ownerId);
          if (owner) this.metrics.perRobot[owner.role].damage += actualDamage;
        } else {
          this.metrics.damageReceived += actualDamage;
          if (isRobot(target)) this.metrics.perRobot[target.role].damageReceived += actualDamage;
        }
      } else {
        moveToward(projectile, target.x, target.y, step, 0);
        remaining.push(projectile);
      }
    }
    this.projectiles = remaining;
  }

  private updateCooldownsAndFlashes(): void {
    for (const actor of [...this.robots, ...this.enemies]) {
      actor.cooldownRemaining = Math.max(0, actor.cooldownRemaining - 1 / FIXED_RATE);
      actor.hitFlashTicks = Math.max(0, actor.hitFlashTicks - 1);
    }
  }

  private removeDeadEntities(): void {
    const enemyCount = this.enemies.length;
    this.enemies = this.enemies.filter((enemy) => enemy.health > 0);
    this.metrics.enemiesDestroyed += enemyCount - this.enemies.length;
    this.robots = this.robots.filter((robot) => robot.health > 0);
  }

  private selectUpgradeOptions(): UpgradeEffect[] {
    const pool = [...UPGRADES];
    const options: UpgradeEffect[] = [];
    while (options.length < 3) {
      const index = this.random.integer(pool.length);
      const [selected] = pool.splice(index, 1);
      if (selected) options.push(selected);
    }
    return options;
  }

  private applyUpgrade(upgrade: UpgradeEffect): void {
    for (const robot of this.robots) {
      if (upgrade.stat === 'damage') robot.damage *= upgrade.multiplier;
      if (upgrade.stat === 'range') robot.attackRange *= upgrade.multiplier;
      if (upgrade.stat === 'speed') robot.speed *= upgrade.multiplier;
      if (upgrade.stat === 'energyRegen') robot.energyRegen *= upgrade.multiplier;
      if (upgrade.stat === 'cooldown') robot.attackCooldown *= upgrade.multiplier;
      if (upgrade.stat === 'health') {
        robot.maxHealth *= upgrade.multiplier;
        robot.health = robot.maxHealth;
      } else robot.health = robot.maxHealth;
    }
  }

  private observations(): string[] {
    const results: string[] = [];
    const robotEntries = Object.entries(this.metrics.perRobot) as [RobotRole, RobotMetrics][];
    const idlest = [...robotEntries].sort(
      (left, right) =>
        right[1].waits / Math.max(1, right[1].commands) -
        left[1].waits / Math.max(1, left[1].commands),
    )[0];
    if (idlest && idlest[1].waits > 0)
      results.push(
        `${title(idlest[0])} spent ${Math.round((idlest[1].waits / Math.max(1, idlest[1].commands)) * 100)}% of decisions waiting.`,
      );
    const retreating = robotEntries.find(([, metrics]) => metrics.retreatsAbove80 > 0);
    if (retreating)
      results.push(
        `${title(retreating[0])} retreated ${retreating[1].retreatsAbove80} times while above 80% health.`,
      );
    const missed = robotEntries.find(([, metrics]) => metrics.attacksOutOfRange > 0);
    if (results.length < 2 && missed)
      results.push(
        `${title(missed[0])} attempted ${missed[1].attacksOutOfRange} attacks outside range.`,
      );
    if (results.length === 0)
      results.push(
        'The squad kept every decision active and in range. Try a more specialized rule set next run.',
      );
    return results.slice(0, 2);
  }
}

function distance(left: Pick<Actor, 'x' | 'y'>, right: Pick<Actor, 'x' | 'y'>): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function isRobot(actor: Actor): actor is Robot {
  return 'role' in actor;
}

function nearest<T extends Pick<Actor, 'x' | 'y'>>(
  source: Pick<Actor, 'x' | 'y'>,
  candidates: T[],
): T | undefined {
  let closest: T | undefined;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const currentDistance = distance(source, candidate);
    if (currentDistance < closestDistance) {
      closest = candidate;
      closestDistance = currentDistance;
    }
  }
  return closest;
}

function moveToward(
  entity: Pick<Actor, 'x' | 'y'>,
  targetX: number,
  targetY: number,
  amount: number,
  stopDistance: number,
): void {
  const deltaX = targetX - entity.x;
  const deltaY = targetY - entity.y;
  const length = Math.hypot(deltaX, deltaY);
  if (length <= stopDistance || length === 0) return;
  const distanceToMove = Math.min(amount, length - stopDistance);
  entity.x += (deltaX / length) * distanceToMove;
  entity.y += (deltaY / length) * distanceToMove;
}

function moveAway(
  entity: Pick<Actor, 'x' | 'y'>,
  targetX: number,
  targetY: number,
  amount: number,
): void {
  const deltaX = entity.x - targetX;
  const deltaY = entity.y - targetY;
  const length = Math.hypot(deltaX, deltaY) || 1;
  entity.x += (deltaX / length) * amount;
  entity.y += (deltaY / length) * amount;
}

function constrain(entity: Pick<Actor, 'x' | 'y' | 'radius'>): void {
  entity.x = Math.max(entity.radius + 22, Math.min(ARENA_WIDTH - entity.radius - 22, entity.x));
  entity.y = Math.max(entity.radius + 22, Math.min(ARENA_HEIGHT - entity.radius - 22, entity.y));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
function title(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export { ARENA_HEIGHT, ARENA_WIDTH, FIXED_RATE };
export type { Program, SourceSpan };
