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
if [ ! -f "$runtime_compose" ] || [ ! -f "$project_root/deploy/supabase-email.compose.yml" ] || [ ! -f "$project_root/deploy/supabase-auth.compose.yml" ] || [ ! -f "$runtime_env" ] || [ ! -f "$project_root/deploy/media-worker.compose.yml" ]; then
  echo "Run scripts/bootstrap-supabase.sh first."
  exit 1
fi
if grep -q 'replace-with-generated-anon-key' "$app_env"; then
  echo "Set VITE_SUPABASE_ANON_KEY in $app_env before deploying."
  exit 1
fi

export STREAMLY_PROJECT_ROOT="$project_root"
runtime_stack() {
  docker compose --env-file "$runtime_env" -f "$runtime_compose" \
    -f "$project_root/deploy/supabase-email.compose.yml" \
    -f "$project_root/deploy/supabase-auth.compose.yml" \
    -f "$project_root/deploy/media-worker.compose.yml" \
    -f "$project_root/deploy/file-preview-worker.compose.yml" "$@"
}
# Build the decoder before changing upload policies. A failed build must not
# switch the database to a queue that has no worker image.
runtime_stack build media-worker file-preview-worker
runtime_stack up -d db

attempt=0
until runtime_stack exec -T db pg_isready -U postgres -d postgres >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    echo "PostgreSQL did not become ready in time."
    exit 1
  fi
  sleep 2
done

STREAMLY_RUNTIME_DIR="$runtime_dir" "$project_root/scripts/apply-migrations.sh"
STREAMLY_RUNTIME_DIR="$runtime_dir" "$project_root/scripts/sync-functions.sh"
runtime_stack up -d
runtime_stack restart functions
runtime_stack up -d --wait --wait-timeout 120 media-worker file-preview-worker
docker compose --env-file "$app_env" -f "$project_root/compose.yml" up -d --build
docker compose --env-file "$app_env" -f "$project_root/compose.yml" ps
