# Imagem de produção do Zerômetro (a Railway usa este Dockerfile; ver .railway/railway.ts).

# --- build: dependências (com o patch do router-core), rotas e bundle ---
FROM oven/bun:1.4.4 AS build
WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
COPY patches ./patches
RUN bun install --frozen-lockfile

COPY . .
RUN bunx --bun tsr generate && bun scripts/build.ts

# --- runtime: só o bundle (servidor + SPA + migrations), sem node_modules ---
FROM oven/bun:1.4.4-slim
ENV NODE_ENV=production \
    TZ=America/Sao_Paulo \
    DATABASE_PATH=/data/zerometro.db \
    PORT=3000

# O Bun resolve os assets do HTML import a partir do cwd: roda de dentro de dist/.
WORKDIR /app/dist
COPY --from=build /app/dist ./

EXPOSE 3000
CMD ["bun", "index.js"]
