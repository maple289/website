Both playback-ended clips contain three seconds of silent test imagery, derived
from the existing media-valid.jpg fixture. They contain no user media. VP8/WebM
works in Chromium/Firefox CI; H.264/MP4 is used for Windows WebKit playback.

To regenerate with a full FFmpeg build, from this directory:

```sh
ffmpeg -loop 1 -i media-valid.jpg -t 3 -vf scale=160:90 -an -c:v libvpx -pix_fmt yuv420p -y playback-ended.webm
ffmpeg -loop 1 -i media-valid.jpg -t 3 -vf scale=160:90 -an -c:v libx264 -pix_fmt yuv420p -movflags +faststart -y playback-ended.mp4
```

Tests wait for real media events; fixture duration is not used to schedule player
closure. File contents do not need to be byte-identical after regeneration.
