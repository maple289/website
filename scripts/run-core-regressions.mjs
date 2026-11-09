import { spawn } from 'node:child_process';
const suites = [
  'tests/audit-account-security.mjs', 'tests/audit-media-security.mjs', 'tests/audit-client-resilience.mjs',
  'tests/public-preview-access.mjs', 'tests/image-data-url.mjs',
  'scripts/test-registration-email.mjs', 'tests/video-bitrate-settings.mjs', 'tests/admin-statistics-reset-db.mjs',
  'tests/messenger-message-deletion.mjs', 'tests/messenger-people.mjs', 'tests/messenger-calls.mjs', 'tests/messenger-notifications-db.mjs',
  'tests/messenger-group-sharing-db.mjs',
  'tests/group-media-upload-db.mjs',
  'tests/single-final-video-publication.mjs',
  'tests/storage-location-compatibility.mjs',
  'tests/storage-file-catalog.mjs',
  'tests/storage-file-returning-policy.mjs',
  'tests/storage-preview-cache.mjs',
  'tests/library-storage-links-db.mjs',
  'tests/retired-storage-cleanup.mjs',
  'tests/library-storage-links-http.mjs',
  'tests/media-job-storage-locations.mjs',
  'tests/media-staging-client.mjs',
  'tests/photo-storage-deletion.mjs',
  'tests/user-file-storage-deletion.mjs',
  'tests/shared-image-gateway.mjs',
  'tests/messenger-group-visibility.mjs',
  'tests/messenger-call-relay.mjs', 'tests/messenger-call-engine.mjs', 'tests/messenger-call-audio-output.mjs', 'tests/messenger-notifications-worker.mjs',
  'tests/content-context-db.mjs', 'tests/temporary-share-routing.mjs', 'tests/folder-downloads.mjs', 'scripts/test-file-sharing.mjs',
];
for (const suite of suites) {
  const status = await new Promise((resolve, reject) => {
    const child=spawn(process.execPath,[suite],{stdio:'inherit',env:process.env});
    child.on('error',reject);child.on('exit',resolve);
  });
  if(status!==0)throw Error(suite+' failed: '+status);
}
