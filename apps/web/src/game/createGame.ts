import Phaser from 'phaser';
import { ARENA_HEIGHT, ARENA_WIDTH } from '@swarm-script/simulation';
import { BattleScene } from './BattleScene';

export function createGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: ARENA_WIDTH,
    height: ARENA_HEIGHT,
    backgroundColor: '#071116',
    scene: [BattleScene],
    render: { antialias: true, pixelArt: false },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  });
}
