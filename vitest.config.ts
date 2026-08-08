import sharedConfig from '@vastworld/config/vitest'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  ...sharedConfig,
  test: {
    ...(sharedConfig.test ?? {}),
    include: ['packages/**/*.test.ts'],
  },
})
