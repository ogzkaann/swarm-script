export type RobotRole = 'striker' | 'guardian' | 'scout';
export type AbilityName = 'overcharge' | 'shield' | 'mark';
export type CommandName = 'attack' | 'approach' | 'retreat' | 'guard' | 'wait' | AbilityName;
export type EnemyArchetype =
  'swarmer' | 'sniper' | 'splitter' | 'splitter-child' | 'bulwark' | 'commander';
export type RunPhase = 'idle' | 'running' | 'paused' | 'upgrade' | 'victory' | 'defeat';

export interface SourcePosition {
  offset: number;
  line: number;
  column: number;
}

export interface SourceSpan {
  start: SourcePosition;
  end: SourcePosition;
}

export interface ScriptDiagnostic {
  severity: 'error' | 'warning';
  message: string;
  span: SourceSpan;
  code: string;
}

export interface ScriptSource {
  robot: RobotRole;
  source: string;
}

export interface EntitySnapshot {
  id: string;
  kind: 'robot' | 'enemy' | 'projectile';
  role?: RobotRole;
  x: number;
  y: number;
  previousX: number;
  previousY: number;
  radius: number;
  health: number;
  maxHealth: number;
  team: 'squad' | 'hostile';
  flash: boolean;
  archetype?: EnemyArchetype;
  facing: number;
  velocityX: number;
  velocityY: number;
  abilityActive?: AbilityName;
  abilityCooldown?: number;
  energy?: number;
  maxEnergy?: number;
  marked?: boolean;
  shielded?: boolean;
  elite?: boolean;
  telegraph?: number;
}

export type CombatEventType =
  | 'shot'
  | 'impact'
  | 'death'
  | 'ability'
  | 'wave-start'
  | 'wave-end'
  | 'upgrade'
  | 'victory'
  | 'defeat';

export interface CombatEvent {
  id: number;
  tick: number;
  type: CombatEventType;
  x: number;
  y: number;
  team?: 'squad' | 'hostile';
  role?: RobotRole;
  archetype?: EnemyArchetype;
  ability?: AbilityName;
  targetId?: string;
  finalInWave?: boolean;
  intensity: 'light' | 'medium' | 'heavy' | 'boss';
}

export interface RunMetrics {
  elapsedSeconds: number;
  wavesCompleted: number;
  totalDamage: number;
  damageReceived: number;
  enemiesDestroyed: number;
  commandsExecuted: number;
  idleDecisions: number;
  perRobot: Record<RobotRole, RobotMetrics>;
  abilitiesUsed: Record<RobotRole, number>;
  shieldDamageBlocked: number;
  markedBonusDamage: number;
  sniperDamage: number;
  splitChildrenDestroyed: number;
  failureCause?: string;
}

export interface RobotMetrics {
  damage: number;
  damageReceived: number;
  commands: number;
  waits: number;
  retreatsAbove80: number;
  attacksOutOfRange: number;
  abilityAttempts: number;
  abilityFailures: number;
}

export interface UpgradeEffect {
  id: string;
  name: string;
  description: string;
  effect:
    | 'damage'
    | 'range'
    | 'health'
    | 'chain'
    | 'overchargeBlast'
    | 'shieldReflect'
    | 'markSpread'
    | 'markedEnergy'
    | 'criticalSlow'
    | 'pierce'
    | 'closeExplosion'
    | 'lowHealthSpeed'
    | 'guardianBattery'
    | 'scoutEvasion'
    | 'isolatedDamage';
  multiplier?: number;
  role?: RobotRole;
  synergy: string;
}

export interface WorldSnapshot {
  tick: number;
  simulationTime: number;
  phase: RunPhase;
  wave: number;
  entities: EntitySnapshot[];
  squadHealth: number;
  metrics: RunMetrics;
  checksum?: string;
  events: CombatEvent[];
  appliedUpgrades: UpgradeEffect[];
}

export interface DecisionTrace {
  tick: number;
  robotId: string;
  robot: RobotRole;
  command: CommandName;
  span: SourceSpan;
  executed: boolean;
  reason?: string;
}

export interface RunConfig {
  seed: number;
  scripts: ScriptSource[];
  reducedMotion: boolean;
  shortRun?: boolean;
}

export type MainToWorkerMessage =
  | { type: 'COMPILE_SCRIPTS'; scripts: ScriptSource[] }
  | { type: 'START_RUN'; config: RunConfig }
  | { type: 'PAUSE_RUN' }
  | { type: 'RESUME_RUN' }
  | { type: 'SET_SPEED'; speed: 1 | 2 | 4 }
  | { type: 'CHOOSE_UPGRADE'; upgradeId: string }
  | { type: 'RESET_RUN' };

export type WorkerToMainMessage =
  | {
      type: 'COMPILE_RESULT';
      success: boolean;
      diagnostics: Partial<Record<RobotRole, ScriptDiagnostic[]>>;
    }
  | { type: 'RUN_STARTED'; seed: number }
  | { type: 'WORLD_SNAPSHOT'; snapshot: WorldSnapshot; sentAt: number }
  | { type: 'DECISION_TRACE'; traces: DecisionTrace[] }
  | { type: 'WAVE_COMPLETED'; wave: number }
  | { type: 'UPGRADE_OPTIONS'; options: UpgradeEffect[] }
  | { type: 'RUN_COMPLETED'; result: WorldSnapshot; observations: string[] }
  | { type: 'SIMULATION_ERROR'; message: string };

export const ROBOT_ROLES: RobotRole[] = ['striker', 'guardian', 'scout'];

export const DEFAULT_SCRIPTS: Record<RobotRole, string> = {
  striker: `when health < 30 {
  retreat();
}

when ability_ready == 1 and energy >= 45 {
  overcharge();
}

when enemy.distance <= attack_range {
  attack();
}

otherwise {
  approach();
}`,
  guardian: `when ally_lowest_health < 35 and health_percent > 45 {
  shield();
}

when allies_under_threat >= 2 and ability_ready == 1 {
  shield();
}

when enemy.distance <= attack_range {
  attack();
}

otherwise {
  approach();
}`,
  scout: `when health_percent < 25 {
  retreat();
}

when enemy.marked == 0 and ability_ready == 1 {
  mark();
}

when energy >= 18 and enemy.distance <= attack_range {
  attack();
}

otherwise {
  approach();
}`,
};
