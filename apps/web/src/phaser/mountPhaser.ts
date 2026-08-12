import Phaser from 'phaser'
import { GameScene } from './GameScene'

/** 在给定父容器中挂载 Phaser 游戏实例（唯一渲染引擎）。 */
export function mountPhaser(parent: HTMLElement): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#0b141a',
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: '100%',
      height: '100%',
    },
    scene: [GameScene],
    render: { antialias: true, pixelArt: false },
  })

  game.events.once('ready', () => {
    if (game.canvas) game.canvas.id = 'game-canvas'
  })

  return game
}
