FROM node:18

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY api-server ./api-server
COPY lib ./lib

RUN corepack enable
RUN corepack prepare pnpm@latest --activate

RUN pnpm install --filter ./api-server... --no-frozen-lockfile
RUN pnpm -C api-server build

CMD ["pnpm", "-C", "api-server", "start"]
