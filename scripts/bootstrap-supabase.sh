#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
release=$(cat "$project_root/.supabase-release")
runtime_dir=${STREAMLY_RUNTIME_DIR:-/srv/streamly/supabase}

case "$runtime_dir" in
  /*) ;;
  *)
    echo "STREAMLY_RUNTIME_DIR must be an absolute path."
    exit 1
    ;;
esac

if [ -f "$runtime_dir/docker-compose.yml" ]; then
  echo "Supabase runtime already exists at $runtime_dir"
  exit 0
fi

runtime_parent=$(dirname "$runtime_dir")
runtime_name=$(basename "$runtime_dir")
if [ ! -d "$runtime_parent" ] || [ ! -w "$runtime_parent" ]; then
  echo "Create $runtime_parent and make it writable before continuing."
  exit 1
fi

temporary_dir=$(mktemp -d)
trap 'rm -rf "$temporary_dir"' EXIT INT TERM

curl -fsSL https://supabase.link/setup.sh -o "$temporary_dir/setup.sh"
(
  cd "$runtime_parent"
  sh "$temporary_dir/setup.sh" \
    --skip-deps \
    --project-dir "$runtime_name" \
    --ref "$release"
)

echo "Supabase $release installed at $runtime_dir"
