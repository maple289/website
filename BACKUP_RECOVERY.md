# Backup and recovery

The full-backup script and proposed timer are prepared, but no production backup
destination, job, snapshot or restore has been verified. Do not treat this as an
active backup until the steps below are completed on the Ubuntu host.

## Setup

1. Install a supported Restic release using the official operating-system package
   or vendor release. Select an **off-host** repository: NAS mounted with NFS/CIFS,
   SFTP, encrypted object storage, or an HTTPS Restic service. A same-VM directory
   is insufficient. Keep the repository outside all source/spool directories and
   on storage independent of the originals' failure domain.
2. Review `deploy/backup.env.example`, substitute the actual mount/config paths,
   and install it at `/srv/streamly/backup.env` with mode `0600`, owned by root.
   Store the strong repository password in the referenced root-only `0600` or
   `0400` file. Keep a separate recoverable copy of that password outside the VM;
   losing it makes encrypted backups unusable. Never put it in Git or chat.
3. Initialize the repository once using Restic. Confirm the NAS is mounted and
   reachable from the backup service. Configure provider credentials in the
   private environment where needed. No repository initialization or pruning is
   performed automatically by this script.
4. Confirm `STREAMLY_STORAGE_DIR` is the actual complete Storage backing tree,
   and `STREAMLY_ENV_FILE` is the deployment's real application configuration.
   Optionally prepare a root-only infrastructure bundle containing the actual
   coturn configuration, IP-update units/scripts and host package/mount inventory.
   The script includes that bundle only when `STREAMLY_INFRA_BACKUP_DIR` is set.
   Independently back up Windows/IIS proxy configuration where used. Router/ASA
   configuration is outside this job and is not modified.
5. Run `/bin/sh /srv/streamly/app/scripts/backup-full.sh` with the private
   environment loaded by a root-controlled service. Verify the resulting snapshot
   with `restic snapshots` and `restic check`. Check that a sample original file,
   database dump, application source and configuration can be read from it.
6. Only after a successful first snapshot, install the supplied service/timer into
   `/etc/systemd/system`, adjust `ExecStart` for the actual checkout, reload systemd
   and enable the timer. Its proposed schedule is 03:00 America/Toronto with up
   to ten minutes of jitter. Monitor failed runs and missed snapshots. Daily
   scheduling implies up to about one day of loss; agree the real RPO separately.

## What the script captures

An encrypted PostgreSQL cluster dump, Storage originals/derivatives, Supabase
runtime configuration, application environment and source tree. File modes are
private from creation (`umask 077`; spool directory `0700`). Database live volume
bytes are excluded in favor of the consistent SQL dump. Dependencies, generated
builds, Git metadata and audit artifacts are excluded. The optional infrastructure
bundle is included. Retained snapshots are never automatically pruned.

The database dump and live Storage scan are **not one atomic snapshot**. Uploads,
conversion or deletion during the run can leave cross-layer differences. Use a
reviewed quiet/maintenance window or coordinated filesystem snapshot, and verify
the restored database against storage using `scripts/check-database-integrity.py`.
Do not delete discrepancies automatically. A successful script exit alone does
not prove recoverability, retention or an atomic application backup.

## Recovery rehearsal — isolated host only

1. Provision an isolated recovery VM with matching database/runtime versions.
   Disable public inbound traffic, outbound email, scheduled jobs and TURN
   credential distribution while validating it.
2. Retrieve the off-host repository and its separate password. Restore to a new
   empty directory; never restore over production. Verify snapshot timestamps and
   Restic integrity first.
3. Restore the SQL dump and configuration under an operator-reviewed procedure,
   then restore the complete Storage tree with the original ownership. Protect
   restored environment/secrets and reconnect only the isolated dependencies.
4. Run read-only database/filesystem reconciliation, then test login, a private
   and public item, video playback, document preview, Messenger permissions and
   revoked/expired shares. Do not send real notifications during rehearsal.
5. Record actual restore duration, missing dependencies, snapshot age and any
   inconsistencies. Only a successful rehearsal establishes a usable RTO. Review
   retention and deletion policy separately before enabling Restic pruning.

See [Restic repository setup](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html)
and [backup documentation](https://restic.readthedocs.io/en/stable/040_backup.html).
