#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
runtime_dir=${STREAMLY_RUNTIME_DIR:-/srv/streamly/supabase}
target_dir="$runtime_dir/volumes/functions"

if [ ! -d "$target_dir" ]; then
  echo "Supabase functions directory not found at $target_dir"
  exit 1
fi

for function_dir in "$project_root"/supabase/functions/*; do
  [ -d "$function_dir" ] || continue
  function_name=$(basename "$function_dir")
  rm -rf "$target_dir/$function_name"
  cp -R "$function_dir" "$target_dir/$function_name"
done

echo "Application Edge Functions synchronized."
