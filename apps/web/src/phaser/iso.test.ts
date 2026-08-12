import { describe, expect, it } from 'vitest'
import { TILE_H, TILE_W, isoToScreen, tileToWorld } from './iso'

describe('iso 投影', () => {
  it('原点映射到屏幕原点', () => {
    expect(isoToScreen(0, 0)).toEqual({ x: 0, y: 0 })
  })

  it('等距投影呈菱形', () => {
    const a = isoToScreen(100, 0)
    const b = isoToScreen(0, 100)

    // 2:1 菱形投影：水平位移按 TILE_W/2，垂直位移按 TILE_H/2
    expect(a.x).toBeCloseTo(100 * (TILE_W / 2))
    expect(a.y).toBeCloseTo(100 * (TILE_H / 2))
    expect(b.x).toBeCloseTo(-100 * (TILE_W / 2))
    expect(b.y).toBeCloseTo(100 * (TILE_H / 2))

    // 两条世界轴关于屏幕纵轴镜像、下沉量相同 —— 这才是“菱形”
    expect(a.x).toBeCloseTo(-b.x)
    expect(a.y).toBeCloseTo(b.y)
    // 垂直压缩比恰为 1/2
    expect(a.y / a.x).toBeCloseTo(TILE_H / TILE_W)
  })

  it('tileToWorld 取瓦片中心', () => {
    const w = tileToWorld(2, 3, 64)
    expect(w.x).toBeCloseTo(160)
    expect(w.y).toBeCloseTo(224)
  })

  it('瓦片宽高为 2:1', () => {
    expect(TILE_W / TILE_H).toBe(2)
  })
})
