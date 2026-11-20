# syntax=docker/dockerfile:1
# Imagem de produção do Zerômetro (a Railway usa este Dockerfile; ver .railway/railway.ts).

# --- build: dependências (com o patch do router-core), rotas e bundle ---
FROM oven/bun:1.4.4 AS build
WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
COPY patches ./patches
RUN bun install --frozen-lockfile

COPY . .
RUN bunx --bun tsr generate && bun scripts/build.ts

# --- litestream: backup contínuo do SQLite (release oficial, conferida pelo checksum) ---
FROM oven/bun:1.4.4 AS litestream
ARG LITESTREAM_VERSION=0.5.18
ADD --checksum=sha256:d3687b9fd0f2e9426bbd3da828429ff3f1dfc5c9b74d54fdf028e4ee510e7dea \
    https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-x86_64.tar.gz \
    /tmp/litestream.tar.gz
RUN tar -xzf /tmp/litestream.tar.gz -C /usr/local/bin litestream && litestream version

# --- runtime: só o bundle (servidor + SPA + migrations) e o litestream, sem node_modules ---
FROM oven/bun:1.4.4-slim
ENV NODE_ENV=production \
    TZ=America/Sao_Paulo \
    DATABASE_PATH=/data/zerometro.db \
    PORT=3000

COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream
COPY deploy/litestream.yml deploy/entrypoint.sh /app/

# O Bun resolve os assets do HTML import a partir do cwd: roda de dentro de dist/.
WORKDIR /app/dist
COPY --from=build /app/dist ./

EXPOSE 3000
CMD ["/app/entrypoint.sh"]
