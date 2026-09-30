# Video processing investigation — 2026-09-30

## Confirmed causes

All four failed uploads in `media_upload_jobs` were inspected with their
retained staged originals, worker state, storage catalog, filesystem permissions,
available disk space, FFprobe and the original FFmpeg command.

| Upload | Source | Original failure |
| --- | --- | --- |
| Фильм1, two uploads of identical bytes | ASF, WMV3, WMA2, 640×480 | Non-monotonic audio DTS aborted the MP4 muxer |
| _Школа | AVI, MPEG4, MP3, 720×540 | Damaged video macroblocks and MP3 headers triggered strict source-decoding abort |
| IMG_2431 | MOV/MP4, H.264, AAC, 1920×1080 | Duplicate video DTS aborted the MP4 muxer |

Sources existed and were readable. Upload sizes were complete, workers were
running, paths resolved under the configured storage location, and storage had
ample free space. No failed upload had been published as a playable video.
Partial conversion files existed only inside the isolated diagnostic run and
were removed with its temporary directory.

Separately, `SAM_0037.AVI` was 49,969,182 bytes. The old uploader sent it in one
request because its resumable threshold was 50 MiB. Microsoft IIS rejected that
request with HTTP 413 and omitted CORS headers, producing the browser's generic
network error before the application gateway received the upload.

## Corrections

- Regenerate missing timestamps, discard packets marked corrupt, synchronize
  encoded audio, and use variable frame timestamps for transcoding. Recoverable
  input errors are logged; final MP4 output still passes a complete strict decode,
  codec/dimension checks and a duration check to reject truncated conversions.
- Preserve compliant MP4 video without unnecessary bitrate re-encoding. Converted
  video remains H.264/AAC, bounded to 1920×1080 without enlarging small sources,
  targeting 2.5 Mbps video/128 kbps audio with faststart.
- Capture complete FFmpeg error/recovery output, exit status, command options and
  source analysis in server diagnostics. Redact paths/URLs; only short safe errors
  enter the database/UI.
- Use 6 MiB resumable chunks for media over 6 MiB. Map HTTP errors and connection
  failures to actionable messages without exposing tokens or internal endpoints.
- Give failed cards visible Delete Failed Upload and Retry Processing controls.
  Failed uploads are paginated separately from recent successes.
- Retry binds the account to `auth.uid()`, requires a retained original, prevents
  retry of deleted/published uploads and refuses unsafe overwrites after incomplete
  cleanup. Failed originals remain private until retry or confirmed deletion.
- Keep the existing confirmed deletion route for both Ready and Failed uploads.
  Preserve related staging job IDs in a server-only tombstone; clean leftover TUS
  receipts only after completed deletion and only when their payload is absent.

The receipt cleaner shares the decoder image but has a separate limited service,
with no added Linux capabilities and a read-only container root. It requires the
local file Storage backend layout configured by the existing Supabase stack.

## Verification

The repaired command successfully converted **all four original failures** in
isolated server checks, including full final decoding and preview generation.
Two identical WMV sources were verified by hash; one was processed completely.
No legitimate failed upload was deleted or silently hidden. Its error now explains
the diagnosed cause, and the owner can choose Retry Processing or Delete.

Live browser checks used a dedicated temporary standard user on the deployed
website: MP4, AVI, WMV, MOV and MKV uploads through multiple selection became
Ready automatically, generated thumbnails and decoded in the player. The exact
SAM AVI uploaded through resumable POST/PATCH requests and also converted/played.
An intentionally invalid source remained a manageable Failed card, could be
retried, and did not block the successful jobs. Mobile-sized deletion tests checked
Cancel, outside click, Escape, explicit confirmation and absence after refresh.
All six Ready cards were deleted through the same confirmation and stayed absent
after refresh.

Post-deletion inspection confirmed zero video rows, processing jobs, Storage
objects, physical files (including upload receipts) or scratch files for the test
uploads. Seven completed deletion tombstones covered the six Ready uploads and
one failed upload. The dedicated test account was removed after these checks.
Worker, receipt-cleaner and frontend containers were healthy after deployment.

Automated checks include TypeScript, targeted ESLint, frontend Docker build,
30 media decoder checks (15 video formats plus image/security cases), 8 worker
publication/cancellation regressions, 2 receipt-cleanup tests, deletion endpoint
checks and rolled-back SQL tests in `tests/video-deletion.sql` and
`tests/video-retry.sql`. CI now includes receipt-cleanup tests.

FFmpeg options follow the [FFmpeg command documentation](https://ffmpeg.org/ffmpeg.html)
and [audio resampling documentation](https://ffmpeg.org/ffmpeg-filters.html#aresample-1).

## Follow-up: failed-card buttons were clipped

The original live click test missed a layout defect. Processing cards applied
both `mg-thumbnail` and `mg-placeholder` to the same element. The placeholder's
`height: 100%` expanded the grey area to the whole grid card height, pushing its
name, error and action buttons below the card's `overflow: hidden` boundary.
The Delete callback existed, but a normal pointer could not reach it. Automated
`scrollIntoView` used during clicks could scroll the hidden card internally and
make the test pass despite the inaccessible layout.

Processing placeholders now sit inside a separate thumbnail container, matching
the existing media-card structure. The thumbnail keeps its 16:9 ratio, and the
name, failure explanation, Retry and Delete actions fit inside the card. This
applies to existing uploads as well as newly queued/failed uploads.

`tests/video-processing-cards.mjs` exercises four long-name/error failed cards
alongside queued and cancelled cards at desktop, tablet and mobile widths. It
checks action bounds and pointer hit testing before any automated button scroll,
then clicks the actual visible button coordinates and verifies confirmation,
Cancel, outside/Escape protection and confirmed removal.
