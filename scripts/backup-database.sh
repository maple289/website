#!/bin/sh
set -eu

runtime_dir=${STREAMLY_RUNTIME_DIR:-/srv/streamly/supabase}
backup_dir=${STREAMLY_BACKUP_DIR:-/srv/streamly/backups}
compose_file="$runtime_dir/docker-compose.yml"
runtime_env="$runtime_dir/.env"

if [ ! -f "$compose_file" ] || [ ! -f "$runtime_env" ]; then
  echo "Supabase runtime is not configured at $runtime_dir"
  exit 1
fi

mkdir -p "$backup_dir"
backup_file="$backup_dir/postgres-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"

docker compose --env-file "$runtime_env" -f "$compose_file" exec -T db \
  pg_dumpall -U postgres | gzip -9 > "$backup_file"

echo "Database backup created: $backup_file"
