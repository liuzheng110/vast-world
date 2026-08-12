import express from 'express'
import type { Server } from 'node:http'
import { serverVersionInfo } from './version.js'

export interface HealthServerOptions {
  port: number
  /** 返回 readiness 时调用，用于判断服务是否真正就绪 */
  isReady?: () => boolean
  /** 房间数等运行指标 */
  getMetrics?: () => Record<string, unknown>
}

/**
 * 启动 HTTP 健康检查服务（独立端口，与 Colyseus 游戏端口分离）。
 *
 * 端点：
 * - GET /health/live  → 进程存活
 * - GET /health/ready → 服务就绪（依赖 isReady 回调）
 * - GET /version      → 版本信息
 * - GET /metrics      → 运行指标
 *
 * 见 ARCHITECTURE.md §9。
 */
export function startHealthServer(opts: HealthServerOptions): Server {
  const app = express()
  app.use(express.json())

  app.get('/health/live', (_req, res) => {
    res.status(200).json({ status: 'alive' })
  })

  app.get('/health/ready', (_req, res) => {
    const ready = opts.isReady ? opts.isReady() : true
    if (ready) {
      res.status(200).json({ status: 'ready' })
    } else {
      res.status(503).json({ status: 'not-ready' })
    }
  })

  app.get('/version', (_req, res) => {
    res.status(200).json(serverVersionInfo)
  })

  app.get('/metrics', (_req, res) => {
    const base = {
      uptime: process.uptime(),
      memory: process.memoryUsage().rss,
      timestamp: Date.now(),
    }
    const extra = opts.getMetrics ? opts.getMetrics() : {}
    res.status(200).json({ ...base, ...extra })
  })

  return app.listen(opts.port, () => {
    console.log(`[health] listening on :${opts.port}`)
  })
}
