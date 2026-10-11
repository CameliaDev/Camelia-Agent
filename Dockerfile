# Camelia CLI — 运行环境
# 与 package.json 的 engines 保持一致：Node 22
FROM node:22-bookworm-slim

# better-sqlite3 在 Linux 上从源码编译需要构建工具链；用预编译包则可省。
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ git \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.14.4 --activate

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY apps ./apps
COPY scripts ./scripts
COPY tests ./tests

RUN pnpm install --frozen-lockfile

# 确保 better-sqlite3 原生模块针对 Node 22 (ABI 127) 编译
RUN pnpm rebuild better-sqlite3

RUN pnpm build

ENTRYPOINT ["node", "packages/cli/dist/bin.js"]
CMD ["doctor", "--offline"]
