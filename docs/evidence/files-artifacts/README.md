# Generated media in the canvas Files view - rendered before/after

The bug: images and videos the agent generates (`generate_image`,
`generate_video`) never appeared in the canvas **Files** view. They live in the
attachment store behind a digest; the transcript carries no path, and the view
was built on paths. Design: `docs/design/canvas-files-list.md`, "Generated media
is a row too".

## What is photographed

One session, seeded through the harness's own code paths
(`seed_generated_artifacts.py`: `cache_media` for the bytes,
`Transcript.append_message` for the rows) into an ISOLATED config root served by
a daemon this run owned:

- three `generate_image` results (two share a producer name, which is the case
  that needs the digest tiebreak);
- one video, delivered the way a detached `generate_video` job really delivers
  it: a `job_result` custom row built by the backend's own
  `Session._job_result_message` (round 1 of review found the first seed used a
  `video_status` tool row, which is not how a video normally arrives);
- a white picture whose pixels match the light list ground, and a picture whose
  bytes were deleted from the store after registering (its digest 404s);
- one ordinary file the agent wrote.

The app is the BUILT app (`pnpm build`, plain-JS bundle with CI's placeholder
OAuth values), driven headless (`window-mode=headless`, never shown, never
focused) over CDP by `capture-files-view.mjs`, which uses the importable facade of
`scripts/renderer-driver.mjs`. `before/` is `origin/main` (`c7568c77f`); `after/`
is this branch. Both ran the same script against the SAME daemon and the SAME
re-seeded session, so the pair differs only in the tree under test.

| Frame | Window | Palette |
| --- | --- | --- |
| `files-wide-{dark,light}` | 1380x900 (docked canvas, 560 px) | dark, light |
| `files-dock400-{dark,light}` | 1184x800 (docked canvas, 400 px: the design doc's width of interest) | dark, light |
| `files-narrow-{dark,light}` | 800x800 (OVERLAY canvas, 220 px) | dark, light |
| `after/files-wide-retrying-{dark,light}` | 1380x900, photographed ~1 s after opening | the skeleton a missing digest shows while the thumbnail retries |
| `after/files-wide-viewer-gone-dark` | 1380x900 | the gone picture opened: "This image is no longer in the session" |
| `after/files-wide-viewer-image-light` | 1380x900 | a 576x1024 picture opened (tall-image fit) |
| `after/files-wide-tabs-light` | 1380x900 | the two same-named pictures open as tabs |
| `after/files-wide-menu-image`, `files-wide-viewer-{image,video}` | 1380x900 | row menu; the row opened in the canvas |

## Readings (from `*/report-*.json`, dark and light identical)

| | rows | thumbnails decoded | rows inside the canvas box | row box |
| --- | --- | --- | --- | --- |
| before, wide / 400 / narrow | 1 (the `.md` only) | 0 | 1 of 1 | 544x36 / 384x36 / 204x36 |
| after, wide | 7 | 4 (3 pictures + the white one) | 7 of 7 | 544x36 |
| after, 400 px dock | 7 | 4 | 7 of 7 | 384x36 |
| after, narrow overlay | 7 | 4 | 7 of 7 | 204x36 |

The video row and the `.md` show a type glyph; the gone picture settles on a
glyph after its two retries (the frames are taken after the wait).

Round 1 remediation, measured here:

- **Tall picture (design D1).** The 576x1024 picture in the viewer at 1380x900:
  `<img>` top 146, bottom 900, dock bottom 900 (`report-wide.json`
  `states.tallViewer`, `imgInsideDock: true`). The design review measured the
  old tree's bottom at 973 against 900 (not re-measured here).
- **Thumbnail edge (design D2).** White picture, light palette, device pixels
  across the thumbnail's left edge: list ground (247,245,239), picture
  (252,251,249), edge pixel (217,213,204): an edge distinct from both. (The
  design review measured the un-edged thumbnail at 1.09:1 against the ground;
  this folder has no before frame of it, because the `before/` tree draws no
  thumbnails at all.)
- **Same-name tabs (UX U2 / QA Q1).** Tab labels read `fixture-model-01.jpg .
  0466de15` and `fixture-model-01.jpg . 412b2a3d`; their tooltips read `<name> .
  <head> . Generated image, kept in this session` (`states.tabs`).
- **Gone picture (UX U3).** The viewer reads "This image is no longer in the
  session" (`states.goneViewer`).

`real-session-proof.mjs` is the extractor run on the operator's real session
`9c59d684d16b` (read-only; it opens the transcript and writes nothing).
`real-session-9c59d684d16b-before-after.txt` is its output on the `origin/main`
tree and on this branch: 0 of 69 generated pictures with a row before, 69 of 69
after, and the two `.bin` path tiles gone. **It is an images-only figure**: no
session on the operator's machine holds a real `Video ready` completion row, so
the video claim rests on the fixture rows the backend's own builder wrote
(`scripts/fixtures/files-artifact-rows.json`) and on the rendered video above.

## Not covered by a still

Clipboard and the save dialog are OS surfaces a headless window cannot show: the
menu entries and their routing are asserted (`scripts/mentioned-files.test.mjs`
A10) and the bytes they hand over come from the same fetch the thumbnail uses
(`scripts/attachment-url.test.mjs`), but the dialog itself and a >10 MB save are
a live-pass item, not something these frames claim. A separate headless retry probe restored the gone digest's bytes after the
retrying dark frame was emitted (same mounted Files view, no view toggle): the
settled row decoded at 480x480 with a blob source in both palettes. The first
probe used a wrong destination (metadata has no name) and did not recover; the
second used the digest read from its sidecar and did. This proves recovery
within the bounded retry window, not an outage-length timing sweep.
