import { describe, expect, it } from 'vitest'
import { generateMap, isObstacle } from './mapgen'
import { isBlockedAt, resolveMove } from './collision'

describe('collision 与移动解算', () => {
  const map = generateMap({ cols: 20, rows: 20, seed: 5 })

  it('障碍瓦片被判定为阻挡', () => {
    let hit = false
    for (let r = 0; r < map.rows && !hit; r++) {
      for (let c = 0; c < map.cols; c++) {
        if (isObstacle(map, c, r)) {
          const w = { x: (c + 0.5) * map.tileSize, y: (r + 0.5) * map.tileSize }
          expect(isBlockedAt(w, map, 1)).toBe(true)
          hit = true
          break
        }
      }
    }
    expect(hit).toBe(true)
  })

  it('resolveMove 逐轴解算抵达边界不穿透', () => {
    const pos = {
      x: (map.spawn.col + 0.5) * map.tileSize,
      y: (map.spawn.row + 0.5) * map.tileSize,
    }
    for (let i = 0; i < 300; i++) {
      const next = resolveMove(pos, 1, 0, map, 100, 0.05, 16)
      pos.x = next.x
      pos.y = next.y
    }
    expect(pos.x).toBeLessThanOrEqual(map.world.maxX - 16 + 1e-6)
    expect(pos.x).toBeGreaterThanOrEqual(map.world.minX + 16 - 1e-6)
  })

  it('resolveMove 钳制到世界边界', () => {
    const next = resolveMove({ x: 10, y: 10 }, -1, -1, map, 1000, 1, 16)
    expect(next.x).toBeGreaterThanOrEqual(map.world.minX + 16)
    expect(next.y).toBeGreaterThanOrEqual(map.world.minY + 16)
  })

  it('对角线输入被归一化（位移长度≈单轴）', () => {
    const spawnW = {
      x: (map.spawn.col + 0.5) * map.tileSize,
      y: (map.spawn.row + 0.5) * map.tileSize,
    }
    const a = resolveMove(spawnW, 1, 1, map, 100, 0.1, 16)
    const len = Math.hypot(a.x - spawnW.x, a.y - spawnW.y)
    expect(len).toBeCloseTo(10, 1)
  })
})
