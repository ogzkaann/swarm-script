import type { UpgradeEffect } from '@swarm-script/shared';

export const UPGRADES: UpgradeEffect[] = [
  {
    id: 'overclocked-rounds',
    name: 'Overclocked rounds',
    description: '+22% weapon damage',
    stat: 'damage',
    multiplier: 1.22,
  },
  {
    id: 'targeting-lattice',
    name: 'Targeting lattice',
    description: '+18% attack range',
    stat: 'range',
    multiplier: 1.18,
  },
  {
    id: 'vector-servos',
    name: 'Vector servos',
    description: '+16% movement speed',
    stat: 'speed',
    multiplier: 1.16,
  },
  {
    id: 'ceramic-shells',
    name: 'Ceramic shells',
    description: '+20% maximum health and repair',
    stat: 'health',
    multiplier: 1.2,
  },
  {
    id: 'flux-reclaimer',
    name: 'Flux reclaimer',
    description: '+30% energy regeneration',
    stat: 'energyRegen',
    multiplier: 1.3,
  },
  {
    id: 'cycle-optimizer',
    name: 'Cycle optimizer',
    description: '-15% attack cooldown',
    stat: 'cooldown',
    multiplier: 0.85,
  },
];
