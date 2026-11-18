# User guide screenshot sources

Guide edition: 17 November 2026. New live screenshots were captured during this
update from the signed-in `https://myhostage.ca/video/` interface. The account was
provided by the user. No uploads were submitted, permissions saved, links created,
notifications enabled, messages sent, or content deleted for the captures.

| File | Source and treatment | PDF section |
| --- | --- | --- |
| `26-live-home.jpg` | Current public video gallery; cropped in the PDF. | 1 |
| `27-live-notifications.jpg` | Current Notifications panel; cropped to exclude profile and account details. | 16 |
| `28-live-group-filter.jpg` | Current gallery with the existing `my` group selected; empty state is intentional. | 15 |
| `29-live-group-upload.jpg` | Current empty upload dialog for `my`; cropped to the dialog and cancelled. | 3 |
| `30-live-sharing.jpg` | Current Share dialog for an existing public video; cropped to exclude the library behind it. Names, email addresses and initials in People are covered with opaque rectangles in the saved image. Cancelled without saving. | 18 |
| `31-live-files.jpg` | Current File Storage; the PDF crops to the toolbar. | 5 |
| `32-live-folder-menu.jpg` | Current menu for the existing EVERYONE folder; cropped to the menu. | 4 |
| `33-live-temporary-link.jpg` | Current initial Temporary Share Link dialog; cropped. No link was created. | 7 |
| `34-demo-iphone-landscape.png` | Existing local WebKit regression capture `.runtime/iphone-idle-webkit-paused.png`, captured 15 November 2026. Demonstration video and simulated iPhone environment; not a physical-device screenshot. | 17 |

Existing redacted Messenger pictures (20-21) and demonstration call pictures
(22-25) are retained and labelled in their captions. Older screenshot files are
preserved as source assets but are not all used by the current PDF. Obsolete
sign-in illustrations were removed from the PDF because the first-login flow
now uses an emailed temporary password.

Rebuild from the repository root with Python containing ReportLab, Pillow and
pypdf: `python tmp/pdfs/build_user_guide_ru.py`. The Russian text source is
`USER_GUIDE_RU.md`; layout, screenshot selection and captions live in the builder.

The English edition reuses the same screenshots and section numbers. Its text
source is `USER_GUIDE_EN.md`; rebuild it with
`python tmp/pdfs/build_user_guide_en.py` to produce
`output/pdf/MyHostage_User_Guide_EN.pdf`. Its captions, headers, footer, metadata,
and bookmarks are in English. The Russian edition is preserved separately.
