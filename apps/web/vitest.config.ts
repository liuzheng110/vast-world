import sharedConfig from '@vastworld/config/vitest'
import { defineConfig } from 'vitest/config'

// 复用工程共享的 Vitest 配置（node 环境），覆盖 include 指向 web 源码。
//
// 注意：这里只取共享配置里的原始值（exclude），不整体展开 sharedConfig.test。
// apps/web 解析到的 vitest 实例与 @vastworld/config 的不是同一份（peer 解析不同），
// 整体展开会把 benchmark.reporters 这类跨实例的类型带进来，在
// exactOptionalPropertyTypes 下必然报“类型有各自独立声明”的错。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: [...(sharedConfig.test?.exclude ?? [])],
  },
})
