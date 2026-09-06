#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
lock_file=${STREAMLY_DEPLOY_LOCK:-/srv/streamly/deploy.lock}
state_file=${STREAMLY_DEPLOY_STATE:-/srv/streamly/last-deployed-sha}
health_url=${STREAMLY_HEALTH_URL:-http://127.0.0.1/healthz}
deployment_sha=${DEPLOY_SHA:-$(git -C "$project_root" rev-parse HEAD)}

if ! command -v flock >/dev/null 2>&1; then
  echo "The flock command is required for automated deployment."
  exit 1
fi

exec 9>"$lock_file"
if ! flock -n 9; then
  echo "Another Streamly deployment is already running."
  exit 1
fi

"$project_root/scripts/backup-database.sh"
"$project_root/scripts/deploy.sh"

attempt=0
until curl -fsS "$health_url" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "Deployment health check failed: $health_url"
    exit 1
  fi
  sleep 2
done

printf '%s\n' "$deployment_sha" > "$state_file"
echo "Streamly deployment completed: $deployment_sha"
