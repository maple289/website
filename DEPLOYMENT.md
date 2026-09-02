# Streamly deployment

## Architecture

The deployment consists of two independently updateable parts:

1. The official self-hosted Supabase runtime, pinned by `.supabase-release`.
2. The custom `streamly-web` image, which contains the Vite frontend and Caddy.

Caddy serves the frontend and proxies Supabase API paths to the official gateway
on the Ubuntu host. PostgreSQL, Auth, REST, Storage, Edge Functions, Studio, and
the other Supabase services remain in the official runtime.

The default data locations are:

```text
/srv/streamly/supabase/volumes/db/data   PostgreSQL
/srv/streamly/supabase/volumes/storage  photos and videos
/srv/streamly/backups                    database backups
```

The Storage directory can later be moved to the large media disk without
changing application paths or database records.

## First server installation

Create writable application directories on Ubuntu:

```bash
sudo mkdir -p /opt/streamly /srv/streamly
sudo chown -R "$USER":"$USER" /opt/streamly /srv/streamly
```

Clone the deployment branch:

```bash
git clone --branch docker-deployment git@github.com:maple289/website.git /opt/streamly/app
cd /opt/streamly/app
```

Install the pinned official Supabase runtime:

```bash
./scripts/bootstrap-supabase.sh
```

For the first LAN test, use `http://192.168.1.191` for the public Supabase,
external API, and site URLs when the installer asks. The generated service-role
key, database password, JWT secret, and dashboard password must remain only in
`/srv/streamly/supabase/.env`.

Create the application environment file:

```bash
cp .env.example .env
```

Copy the generated `ANON_KEY` from the Supabase environment into
`VITE_SUPABASE_ANON_KEY` in `.env`. The anon key is intended for browser use;
never copy `SERVICE_ROLE_KEY` into the frontend environment.

Start or update the complete deployment:

```bash
./scripts/deploy.sh
```

The script synchronizes Edge Functions, starts Supabase, waits for PostgreSQL,
applies only new SQL migrations, rebuilds the frontend image, and restarts the
web container.

## First administrator

Create the user through the website first. Then run the bootstrap function as
the database owner, replacing the email:

```bash
docker compose \
  --env-file /srv/streamly/supabase/.env \
  -f /srv/streamly/supabase/docker-compose.yml \
  exec -T db psql -U postgres -d postgres \
  -c "SELECT public.promote_first_admin('admin@example.com');"
```

The function stops working after the first administrator is assigned and is not
available through the public API.

## Backups

Create a compressed PostgreSQL backup:

```bash
./scripts/backup-database.sh
```

This does not copy media files. Media backup will be configured together with
the dedicated media disk using filesystem snapshots or a second storage target.

## Network exposure

Expose only ports 80 and 443 to users. Supabase gateway, Studio, PostgreSQL, and
other internal service ports should be blocked by the Ubuntu and perimeter
firewalls. Studio should be accessed through an SSH tunnel or the server console.

When a domain is ready, set `APP_ADDRESS` and `VITE_SUPABASE_URL` to that domain,
update the matching Supabase URLs, and redeploy. Caddy will then manage HTTPS.

## Updates and rollback

Friend/Bolt updates continue in `main`. Merge them into `docker-deployment`, let
GitHub Actions validate the result, then deploy a tagged commit on the server.

Before each production update:

```bash
./scripts/backup-database.sh
git fetch --tags origin
git checkout <release-tag>
./scripts/deploy.sh
```

Rollback checks out the previous tag and runs `deploy.sh` again. Database
migrations are forward-only, so schema-changing releases require a compatible
backup and an explicit rollback plan.
