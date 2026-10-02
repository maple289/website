# Files previews

The existing Files menu and opening behavior use `FilePreview`, inside TaskModal.
Preview closes explicitly, retains the folder/view, and leaves Download available.
Unsupported types open basic information without downloading their content.
Existing video preview behavior is preserved.

## Formats and limits

| Format | Rendering | Source limit |
| --- | --- | --- |
| PDF | PDF.js with multipage scrolling, zoom and selectable text | 100 MB |
| JPG/JPEG, PNG, GIF, WebP | Aspect-ratio-preserving image | 50 MB |
| TXT, JSON, XML | Escaped plain text; JSON formatted when valid | 2 MB |
| CSV | Read-only table; quoted commas/newlines supported | 2 MB |
| DOCX | LibreOffice Writer → cached PDF | 25 MB |
| XLSX | LibreOffice Calc → cached PDF | 20 MB |
| PPTX | LibreOffice Impress → cached PDF | 25 MB |

Office previews contain at most 200 pages. CSV displays at most 200 rows,
50 columns and 2,000 characters per cell; the original download retains all data.
UTF-8 and BOM-marked UTF-16 text are supported. XML is never executed or parsed
as a browser document. CSV cells never execute formulas or HTML.

## Authorization and caching

`file-preview` checks the original on every status/content request:

- An authenticated path uses the existing `can_read_user_file` permission RPC.
- A public opaque ID uses `resolve_public_user_file`, checking current Everyone
  inheritance and Trash rules without exposing private parent/storage paths.
- The private `file-previews` bucket and job/cleanup tables are server-only.
  No signed URL or public static route grants access to cached PDFs.
- Only an authorized request can enqueue a job. Duplicate/concurrent requests
  reuse one source-version job. A failed job is retained, so opening it repeatedly
  does not continuously reconvert a broken document.

Cache identity includes the Storage object ID, version and modification timestamp.
Storage changes/deletion, metadata moves/Trash/replacement, and successful account
deletion invalidate jobs. Cleanup runs approximately every 10 seconds through the
Storage API; failures remain queued. Reconciliation removes orphaned cache objects
older than five minutes, including uploads left by an interrupted worker.
Account deletion continues to follow the existing original-storage policy.

## Worker deployment and protection

`scripts/deploy.sh` builds/starts `file-preview-worker` with the existing Supabase
stack. LibreOffice Writer, Calc and Impress are installed in its container on the
Ubuntu VM; Microsoft Office and an unrestricted host LibreOffice service are not
required. Conversion follows LibreOffice's documented
[headless conversion interface](https://help.libreoffice.org/latest/en-GB/text/shared/guide/start_parameters.html).

The database claim RPC and worker both enforce one Office conversion at a time.
Video/photo workers run independently. Queue limits are 200 overall and 20 per
source owner. The worker has a 2 GB memory limit, one CPU, 128 processes and bounded
temporary storage. Each conversion has a 120-second wall-clock limit, CPU/output
limits, its own writable profile, and a read-only source copy.

The coordinator keeps credentials. The document decoder runs under a separate
unprivileged UID, inherits no credentials, cannot read the coordinator environment,
and has IPv4/IPv6 sockets and process-group escape denied by seccomp. Macros, embedded objects, external
resources/data, malformed packages and archive traversal are rejected. ZIP limits
are 10,000 entries, 100 MB expanded, and 30 MB per entry. Workbooks are limited to
100 sheets and 200,000 cells. LibreOffice subprocess diagnostics remain server-side.
No source document is altered; incomplete PDFs/profiles are removed on failure,
timeout, cancellation or source invalidation.

The UI polls generating previews every two seconds while visible, cancels on
Close, and stops after five minutes. It reports failure/limits while preserving
the original Download action. Generated PDFs use the same PDF.js viewer as PDFs.
The PDF viewer is loaded only when needed and uses a background web worker,
visible-page rendering and bounded canvas caching. Document scripting, XFA and
editable annotations are disabled. Its bundled font/CMap/WASM assets are copied
by the build script; they contain no user documents or cached previews.

## Verification

- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json`
- `node node_modules/vite/bin/vite.js build`
- Start `node tests/file-previews-server.mjs`, then run
  `node tests/file-previews.mjs` with Playwright installed (or `PLAYWRIGHT_MODULE`
  pointing to the bundled runtime). This uses a fake backend, never production.
- `tests/file-preview-backend.py` runs in the deployed worker with disposable
  documents and two isolated users, testing real conversion, authorization,
  sharing/revocation, caching, replacement/deletion, limits and account cleanup.
  `TEST_ANON_KEY` comes from server configuration; no credentials are printed.
- `tests/file-preview-worker.py` runs as the decoder UID in the worker image to
  check malformed/macro/external/oversized packages and network/credential isolation.

Browser checks cover desktop, tablet, and mobile portrait/landscape emulation;
physical iOS/Android device behavior is not implied by those checks.

Initial verification passed 40 real backend checks, 12 decoder isolation checks,
and 32 browser groups across public/private desktop, tablet, and mobile views.
