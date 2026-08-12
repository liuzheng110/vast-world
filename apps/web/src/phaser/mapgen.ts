import { TILE_W } from './iso'

/**
 * 程序化生成的等距测试地图（确定性：同 seed 同结果，不依赖外部素材）。
 */

export interface GameMap {
  cols: number
  rows: number
  tileSize: number
  /** 障碍瓦片键集合 "col,row" */
  obstacles: Set<string>
  /** 出生网格 */
  spawn: { col: number; row: number }
  /** 世界边界（世界单位） */
  world: { minX: number; minY: number; maxX: number; maxY: number }
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    // xorshift32
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 0xffffffff
  }
}

export interface GenerateMapOptions {
  cols?: number
  rows?: number
  tileSize?: number
  seed?: number
  /** 障碍瓦片占比（0..1） */
  obstacleRatio?: number
}

export function generateMap(opts: GenerateMapOptions = {}): GameMap {
  const cols = opts.cols ?? 28
  const rows = opts.rows ?? 28
  const tileSize = opts.tileSize ?? TILE_W
  const seed = opts.seed ?? 1337
  const obstacleRatio = opts.obstacleRatio ?? 0.12

  const rng = makeRng(seed)
  const obstacles = new Set<string>()
  const spawn = { col: Math.floor(cols / 2), row: Math.floor(rows / 2) }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // 四周一圈墙
      if (c === 0 || r === 0 || c === cols - 1 || r === rows - 1) {
        obstacles.add(`${c},${r}`)
        continue
      }
      // 出生点周围 3x3 留空，保证可移动
      if (Math.abs(c - spawn.col) <= 1 && Math.abs(r - spawn.row) <= 1) continue
      if (rng() < obstacleRatio) obstacles.add(`${c},${r}`)
    }
  }

  const world = {
    minX: 0,
    minY: 0,
    maxX: cols * tileSize,
    maxY: rows * tileSize,
  }

  return { cols, rows, tileSize, obstacles, spawn, world }
}

export function isObstacle(map: GameMap, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= map.cols || row >= map.rows) return true
  return map.obstacles.has(`${col},${row}`)
}
