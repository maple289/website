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
    -f "$project_root/deploy/file-preview-worker.compose.yml" \
    -f "$project_root/deploy/analytics-collector.compose.yml" \
    -f "$project_root/deploy/messenger.compose.yml" "$@"
}
# Realtime owns its internal tenant table. Keep this deployment-only change on
# its administrative connection; postgres migrations and API roles need no
# additional UPDATE permission on _realtime.tenants.
enforce_private_realtime() {
  runtime_stack exec -T db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
  IF to_regclass('_realtime.tenants') IS NULL OR NOT EXISTS(
    SELECT 1 FROM information_schema.columns WHERE table_schema='_realtime'
      AND table_name='tenants' AND column_name='private_only') THEN
    RAISE EXCEPTION 'Upgrade Realtime to support private_only before enabling Messenger';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM _realtime.tenants) THEN
    RAISE EXCEPTION 'Initialize the Realtime tenant before enabling Messenger';
  END IF;
  UPDATE _realtime.tenants SET private_only=true WHERE private_only IS DISTINCT FROM true;
END $$;
SQL
}
# Build the decoder before changing upload policies. A failed build must not
# switch the database to a queue that has no worker image.
runtime_stack build media-worker file-preview-worker analytics-collector
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

# Private Broadcast's database functions are installed by Realtime's tenant
# migration. Seed a missing tenant once, before the application migrations.
# Never reseed an existing tenant: the stock seed resets private_only=false.
tenant_table=$(runtime_stack exec -T db psql -U postgres -d postgres -tAc "SELECT to_regclass('_realtime.tenants')" | tr -d '[:space:]')
export STREAMLY_REALTIME_SEED=false
if [ -z "$tenant_table" ]; then
  export STREAMLY_REALTIME_SEED=true
elif [ "$(runtime_stack exec -T db psql -U postgres -d postgres -tAc 'SELECT count(*) FROM _realtime.tenants' | tr -d '[:space:]')" = '0' ]; then
  export STREAMLY_REALTIME_SEED=true
fi
runtime_stack up -d --wait --wait-timeout 180 realtime
enforce_private_realtime

STREAMLY_RUNTIME_DIR="$runtime_dir" "$project_root/scripts/apply-migrations.sh"
STREAMLY_RUNTIME_DIR="$runtime_dir" "$project_root/scripts/sync-functions.sh"
export STREAMLY_REALTIME_SEED=false
# Enforce again on deploy, including recovery from an external tenant reseed.
enforce_private_realtime
runtime_stack up -d
runtime_stack restart functions realtime
runtime_stack up -d --wait --wait-timeout 180 media-worker file-preview-worker analytics-collector
docker compose --env-file "$app_env" -f "$project_root/compose.yml" up -d --build
docker compose --env-file "$app_env" -f "$project_root/compose.yml" ps
