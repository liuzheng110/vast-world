import { RATE_LIMITS, type MoveInput } from '@vastworld/protocol'

/**
 * 每房间最大玩家数（ARCHITECTURE.md §6.3）。
 */
export const MAX_PLAYERS_PER_ROOM = 16

/**
 * 固定 tick 频率（Hz）。见 ARCHITECTURE.md §6.2。
 */
export const TICK_HZ = 20

/** 每 tick 的毫秒数。 */
export const TICK_MS = 1000 / TICK_HZ

/** 玩家移动速度（世界单位/秒）。 */
export const PLAYER_SPEED = 200

/** 玩家碰撞半径。 */
export const PLAYER_RADIUS = 16

/** 地图边界（安全测试地图）。 */
export const WORLD_BOUNDS = {
  minX: 0,
  minY: 0,
  maxX: 3200,
  maxY: 3200,
} as const

/**
 * 限制导出 RATE_LIMITS 以方便 game-core 消费者使用。
 */
export { RATE_LIMITS, type MoveInput }
