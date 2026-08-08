import { defineConfig } from 'vitest/config'

// 供 node 环境包复用的基础 Vitest 配置。
// 各包在自身 vitest.config.ts 中导入并覆盖 include 等字段。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/build/**'],
  },
})
