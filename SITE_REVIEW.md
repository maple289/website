# Site review — September 30, 2026

## Scope and checks

Reviewed the deployed site at https://myhostage.ca/video/ as a guest, at desktop
(1440 × 1000), tablet (768 × 1024), phone portrait (390 × 844), and phone landscape
(844 × 390) sizes. Inspected the frontend source, authentication/settings components,
and existing file/gallery loading code. No registrations, emails, uploads, account
changes, reactions, or deletions were submitted. No application fixes were deployed
as part of this review.

Authenticated Settings, Admin, uploads, and private libraries were inspected in
source only; their live workflows were not tested in this review. This is a UI and
code review, not a complete security or cross-browser audit. Physical touch/swipe
gestures and the mobile software keyboard were not tested.

Checks that passed:

- TypeScript application check: no errors.
- No browser console errors/warnings captured during the public browsing checks.
- Public video played with no media error and a ready state of 4.
- Public photo originals loaded; Next changed the current photo from the first
  image to Family, following the gallery order.
- Public Files remained read-only, with no upload or management controls visible.
- Opening the Everyone folder and using browser Back returned to the public root.
- Grid/List/Tree controls were present and switched their selected state. The only
  public folder available during the review was empty, so a populated lazy tree
  could not be verified.
- Search produced an appropriate no-matching-photos message.
- Registration remained open on Escape. Its landscape form was scrollable, and
  its Close button remained accessible.
- No horizontal page overflow was observed in the checked public phone layout.

## Findings, in priority order

### 1. Public Photos does not have a stable URL/history entry — confirmed live

Selecting Photos leaves the URL at `/video/`. Refresh returns to Discover videos.
Public Videos/Photos are React state (`homeTab`) rather than separate history
locations. Browser history consequently cannot represent transitions between the
two public sections, and a shared link cannot select Public Photos.

Relevant code: `src/App.tsx:56`, `src/App.tsx:91`.

Recommendation: give each public section a distinct route, derive the active tab
from that route, and retain the existing separate private-library routes. Restore
the selected gallery/viewer consistently on Back, Forward, and reload.

### 2. Video player title has very low contrast — confirmed live

The Big Boom title inherits `rgb(34,51,72)` from `.media-page`, while the player
surface is `rgb(10,10,10)`. The measured contrast is approximately **1.54:1**.
This makes the title almost invisible. Gallery metadata is 11px, `#758497` on white,
approximately **3.82:1**, which is below the 4.5:1 criterion for ordinary text.

Relevant code: `src/components/VideoPlayer.tsx:54`,
`src/components/MediaGallery.css:22`.

Recommendation: explicitly pair viewer foreground/background colors; use a bright
title in the dark player. Darken gallery metadata and increase it to 12–13px.
Do not apply a foreground color from one surface to a different surface.

Reference: [WCAG text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

### 3. Mobile search covers the media tabs — confirmed live

At 390px width, the expanded search panel occupied roughly y=72–140.5, while
Videos/Photos/Files occupied y=88–140.5. The search panel completely covered those
tabs. Main content is not offset when the extra fixed search row opens.

Relevant code: `src/App.tsx:173`, `src/App.tsx:198`.

Recommendation: reserve space for the expanded row, or keep search within a
responsive toolbar. Keep the section navigation visible and reachable.

### 4. Photo viewer briefly reports failure during normal loading — confirmed live/source

Opening a valid photo initially showed “Unable to load photo.” The image then
loaded successfully. `ViewerPhoto` supplies that error as the fallback to
`StorageImage`, which also uses it while obtaining the signed URL.

Relevant code: `src/components/PhotoViewer.tsx:16`,
`src/components/StorageImage.tsx:11`.

Recommendation: separate loading, loaded, and failed states. Use a neutral skeleton
or Loading photo indicator until a genuine request/decoding failure occurs; provide
Retry for genuine failures. Retain the preview fallback for non-browser image formats.

### 5. Some controls are placeholders — confirmed in source

Notifications has no handler and always shows a red indicator. Your channel in
AccountMenu has no handler. These controls imply working features.

Relevant code: `src/App.tsx:165`, `src/components/AccountMenu.tsx:53`.

Recommendation: implement their destinations/states, or remove the inactive controls
until implemented. Never show an unread notification indicator without unread data.

### 6. Public gallery failures can look like an empty library — confirmed in source

The public video loader ignores the error except for skipping the data update.
The photo loader discards the error entirely and sets the data to an empty list.
Consequently, failed requests can produce “No public videos/photos” or stale content
instead of explaining a loading failure.

Relevant code: `src/components/HomePage.tsx:25`,
`src/components/PublicPhotoGallery.tsx:17`.

Recommendation: display a safe loading error with Retry, preserve previously loaded
items on a refresh failure, and distinguish no content from unavailable content.

### 7. Gallery loading has no explicit pagination — confirmed in source

Public and personal galleries request all matching rows, then filter in the browser.
The video galleries repeatedly load the full collection at 5/15-second intervals.
There is no explicit range/cursor for gallery records. Large libraries may be costly
to load/search, and the API's row cap may prevent later items from appearing.

Relevant code: `src/components/HomePage.tsx:25`,
`src/components/PublicPhotoGallery.tsx:17`, `src/components/VideoLibrary.tsx:35`,
`src/components/PhotoLibrary.tsx:37`.

Recommendation: add server-side search and cursor pagination using the existing
permission-filtered APIs. Poll only processing items or update changed records.
File Manager already has server-side recursive search and paged result loading;
reuse that architectural approach rather than replacing it.

### 8. Brand, search scope, and action labels are inconsistent — confirmed live/source

- Header says Videos, sign-in says Streamly, and email/site identity is MyHostage.
- Mobile search says “videos, photos, and files” but filters the current section.
- Files has both the header search and the File Manager search, bound to the same
  value, making their relationship unclear.
- Files footer says “1 items” while its heading correctly says “1 item”.
- The signed-out mobile account button and video player's X have no accessible
  name. The File Manager search's accessible name is the shortcut “⌘ K”.

Relevant code: `src/App.tsx:143`, `src/components/AuthModal.tsx:182`,
`src/components/AccountMenu.tsx:25`, `src/components/VideoPlayer.tsx:55`,
`src/components/FileManager.tsx:601`, `src/components/FileManager.tsx:615`.

Recommendation: use MyHostage consistently, a context-specific search label,
one clear search entry per scope, proper singular/plural counts, and accessible
names for every icon action. Make the brand a Home link.

### 9. Full owner email addresses are displayed to guests — confirmed live

Public video and photo captions show the owner's full email address. This is not
needed to browse or identify the media, and it exposes contact information.

Relevant code: `src/components/MediaVideoCard.tsx:39`,
`src/components/PublicPhotoGallery.tsx:43`.

Recommendation: show a display name using the current profile, with an appropriate
fallback, and review the public API fields so the full email is not simply hidden
in the UI while still returned unnecessarily. Preserve ownership and authorization.

### 10. Lint is not clean — verified

Production source has one lint error (an unnecessary regex escape in
`supabase/functions/storage-settings/index.ts:30`) and two warnings (VideoPlayer
effect dependencies and AuthContext fast-refresh exports). The full repository
run had nine errors/eight warnings including ignored-runtime/test harness files.
These counts are not nine production failures.

Recommendation: correct the production lint issue, address the effect dependency,
and explicitly exclude `.runtime` from lint. Keep tests typed instead of silencing
their diagnostics indiscriminately.

## Recommended visual direction: Fluent Gallery

Keep the existing compact cards, familiar controls, yellow folder icons, and
separate Public Library / My Library scopes. Improve consistency with shared
colors, spacing, typography, and focus states rather than changing the underlying
file-management or permission behavior.

| Element | Proposed treatment |
| --- | --- |
| Background | Subtle `#F7F9FC` → `#EEF3F8` gradient |
| Surface | White cards and toolbars, fine `#E2E8F0` borders |
| Header | Restrained navy `#0F2344`; MyHostage identity |
| Main text | `#223348`; 14–15px card titles, 16px form text |
| Secondary text | `#52657A`; 12–13px, sufficient contrast |
| Primary action | Blue `#2563EB`, shared across navigation/forms/uploads |
| Destructive action | Red reserved for delete/error states |
| Shape | Consistent 12–16px corner radii; minimal shadows |
| Motion | 150–180ms; honor reduced-motion settings |

### Gallery and navigation

- One persistent Videos / Photos / Files navigation row with a clear active section.
- Label public pages Public Library and personal pages My Videos / My Photos /
  File Storage. Keep their purposes distinct.
- Align the heading and small Public Library subtitle on the left, instead of the
  current heading on the far right of a mostly empty toolbar.
- Give actual Search / Sort / Filter / Upload controls a consistent toolbar;
  retain touch access and existing actions.
- Keep thumbnails dominant; use one compact metadata row and a small reaction row.
- Show Processing / Failed prominently. A small ready check is enough after
  completion; avoid repeating Public + Ready labels everywhere unnecessarily.
- Offer a compact/comfortable gallery density choice. Portrait images can use a
  photo-focused layout without losing the full image in the viewer.

### Forms, viewers, and File Manager

- Give task forms the same light surface, typography, and primary action treatment
  as the galleries. Keep the actual video/photo viewing canvas dark and legible.
- Preserve explicit closing, dirty-draft protection, focus trapping, and deletion
  confirmation. Visual changes must not change these protections.
- Keep filename/count and relevant actions visible in viewers; consider access to
  existing Download/Edit options for permitted users without covering the image.
- Make the Files navigation surface match Videos/Photos. Keep its compact grid,
  list/tree views, and yellow folders.
- Reduce visual competition between the global sidebar and File Manager navigation
  using a shared spacing/grid system, while retaining all existing destinations.
- Use about 44px comfortable touch targets as a design target. WCAG's minimum
  target criterion is 24 × 24 CSS pixels or its specified spacing exceptions.

Reference: [WCAG target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

## Suggested order of work

1. Fix public routing, mobile search overlap, player contrast, and photo loading state.
2. Correct error states, inactive controls, accessible labels, and public owner captions.
3. Unify branding/colors/toolbar/cards and retain all modal/deletion safeguards.
4. Add paginated media loading/search and improve polling efficiency.

The accompanying visual concepts use schematic media placeholders, not changes to
the production site. Fluent Gallery is the recommended default; Photo Focus shows
an alternative gallery layout with more emphasis on the images.


## Fluent Gallery implementation — October 1, 2026

Implemented the selected visual direction in the existing application:

- Shared navy header, MyHostage branding/favicon, light sidebar and surfaces,
  blue primary actions, clearer metadata and keyboard focus states.
- Persistent public Videos/Photos/Files navigation, with separate public-video
  and public-photo URLs. Refresh and Back/Forward retain the selected section.
- Responsive gallery toolbar with actual sorting, privacy filtering in personal
  libraries, and compact/comfortable density. Viewer order follows gallery sorting.
- Consistent light registration, upload/edit, Settings and Admin surfaces; dark
  media canvases retain readable titles and explicit Close controls.
- Reserved space for mobile search, context-specific search labels, a single Files
  search field, accessible sign-in/player/search labels and correct item plurals.
- Genuine gallery loading errors with Retry and no misleading empty-state message.
  Photo signing/loading is separate from failure; viewers provide Retry.
- Removed inactive notifications, linked My Videos from the account menu, and
  removed full owner-email captions from public cards.
- Stopped idle full-video polling after items are Ready. Processing polling and
  the existing background-job refresh events remain in use.
- Corrected the production regex lint issue, excluded ignored runtime files from
  lint, and typed the upload/processing regression harnesses.

Verification:

- Application TypeScript check and production build pass.
- Repository lint has no errors; the existing AuthContext fast-refresh warning remains.
- Public navigation checks pass at 1440, 768 and 375px, including personal-to-public
  transitions, Back/Forward, guest access, refresh persistence and error/Retry cases.
- All 29 Settings/history/draft checks pass with the shared theme loaded.
- All 55 upload validation/batch/drag-and-drop checks pass using mocked APIs.
- Registration feedback checks pass at desktop/tablet/phone sizes; failed-processing
  card deletion controls retain explicit confirmation at all three widths.
- Visual checks use the existing public media API in a local preview: video plays
  without a media error (readyState 4); photo navigation follows alphabetical sorting;
  outside taps and Escape do not dismiss registration; public Files remains read-only.

Remaining follow-up work from the audit: server-side gallery pagination/search,
minimizing public API fields (email captions are removed, but existing table APIs
still expose their permitted row fields), and splitting the large application bundle.
These backend/API changes are outside this visual implementation. Physical touch
hardware and authenticated production Admin workflows have not been exercised.


### Deployment

Deployed to https://myhostage.ca/video/ on October 1, 2026. The production container
build passed TypeScript and Vite compilation. Source files were checked against
local Git baselines before copying, with a recovery copy saved at
`/srv/streamly/fluent-design-backup-20261001-1790852413`.

Live public Photos retained its route and gallery density after refresh. All six
photo previews decoded successfully and no browser console errors/warnings were
captured. Mobile search leaves Videos/Photos/Files fully accessible. The existing
Supabase permissions, upload/conversion workers and email configuration were retained.
The changes are deployed but remain uncommitted in the project checkout.
