import { defineConfig } from '@playwright/test'

const WEB_PORT = Number(process.env['WEB_PORT'] ?? 4173)
const GAME_PORT = Number(process.env['GAME_PORT'] ?? 2567)
const HEALTH_PORT = Number(process.env['HEALTH_PORT'] ?? 2570)

/**
 * M0 Web E2E（Playwright）。
 * - 两个 webServer：游戏服务 + Web 预览。
 * - reuseExistingServer: true —— 若已在外部启动（如本机手动验证），直接复用，不重复拉起。
 * - 服务命令通过 pnpm filter 调用；env 中清空 NODE_OPTIONS 以避免环境回收站拦截。
 */
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'off',
  },
  webServer: [
    {
      // start 运行的是构建产物 dist/main.js，先 build 保证 E2E 验证的是真实制品
      command:
        'pnpm --filter @vastworld/game-server build && pnpm --filter @vastworld/game-server start',
      url: `http://localhost:${HEALTH_PORT}/health/ready`,
      timeout: 120_000,
      reuseExistingServer: true,
      env: {
        GAME_SERVER_PORT: String(GAME_PORT),
        HEALTH_SERVER_PORT: String(HEALTH_PORT),
        NODE_OPTIONS: '',
      },
    },
    {
      command: `pnpm --filter @vastworld/web preview --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/`,
      timeout: 60_000,
      reuseExistingServer: true,
      env: {
        NODE_OPTIONS: '',
      },
    },
  ],
})
