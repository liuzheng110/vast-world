import { MOVE_INPUT_VALIDATORS, type MoveInput } from './input.js'
import { PLAYER_RADIUS, PLAYER_SPEED, TICK_MS, WORLD_BOUNDS } from './constants.js'
import type { PlayerState, Vec2 } from './player.js'

/**
 * 将一个移动输入应用到玩家状态（服务端权威）。
 *
 * - 校验 axis 范围在 [-1, 1]
 * - 按固定 tick 时间步推进位置
 * - 用简单 AABB 钳制到世界边界
 * - 更新 lastSequence（单调递增）
 *
 * 不做碰撞检测（M0 无碰撞需求），但预留了半径以供后续使用。
 */
export function applyMove(player: PlayerState, input: MoveInput): void {
  // 校验输入
  const parsed = MOVE_INPUT_VALIDATORS.move(input)
  if (!parsed.success || !parsed.data) return

  const { axisX, axisY, sequence } = parsed.data

  // 序列号必须单调递增（丢弃乱序/重放）
  if (sequence <= player.lastSequence) return

  // 归一化对角线移动
  const len = Math.hypot(axisX, axisY)
  const nx = len > 1 ? axisX / len : axisX
  const ny = len > 1 ? axisY / len : axisY

  // 推进位置
  const dt = TICK_MS / 1000
  player.position.x += nx * PLAYER_SPEED * dt
  player.position.y += ny * PLAYER_SPEED * dt

  // 世界边界钳制
  player.position.x = clamp(
    player.position.x,
    WORLD_BOUNDS.minX + PLAYER_RADIUS,
    WORLD_BOUNDS.maxX - PLAYER_RADIUS,
  )
  player.position.y = clamp(
    player.position.y,
    WORLD_BOUNDS.minY + PLAYER_RADIUS,
    WORLD_BOUNDS.maxY - PLAYER_RADIUS,
  )

  player.axisX = nx
  player.axisY = ny
  player.lastSequence = sequence
}

/** 不产生新对象的原地钳制。 */
function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

/**
 * 计算两点距离。
 */
export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
