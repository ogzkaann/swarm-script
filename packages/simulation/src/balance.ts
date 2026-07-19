import { DEFAULT_SCRIPTS, ROBOT_ROLES, type RobotRole } from '@swarm-script/shared';
import { compileScript, type Program } from '@swarm-script/scripting';
import { SwarmSimulation } from './simulation';

export interface BalanceReport {
  seeds: number;
  wins: number;
  winningSeeds: number[];
  winRate: number;
  averageDuration: number;
  averageDamage: Record<RobotRole, number>;
  abilityUsage: Record<RobotRole, number>;
  upgradePicks: Record<string, number>;
  failureCauses: Record<string, number>;
}

export function runBalanceReport(seeds: number[]): BalanceReport {
  const programs = defaultPrograms();
  const totals = {
    duration: 0,
    damage: { striker: 0, guardian: 0, scout: 0 },
    abilities: { striker: 0, guardian: 0, scout: 0 },
  };
  let wins = 0;
  const winningSeeds: number[] = [];
  const upgradePicks: Record<string, number> = {};
  const failureCauses: Record<string, number> = {};

  for (const seed of seeds) {
    const simulation = new SwarmSimulation({ seed, programs });
    simulation.start();
    for (
      let tick = 0;
      tick < 30 * 360 && !['victory', 'defeat'].includes(simulation.getPhase());
      tick += 1
    ) {
      simulation.step();
      if (simulation.getPhase() === 'upgrade') {
        const options = simulation.getUpgradeOptions();
        const selected = options[seed % options.length] ?? options[0];
        if (selected) {
          upgradePicks[selected.id] = (upgradePicks[selected.id] ?? 0) + 1;
          simulation.chooseUpgrade(selected.id);
        }
      }
    }
    const snapshot = simulation.snapshot();
    if (snapshot.phase === 'victory') {
      wins += 1;
      winningSeeds.push(seed);
    } else {
      const cause = snapshot.metrics.failureCause ?? 'timeout';
      failureCauses[cause] = (failureCauses[cause] ?? 0) + 1;
    }
    totals.duration += snapshot.simulationTime;
    for (const role of ROBOT_ROLES) {
      totals.damage[role] += snapshot.metrics.perRobot[role].damage;
      totals.abilities[role] += snapshot.metrics.abilitiesUsed[role];
    }
  }

  const divisor = Math.max(1, seeds.length);
  return {
    seeds: seeds.length,
    wins,
    winningSeeds,
    winRate: wins / divisor,
    averageDuration: totals.duration / divisor,
    averageDamage: mapRoles((role) => totals.damage[role] / divisor),
    abilityUsage: mapRoles((role) => totals.abilities[role] / divisor),
    upgradePicks,
    failureCauses,
  };
}

function defaultPrograms(): Record<RobotRole, Program> {
  return Object.fromEntries(
    ROBOT_ROLES.map((role) => [role, compileScript(DEFAULT_SCRIPTS[role]).program!]),
  ) as Record<RobotRole, Program>;
}

function mapRoles(factory: (role: RobotRole) => number): Record<RobotRole, number> {
  return { striker: factory('striker'), guardian: factory('guardian'), scout: factory('scout') };
}
