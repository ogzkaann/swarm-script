export type RobotRole = 'striker' | 'guardian' | 'scout';
export type CommandName = 'attack' | 'approach' | 'retreat' | 'guard' | 'wait';
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
}

export interface RobotMetrics {
  damage: number;
  damageReceived: number;
  commands: number;
  waits: number;
  retreatsAbove80: number;
  attacksOutOfRange: number;
}

export interface UpgradeEffect {
  id: string;
  name: string;
  description: string;
  stat: 'damage' | 'range' | 'speed' | 'health' | 'energyRegen' | 'cooldown';
  multiplier: number;
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
}

export interface DecisionTrace {
  tick: number;
  robotId: string;
  robot: RobotRole;
  command: CommandName;
  span: SourceSpan;
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

when enemy.distance <= attack_range {
  attack();
}

otherwise {
  approach();
}`,
  guardian: `when ally_lowest_health < 35 and health_percent > 45 {
  guard();
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

when energy >= 18 and enemy.distance <= attack_range {
  attack();
}

otherwise {
  approach();
}`,
};
