#!/bin/sh
set -eu
umask 077
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
runtime_dir=${STREAMLY_RUNTIME_DIR:-/srv/streamly/supabase}
storage_dir=${STREAMLY_STORAGE_DIR:-$runtime_dir/volumes/storage}
app_env=${STREAMLY_ENV_FILE:-$project_root/.env}
spool_base=${STREAMLY_BACKUP_DIR:-/srv/streamly/backups}
if ! command -v restic >/dev/null 2>&1 || [ -z "${RESTIC_REPOSITORY:-}" ] || [ -z "${RESTIC_PASSWORD_FILE:-}" ]; then
  echo "Full backup requires restic, an off-host repository and a password file." >&2
  exit 1
fi
if [ ! -f "$RESTIC_PASSWORD_FILE" ]; then
  echo "The backup password file must exist with mode 0600 or 0400." >&2
  exit 1
fi
case "$(stat -c %a "$RESTIC_PASSWORD_FILE")" in 600|400) ;; *) echo "The backup password file must have mode 0600 or 0400." >&2; exit 1;; esac
case "$RESTIC_REPOSITORY" in
  s3:*|b2:*|azure:*|sftp:*|rest:https://*) ;;
  /*)
    case "$(findmnt -n -o FSTYPE -T "$RESTIC_REPOSITORY")" in nfs|nfs4|cifs|fuse.sshfs) ;; *) echo "The local repository must be on a verified remote mount." >&2; exit 1;; esac ;;
  *) echo "Use a supported off-host encrypted repository." >&2; exit 1 ;;
esac
storage_dir=$(readlink -f "$storage_dir")
[ -d "$storage_dir" ] && [ -f "$runtime_dir/.env" ] && [ -f "$app_env" ]
case "$RESTIC_REPOSITORY" in
  /*)
    repository_real=$(readlink -f "$RESTIC_REPOSITORY")
    for source in "$storage_dir" "$runtime_dir" "$project_root" "$spool_base" "${STREAMLY_INFRA_BACKUP_DIR:-$project_root}"; do
      source=$(readlink -f "$source")
      case "$repository_real" in "$source"|"$source"/*) echo "The repository must be outside every backup source and spool directory." >&2; exit 1;; esac
    done ;;
esac
mkdir -p "$spool_base"
chmod 700 "$spool_base"
spool_base=$(readlink -f "$spool_base")
spool=$(mktemp -d "$spool_base/full-XXXXXXXX")
case "$spool" in "$spool_base"/full-*) ;; *) exit 1;; esac
trap 'rm -rf -- "$spool"' EXIT HUP INT TERM
exec 9>"$spool_base/full-backup.lock"
flock -n 9 || { echo "Another full backup is running." >&2; exit 1; }
export RESTIC_REPOSITORY RESTIC_PASSWORD_FILE
# Raw provider errors may contain repository URLs; keep them out of journals.
restic snapshots >/dev/null 2>&1 || { echo "Encrypted repository verification failed." >&2; exit 1; }
docker compose --env-file "$runtime_dir/.env" -f "$runtime_dir/docker-compose.yml" exec -T db pg_dumpall -U postgres > "$spool/postgres.sql"

# The push signing key lives outside PostgreSQL in a private persistent volume.
# Include it only inside this protected, encrypted full-backup spool. Never print
# its contents or place it in application/public configuration.
export STREAMLY_PROJECT_ROOT="$project_root"
push_container=$(docker compose --env-file "$runtime_dir/.env" -f "$runtime_dir/docker-compose.yml" \
  -f "$project_root/deploy/push-dispatcher.compose.yml" ps -q push-dispatcher)
if [ -n "$push_container" ]; then
  docker cp "$push_container:/var/lib/push/vapid.pem" "$spool/messenger-push-vapid.pem"
  chmod 600 "$spool/messenger-push-vapid.pem"
fi
date -u +%FT%TZ > "$spool/captured-at-utc"
git -C "$project_root" rev-parse HEAD > "$spool/source-sha"
if [ -n "${STREAMLY_INFRA_BACKUP_DIR:-}" ]; then
  [ -d "$STREAMLY_INFRA_BACKUP_DIR" ] || { echo "The infrastructure backup bundle is unavailable." >&2; exit 1; }
  set -- "$STREAMLY_INFRA_BACKUP_DIR"
else
  set --
fi
if ! restic backup --tag myhostage-full --group-by host,tags --exclude "$runtime_dir/volumes/db" \
  --exclude "$project_root/node_modules" --exclude "$project_root/.runtime" --exclude "$project_root/.git" --exclude "$project_root/audit" \
  "$spool" "$storage_dir" "$runtime_dir" "$app_env" "$project_root" "$@" >/dev/null 2>&1; then
  echo "Encrypted full backup failed. No retained snapshots were deleted." >&2
  exit 1
fi
echo "Encrypted database, content and application configuration backup completed."
# Retention/pruning is deliberately a separately reviewed operator operation.
