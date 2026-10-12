#!/bin/sh
set -eu
# Hashed build artifacts only; this volume never contains user uploads.
mkdir -p /asset-cache/assets
find /asset-cache/assets -type f -mtime +14 -delete
cp /srv/assets/* /asset-cache/assets/
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
