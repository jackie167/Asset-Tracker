FROM node:18

WORKDIR /app

COPY api-server ./api-server
COPY lib ./lib

RUN corepack enable
RUN corepack prepare pnpm@latest --activate

WORKDIR /app/api-server
RUN pnpm install

CMD ["pnpm", "dev"]
