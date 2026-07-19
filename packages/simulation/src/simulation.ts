import type {
  AbilityName,
  CombatEvent,
  CommandName,
  DecisionTrace,
  EnemyArchetype,
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
  velocityX: number;
  velocityY: number;
  facing: number;
  knockbackX: number;
  knockbackY: number;
  radius: number;
  health: number;
  maxHealth: number;
  speed: number;
  damage: number;
  attackRange: number;
  attackCooldown: number;
  cooldownRemaining: number;
  hitFlashTicks: number;
  lastDamageTick: number;
}

interface Robot extends Actor {
  role: RobotRole;
  energy: number;
  maxEnergy: number;
  energyRegen: number;
  command: CommandName;
  guarding: boolean;
  abilityCooldown: number;
  abilityTicks: number;
  dashTicks: number;
  dashCooldown: number;
  shotCount: number;
}

interface Enemy extends Actor {
  archetype: EnemyArchetype;
  targetId: string;
  markTicks: number;
  telegraphTicks: number;
  slowTicks: number;
  elite: boolean;
  lastHitOwnerId: string;
  splitDepth: number;
}

interface Projectile {
  id: string;
  x: number;
  y: number;
  previousX: number;
  previousY: number;
  velocityX: number;
  velocityY: number;
  facing: number;
  radius: number;
  targetId: string;
  ownerId: string;
  team: 'squad' | 'hostile';
  damage: number;
  speed: number;
  chainRemaining: number;
  pierceRemaining: number;
  critical: boolean;
  hitIds: string[];
}

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
  abilityAttempts: 0,
  abilityFailures: 0,
});

const roleAbility: Record<RobotRole, AbilityName> = {
  striker: 'overcharge',
  guardian: 'shield',
  scout: 'mark',
};

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
  private nextEventId = 1;
  private availableUpgrades: UpgradeEffect[] = [];
  private appliedUpgrades: UpgradeEffect[] = [];
  private combatEvents: CombatEvent[] = [];
  private metrics: RunMetrics = this.createMetrics();

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
    this.emit('upgrade', ARENA_WIDTH / 2, ARENA_HEIGHT / 2, 'medium');
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
    this.updateTimers();
    this.removeDeadEntities();

    if (this.robots.length === 0) {
      this.phase = 'defeat';
      this.metrics.failureCause = this.inferFailureCause();
      this.emit('defeat', ARENA_WIDTH / 2, ARENA_HEIGHT / 2, 'heavy');
      const snapshot = this.snapshot();
      snapshot.checksum = this.checksum();
      events.runCompleted = { snapshot, observations: this.observations() };
    } else if (
      this.enemies.length === 0 &&
      this.projectiles.every((projectile) => projectile.team !== 'squad')
    ) {
      this.metrics.wavesCompleted = this.wave;
      events.waveCompleted = this.wave;
      this.emit('wave-end', ARENA_WIDTH / 2, ARENA_HEIGHT / 2, 'heavy');
      if (this.wave >= 3) {
        this.phase = 'victory';
        this.emit('victory', ARENA_WIDTH / 2, ARENA_HEIGHT / 2, 'boss');
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
        velocityX: robot.velocityX,
        velocityY: robot.velocityY,
        facing: robot.facing,
        radius: robot.radius,
        health: robot.health,
        maxHealth: robot.maxHealth,
        team: 'squad' as const,
        flash: robot.hitFlashTicks > 0,
        ...(robot.abilityTicks > 0 ? { abilityActive: roleAbility[robot.role] } : {}),
        abilityCooldown: robot.abilityCooldown,
        energy: robot.energy,
        maxEnergy: robot.maxEnergy,
        shielded: this.isShielded(robot),
      })),
      ...this.enemies.map((enemy) => ({
        id: enemy.id,
        kind: 'enemy' as const,
        archetype: enemy.archetype,
        x: enemy.x,
        y: enemy.y,
        previousX: enemy.previousX,
        previousY: enemy.previousY,
        velocityX: enemy.velocityX,
        velocityY: enemy.velocityY,
        facing: enemy.facing,
        radius: enemy.radius,
        health: enemy.health,
        maxHealth: enemy.maxHealth,
        team: 'hostile' as const,
        flash: enemy.hitFlashTicks > 0,
        marked: enemy.markTicks > 0,
        elite: enemy.elite,
        telegraph: enemy.telegraphTicks > 0 ? enemy.telegraphTicks / 24 : 0,
      })),
      ...this.projectiles.map((projectile) => ({
        id: projectile.id,
        kind: 'projectile' as const,
        x: projectile.x,
        y: projectile.y,
        previousX: projectile.previousX,
        previousY: projectile.previousY,
        velocityX: projectile.velocityX,
        velocityY: projectile.velocityY,
        facing: projectile.facing,
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
      events: this.combatEvents.filter((event) => event.tick >= this.tick - 120),
      appliedUpgrades: [...this.appliedUpgrades],
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
        round(robot.velocityX),
        round(robot.velocityY),
        round(robot.health),
        round(robot.energy),
        round(robot.abilityCooldown),
      ]),
      enemies: this.enemies.map((enemy) => [
        enemy.id,
        enemy.archetype,
        round(enemy.x),
        round(enemy.y),
        round(enemy.health),
        enemy.markTicks,
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
    this.nextEventId = 1;
    this.availableUpgrades = [];
    this.appliedUpgrades = [];
    this.combatEvents = [];
    this.metrics = this.createMetrics();
  }

  private createMetrics(): RunMetrics {
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
      abilitiesUsed: { striker: 0, guardian: 0, scout: 0 },
      shieldDamageBlocked: 0,
      markedBonusDamage: 0,
      sniperDamage: 0,
      splitChildrenDestroyed: 0,
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
      velocityX: 0,
      velocityY: 0,
      facing: 0,
      knockbackX: 0,
      knockbackY: 0,
      radius: role === 'guardian' ? 18 : 15,
      health: stats.maxHealth,
      maxHealth: stats.maxHealth,
      speed: stats.speed,
      damage: stats.damage,
      attackRange: stats.attackRange,
      attackCooldown: role === 'scout' ? 0.62 : role === 'striker' ? 0.76 : 0.9,
      cooldownRemaining: 0,
      hitFlashTicks: 0,
      lastDamageTick: -9999,
      energy: 100,
      maxEnergy: 100,
      energyRegen: role === 'scout' ? 16 : 13,
      command: 'wait',
      guarding: false,
      abilityCooldown: 0,
      abilityTicks: 0,
      dashTicks: 0,
      dashCooldown: 0,
      shotCount: 0,
    });
    this.robots = [
      create('striker', 390, 260, { maxHealth: 140, speed: 150, damage: 26, attackRange: 185 }),
      create('guardian', 355, 310, { maxHealth: 220, speed: 118, damage: 17, attackRange: 160 }),
      create('scout', 420, 330, { maxHealth: 110, speed: 195, damage: 19, attackRange: 175 }),
    ];
  }

  private spawnWave(wave: number): void {
    this.wave = wave;
    const composition: EnemyArchetype[] = this.shortRun
      ? [wave === 1 ? 'swarmer' : wave === 2 ? 'splitter' : 'commander']
      : wave === 1
        ? ['swarmer', 'swarmer', 'swarmer', 'swarmer', 'swarmer', 'splitter', 'swarmer']
        : wave === 2
          ? ['swarmer', 'swarmer', 'sniper', 'sniper', 'splitter', 'bulwark', 'swarmer', 'splitter']
          : [
              'swarmer',
              'swarmer',
              'sniper',
              'sniper',
              'splitter',
              'bulwark',
              'bulwark',
              'swarmer',
              'commander',
            ];
    composition.forEach((archetype, index) =>
      this.enemies.push(this.createEnemy(archetype, wave, index)),
    );
    this.emit('wave-start', ARENA_WIDTH / 2, ARENA_HEIGHT / 2, wave === 3 ? 'heavy' : 'medium');
  }

  private createEnemy(
    archetype: EnemyArchetype,
    wave: number,
    index: number,
    position?: { x: number; y: number },
  ): Enemy {
    const edge = index % 4;
    const margin = 38;
    const x =
      position?.x ??
      (edge === 0
        ? margin
        : edge === 2
          ? ARENA_WIDTH - margin
          : this.random.between(75, ARENA_WIDTH - 75));
    const y =
      position?.y ??
      (edge === 1
        ? margin
        : edge === 3
          ? ARENA_HEIGHT - margin
          : this.random.between(75, ARENA_HEIGHT - 75));
    const base = enemyStats(archetype, wave, this.shortRun);
    return {
      id: `enemy-${this.nextEntityId++}`,
      archetype,
      x,
      y,
      previousX: x,
      previousY: y,
      velocityX: 0,
      velocityY: 0,
      facing: Math.PI,
      knockbackX: 0,
      knockbackY: 0,
      radius: base.radius,
      health: base.health,
      maxHealth: base.health,
      speed: base.speed,
      damage: base.damage,
      attackRange: base.range,
      attackCooldown: base.cooldown,
      cooldownRemaining: this.random.between(0, base.cooldown),
      hitFlashTicks: 0,
      lastDamageTick: -9999,
      targetId: '',
      markTicks: 0,
      telegraphTicks: 0,
      slowTicks: 0,
      elite: archetype === 'commander',
      lastHitOwnerId: '',
      splitDepth: archetype === 'splitter-child' ? 1 : 0,
    };
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
      const alliesUnderThreat = this.robots.filter((ally) =>
        this.enemies.some((candidate) => distance(ally, candidate) < 190),
      ).length;
      const context: ScriptContext = {
        health: robot.health,
        health_percent: (robot.health / robot.maxHealth) * 100,
        energy: robot.energy,
        'enemy.distance': enemy ? distance(robot, enemy) : 9999,
        attack_range: robot.attackRange,
        ally_lowest_health: lowestAllyHealth,
        ability_ready: robot.abilityCooldown <= 0 ? 1 : 0,
        ability_cooldown: robot.abilityCooldown,
        'enemy.marked': enemy?.markTicks ? 1 : 0,
        allies_under_threat: alliesUnderThreat,
      };
      const decision = executeProgram(this.programs[robot.role], context, 64);
      robot.command = decision.command;
      robot.guarding = decision.command === 'guard';
      const status = isAbility(decision.command)
        ? this.activateAbility(robot, decision.command, enemy)
        : this.commandStatus(robot, decision.command, enemy);
      this.recordDecision(robot, decision.command, context['enemy.distance'], status.executed);
      traces.push({
        tick: this.tick,
        robotId: robot.id,
        robot: robot.role,
        command: decision.command,
        span: decision.span,
        ...status,
      });
    }
    return traces;
  }

  private commandStatus(
    robot: Robot,
    command: CommandName,
    enemy: Enemy | undefined,
  ): { executed: boolean; reason?: string } {
    if (command !== 'attack') return { executed: true };
    if (!enemy) return { executed: false, reason: 'No target available.' };
    if (distance(robot, enemy) > robot.attackRange)
      return { executed: false, reason: 'Target is outside attack range.' };
    if (robot.energy < 12) return { executed: false, reason: 'Needs 12 energy.' };
    return { executed: true };
  }

  private activateAbility(
    robot: Robot,
    ability: AbilityName,
    enemy: Enemy | undefined,
  ): { executed: boolean; reason?: string } {
    const metrics = this.metrics.perRobot[robot.role];
    metrics.abilityAttempts += 1;
    if (ability !== roleAbility[robot.role]) {
      metrics.abilityFailures += 1;
      return { executed: false, reason: `${title(robot.role)} cannot use ${ability}().` };
    }
    const cost = ability === 'overcharge' ? 45 : ability === 'shield' ? 40 : 30;
    if (robot.abilityCooldown > 0) {
      metrics.abilityFailures += 1;
      return { executed: false, reason: `Ability ready in ${robot.abilityCooldown.toFixed(1)}s.` };
    }
    if (robot.energy < cost) {
      metrics.abilityFailures += 1;
      return { executed: false, reason: `Needs ${cost} energy.` };
    }
    if (ability === 'mark' && !enemy) {
      metrics.abilityFailures += 1;
      return { executed: false, reason: 'No target available to mark.' };
    }
    robot.energy -= cost;
    robot.abilityCooldown = ability === 'overcharge' ? 8 : ability === 'shield' ? 9 : 6;
    robot.abilityTicks = Math.round(
      (ability === 'shield' ? 3.6 : ability === 'mark' ? 0.45 : 3) * FIXED_RATE,
    );
    this.metrics.abilitiesUsed[robot.role] += 1;
    if (ability === 'mark' && enemy) enemy.markTicks = Math.round(4.8 * FIXED_RATE);
    this.emit('ability', robot.x, robot.y, 'heavy', {
      role: robot.role,
      ability,
      ...(enemy ? { targetId: enemy.id } : {}),
      team: 'squad',
    });
    if (ability === 'overcharge' && this.hasUpgrade('volatile-overcharge')) {
      for (const target of this.enemies.filter((candidate) => distance(robot, candidate) <= 115))
        this.damageEnemy(target, 28, robot.id, robot.x, robot.y);
    }
    return { executed: true };
  }

  private recordDecision(
    robot: Robot,
    command: CommandName,
    enemyDistance: number,
    executed: boolean,
  ): void {
    const robotMetrics = this.metrics.perRobot[robot.role];
    robotMetrics.commands += 1;
    this.metrics.commandsExecuted += 1;
    if (command === 'wait') {
      robotMetrics.waits += 1;
      this.metrics.idleDecisions += 1;
    }
    if (command === 'retreat' && robot.health / robot.maxHealth > 0.8)
      robotMetrics.retreatsAbove80 += 1;
    if (command === 'attack' && (!executed || enemyDistance > robot.attackRange))
      robotMetrics.attacksOutOfRange += 1;
  }

  private moveRobots(): void {
    for (const robot of this.robots) {
      const enemy = nearest(robot, this.enemies);
      if (!enemy) {
        integrate(robot, 0, 0, 680);
        continue;
      }
      let desired = { x: 0, y: 0 };
      const speedBoost =
        this.hasUpgrade('survival-servos') && robot.health / robot.maxHealth < 0.35 ? 1.45 : 1;
      const baseSpeed = robot.speed * speedBoost;
      if (robot.command === 'attack') this.tryShoot(robot, enemy, 'squad');
      if (robot.command === 'approach') {
        if (robot.role === 'striker' && robot.dashCooldown <= 0 && distance(robot, enemy) > 120) {
          robot.dashTicks = 6;
          robot.dashCooldown = 2.4;
        }
        desired = towardVelocity(
          robot,
          enemy,
          baseSpeed * (robot.dashTicks > 0 ? 1.65 : 1),
          Math.max(38, robot.attackRange * 0.78),
        );
      }
      if (robot.command === 'retreat') desired = awayVelocity(robot, enemy, baseSpeed);
      if (robot.command === 'guard' || robot.command === 'shield') {
        const vulnerable = [...this.robots].sort(
          (left, right) => left.health / left.maxHealth - right.health / right.maxHealth,
        )[0];
        if (vulnerable) desired = towardVelocity(robot, vulnerable, baseSpeed, 42);
      }
      if (robot.command === 'overcharge' || robot.command === 'mark') desired = { x: 0, y: 0 };
      const separation = this.robotSeparation(robot);
      desired.x += separation.x;
      desired.y += separation.y;
      integrate(robot, desired.x, desired.y, 760);
      constrain(robot);
    }
  }

  private robotSeparation(robot: Robot): { x: number; y: number } {
    let x = 0;
    let y = 0;
    for (const ally of this.robots) {
      if (ally.id === robot.id) continue;
      const gap = distance(robot, ally);
      if (gap > 0 && gap < 48) {
        x += ((robot.x - ally.x) / gap) * (48 - gap) * 6;
        y += ((robot.y - ally.y) / gap) * (48 - gap) * 6;
      }
    }
    return { x, y };
  }

  private updateEnemyAI(): void {
    for (const enemy of this.enemies) {
      const target =
        enemy.archetype === 'swarmer'
          ? [...this.robots].sort((a, b) => a.health / a.maxHealth - b.health / b.maxHealth)[0]
          : nearest(enemy, this.robots);
      if (!target) continue;
      enemy.targetId = target.id;
      let desired = { x: 0, y: 0 };
      const speed = enemy.speed * (enemy.slowTicks > 0 ? 0.56 : 1);

      if (enemy.archetype === 'sniper' || enemy.archetype === 'commander') {
        const gap = distance(enemy, target);
        if (enemy.telegraphTicks > 0) {
          enemy.telegraphTicks -= 1;
          if (enemy.telegraphTicks === 0) this.fireProjectile(enemy, target, 'hostile');
        } else if (enemy.cooldownRemaining <= 0 && gap <= enemy.attackRange) {
          enemy.telegraphTicks = enemy.archetype === 'commander' ? 18 : 24;
        } else if (gap < 210) desired = awayVelocity(enemy, target, speed);
        else if (gap > enemy.attackRange * 0.88)
          desired = towardVelocity(enemy, target, speed, enemy.attackRange * 0.78);
      } else {
        const surroundAngle = entityNumber(enemy.id) * 2.399;
        const surroundRadius = enemy.archetype === 'swarmer' ? 32 : 0;
        const point = {
          x: target.x + Math.cos(surroundAngle) * surroundRadius,
          y: target.y + Math.sin(surroundAngle) * surroundRadius,
        };
        const gap = distance(enemy, target);
        if (gap <= enemy.attackRange) this.tryShoot(enemy, target, 'hostile');
        else
          desired = towardVelocity(
            enemy,
            point,
            speed,
            enemy.archetype === 'swarmer' ? 0 : enemy.attackRange * 0.72,
          );
      }
      integrate(enemy, desired.x, desired.y, enemy.archetype === 'swarmer' ? 900 : 520);
      constrain(enemy);
    }
  }

  private tryShoot(owner: Actor, target: Actor, team: 'squad' | 'hostile'): void {
    if (owner.cooldownRemaining > 0 || distance(owner, target) > owner.attackRange) return;
    const robot = isRobot(owner) ? owner : null;
    if (robot && robot.energy < 12) return;
    if (robot) robot.energy -= 12;
    this.fireProjectile(owner, target, team);
  }

  private fireProjectile(owner: Actor, target: Actor, team: 'squad' | 'hostile'): void {
    const robot = isRobot(owner) ? owner : null;
    const overcharged = robot?.role === 'striker' && robot.abilityTicks > 0;
    if (robot) robot.shotCount += 1;
    owner.cooldownRemaining = owner.attackCooldown * (overcharged ? 0.48 : 1);
    const facing = Math.atan2(target.y - owner.y, target.x - owner.x);
    const critical = Boolean(
      robot && this.hasUpgrade('cryo-criticals') && robot.shotCount % 5 === 0,
    );
    const pierce = Boolean(robot && this.hasUpgrade('trident-bore') && robot.shotCount % 3 === 0);
    this.projectiles.push({
      id: `projectile-${this.nextEntityId++}`,
      x: owner.x,
      y: owner.y,
      previousX: owner.x,
      previousY: owner.y,
      velocityX: Math.cos(facing) * (team === 'squad' ? 470 : 320),
      velocityY: Math.sin(facing) * (team === 'squad' ? 470 : 320),
      facing,
      radius: team === 'squad' ? 4 : 5,
      targetId: target.id,
      ownerId: owner.id,
      team,
      damage: owner.damage * (overcharged ? 1.5 : 1),
      speed: team === 'squad' ? 470 : 320,
      chainRemaining: team === 'squad' && this.hasUpgrade('arc-relay') ? 1 : 0,
      pierceRemaining: pierce ? 1 : 0,
      critical,
      hitIds: [],
    });
    this.emit('shot', owner.x, owner.y, 'light', {
      team,
      targetId: owner.id,
      ...(robot ? { role: robot.role } : {}),
      ...(isEnemy(owner) ? { archetype: owner.archetype } : {}),
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
        if (projectile.team === 'squad' && isEnemy(target))
          this.hitEnemyWithProjectile(target, projectile);
        else if (projectile.team === 'hostile' && isRobot(target))
          this.hitRobotWithProjectile(target, projectile);
        projectile.hitIds.push(target.id);
        if (projectile.pierceRemaining > 0 && projectile.team === 'squad') {
          projectile.pierceRemaining -= 1;
          const next = nearestExcluding(target, this.enemies, projectile.hitIds, 150);
          if (next) {
            projectile.targetId = next.id;
            remaining.push(projectile);
          }
        } else if (projectile.chainRemaining > 0 && projectile.team === 'squad') {
          const next = nearestExcluding(target, this.enemies, projectile.hitIds, 145);
          if (next) {
            projectile.chainRemaining -= 1;
            projectile.damage *= 0.65;
            projectile.targetId = next.id;
            remaining.push(projectile);
          }
        }
      } else {
        const angle = Math.atan2(target.y - projectile.y, target.x - projectile.x);
        projectile.facing = angle;
        projectile.velocityX = Math.cos(angle) * projectile.speed;
        projectile.velocityY = Math.sin(angle) * projectile.speed;
        projectile.x += projectile.velocityX / FIXED_RATE;
        projectile.y += projectile.velocityY / FIXED_RATE;
        remaining.push(projectile);
      }
    }
    this.projectiles = remaining;
  }

  private hitEnemyWithProjectile(enemy: Enemy, projectile: Projectile): void {
    let damage = projectile.damage;
    if (enemy.archetype === 'bulwark' || enemy.archetype === 'commander') {
      const incomingAngle = Math.atan2(projectile.y - enemy.y, projectile.x - enemy.x);
      const front = Math.cos(incomingAngle - enemy.facing) > 0.15;
      if (front) damage *= enemy.archetype === 'commander' ? 0.55 : 0.45;
    }
    const owner = this.robots.find((robot) => robot.id === projectile.ownerId);
    if (
      owner?.role === 'striker' &&
      this.hasUpgrade('lone-target-protocol') &&
      this.enemies.filter(
        (candidate) => candidate.id !== enemy.id && distance(candidate, enemy) < 115,
      ).length === 0
    )
      damage *= 1.35;
    const baseDamage = damage;
    if (enemy.markTicks > 0) {
      damage *= 1.35;
      this.metrics.markedBonusDamage += damage - baseDamage;
    }
    this.damageEnemy(enemy, damage, projectile.ownerId, projectile.x, projectile.y);
    if (projectile.critical) enemy.slowTicks = Math.max(enemy.slowTicks, 42);
  }

  private hitRobotWithProjectile(robot: Robot, projectile: Projectile): void {
    const shield = this.robots.find(
      (candidate) =>
        candidate.role === 'guardian' &&
        candidate.abilityTicks > 0 &&
        distance(candidate, robot) <= 118,
    );
    const reduction = shield ? 0.42 : robot.guarding ? 0.68 : 1;
    const actualDamage = projectile.damage * reduction;
    const blocked = projectile.damage - actualDamage;
    robot.health -= actualDamage;
    robot.lastDamageTick = this.tick;
    robot.hitFlashTicks = 3;
    const angle = Math.atan2(robot.y - projectile.y, robot.x - projectile.x);
    robot.knockbackX += Math.cos(angle) * 52;
    robot.knockbackY += Math.sin(angle) * 52;
    this.metrics.damageReceived += actualDamage;
    this.metrics.perRobot[robot.role].damageReceived += actualDamage;
    const enemyOwner = this.enemies.find((enemy) => enemy.id === projectile.ownerId);
    if (enemyOwner?.archetype === 'sniper' || enemyOwner?.archetype === 'commander')
      this.metrics.sniperDamage += actualDamage;
    if (shield && blocked > 0) {
      this.metrics.shieldDamageBlocked += blocked;
      if (this.hasUpgrade('guardian-dynamo'))
        shield.energy = Math.min(100, shield.energy + blocked * 0.22);
      if (this.hasUpgrade('mirror-aegis') && enemyOwner)
        this.damageEnemy(enemyOwner, blocked * 0.35, shield.id, shield.x, shield.y);
    }
    this.emit('impact', robot.x, robot.y, actualDamage > 22 ? 'medium' : 'light', {
      team: 'hostile',
      targetId: robot.id,
    });
  }

  private damageEnemy(
    enemy: Enemy,
    damage: number,
    ownerId: string,
    impactX: number,
    impactY: number,
  ): void {
    enemy.health -= damage;
    enemy.lastHitOwnerId = ownerId;
    enemy.lastDamageTick = this.tick;
    enemy.hitFlashTicks = 3;
    const angle = Math.atan2(enemy.y - impactY, enemy.x - impactX);
    enemy.knockbackX += Math.cos(angle) * Math.min(75, damage * 2.1);
    enemy.knockbackY += Math.sin(angle) * Math.min(75, damage * 2.1);
    this.metrics.totalDamage += damage;
    const owner = this.robots.find((robot) => robot.id === ownerId);
    if (owner) this.metrics.perRobot[owner.role].damage += damage;
    this.emit('impact', enemy.x, enemy.y, damage > 30 ? 'medium' : 'light', {
      team: 'squad',
      targetId: enemy.id,
    });
  }

  private updateTimers(): void {
    for (const actor of [...this.robots, ...this.enemies]) {
      actor.cooldownRemaining = Math.max(0, actor.cooldownRemaining - 1 / FIXED_RATE);
      actor.hitFlashTicks = Math.max(0, actor.hitFlashTicks - 1);
    }
    for (const robot of this.robots) {
      const scoutBoost =
        robot.role === 'scout' &&
        this.hasUpgrade('evasive-clock') &&
        this.tick - robot.lastDamageTick > FIXED_RATE * 2.5
          ? 1.8
          : 1;
      robot.abilityCooldown = Math.max(0, robot.abilityCooldown - scoutBoost / FIXED_RATE);
      robot.abilityTicks = Math.max(0, robot.abilityTicks - 1);
      robot.dashTicks = Math.max(0, robot.dashTicks - 1);
      robot.dashCooldown = Math.max(0, robot.dashCooldown - 1 / FIXED_RATE);
    }
    for (const enemy of this.enemies) {
      enemy.markTicks = Math.max(0, enemy.markTicks - 1);
      enemy.slowTicks = Math.max(0, enemy.slowTicks - 1);
    }
  }

  private removeDeadEntities(): void {
    const deadEnemies = this.enemies.filter((enemy) => enemy.health <= 0);
    if (deadEnemies.length === 0) {
      this.robots = this.robots.filter((robot) => robot.health > 0);
      return;
    }
    const deadIds = new Set(deadEnemies.map((enemy) => enemy.id));
    this.enemies = this.enemies.filter((enemy) => !deadIds.has(enemy.id));
    const finalDeathId =
      this.enemies.length === 0 &&
      !deadEnemies.some((enemy) => enemy.archetype === 'splitter' && enemy.splitDepth === 0)
        ? deadEnemies.at(-1)?.id
        : undefined;
    for (const enemy of deadEnemies) {
      this.metrics.enemiesDestroyed += 1;
      if (enemy.archetype === 'splitter-child') this.metrics.splitChildrenDestroyed += 1;
      const intensity =
        enemy.archetype === 'commander'
          ? 'boss'
          : enemy.archetype === 'bulwark'
            ? 'heavy'
            : 'medium';
      this.emit('death', enemy.x, enemy.y, intensity, {
        archetype: enemy.archetype,
        targetId: enemy.id,
        team: 'hostile',
        ...(enemy.id === finalDeathId ? { finalInWave: true } : {}),
      });
      if (enemy.markTicks > 0) {
        if (this.hasUpgrade('bounty-circuit'))
          for (const robot of this.robots) robot.energy = Math.min(100, robot.energy + 14);
        if (this.hasUpgrade('viral-designator')) {
          const next = nearest(enemy, this.enemies);
          if (next) next.markTicks = Math.max(next.markTicks, Math.round(3.8 * FIXED_RATE));
        }
      }
      if (enemy.archetype === 'splitter' && enemy.splitDepth === 0) {
        for (const side of [-1, 1]) {
          const child = this.createEnemy('splitter-child', this.wave, this.nextEntityId, {
            x: enemy.x + side * 18,
            y: enemy.y + side * 10,
          });
          this.enemies.push(child);
        }
      }
      const owner = this.robots.find((robot) => robot.id === enemy.lastHitOwnerId);
      if (owner && this.hasUpgrade('proximity-charge') && distance(owner, enemy) <= 105) {
        for (const nearby of this.enemies.filter((candidate) => distance(candidate, enemy) <= 90))
          this.damageEnemy(nearby, 24, owner.id, enemy.x, enemy.y);
      }
    }
    this.robots = this.robots.filter((robot) => robot.health > 0);
  }

  private selectUpgradeOptions(): UpgradeEffect[] {
    const owned = new Set(this.appliedUpgrades.map((upgrade) => upgrade.id));
    const pool = UPGRADES.filter((upgrade) => !owned.has(upgrade.id));
    const options: UpgradeEffect[] = [];
    while (options.length < 3 && pool.length > 0) {
      const index = this.random.integer(pool.length);
      const [selected] = pool.splice(index, 1);
      if (selected) options.push(selected);
    }
    return options;
  }

  private applyUpgrade(upgrade: UpgradeEffect): void {
    for (const robot of this.robots) {
      if (upgrade.effect === 'damage') robot.damage *= upgrade.multiplier ?? 1;
      if (upgrade.effect === 'range') robot.attackRange *= upgrade.multiplier ?? 1;
      if (upgrade.effect === 'health') {
        robot.maxHealth *= upgrade.multiplier ?? 1;
        robot.health = robot.maxHealth;
      } else robot.health = Math.min(robot.maxHealth, robot.health + robot.maxHealth * 0.22);
    }
  }

  private hasUpgrade(id: string): boolean {
    return this.appliedUpgrades.some((upgrade) => upgrade.id === id);
  }

  private isShielded(robot: Robot): boolean {
    return this.robots.some(
      (candidate) =>
        candidate.role === 'guardian' &&
        candidate.abilityTicks > 0 &&
        distance(candidate, robot) <= 118,
    );
  }

  private emit(
    type: CombatEvent['type'],
    x: number,
    y: number,
    intensity: CombatEvent['intensity'],
    details: Partial<Omit<CombatEvent, 'id' | 'tick' | 'type' | 'x' | 'y' | 'intensity'>> = {},
  ): void {
    this.combatEvents.push({
      id: this.nextEventId++,
      tick: this.tick,
      type,
      x,
      y,
      intensity,
      ...details,
    });
    if (this.combatEvents.length > 180) this.combatEvents.splice(0, this.combatEvents.length - 180);
  }

  private observations(): string[] {
    const results: string[] = [];
    const striker = this.metrics.perRobot.striker;
    if (striker.abilityAttempts === 0)
      results.push(
        'Striker never attempted Overcharge; add an ability_ready rule to convert spare energy.',
      );
    if (this.metrics.markedBonusDamage > 0)
      results.push(
        `Scout's Mark added ${Math.round(this.metrics.markedBonusDamage)} squad damage.`,
      );
    if (this.metrics.shieldDamageBlocked > 0)
      results.push(
        `Guardian blocked ${Math.round(this.metrics.shieldDamageBlocked)} damage with Shield.`,
      );
    if (this.metrics.sniperDamage > this.metrics.damageReceived * 0.35)
      results.push('Snipers dealt most incoming damage from outside standard attack range.');
    const failed = (Object.entries(this.metrics.perRobot) as [RobotRole, RobotMetrics][]).find(
      ([, metrics]) => metrics.abilityFailures > 2,
    );
    if (failed)
      results.push(
        `${title(failed[0])} had ${failed[1].abilityFailures} failed ability attempts; check cooldown and energy sensors.`,
      );
    if (results.length === 0)
      results.push(
        'The squad used its tactical windows cleanly; try a more specialized upgrade chain.',
      );
    return results.slice(0, 3);
  }

  private inferFailureCause(): string {
    if (this.metrics.sniperDamage > this.metrics.damageReceived * 0.4) return 'sniper pressure';
    if (this.metrics.shieldDamageBlocked < 10) return 'insufficient protection';
    return 'squad integrity collapsed under mixed pressure';
  }
}

function enemyStats(
  archetype: EnemyArchetype,
  wave: number,
  shortRun: boolean,
): {
  health: number;
  speed: number;
  damage: number;
  range: number;
  cooldown: number;
  radius: number;
} {
  if (shortRun)
    return {
      health: archetype === 'commander' ? 115 : 48,
      speed: 125,
      damage: archetype === 'commander' ? 13 : 7,
      range: archetype === 'commander' ? 310 : 62,
      cooldown: 1.15,
      radius: archetype === 'commander' ? 24 : 13,
    };
  const scale = 1 + (wave - 1) * 0.12;
  const stats: Record<EnemyArchetype, [number, number, number, number, number, number]> = {
    swarmer: [105, 132, 0.7, 48, 0.92, 11],
    sniper: [155, 74, 1.5, 365, 2.8, 14],
    splitter: [235, 92, 1.25, 78, 1.25, 17],
    'splitter-child': [82, 122, 0.6, 54, 1, 9],
    bulwark: [405, 62, 1.7, 92, 1.45, 22],
    commander: [800, 86, 3, 330, 2.25, 27],
  };
  const [health, speed, damage, range, cooldown, radius] = stats[archetype];
  return { health: health * scale, speed, damage: damage * scale, range, cooldown, radius };
}

function distance(left: Pick<Actor, 'x' | 'y'>, right: Pick<Actor, 'x' | 'y'>): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function isRobot(actor: Actor): actor is Robot {
  return 'role' in actor;
}

function isEnemy(actor: Actor): actor is Enemy {
  return 'archetype' in actor;
}

function isAbility(command: CommandName): command is AbilityName {
  return command === 'overcharge' || command === 'shield' || command === 'mark';
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

function nearestExcluding<T extends Pick<Actor, 'id' | 'x' | 'y'>>(
  source: Pick<Actor, 'x' | 'y'>,
  candidates: T[],
  excluded: string[],
  maxDistance: number,
): T | undefined {
  return nearest(
    source,
    candidates.filter(
      (candidate) => !excluded.includes(candidate.id) && distance(source, candidate) <= maxDistance,
    ),
  );
}

function towardVelocity(
  entity: Pick<Actor, 'x' | 'y'>,
  target: Pick<Actor, 'x' | 'y'>,
  speed: number,
  stopDistance: number,
): { x: number; y: number } {
  const deltaX = target.x - entity.x;
  const deltaY = target.y - entity.y;
  const length = Math.hypot(deltaX, deltaY);
  if (length <= stopDistance + 5 || length === 0) return { x: 0, y: 0 };
  const ramp = Math.min(1, Math.max(0.18, (length - stopDistance) / 55));
  return { x: (deltaX / length) * speed * ramp, y: (deltaY / length) * speed * ramp };
}

function awayVelocity(
  entity: Pick<Actor, 'x' | 'y'>,
  target: Pick<Actor, 'x' | 'y'>,
  speed: number,
): { x: number; y: number } {
  const deltaX = entity.x - target.x;
  const deltaY = entity.y - target.y;
  const length = Math.hypot(deltaX, deltaY) || 1;
  return { x: (deltaX / length) * speed, y: (deltaY / length) * speed };
}

function integrate(actor: Actor, desiredX: number, desiredY: number, acceleration: number): void {
  const maxChange = acceleration / FIXED_RATE;
  actor.velocityX = approach(actor.velocityX, desiredX, maxChange);
  actor.velocityY = approach(actor.velocityY, desiredY, maxChange);
  actor.velocityX += actor.knockbackX / FIXED_RATE;
  actor.velocityY += actor.knockbackY / FIXED_RATE;
  actor.knockbackX *= 0.8;
  actor.knockbackY *= 0.8;
  actor.x += actor.velocityX / FIXED_RATE;
  actor.y += actor.velocityY / FIXED_RATE;
  if (Math.hypot(actor.velocityX, actor.velocityY) > 3)
    actor.facing = turnToward(actor.facing, Math.atan2(actor.velocityY, actor.velocityX), 0.24);
}

function approach(value: number, target: number, amount: number): number {
  if (value < target) return Math.min(target, value + amount);
  return Math.max(target, value - amount);
}

function turnToward(value: number, target: number, amount: number): number {
  const delta = Math.atan2(Math.sin(target - value), Math.cos(target - value));
  return value + Math.max(-amount, Math.min(amount, delta));
}

function constrain(entity: Actor): void {
  const nextX = Math.max(entity.radius + 22, Math.min(ARENA_WIDTH - entity.radius - 22, entity.x));
  const nextY = Math.max(entity.radius + 22, Math.min(ARENA_HEIGHT - entity.radius - 22, entity.y));
  if (nextX !== entity.x) entity.velocityX *= -0.18;
  if (nextY !== entity.y) entity.velocityY *= -0.18;
  entity.x = nextX;
  entity.y = nextY;
}

function entityNumber(id: string): number {
  return Number(id.match(/\d+/)?.[0] ?? 1);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function title(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export { ARENA_HEIGHT, ARENA_WIDTH, FIXED_RATE, UPGRADES };
export type { Program, SourceSpan };
