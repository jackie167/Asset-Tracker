FROM node:18

WORKDIR /app

COPY . .

RUN corepack enable
RUN corepack prepare pnpm@latest --activate

# Prefer api-server if it exists; otherwise fall back to repo root.
RUN if [ -f api-server/package.json ]; then cd api-server && pnpm install; \
    elif [ -f artifacts/api-server/package.json ]; then cd artifacts/api-server && pnpm install; \
    elif [ -f package.json ]; then pnpm install; \
    else echo "No package.json found in /app, /app/api-server, or /app/artifacts/api-server" && exit 1; \
    fi

CMD ["sh", "-c", "if [ -f /app/api-server/package.json ]; then cd /app/api-server; elif [ -f /app/artifacts/api-server/package.json ]; then cd /app/artifacts/api-server; fi; pnpm dev"]
