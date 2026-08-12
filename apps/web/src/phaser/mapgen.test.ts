import { describe, expect, it } from 'vitest'
import { generateMap, isObstacle } from './mapgen'

describe('generateMap', () => {
  it('同 seed 确定性一致', () => {
    const a = generateMap({ seed: 42 })
    const b = generateMap({ seed: 42 })
    expect(a.obstacles.size).toBe(b.obstacles.size)
    expect([...a.obstacles]).toEqual([...b.obstacles])
  })

  it('出生点 3x3 区域留空', () => {
    const m = generateMap({ seed: 7 })
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        expect(isObstacle(m, m.spawn.col + dc, m.spawn.row + dr)).toBe(false)
      }
    }
  })

  it('四周一圈墙', () => {
    const m = generateMap({ cols: 20, rows: 20 })
    expect(isObstacle(m, 0, 0)).toBe(true)
    expect(isObstacle(m, 19, 19)).toBe(true)
    expect(isObstacle(m, 0, 10)).toBe(true)
  })

  it('暴露世界边界', () => {
    const m = generateMap({ cols: 20, rows: 20, tileSize: 64 })
    expect(m.world.maxX).toBe(1280)
    expect(m.world.maxY).toBe(1280)
  })
})
