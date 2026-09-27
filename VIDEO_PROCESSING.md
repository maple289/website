# Automated video analysis and conversion

The existing media worker/queue handles every video upload. FFprobe performs server-side analysis; FFmpeg performs actual decoding, conversion and final verification. TypeScript remains responsible for upload orchestration and gallery status; browser JavaScript does not transcode media.

## Processing policy

- Detect actual container, video codec, video bitrate, dimensions, frame rate, duration and audio properties. The MOV/MP4 shared demuxer is distinguished using its major brand, not the user filename. If stream bitrate is missing, count compressed video packet bytes over duration; do not substitute total audio+video bitrate.
- Non-MP4 input, video above 2.5 Mbps, incompatible codec/pixel format, excessive dimensions, rotation or non-square pixels: normalize with H.264, yuv420p, 2.5 Mbps target/min/max, 5 Mbps VBV buffer, filler, AAC at 128 kbps, fast-start MP4, and at most 1920 by 1080 display pixels. Preserve source timestamps/frame rate and aspect ratio (subject to even-pixel rounding). Smaller display dimensions are not enlarged.
- Compatible MP4/H.264 at or below 2.5 Mbps: copy video packets without re-encoding. Remux for fast-start; copy compatible AAC-LC around 128 kbps or re-encode only audio when necessary. Lower-bitrate originals are not padded/re-encoded merely to reach 2.5 Mbps.
- Audio-free videos remain audio-free. Only the main video and first audio track are selected for playback. Original files retain other tracks.
- MP4 does not support x264's `nal-hrd=cbr` signaling. Use `nal-hrd=vbr:filler=1` with matching target/min/max rates for a tightly controlled 2.5 Mbps video payload. Short intervals/short clips and container/audio overhead mean total file bitrate is not exactly 2.5 Mbps; AAC 128 kbps is an encoder target.
- Fully decode the final MP4, even when video was copied, before publication. Store measured output metadata rather than reporting an encoder target as a measurement.

## Records, visibility and recovery

Migration `20260928100000_video_processing_metadata.sql` stores original probe metadata, conversion action, output audio details and processed size. Existing video codec/bitrate/resolution/frame-rate/duration fields describe the playable output. Owner, name and Public/Private selection remain unchanged.

`storage_path` retains the original; `processed_storage_path` points to the verified MP4. Both use the existing Admin-configured video base path. The existing `serve-media` endpoint serves the processed MP4 and checks access as before. Ready gallery rows are created only after successful processing/publication. No unvalidated processing row is exposed in the public gallery.

Private owner-only job cards show Processing, Ready or Processing Failed. Closing the upload dialog after queueing, navigating away or closing the browser does not stop conversion. A processing failure cannot enable playback. Successful completion refreshes the gallery automatically. Failed source files remain in private staging for troubleshooting; successful originals are retained in video storage. This change does not introduce automatic original-file deletion or a new unconfirmed delete action.

## Deployment and verification status

Deploy schema, worker and frontend together using the existing deployment script. FFmpeg/FFprobe are already installed by the media-worker Dockerfile, so there is no need to install a separate JavaScript codec library or FFmpeg on the host. The worker remains isolated from the web request, with two processing slots.

This revision has not been deployed. TypeScript compilation was checked; no new runtime conversion/browser test run was performed for this revision. The earlier validation report describes the previous processing policy, not proof of the new rate-control/resize/copy behavior.

References: [FFmpeg encoder/muxer options](https://www.ffmpeg.org/ffmpeg-all.html), [scale filter and aspect handling](https://ffmpeg.org/ffmpeg-filters.html), [timestamp/frame-rate options](https://ffmpeg.org/ffmpeg.html).
