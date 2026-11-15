`video-frame-edges.mp4` is a three-second, silent H.264 video generated from a
640 x 360 canvas (16:9). It contains no user or third-party media.

The pattern has a white outside border, red/green/blue/yellow corners, labeled
TOP/BOTTOM/LEFT/RIGHT edges and a centered circle. These make clipping and
distortion visible. The canvas was captured at 15 fps using Chromium's
MediaRecorder (`video/mp4;codecs=avc1.42001e`, 1 Mbps).

`tests/iphone-video-layout.mjs` pauses this same source and compares the rendered
playback area with a canvas rendering of the decoded frame at uniform contain
scale. It checks portrait, short landscape, browser-bar-sized viewport changes
and rotation back to portrait in Chromium and WebKit. Only the native playback
controls are hidden during pixel capture, and they are restored immediately
afterward. Presentation and interaction regressions run separately with controls
enabled.
