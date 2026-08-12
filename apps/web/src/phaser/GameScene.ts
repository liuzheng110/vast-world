import Phaser from 'phaser'
import { PLAYER_RADIUS, PLAYER_SPEED } from '@vastworld/game-core'
import { TILE_H, TILE_W, isoToScreen, tileToWorld } from './iso'
import { generateMap, isObstacle, type GameMap } from './mapgen'
import { resolveMove } from './collision'
import * as connection from '../net/connection'

const FLOOR_COLOR = 0x244c43
const FLOOR_COLOR_ALT = 0x2b5a4f
const PLAYER_COLOR = 0x4be0c0
const OBSTACLE_COLOR = 0x6b7280
const OBSTACLE_HI = 0x8b95a1
const GROUND_DEPTH = -1_000_000

/**
 * 固定斜俯视（等距）2.5D 场景：程序化地图 + WASD 移动 + 本地碰撞 +
 * 相机跟随 + 缩放限制 + 脚点深度排序。不加载任何外部素材。
 */
export class GameScene extends Phaser.Scene {
  private map!: GameMap
  private player!: Phaser.GameObjects.Image
  private pos = { x: 0, y: 0 }
  private keys!: Record<string, Phaser.Input.Keyboard.Key>
  private zoom = 1

  constructor() {
    super('world')
  }

  create(): void {
    this.map = generateMap()
    const spawn = tileToWorld(this.map.spawn.col, this.map.spawn.row, this.map.tileSize)
    this.pos = { x: spawn.x, y: spawn.y }

    this.ensureTextures()
    this.drawGround()
    this.drawObstacles()

    this.player = this.add.image(0, 0, 'player')
    this.player.setDepth(this.pos.y)

    const bounds = this.mapScreenBounds()
    this.cameras.main.setBounds(bounds.minX, bounds.minY, bounds.width, bounds.height)
    this.cameras.main.setBackgroundColor('#0b141a')
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12)
    this.cameras.main.setZoom(this.zoom)
    this.syncPlayerSprite()

    const kb = this.input.keyboard
    if (kb) {
      this.keys = kb.addKeys('W,A,S,D,UP,LEFT,DOWN,RIGHT') as Record<
        string,
        Phaser.Input.Keyboard.Key
      >
    }

    // 滚轮缩放（限制范围）
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      this.zoom = Phaser.Math.Clamp(this.zoom - dy * 0.001, 0.5, 2)
      this.cameras.main.setZoom(this.zoom)
    })
  }

  override update(_time: number, delta: number): void {
    if (!this.keys) return
    const dt = Math.min(delta, 50) / 1000

    let axisX = 0
    let axisY = 0
    if (this.keys.A.isDown || this.keys.LEFT.isDown) axisX -= 1
    if (this.keys.D.isDown || this.keys.RIGHT.isDown) axisX += 1
    if (this.keys.W.isDown || this.keys.UP.isDown) axisY -= 1
    if (this.keys.S.isDown || this.keys.DOWN.isDown) axisY += 1

    if (axisX !== 0 || axisY !== 0) {
      const next = resolveMove(this.pos, axisX, axisY, this.map, PLAYER_SPEED, dt, PLAYER_RADIUS)
      this.pos = next
      this.syncPlayerSprite()
      // 仅已握手连接才向服务端发送输入
      connection.sendMove(axisX, axisY)
    }
  }

  private syncPlayerSprite(): void {
    const s = isoToScreen(this.pos.x, this.pos.y)
    this.player.setPosition(s.x, s.y)
    this.player.setDepth(this.pos.y)
  }

  private mapScreenBounds(): {
    minX: number
    minY: number
    width: number
    height: number
  } {
    const corners = [
      isoToScreen(this.map.world.minX, this.map.world.minY),
      isoToScreen(this.map.world.maxX, this.map.world.minY),
      isoToScreen(this.map.world.minX, this.map.world.maxY),
      isoToScreen(this.map.world.maxX, this.map.world.maxY),
    ]
    const xs = corners.map((c) => c.x)
    const ys = corners.map((c) => c.y)
    const minX = Math.min(...xs) - 256
    const minY = Math.min(...ys) - 256
    const maxX = Math.max(...xs) + 256
    const maxY = Math.max(...ys) + 256
    return { minX, minY, width: maxX - minX, height: maxY - minY }
  }

  private drawGround(): void {
    const g = this.add.graphics()
    g.setDepth(GROUND_DEPTH)
    for (let r = 0; r < this.map.rows; r++) {
      for (let c = 0; c < this.map.cols; c++) {
        const w = tileToWorld(c, r, this.map.tileSize)
        const s = isoToScreen(w.x, w.y)
        g.fillStyle((c + r) % 2 === 0 ? FLOOR_COLOR : FLOOR_COLOR_ALT, 1)
        g.lineStyle(1, 0x18302a, 0.6)
        this.diamond(g, s.x, s.y)
      }
    }
  }

  private drawObstacles(): void {
    for (let r = 0; r < this.map.rows; r++) {
      for (let c = 0; c < this.map.cols; c++) {
        if (!isObstacle(this.map, c, r)) continue
        const w = tileToWorld(c, r, this.map.tileSize)
        const s = isoToScreen(w.x, w.y)
        const obs = this.add.image(s.x, s.y - 8, 'obstacle')
        obs.setDepth(w.y)
      }
    }
  }

  private diamond(g: Phaser.GameObjects.Graphics, cx: number, cy: number): void {
    const hw = TILE_W / 2
    const hh = TILE_H / 2
    g.beginPath()
    g.moveTo(cx, cy - hh)
    g.lineTo(cx + hw, cy)
    g.lineTo(cx, cy + hh)
    g.lineTo(cx - hw, cy)
    g.closePath()
    g.fillPath()
    g.strokePath()
  }

  private ensureTextures(): void {
    if (!this.textures.exists('player')) {
      const g = this.make.graphics({ x: 0, y: 0 }, false)
      g.fillStyle(0x000000, 0.25)
      g.fillEllipse(16, 26, 22, 10)
      g.fillStyle(PLAYER_COLOR, 1)
      g.fillCircle(16, 16, 14)
      g.lineStyle(2, 0xffffff, 0.8)
      g.strokeCircle(16, 16, 14)
      g.generateTexture('player', 32, 32)
      g.destroy()
    }

    if (!this.textures.exists('obstacle')) {
      const g = this.make.graphics({ x: 0, y: 0 }, false)
      g.fillStyle(0x000000, 0.25)
      g.fillEllipse(16, 26, 24, 10)
      g.fillStyle(OBSTACLE_COLOR, 1)
      g.fillCircle(16, 14, 13)
      g.fillStyle(OBSTACLE_HI, 1)
      g.fillCircle(13, 11, 5)
      g.generateTexture('obstacle', 32, 32)
      g.destroy()
    }
  }
}
