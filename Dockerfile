FROM node:20

WORKDIR /app

ENV NODE_ENV=development

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY api-server ./api-server
COPY artifacts/finance-tracker ./artifacts/finance-tracker
COPY attached_assets ./attached_assets
COPY lib ./lib

RUN corepack enable
RUN corepack prepare pnpm@latest --activate

RUN pnpm install --filter ./api-server... --filter ./artifacts/finance-tracker... --no-frozen-lockfile
RUN pnpm -C artifacts/finance-tracker build
RUN pnpm -C api-server build

CMD ["pnpm", "-C", "api-server", "start"]
