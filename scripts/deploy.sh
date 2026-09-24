#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
runtime_dir=${STREAMLY_RUNTIME_DIR:-/srv/streamly/supabase}
app_env=${STREAMLY_ENV_FILE:-$project_root/.env}
runtime_compose="$runtime_dir/docker-compose.yml"
runtime_env="$runtime_dir/.env"

if [ ! -f "$app_env" ]; then
  echo "Create $app_env from .env.example before deploying."
  exit 1
fi
if [ ! -f "$runtime_compose" ] || [ ! -f "$runtime_env" ]; then
  echo "Run scripts/bootstrap-supabase.sh first."
  exit 1
fi
if grep -q 'replace-with-generated-anon-key' "$app_env"; then
  echo "Set VITE_SUPABASE_ANON_KEY in $app_env before deploying."
  exit 1
fi

STREAMLY_RUNTIME_DIR="$runtime_dir" "$project_root/scripts/sync-functions.sh"

docker compose --env-file "$runtime_env" -f "$runtime_compose" up -d

attempt=0
until docker compose --env-file "$runtime_env" -f "$runtime_compose" exec -T db pg_isready -U postgres -d postgres >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    echo "PostgreSQL did not become ready in time."
    exit 1
  fi
  sleep 2
done

STREAMLY_RUNTIME_DIR="$runtime_dir" "$project_root/scripts/apply-migrations.sh"
docker compose --env-file "$runtime_env" -f "$runtime_compose" restart functions
docker compose --env-file "$app_env" -f "$project_root/compose.yml" up -d --build
docker compose --env-file "$app_env" -f "$project_root/compose.yml" ps
