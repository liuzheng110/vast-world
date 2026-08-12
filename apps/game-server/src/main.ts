import { startGameServer } from './server.js'

/**
 * 入口：从环境变量读取端口配置并启动游戏服务。
 *
 * 默认：
 * - GAME_SERVER_PORT=2567（与 .env 一致）
 * - HEALTH_SERVER_PORT=2570
 */
async function main(): Promise<void> {
  const gamePort = Number(process.env['GAME_SERVER_PORT'] ?? '2567')
  const healthPort = Number(process.env['HEALTH_SERVER_PORT'] ?? '2570')

  const { close } = await startGameServer({ gamePort, healthPort })

  // 优雅退出
  const shutdown = async (sig: string): Promise<void> => {
    console.log(`[game-server] received ${sig}, shutting down...`)
    await close()
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

void main().catch((err) => {
  console.error('[game-server] fatal:', err)
  process.exit(1)
})
