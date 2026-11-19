# PDF previews

PDF.js `pdfjs-dist` 6.3.289 uses its compatibility (`legacy`) viewer and matching
worker. PDFs open from File Manager in the existing TaskModal, with vertical page
scrolling, previous/next and page input, fit width, 25–300% zoom, fullscreen,
existing authorized download and explicit Close. Temporary-share PDFs use the same
viewer instead of an iframe. Application/PDF MIME recognition also supports files
without an extension; known non-PDF extensions retain their existing behavior.
Office previews necessarily share the renderer; their conversion pipeline and
other file/image/video behavior remain unchanged.

## Access

- `/functions/v1/file-preview`: bearer session validated with `auth.getUser`, then
  `can_read_user_file` for owner/direct or inherited folder grants. Public opaque
  IDs use `resolve_public_user_file`, which checks current Everyone access.
- `/functions/v1/messenger-media`: existing attachment access RPC verifies group
  membership and checks again before bytes are returned. File Manager currently
  has person/folder/Everyone grants; this change adds no new group sharing model.
- `/functions/v1/temporary-share`: existing hashed token, exact item/subtree,
  expiry, revocation and Trash checks apply separately to metadata and bytes.

The server streams private storage using server-only credentials, no redirects or
signed URLs. Responses are no-store; PDF.js receives already-authorized bytes
directly, without fetching a Blob URL. Saved endpoint URLs are checked again and cannot grant private access.
Already received/downloaded bytes cannot be recalled when access is later revoked.
The existing original download authorization and anonymous download policy remain.

## Rendering and mobile

PDFViewer schedules visible/nearby pages and evicts canvas cache entries (default
10-page buffer, adjusted for visible pages). Page canvases are capped at 2,097,152
pixels and 4096 pixels per dimension; detail canvases retain readable zoom quality.
A 300-page synthetic regression verifies fewer than 20 live canvases after a jump
to page 290. PDFs are not permanently converted to images.

Existing PDF preview size limit is 100 MB. Authorized bytes are buffered before
rendering; this is not streaming/range loading of large private PDFs. Very large
or complex documents can still require substantial memory. Source loading has a
60-second deadline, module loading 30 seconds, and first paint 45 seconds. Failures
show Preview unavailable, Download PDF (where permitted), and Close. Password PDFs
fall back to downloading into a reader. Diagnostic logs contain stage/error type,
never source paths, names, tokens or PDF bytes. PDF scripting, XFA, editable
annotations and external link actions are not enabled.

The viewer fits VisualViewport and safe areas in portrait/landscape, leaves one
finger scrolling native, and supports two-touch PDF zoom. Fullscreen uses the
browser API when available and a viewport-filling fallback on iPhones that lack
element fullscreen. Browser chrome cannot be hidden by that fallback. Existing
modal history/navigation behavior is retained.

## Verification

`tests/pdf-preview-access.mjs` executes actual Edge handlers with real isolated
File Manager permission SQL; Messenger membership responses are deterministic
fixtures (actual membership SQL is covered by the existing group tests).
`tests/temporary-share-server.mjs` checks PDF expiry/revocation before bytes.
`tests/pdf-preview.mjs` exercises real PDF.js and worker rendering in Chromium,
Firefox and WebKit, synthetic 12/300-page PDFs, MIME-only files, page scrolling,
navigation, aspect ratio, zoom, pinch events, native/fallback fullscreen, download,
Close, rotation/toolbar viewport geometry, corrupt/denied inputs, cancelled/stalled
loads, missing viewer module, and expired temporary capabilities. CI runs the suite
in all three engines; existing multi-format preview tests cover Office/photo/text.

Browser profiles are emulation, not physical iPhone/Android tests. Physical iPhone
Safari/FxiOS, Android touch gestures, memory pressure and native download UI still
need device validation. Test reports must distinguish those limits from passing
engine-level regressions. No production private user document is used in fixtures.

The PDF browser suite applies the exact `connect-src` directive extracted from
the production Caddy configuration. This reproduces the original deployment-only
failure: PDF.js fetching a Blob URL violates `connect-src 'self' https: wss:`.
Direct byte input fixes it without broadening the site's security policy.

Local verification on 2026-11-18 passed the full core suite, type-check, lint
(one pre-existing vendored lint warning), production build, zero-vulnerability
dependency audit, desktop Chrome/Edge/Firefox, Chromium/Firefox Android profiles,
and WebKit iPhone Safari/FxiOS profiles. Existing Edge desktop/mobile private and
public multi-format preview regressions also passed. Production deployment and
physical-device validation are separate from these isolated local checks.

Main changed components are `FilePreview`, `PdfFilePreview`,
`PdfPreviewBoundary`, `usePdfPresentation`, and `TemporarySharePage`; scoped PDF
modal CSS and sanitized diagnostics support them. The file-preview and
messenger-media handlers only gain PDF MIME fallback; their existing access
checks are retained. Browser/core runners and CI include the new regressions.
