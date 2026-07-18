import type {
  MainToWorkerMessage,
  RobotRole,
  ScriptDiagnostic,
  WorkerToMainMessage,
} from '@swarm-script/shared';
import { compileScript, type Program } from '@swarm-script/scripting';
import { SwarmSimulation } from '@swarm-script/simulation';

export class SimulationHost {
  private programs: Partial<Record<RobotRole, Program>> = {};
  private simulation: SwarmSimulation | null = null;
  private speed: 1 | 2 | 4 = 1;

  constructor(private readonly send: (message: WorkerToMainMessage) => void) {}

  handle(message: MainToWorkerMessage): void {
    try {
      switch (message.type) {
        case 'COMPILE_SCRIPTS': {
          const diagnostics: Partial<Record<RobotRole, ScriptDiagnostic[]>> = {};
          const programs: Partial<Record<RobotRole, Program>> = {};
          for (const script of message.scripts) {
            const result = compileScript(script.source);
            diagnostics[script.robot] = result.diagnostics;
            if (result.program) programs[script.robot] = result.program;
          }
          const success = message.scripts.every((script) => programs[script.robot] !== undefined);
          if (success) this.programs = programs;
          this.send({ type: 'COMPILE_RESULT', success, diagnostics });
          break;
        }
        case 'START_RUN': {
          this.compileForRun(message.config.scripts);
          const programs = this.completePrograms();
          if (!programs) return;
          this.simulation = new SwarmSimulation({
            seed: message.config.seed,
            programs,
            ...(message.config.shortRun === undefined ? {} : { shortRun: message.config.shortRun }),
          });
          this.simulation.start();
          this.send({ type: 'RUN_STARTED', seed: message.config.seed });
          this.sendSnapshot();
          break;
        }
        case 'PAUSE_RUN':
          this.simulation?.pause();
          this.sendSnapshot();
          break;
        case 'RESUME_RUN':
          this.simulation?.resume();
          this.sendSnapshot();
          break;
        case 'SET_SPEED':
          this.speed = message.speed;
          break;
        case 'CHOOSE_UPGRADE':
          if (this.simulation?.chooseUpgrade(message.upgradeId)) this.sendSnapshot();
          break;
        case 'RESET_RUN':
          this.simulation = null;
          break;
      }
    } catch (error) {
      this.send({
        type: 'SIMULATION_ERROR',
        message: error instanceof Error ? error.message : 'Unknown simulation failure',
      });
    }
  }

  advanceFrame(): void {
    if (!this.simulation) return;
    for (let index = 0; index < this.speed; index += 1) {
      const events = this.simulation.step();
      if (events.traces.length > 0) this.send({ type: 'DECISION_TRACE', traces: events.traces });
      if (events.waveCompleted !== undefined)
        this.send({ type: 'WAVE_COMPLETED', wave: events.waveCompleted });
      if (events.upgradeOptions)
        this.send({ type: 'UPGRADE_OPTIONS', options: events.upgradeOptions });
      if (events.runCompleted)
        this.send({
          type: 'RUN_COMPLETED',
          result: events.runCompleted.snapshot,
          observations: events.runCompleted.observations,
        });
    }
    if (this.simulation.snapshot().tick % 2 === 0 || this.simulation.getPhase() !== 'running')
      this.sendSnapshot();
  }

  private compileForRun(scripts: { robot: RobotRole; source: string }[]): void {
    const diagnostics: Partial<Record<RobotRole, ScriptDiagnostic[]>> = {};
    const programs: Partial<Record<RobotRole, Program>> = {};
    for (const script of scripts) {
      const result = compileScript(script.source);
      diagnostics[script.robot] = result.diagnostics;
      if (result.program) programs[script.robot] = result.program;
    }
    const success = scripts.every((script) => programs[script.robot] !== undefined);
    this.send({ type: 'COMPILE_RESULT', success, diagnostics });
    if (success) this.programs = programs;
  }

  private completePrograms(): Record<RobotRole, Program> | null {
    const { striker, guardian, scout } = this.programs;
    return striker && guardian && scout ? { striker, guardian, scout } : null;
  }

  private sendSnapshot(): void {
    if (this.simulation)
      this.send({
        type: 'WORLD_SNAPSHOT',
        snapshot: this.simulation.snapshot(),
        sentAt: Date.now(),
      });
  }
}
