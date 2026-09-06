#!/bin/sh
set -eu

runtime_dir=${STREAMLY_RUNTIME_DIR:-/srv/streamly/supabase}
backup_dir=${STREAMLY_BACKUP_DIR:-/srv/streamly/backups}
retention_days=${STREAMLY_BACKUP_RETENTION_DAYS:-30}
compose_file="$runtime_dir/docker-compose.yml"
runtime_env="$runtime_dir/.env"

case "$retention_days" in
  ''|*[!0-9]*)
    echo "STREAMLY_BACKUP_RETENTION_DAYS must be a non-negative integer."
    exit 1
    ;;
esac

if [ ! -f "$compose_file" ] || [ ! -f "$runtime_env" ]; then
  echo "Supabase runtime is not configured at $runtime_dir"
  exit 1
fi

mkdir -p "$backup_dir"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
sql_file="$backup_dir/.postgres-$timestamp.sql"
backup_file="$backup_dir/postgres-$timestamp.sql.gz"
trap 'rm -f "$sql_file" "$sql_file.gz"' EXIT INT TERM

docker compose --env-file "$runtime_env" -f "$compose_file" exec -T db \
  pg_dumpall -U postgres > "$sql_file"
gzip -9 "$sql_file"
mv "$sql_file.gz" "$backup_file"
trap - EXIT INT TERM

find "$backup_dir" -type f -name 'postgres-*.sql.gz' \
  -mtime "+$retention_days" -delete

echo "Database backup created: $backup_file"
