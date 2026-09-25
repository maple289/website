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

## Optional profile names

This release requires migration `20260924030000_add_optional_profile_names.sql`
and updated `admin-users` and `approve-registration` Edge Functions alongside the
frontend. The normal deployment procedure includes all three; when deploying
manually, apply the migration before enabling the updated functions and frontend.

Existing accounts retain nullable names and need no profile update. Registration
still uses the existing email approval/invitation flow. Names are stored on
pending requests and copied to the profile when an approved invitation creates
the account. Account settings can edit or clear only the caller's names; admin
editing continues to require the existing server-side administrator check.

## Video and photo reactions

Apply `20260924040000_add_media_reactions.sql` before deploying the reaction UI.
It depends on the optional profile-name migration above. No additional Edge
Function or Realtime publication is required.

Reaction rows use user IDs, a unique user/media key, and cascading foreign keys.
Client roles cannot read or write the table directly. The RPCs enforce the same
public/owner/admin scope as the current video and photo SELECT policies; if
those media policies change, update `can_access_reaction_media` accordingly.
Only authenticated users can mutate their own reactions. Details return current
profile names (first, last, then email prefix), never the full email column.

The frontend shares optimistic updates between cards and viewers, rolling back
failed saves. Near-visible media counts are fetched in batches of up to 100 and
refreshed every 20 seconds while the page is visible, plus on window focus.
Other users' changes therefore appear on the next refresh. Detail lists use
50-user cursor pages and refresh from current profiles while open.

## Registration email configuration and diagnosis

The application uses email requests that require admin approval. Submission sends
an applicant receipt and a notification to **every profile with role `admin`**.
Approval creates/invites the account through Supabase Auth and sends the existing
approval email. There is no username field in this authentication model.

Confirmed defects repaired in this release:

- Submission had no applicant email and the browser ignored notification HTTP failures.
- Both Resend senders were hard-coded to `noreply@bolt.new`.
- Email failure booleans were ignored, and there were no persistent delivery IDs
  or protections against repeated notification requests.
- Deployment supplied no explicit custom email variables to Edge Functions.
  A Compose `.env` value alone does not inject a variable into a container.

The existing direct Resend HTTP API is retained (no frontend SDK/API key).
Configure the **existing** key on the server in `/srv/streamly/supabase/.env`:

```dotenv
RESEND_API_KEY=<existing server-side key>
RESEND_FROM_EMAIL=Streamly <notifications@your-verified-domain.example>
```

Use a sender domain verified in your Resend account; the example is not a real
sender. `SMTP_ADMIN_EMAIL` is a fallback sender when `RESEND_FROM_EMAIL` is absent.
Do not add these secrets to `VITE_*`, the application build environment, or Git.
`scripts/deploy.sh` now includes `deploy/supabase-email.compose.yml` to inject only
backend email settings into the Functions container and recreate it if changed.
Deploy migration `20260924050000_registration_email_delivery.sql`, both updated
registration Edge Functions, their `_shared` directory, and the frontend together.

Supabase Auth invitations are a **separate SMTP delivery path**. A Resend API key
in Functions alone does not configure Auth. Verify the runtime's existing
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_ADMIN_EMAIL` and
`SMTP_SENDER_NAME`. When Resend is your SMTP provider, its documented host is
`smtp.resend.com`, username `resend`, password your existing API key, and port
587 uses STARTTLS. Preserve a working SMTP configuration. See
https://resend.com/docs/send-with-smtp.

### Inspect without printing secrets

Run on the production server (Python 3, standard library only):

```bash
python3 scripts/diagnose-registration-email.py --env-file /srv/streamly/supabase/.env
```

Also run `sh scripts/check-email-runtime.sh` to verify variable presence inside
the running Functions container (as opposed to only the environment file).

The Python script reports key presence, sender domain status where permitted, and only
safe metadata from Resend Logs. A send-only key may lack permission to list domains
or logs; a 403 from those read endpoints alone does not mean the key cannot send.
Inspect the signed-in dashboard in that case. Never print `docker inspect` or
`docker compose config` unfiltered: they can contain the complete key.

For the user-authorized live registration test:

```bash
python3 scripts/diagnose-registration-email.py --env-file /srv/streamly/supabase/.env --registration-test maple289@gmail.com
```

This sends a real registration receipt and real notifications to all admins. It
requires the migrated backend plus `SUPABASE_PUBLIC_URL` (or `API_EXTERNAL_URL`),
`ANON_KEY`, and `SERVICE_ROLE_KEY` in the backend environment. It does not bypass
approval or create a duplicate auth account. If the address already has an approved
request, use a separately authorized fresh address for a new registration test.
Verify the delivery rows and their message IDs against Resend Emails/Logs; API
acceptance is not proof that the message arrived in the recipient inbox. Complete
admin approval separately to verify the Auth SMTP invitation and approval email.

### Failures and safe retries

Server logs include operation, provider HTTP status, error type/message, and
accepted message ID. Full API keys and Authorization tokens are redacted.
`registration_email_deliveries` is backend-only and stores each operation's status,
message ID, and sanitized error. A failure never rolls back an accepted request.
Resubmitting the same pending registration retries only unsent emails; already
sent messages are skipped. Provider rate-limit/server errors get two bounded
retries with the same idempotency key. Concurrent sends have a database claim,
a one-minute cooldown, and a five-attempt cap. No recurring retry job is installed. Repeating the same authenticated
`approve-registration` action for an already approved/rejected request retries its
unsent notification without another invitation/account creation. The admin UI
warns if a saved review has an unconfirmed email.

Before the first provider attempt, missing configuration does not consume the send-attempt budget. For ambiguous
attempts older than 23 hours, inspect Resend logs before any operator retry;
the provider's idempotency window is 24 hours. Do not blindly clear sent rows or
reset uncertain deliveries. Fix the configuration before resubmitting.

Offline regression tests use the existing local PGlite dependency and send no mail:

```bash
node scripts/test-registration-email.mjs
```

Live key validity, verified-domain ownership, inbox delivery, and production
Resend logs cannot be inferred from offline tests.
