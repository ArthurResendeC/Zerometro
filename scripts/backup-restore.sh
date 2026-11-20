#!/bin/sh
# Baixa o backup do SQLite (Litestream) para um arquivo local, sem tocar na instância.
# Uso: mise run backup:restore [-- <flags do litestream restore>]
#   ex.: mise run backup:restore -- -timestamp 2026-11-20T15:00:00Z   (estado antes desse instante)
# A task roda isto via `railway run`, que traz as BACKUP_* do serviço. O Litestream roda pela
# imagem oficial no Docker, com a mesma config da produção (deploy/litestream.yml).
set -eu

if [ -z "${BACKUP_BUCKET:-}" ]; then
  echo "BACKUP_BUCKET vazio: o serviço não tem backup configurado (ver \"Backup\" no README)" >&2
  exit 1
fi

mkdir -p data
OUT="restaurado-$(date +%Y%m%d-%H%M%S).db"

docker run --rm \
  -v "$PWD/data:/out" \
  -v "$PWD/deploy/litestream.yml:/etc/litestream.yml:ro" \
  -e DATABASE_PATH=/data/zerometro.db \
  -e BACKUP_BUCKET -e BACKUP_ENDPOINT -e BACKUP_ACCESS_KEY_ID -e BACKUP_SECRET_ACCESS_KEY \
  -e BACKUP_PATH="${BACKUP_PATH:-zerometro}" \
  -e BACKUP_REGION="${BACKUP_REGION:-auto}" \
  -e BACKUP_FORCE_PATH_STYLE="${BACKUP_FORCE_PATH_STYLE:-false}" \
  --user "$(id -u):$(id -g)" \
  litestream/litestream:0.5.18 \
  restore -integrity-check full -o "/out/$OUT" "$@" /data/zerometro.db

echo "Restaurado em data/$OUT"
