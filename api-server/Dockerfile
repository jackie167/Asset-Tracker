FROM node:18

WORKDIR /app

COPY . .

RUN corepack enable
RUN corepack prepare pnpm@latest --activate

RUN pnpm install

CMD ["pnpm", "dev"]