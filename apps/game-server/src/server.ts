import http from 'node:http'
import { Server as ColyseusServer } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'
import { startHealthServer } from './health.js'
import { WorldRoom } from './world-room.js'
import { serverVersionInfo } from './version.js'

export interface GameServerOptions {
  /** 游戏服务端口（Colyseus WebSocket） */
  gamePort: number
  /** 健康检查端口（独立端口，便于 K8s/容器探针配置） */
  healthPort: number
}

/**
 * 创建并启动 VastWorld 游戏服务。
 *
 * 架构（见 ARCHITECTURE.md §4）：
 * - 独立 HTTP 健康检查服务
 * - Colyseus WebSocket：WorldRoom 权威房间
 *
 * 返回 { close } 用于测试中优雅关闭。
 */
export async function startGameServer(opts: GameServerOptions): Promise<{
  close: () => Promise<void>
}> {
  // 创建 HTTP server 供 WebSocket 共用
  const httpServer = http.createServer()

  // Colyseus Server：使用 WebSocketTransport
  const transport = new WebSocketTransport({ server: httpServer })

  const colyseus = new ColyseusServer({ transport })

  // 注册 WorldRoom（房间名 "world"）
  colyseus.define('world', WorldRoom)

  // 启动 HTTP server
  await new Promise<void>((resolve) => {
    httpServer.listen(opts.gamePort, () => resolve())
  })

  // 健康检查服务（独立端口）
  let colyseusReady = true

  const healthServer = startHealthServer({
    port: opts.healthPort,
    isReady: () => colyseusReady,
    getMetrics: () => ({
      ...serverVersionInfo,
      registeredRoomTypes: 1,
    }),
  })

  console.log(
    `[game-server] listening on :${opts.gamePort} | health on :${opts.healthPort} | ${serverVersionInfo.appVersion}@${serverVersionInfo.commitSha} protocol=v${serverVersionInfo.protocolVersion}`,
  )

  return {
    async close(): Promise<void> {
      colyseusReady = false
      await new Promise<void>((resolve) => {
        healthServer.close(() => resolve())
      })
      await colyseus.gracefullyShutdown(false)
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve())
      })
    },
  }
}
