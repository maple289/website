# Automated video analysis and conversion

The existing media worker/queue handles every video upload. FFprobe performs server-side analysis; FFmpeg performs actual decoding, conversion and final verification. TypeScript remains responsible for upload orchestration and gallery status; browser JavaScript does not transcode media.

## Admin configuration

Open **Admin Console → Settings → Video Processing** to change **Target Video Bitrate**. The default is **3.0 Mbps**; accepted values are **1–15 Mbps**, with up to two decimal places. Settings are stored in the existing admin-only `storage_settings` singleton (`target_video_bitrate_mbps`), protected by the existing settings API authorization and database RLS plus a database range constraint.

Each new conversion reads the current value when its worker starts validation. Saving does not require rebuilding or restarting the application, and does not queue reconversions of existing Ready videos. Changing this setting preserves the configured video/photo storage locations and file-server URL. Jobs already being processed retain the target they read when starting.

The **conversion target** is configurable; the **MP4 video-stream threshold** remains **4.5 Mbps**, independent of that target and of audio bitrate.

## Processing policy

- Detect actual container, video codec, video bitrate, dimensions, frame rate, duration and audio properties. The MOV/MP4 shared demuxer is distinguished using its major brand, not the user filename. If stream bitrate is missing, count compressed video packet bytes over duration; do not substitute total audio+video bitrate.
- Non-MP4 input, video above 4.5 Mbps, unknown video bitrate, incompatible codec/pixel format, excessive dimensions, rotation or non-square pixels: normalize with H.264, yuv420p, configured target/min/max, a VBV buffer twice that bitrate, filler, AAC at 128 kbps, fast-start MP4, and at most 1920 by 1080 display pixels. Preserve source timestamps/frame rate and aspect ratio (subject to even-pixel rounding). Smaller display dimensions are not enlarged. A failed packet-bitrate measurement safely falls back to conversion.
- Compatible MP4/H.264 at or below 4.5 Mbps with AAC-LC (or no audio) and fast-start layout: keep the original bytes without a conversion/remux command. Validation and thumbnail generation still run before Ready publication. AAC bitrate does not affect the video-stream threshold.
- Compatible lower-bitrate MP4 missing fast-start layout or requiring compatible audio: remux with video stream copy; normalize audio only when necessary. Lower-bitrate video is never re-encoded merely to reach the configured target.
- Audio-free videos remain audio-free. Converted/remuxed output selects the main video and first audio track. Files kept as-is retain their original tracks.
- MP4 does not support x264's `nal-hrd=cbr` signaling. Use `nal-hrd=vbr:filler=1` with matching configured target/min/max rates for a tightly controlled video payload. Short intervals/short clips and container/audio overhead mean total file bitrate is not exactly the configured target; AAC 128 kbps is an encoder target.
- Fully decode the final MP4, even when video was copied, before publication. Store measured output metadata rather than reporting an encoder target as a measurement.

## Records, visibility and recovery

Migration `20260928100000_video_processing_metadata.sql` stores original probe metadata, conversion action, output audio details and processed size. Existing video codec/bitrate/resolution/frame-rate/duration fields describe the playable output. Owner, name and Public/Private selection remain unchanged.

`storage_path` retains the original; `processed_storage_path` points to the verified MP4. Both use the existing Admin-configured video base path. The existing `serve-media` endpoint serves the processed MP4 and checks access as before. Ready gallery rows are created only after successful processing/publication. No unvalidated processing row is exposed in the public gallery.

Private owner-only job cards show Processing, Ready or Processing Failed. Closing the upload dialog after queueing, navigating away or closing the browser does not stop conversion. A processing failure cannot enable playback. Successful completion refreshes the gallery automatically. Failed source files remain in private staging for troubleshooting; successful originals are retained in video storage. This change does not introduce automatic original-file deletion or a new unconfirmed delete action.

## Verification of configurable bitrate

Tests use isolated databases, mocked browser APIs, and generated files in network-disabled decoder containers; no existing user files or accounts are test fixtures.

- `tests/video-bitrate-settings.mjs`: 24 actual-handler/database checks, including range/precision validation, admin-only access, RLS, default, preserving storage configuration and failed-save behavior.
- `tests/video-bitrate-settings-browser.mjs`: 12 checks at desktop (1440 px), tablet (768 px) and mobile (390 px) widths, including touch layouts, duplicate-submit protection, persistence, failed saves, guarded discard and no horizontal overflow. These are browser emulations, not physical device tests.
- `services/media-worker/test_bitrate.py`: seven tests with parameterized decision checks and six real FFmpeg cases. Verify the inclusive 4.5 Mbps video boundary, higher total audio/video bitrate without re-encoding, changed targets, non-MP4 conversion, fast-start remux, original-file hashes, thumbnail output and measured converted bitrate.
- `services/media-worker/test_validation.py`: 30 existing decoder checks, including AVI, WMV, MOV, MKV, MP4 and other formats, images and invalid content.
- `services/media-worker/test_worker.py`: 14 regression tests, including dynamic target reads, publication rollback, cancellation and stale claims.
- TypeScript checking and whitespace validation also pass.

Migration `20261004010000_configurable_video_bitrate.sql` adds only the settings column and range constraint. No existing media record or processing job is modified by this migration.

The setting, settings API, worker and Admin UI were deployed together on 2026-10-04 UTC. The live worker reads **3.0 Mbps** from the database; the new migration is recorded, services are healthy, and the public HTTPS page serves the updated bundle. Existing video/photo/object counts and all video storage references match the pre-deployment snapshot. The deployed decoder image also passes the bitrate and worker regression tests.

A verified, private custom-format database backup is retained at `/srv/streamly/audits/video-bitrate-20261004/pre-bitrate.postgres.dump`, alongside the pre-change source snapshot and deployment/test logs. Its archive listing was verified with `pg_restore --list`. For recovery, first restore this archive to an isolated database using `pg_restore`; a production restore requires a maintenance window with writes stopped and would roll back all database changes since the backup. The backup does not contain physical storage payloads, which this deployment did not alter.

## Deployment and previous verification

Deploy schema, worker and frontend together using the existing deployment script. FFmpeg/FFprobe are already installed by the media-worker Dockerfile, so there is no need to install a separate JavaScript codec library or FFmpeg on the host. The worker remains isolated from the web request, with two processing slots.

The deployed system was checked through the live authenticated upload, queue, storage and playback APIs and the HTTPS browser interface. A live failure was found: measured bitrate was a decimal while the existing database column requires an integer. The worker now rounds measured kb/s for that column (source metadata retains precision). The corrected worker was rebuilt and restarted successfully on the server. The repository correction must also be committed/pushed so future deployments retain it.

Earlier live results (the previous 2.5 Mbps policy, retained as historical evidence):

- Standard User account, private ownership, original retention, final MP4 playback, H.264/AAC, preserved frame rate and fast-start layout: passed.
- Low-bitrate 720p MP4: stream-copied without video re-encoding, 1280x720, measured approximately 579 kb/s.
- High-bitrate 720p MP4: transcoded, 1280x720; four-second fixture measured 2713 kb/s.
- 4K MKV: transcoded to 1920x1080; one-second fixture measured 2752 kb/s.
- Portrait MOV: transcoded proportionally to 606x1080; one-second fixture measured 2874 kb/s.
- These very short samples illustrate VBV/startup and container timing effects: the encoder target is 2500 kb/s, not a guarantee that every short file averages exactly that rate. Measured AAC rates were 122–126 kb/s for a 128 kb/s target.
- Direct final-bucket upload and direct Ready-row insertion by the standard user: rejected. Forged executable bytes reported as video: rejected, no gallery row, source retained privately.
- Actual HTTPS browser sign-in, gallery Ready/error states, processed playback, file-picker upload, background queue handoff and automatic Ready refresh: passed; no browser JavaScript runtime errors during the authenticated test.
- Six worker regression tests passed, including a fractional-bitrate fixture that asserts integer persistence.
- Both dedicated synthetic test accounts and all their test media/records were removed after success. Existing user content was not changed.

References: [FFmpeg encoder/muxer options](https://www.ffmpeg.org/ffmpeg-all.html), [scale filter and aspect handling](https://ffmpeg.org/ffmpeg-filters.html), [timestamp/frame-rate options](https://ffmpeg.org/ffmpeg.html).
