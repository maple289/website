# Validated video and photo uploads

## Findings and design

Previously the browser wrote directly into `user-videos` / `user-images` and marked videos Ready. Photo thumbnail failures were non-fatal. The existing `process-video` function parsed MP4/MOV headers but did not decode video; the checked server had no FFmpeg/FFprobe executable. MIME/extension checks could therefore be bypassed.

All gallery upload entry points now use `mediaUploads.ts` and `mediaValidation.ts`. Each file gets category, size, signature and (where the browser supports it) image-decode checks before transfer. A mixed selection has independent success/error rows. Custom video preview images use the same image validator.

Uploads go into private, immutable `media-staging` objects. An authenticated edge function queues an owner-bound job. Only the server worker can publish gallery rows or write the final media buckets. Restrictive storage policies close old permissive-policy bypasses; table permissions/triggers prevent clients forging storage paths or Ready status. Normal file-manager uploads, metadata edits, ownership rules and confirmed deletions remain in place.

The worker uses FFprobe followed by a complete FFmpeg decode/conversion to H.264/AAC MP4 with a 2,500 kb/s target when transcoding is needed (see VIDEO_PROCESSING.md). Compatible MP4 video at or below this bitrate is stream-copied; audio/fast-start layout is normalized separately. Images use Pillow plus pillow-heif, verify all frames, and produce WebP previews/thumbnails. No gallery row is created until processing succeeds. Failed jobs stay visible as per-file errors; other files continue. For videos, the upload dialog returns after server queueing, and an owner-only gallery job panel polls status and refreshes on completion. Photos retain their existing per-file completion flow. Photo Viewer falls back to the preview when the browser cannot display a valid original.

## Supported formats and limits

- Videos: MP4, MOV, AVI, MKV, WMV/ASF, WebM, MPEG/MPG, M4V, 3GP/3G2, TS/MTS/M2TS, OGV, FLV/F4V, VOB, RM/RMVB, MXF and NUT. Actual container/codec decoding decides acceptance; a matching extension is insufficient. AVI/QuickTime aliases `.divx`/`.qt` are accepted.
- Photos: JPEG, PNG, GIF, WebP, BMP, TIFF, HEIC/HEIF and AVIF. SVG, PDF, image sequences and external playlists are excluded.
- Existing size limits: videos 10 GiB, photos/previews 25 MiB. Decoder limits: 40 megapixels per frame, 1,000 image frames / 200 million total decoded image pixels, four-hour videos, bounded subprocess time, two processing slots, two CPUs and 2 GiB container memory.
- Complex or damaged files can fail despite having a supported extension. Decoder logs and server paths are not returned to users. FFmpeg network protocols and playlist demuxers are disabled. Decoder children receive no Supabase credentials in their environment.

## Deployment

**These changes must be deployed together. A frontend-only deployment cannot work.**

`scripts/deploy.sh` now builds `deploy/media-worker.compose.yml` before applying the migration, starts the worker in the existing Supabase network, waits for its health check, then builds the frontend. It uses the existing runtime `SERVICE_ROLE_KEY` server-side; no new browser secret is needed. The image installs pinned Pillow/pillow-heif dependencies and Debian FFmpeg. The scratch volume needs capacity for two simultaneous source files plus converted outputs (allow at least 30 GiB free). No production deployment was performed during implementation/testing.

Required pieces:

1. Migration `20260928090000_validated_media_uploads.sql`.
2. `queue-media-upload`, updated `process-video` and `serve-media` functions through the existing sync script.
3. Healthy media-worker service, then the updated frontend.

Old browser builds will have direct uploads rejected after migration; users must reload. Existing gallery records/objects are not reprocessed or modified. Jobs are private; the server removes each job's temporary inputs after processing. Interrupted processing is marked failed after three hours. Failed video originals are retained in private staging; successful videos retain their originals in final storage. Unqueued uploads abandoned before registration may remain in the staging bucket; clean these only through a separately scoped retention procedure. Do not delete final media objects merely because an HTTP commit response was lost.

## Verification

- 30 real decoder checks passed in an isolated container with no network or production credentials: eight image formats, fifteen video containers, category rejection, corruption, executable/PDF masquerading as media, actual-content detection independent of filename, and playlist rejection.
- Six worker publication tests passed, including validation-before-publication and preserving files after ambiguous commit responses.
- 55 browser integration checks passed. Tests use the real upload components/validators with mocked storage/queue responses. They cover both sections, picker single/multiple, gallery and modal drops, mixed files, mobile layout, forged MIME/extensions, corrupt content, server-reported failure, independent successful completion and the >50 MiB resumable upload path.
- Isolated PostgreSQL 17 migration/policy checks passed: direct final-bucket writes and gallery inserts denied, forged metadata/status denied, cross-user staging/jobs hidden, metadata edits and normal File Manager writes retained, service-only enqueue.
- TypeScript, changed production-file lint and the production Vite build passed. Build retains the existing large-bundle advisory.
- Live production end-to-end upload has **not** been tested; it requires deployment of the worker, functions, schema and frontend.

### Repeat tests

```sh
docker build -t streamly-media-validation:test services/media-worker
docker run --rm --network none --memory 2g --cpus 2 --entrypoint python streamly-media-validation:test test_validation.py
docker run --rm --network none --entrypoint python streamly-media-validation:test test_worker.py
```

Start Vite with `VITE_SUPABASE_URL=https://upload-test.supabase.co` and a dummy `VITE_SUPABASE_ANON_KEY`, on port 5189. Run `node tests/media-uploads.mjs` with Playwright installed, or set `PLAYWRIGHT_MODULE` to its module URL. `BROWSER_CHANNEL` defaults to `msedge`; `TEST_BASE_URL` overrides the local test URL. Fixtures are synthetic and contain no user data.

For SQL tests, use a **new disposable PostgreSQL database only**. Apply `tests/media-upload-setup.sql`, the existing `20260924020000_validate_photo_edits.sql`, the new upload migration, then `tests/media-upload-checks.sql` with `ON_ERROR_STOP=1`. The setup creates test roles/schemas and must never be run against the application database.

Processor documentation: [FFprobe](https://ffmpeg.org/ffprobe.html), [FFmpeg protocol restrictions](https://ffmpeg.org/ffmpeg-protocols.html), [Pillow image formats](https://pillow.readthedocs.io/en/stable/handbook/image-file-formats.html), [Pillow safety limits](https://pillow.readthedocs.io/en/stable/handbook/security.html), [pillow-heif](https://pypi.org/project/pillow-heif/).
