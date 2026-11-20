#!/bin/sh
# Sobe o Zerômetro na imagem de produção. Com backup configurado (BACKUP_BUCKET), o Litestream
# fica na frente: restaura o banco se o volume estiver vazio e replica cada mudança para o bucket
# enquanto o servidor roda (`replicate -exec`: quando o servidor sai, o Litestream sincroniza o
# que falta e sai junto).
set -eu

CONFIG=/app/litestream.yml
export DATABASE_PATH="${DATABASE_PATH:-/data/zerometro.db}"
export BACKUP_PATH="${BACKUP_PATH:-zerometro}"
export BACKUP_REGION="${BACKUP_REGION:-auto}"

if [ -z "${BACKUP_BUCKET:-}" ]; then
  echo "⚠️  Backup desligado: defina BACKUP_BUCKET e as demais BACKUP_* (ver README)"
  exec bun index.js
fi

# Volume novo ou perdido, com backup no bucket: volta do último estado antes de subir.
# Com banco no volume (o normal), ou sem nada no bucket (primeiro deploy), não faz nada.
litestream restore -config "$CONFIG" -if-db-not-exists -if-replica-exists "$DATABASE_PATH"

exec litestream replicate -config "$CONFIG" -exec "bun index.js"
