FROM node:18

WORKDIR /app

COPY . .

RUN corepack enable
RUN pnpm install

CMD ["pnpm", "start"]