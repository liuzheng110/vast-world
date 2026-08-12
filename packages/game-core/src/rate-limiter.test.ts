import { describe, expect, it } from 'vitest'
import { RateLimiter } from './rate-limiter.js'

describe('RateLimiter', () => {
  it('allows up to max within window', () => {
    const rl = new RateLimiter(3, 1000)
    expect(rl.tryConsume(0)).toBe(true)
    expect(rl.tryConsume(100)).toBe(true)
    expect(rl.tryConsume(200)).toBe(true)
    // 超出限制
    expect(rl.tryConsume(300)).toBe(false)
    expect(rl.count).toBe(3)
  })

  it('evicts expired entries', () => {
    const rl = new RateLimiter(2, 1000)
    expect(rl.tryConsume(0)).toBe(true)
    expect(rl.tryConsume(500)).toBe(true)
    expect(rl.tryConsume(600)).toBe(false) // 窗口内已满
    // 超过 1000ms 后，前两条已过期
    expect(rl.tryConsume(1500)).toBe(true)
    expect(rl.tryConsume(1600)).toBe(true)
    expect(rl.tryConsume(1700)).toBe(false)
  })

  it('reset clears all entries', () => {
    const rl = new RateLimiter(5, 1000)
    rl.tryConsume(0)
    rl.tryConsume(100)
    expect(rl.count).toBe(2)
    rl.reset()
    expect(rl.count).toBe(0)
  })

  it('handles zero-window edge case gracefully', () => {
    const rl = new RateLimiter(1, 0)
    expect(rl.tryConsume(0)).toBe(true)
    // 同一时刻已满
    expect(rl.tryConsume(0)).toBe(false)
  })
})
