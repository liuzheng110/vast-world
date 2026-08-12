import { describe, expect, it } from 'vitest'
import { applyMove, distance } from './movement.js'
import { createPlayer } from './player.js'
import { PLAYER_RADIUS, PLAYER_SPEED, TICK_MS, WORLD_BOUNDS } from './constants.js'

describe('applyMove', () => {
  it('moves player according to input', () => {
    const player = createPlayer('p1', 'Alice', { x: 100, y: 100 })
    applyMove(player, {
      sequence: 1,
      clientTime: Date.now(),
      axisX: 1,
      axisY: 0,
    })
    const expectedDelta = PLAYER_SPEED * (TICK_MS / 1000)
    expect(player.position.x).toBeCloseTo(100 + expectedDelta, 5)
    expect(player.position.y).toBe(100)
    expect(player.lastSequence).toBe(1)
  })

  it('normalizes diagonal movement', () => {
    const player = createPlayer('p1', 'Alice', { x: 100, y: 100 })
    applyMove(player, {
      sequence: 1,
      clientTime: Date.now(),
      axisX: 1,
      axisY: 1,
    })
    // 对角线归一化后，x 和 y 增量应相等
    const dx = player.position.x - 100
    const dy = player.position.y - 100
    expect(Math.abs(dx - dy)).toBeLessThan(0.001)
    // 总速度应等于 PLAYER_SPEED，不是 sqrt(2) 倍
    const totalDist = Math.hypot(dx, dy)
    const expected = PLAYER_SPEED * (TICK_MS / 1000)
    expect(totalDist).toBeCloseTo(expected, 3)
  })

  it('clamps to world bounds', () => {
    const player = createPlayer('p1', 'Alice', {
      x: WORLD_BOUNDS.minX + PLAYER_RADIUS,
      y: WORLD_BOUNDS.minY + PLAYER_RADIUS,
    })
    applyMove(player, {
      sequence: 1,
      clientTime: Date.now(),
      axisX: -1,
      axisY: -1,
    })
    expect(player.position.x).toBeGreaterThanOrEqual(WORLD_BOUNDS.minX + PLAYER_RADIUS - 0.01)
    expect(player.position.y).toBeGreaterThanOrEqual(WORLD_BOUNDS.minY + PLAYER_RADIUS - 0.01)
  })

  it('rejects out-of-range axis values', () => {
    const player = createPlayer('p1', 'Alice', { x: 100, y: 100 })
    applyMove(player, {
      sequence: 1,
      clientTime: Date.now(),
      axisX: 2,
      axisY: 0,
    })
    // 不应移动
    expect(player.position.x).toBe(100)
    expect(player.lastSequence).toBe(0)
  })

  it('rejects non-monotonic sequence', () => {
    const player = createPlayer('p1', 'Alice', { x: 100, y: 100 })
    player.lastSequence = 5
    applyMove(player, {
      sequence: 3,
      clientTime: Date.now(),
      axisX: 1,
      axisY: 0,
    })
    expect(player.position.x).toBe(100)
    expect(player.lastSequence).toBe(5)
  })

  it('rejects negative sequence', () => {
    const player = createPlayer('p1', 'Alice', { x: 100, y: 100 })
    applyMove(player, {
      sequence: -1,
      clientTime: Date.now(),
      axisX: 1,
      axisY: 0,
    })
    expect(player.position.x).toBe(100)
    expect(player.lastSequence).toBe(0)
  })

  it('handles zero movement input', () => {
    const player = createPlayer('p1', 'Alice', { x: 100, y: 100 })
    applyMove(player, {
      sequence: 1,
      clientTime: Date.now(),
      axisX: 0,
      axisY: 0,
    })
    expect(player.position.x).toBe(100)
    expect(player.position.y).toBe(100)
    expect(player.lastSequence).toBe(1)
  })
})

describe('distance', () => {
  it('computes Euclidean distance', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
  })
  it('returns 0 for same point', () => {
    expect(distance({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0)
  })
})
