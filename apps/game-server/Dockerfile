# syntax=docker/dockerfile:1.7

# ---- Build stage ----
FROM node:22-alpine AS builder

WORKDIR /app

# 启用 pnpm（Node 22 自带 corepack）
RUN corepack enable pnpm

# 先复制 workspace 清单，利用缓存
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/config/package.json packages/config/
COPY packages/game-core/package.json packages/game-core/
COPY apps/game-server/package.json apps/game-server/

# 安装依赖（--frozen-lockfile 保证可复现）
RUN pnpm install --frozen-lockfile

# 复制源码
COPY tsconfig.base.json ./
COPY packages/protocol/ packages/protocol/
COPY packages/config/ packages/config/
COPY packages/game-core/ packages/game-core/
COPY apps/game-server/ apps/game-server/

# 构建：typecheck + esbuild 打包
# 产物 apps/game-server/dist 已内联 @vastworld/* 源码，并自带只声明注册表依赖的 package.json
RUN pnpm --filter @vastworld/game-server build

# ---- Dependency stage：为运行时制品安装真实依赖 ----
FROM node:22-alpine AS deps

WORKDIR /srv/game-server

COPY --from=builder /app/apps/game-server/dist/package.json ./package.json

# 制品 package.json 中不含 workspace: 协议，可直接用 npm 独立安装
RUN npm install --omit=dev --no-audit --no-fund

# ---- Runtime stage ----
FROM node:22-alpine AS runtime

# 非 root 用户（RELEASE.md §4）
RUN addgroup -g 1001 -S vwgamer && adduser -u 1001 -S vwgamer -G vwgamer

WORKDIR /srv/game-server

# 只带上运行时制品与其依赖：不再需要 pnpm、workspace 布局或 tsx
COPY --from=deps --chown=vwgamer:vwgamer /srv/game-server/node_modules ./node_modules
COPY --from=builder --chown=vwgamer:vwgamer /app/apps/game-server/dist/ ./

USER vwgamer

ENV NODE_ENV=production

# 默认端口
ENV GAME_SERVER_PORT=2567
ENV HEALTH_SERVER_PORT=2570
EXPOSE 2567 2570

# 健康检查（RELEASE.md §3）
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:2570/health/ready || exit 1

# 启动命令
CMD ["node", "main.js"]
