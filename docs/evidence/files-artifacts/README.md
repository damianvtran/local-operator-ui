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
a daemon this run owned: three `generate_image` results (two share a producer
name, which is the case that needs the digest tiebreak), one `video_status`
receipt for a real 2 s clip, and one ordinary file the agent wrote.

The app is the BUILT app (`pnpm build`, plain-JS bundle with CI's placeholder
OAuth values), driven headless (`window-mode=headless`, never shown, never
focused) over CDP by `capture-files-view.mjs`, which uses the importable facade of
`scripts/renderer-driver.mjs`. `before/` is `origin/main` (`c7568c77f`); `after/`
is this branch. Both ran the same script against the same daemon and session.

| Frame | Window | Palette |
| --- | --- | --- |
| `files-wide-{dark,light}` | 1380x900 (docked canvas, 560 px) | dark, light |
| `files-narrow-{dark,light}` | 800x800 (overlay canvas, 220 px) | dark, light |
| `after/files-wide-menu-image` | 1380x900 | dark - the row's actions menu on a picture |
| `after/files-wide-viewer-{image,video}` | 1380x900 | dark - the row opened in the canvas |

## Readings (from `*/report-*.json`)

| | rows | thumbnails decoded | rows inside the canvas box |
| --- | --- | --- | --- |
| before, wide | 1 (the `.md` only) | 0 | 1 of 1 |
| after, wide | 5 | 3 (blob:, natural 576x1024 / 576x1024 / 1024x576) | 5 of 5 |
| before, narrow | 1 | 0 | 1 of 1 |
| after, narrow | 5 | 3 | 5 of 5 |

Row boxes are 544x36 wide and 204x36 narrow, the shipped list geometry, so the
new rows add no new height or overflow. The row menu on a picture reads
`Show in canvas / Save as... / Copy image`; on the video it reads `Show in
canvas / Save as...`. Opening a picture in the canvas decodes it (576x1024, a
`blob:` source) with no freshness bar and no "No longer on disk"; opening the
video reaches `readyState 4`, 640x360, 2 s, no media error.

`real-session-9c59d684d16b-before-after.txt` is the same extractor on the
operator's real session (read-only): 0 generated pictures with a row before, 69
of 69 after.

## Not covered by a still

Clipboard and the save dialog are OS surfaces a headless window cannot show: the
menu entries and their routing are asserted (`scripts/mentioned-files.test.mjs`
A10), the bytes they hand over are the same fetch the thumbnail uses, and the
dialog itself is the platform's. That is a live-pass item, not something these
frames claim.
