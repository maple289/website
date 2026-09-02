#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
runtime_dir=${STREAMLY_RUNTIME_DIR:-/srv/streamly/supabase}
compose_file="$runtime_dir/docker-compose.yml"
runtime_env="$runtime_dir/.env"

if [ ! -f "$compose_file" ] || [ ! -f "$runtime_env" ]; then
  echo "Supabase runtime is not configured at $runtime_dir"
  exit 1
fi

run_psql() {
  docker compose --env-file "$runtime_env" -f "$compose_file" exec -T db \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}

run_psql <<'SQL'
CREATE SCHEMA IF NOT EXISTS streamly_internal;
CREATE TABLE IF NOT EXISTS streamly_internal.schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON SCHEMA streamly_internal FROM PUBLIC, anon, authenticated;
SQL

for migration in "$project_root"/supabase/migrations/*.sql; do
  [ -f "$migration" ] || continue
  version=$(basename "$migration")
  case "$version" in
    *[!0-9A-Za-z_.-]*)
      echo "Unsafe migration filename: $version"
      exit 1
      ;;
  esac

  applied=$(run_psql -tAc "SELECT 1 FROM streamly_internal.schema_migrations WHERE version = '$version'" | tr -d '[:space:]')
  if [ "$applied" = "1" ]; then
    echo "Already applied: $version"
    continue
  fi

  echo "Applying: $version"
  {
    printf 'BEGIN;\n'
    cat "$migration"
    printf "\nINSERT INTO streamly_internal.schema_migrations (version) VALUES ('%s');\n" "$version"
    printf 'COMMIT;\n'
  } | run_psql
done
