/**
 * 滑动窗口频率限制器。
 *
 * 用于服务端对每客户端的消息频率做限制（ARCHITECTURE.md §9）。
 * 纯函数实现，不依赖任何外部库。
 */
export class RateLimiter {
  private timestamps: number[] = []
  private readonly maxPerWindow: number
  private readonly windowMs: number

  constructor(maxPerSecond: number, windowMs = 1000) {
    this.maxPerWindow = maxPerSecond
    this.windowMs = windowMs
  }

  /**
   * 记录一次事件，返回是否允许。
   * 如果窗口内已满则拒绝并返回 false。
   */
  tryConsume(now: number): boolean {
    const cutoff = now - this.windowMs
    // 淘汰过期记录（严格小于 cutoff 才算过期；等于 cutoff 在零窗口边界下算过期）
    while (this.timestamps.length > 0 && this.timestamps[0]! < cutoff) {
      this.timestamps.shift()
    }
    if (this.timestamps.length >= this.maxPerWindow) return false
    this.timestamps.push(now)
    return true
  }

  /** 当前窗口内已记录数量。 */
  get count(): number {
    return this.timestamps.length
  }

  /** 重置。 */
  reset(): void {
    this.timestamps = []
  }
}
