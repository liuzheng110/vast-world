/**
 * VastWorld game-server 构建脚本。
 *
 * 产出一个**真正可运行、可独立安装**的服务端制品：
 *
 *   dist/
 *     main.js          可执行入口（node dist/main.js）
 *     main.js.map      sourcemap
 *     package.json     只声明真实的注册表运行时依赖（无 workspace: 协议）
 *     README.md        部署说明
 *
 * 设计取舍：
 * - workspace 内部包（@vastworld/*）以 TypeScript 源码形式发布，没有自己的 dist，
 *   因此这里用 esbuild 把它们**内联打包**进 main.js，制品不再依赖 monorepo 布局。
 * - 第三方运行时依赖（@colyseus/*、express、ws）保持 external：
 *   它们含有原生/可选依赖与动态 require，打包进去反而更脆弱；
 *   改为写进 dist/package.json 的 dependencies，让 `npm install --omit=dev` 装回来。
 *
 * 因此制品的部署方式为：
 *   cp -r dist /srv/game-server && cd /srv/game-server && node main.js
 *
 * 制品发布时打包 dist + node_modules（用 pnpm 预装），下载者解压后直接 node main.js。
 * 不再用 `npm install --omit=dev`：@colyseus/core@0.16.25 发布时保留了 `workspace:^` 协议
 * （上游 bug），npm 无法解析。
 */
import { build } from 'esbuild'
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..')
const distDir = join(packageRoot, 'dist')

/** workspace 内部包一律内联打包，不进入制品依赖。 */
const isWorkspacePackage = (name) => name.startsWith('@vastworld/')

async function main() {
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))

  const runtimeDependencies = Object.fromEntries(
    Object.entries(manifest.dependencies ?? {}).filter(([name]) => !isWorkspacePackage(name)),
  )

  for (const [name, range] of Object.entries(runtimeDependencies)) {
    if (String(range).startsWith('workspace:')) {
      throw new Error(`运行时依赖 ${name} 仍使用 workspace: 协议，制品无法独立安装`)
    }
  }

  await rm(distDir, { recursive: true, force: true })
  await mkdir(distDir, { recursive: true })

  const result = await build({
    entryPoints: [join(packageRoot, 'src/main.ts')],
    outfile: join(distDir, 'main.js'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    sourcemap: true,
    minify: false,
    logLevel: 'info',
    // 只 external 注册表依赖；@vastworld/* 被内联
    external: Object.keys(runtimeDependencies),
    banner: {
      // 部分 CJS 依赖在 ESM 下会访问 require，提供兼容垫片
      js: [
        "import { createRequire as __createRequire } from 'node:module'",
        'const require = __createRequire(import.meta.url)',
      ].join('\n'),
    },
    metafile: true,
  })

  const bundledWorkspacePackages = Object.keys(result.metafile.inputs).filter(
    (p) => p.includes('packages/protocol/') || p.includes('packages/game-core/'),
  ).length

  const distManifest = {
    name: manifest.name,
    version: manifest.version,
    private: true,
    description: manifest.description,
    type: 'module',
    main: './main.js',
    bin: { 'vastworld-game-server': './main.js' },
    scripts: { start: 'node main.js' },
    engines: manifest.engines ?? { node: '>=22' },
    dependencies: runtimeDependencies,
  }

  await writeFile(join(distDir, 'package.json'), `${JSON.stringify(distManifest, null, 2)}\n`)

  await writeFile(
    join(distDir, 'README.md'),
    [
      `# ${manifest.name} 运行时制品`,
      '',
      '由 `pnpm --filter @vastworld/game-server build` 生成，可脱离 monorepo 独立部署。',
      '',
      '```bash',
      '# 制品 tarball 已包含 node_modules，解压后直接运行：',
      'tar xzf game-server-dist.tar.gz',
      'cd dist',
      'node main.js             # 或 npm start',
      '```',
      '',
      '环境变量：`GAME_SERVER_PORT`（默认 2567）、`HEALTH_SERVER_PORT`（默认 2570）、',
      '`APP_VERSION`、`COMMIT_SHA`。',
      '',
      `workspace 内部包（@vastworld/protocol、@vastworld/game-core，共 ${bundledWorkspacePackages} 个源文件）`,
      '已内联打包进 `main.js`，不需要额外安装。',
      '生产依赖（@colyseus/*、express、ws）已预装在 `node_modules/`，不需要 `npm install`。',
      '',
      '> 注意：@colyseus/core@0.16.25 发布时保留了 `workspace:^` 协议（上游 bug），',
      '> `npm install` 会失败。制品已用 pnpm 预装好依赖，绕过此问题。',
      '',
    ].join('\n'),
  )

  console.log(
    `[build] dist/main.js 就绪；运行时依赖 ${Object.keys(runtimeDependencies).length} 个，` +
      `内联 workspace 源文件 ${bundledWorkspacePackages} 个`,
  )
}

main().catch((err) => {
  console.error('[build] failed:', err)
  process.exit(1)
})
