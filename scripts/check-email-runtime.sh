#!/bin/sh
set -eu
runtime_dir=${STREAMLY_RUNTIME_DIR:-/srv/streamly/supabase}
# Never dump container environment or Compose config: they contain secrets.
docker compose --env-file "$runtime_dir/.env" -f "$runtime_dir/docker-compose.yml" exec -T functions sh -c '
for key in RESEND_API_KEY RESEND_FROM_EMAIL SITE_URL; do
  if printenv "$key" | grep -q .; then
    printf "%s: configured\n" "$key"
  else
    printf "%s: missing\n" "$key"
  fi
done
'
