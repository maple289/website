#!/bin/sh
set -eu

runtime_dir=${STREAMLY_RUNTIME_DIR:-/srv/streamly/supabase}
compose_file="$runtime_dir/docker-compose.yml"
runtime_env="$runtime_dir/.env"

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo "Usage: $0 <admin-email>"
  exit 1
fi
if [ ! -f "$compose_file" ] || [ ! -f "$runtime_env" ]; then
  echo "Supabase runtime is not configured at $runtime_dir"
  exit 1
fi

docker compose --env-file "$runtime_env" -f "$compose_file" exec -T db \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 -v "admin_email=$1" <<'SQL'
SELECT public.promote_first_admin(:'admin_email');
SQL

echo "First administrator promoted: $1"
