/**
 * 二维向量（世界权威坐标）。
 * 见 ARCHITECTURE.md §2：权威世界坐标为 x, y。
 */
export interface Vec2 {
  x: number
  y: number
}

/**
 * 玩家状态（房间内存中的权威状态，不持久化）。
 * 见 ARCHITECTURE.md §6.2：热状态只保存在房间内存中。
 */
export interface PlayerState {
  /** 内部玩家 ID（Supabase auth user id 映射后的房间内标识） */
  id: string
  /** 玩家昵称 */
  nickname: string
  /** 世界坐标 */
  position: Vec2
  /** 当前移动输入轴 (-1..1) */
  axisX: number
  axisY: number
  /** 最后处理的输入序列号 */
  lastSequence: number
  /** 是否在线 */
  connected: boolean
}

/**
 * 房间内所有玩家的权威状态快照。
 */
export interface WorldSnapshot {
  players: PlayerState[]
  tick: number
  timestamp: number
}

/**
 * 创建初始 PlayerState。
 */
export function createPlayer(id: string, nickname: string, spawnPosition: Vec2): PlayerState {
  return {
    id,
    nickname,
    position: { ...spawnPosition },
    axisX: 0,
    axisY: 0,
    lastSequence: 0,
    connected: true,
  }
}
