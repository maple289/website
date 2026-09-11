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

Clone the main branch:

```bash
git clone --branch main git@github.com:maple289/website.git /opt/streamly/app
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

Create the user through the website first. Then promote that account:

```bash
./scripts/promote-first-admin.sh admin@example.com
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
When IIS exposes the frontend below a path such as `/video/`, set
`VITE_BASE_PATH=/video/`. Keep `VITE_SUPABASE_URL` at the public origin without
the path because Supabase APIs remain under `/auth/v1`, `/rest/v1`, and the
other root API routes.

## Updates and rollback

Friend/Bolt updates continue in `main`. GitHub Actions validates every push and
the production runner automatically deploys the newest successful commit.

For a manual recovery or rollback:

```bash
./scripts/backup-database.sh
git fetch --tags origin
git checkout <release-tag>
./scripts/deploy.sh
```

Rollback checks out the previous tag and runs `deploy.sh` again. Database
migrations are forward-only, so schema-changing releases require a compatible
backup and an explicit rollback plan.

## Automatic deployment

Every push to `main` is validated by the hosted `CI` workflow. A successful CI
run dispatches `Deploy` to the Ubuntu runner labelled `streamly-production`.
The runner ignores a validated commit if a newer commit has already reached
`main`, preventing an older delayed workflow from replacing a newer release.

Keep the application environment outside the runner checkout:

```bash
cp /opt/streamly/app/.env /srv/streamly/app.env
chmod 600 /srv/streamly/app.env
```

In the GitHub repository, open **Settings > Actions > Runners**, choose
**New self-hosted runner**, then follow the displayed Linux x64 commands on the
Ubuntu VM. Configure the runner with the custom label
`streamly-production` and install it as a system service under the `vlad` user.
The runner user must be able to run `docker ps` without `sudo` and write to
`/srv/streamly`.

For every validated commit, the runner:

1. acquires a deployment lock;
2. creates a complete PostgreSQL backup;
3. removes backups older than 30 days;
4. synchronizes Edge Functions and applies only new migrations;
5. builds and starts the web container;
6. verifies `/healthz` and records the deployed commit in
   `/srv/streamly/last-deployed-sha`.

No GitHub secrets are required for deployment. Supabase and application secrets
remain in `/srv/streamly/supabase/.env` and `/srv/streamly/app.env` on Ubuntu.
