# Team Bridge inline images: evidence

Images in a Team Bridge message used to sit in a bordered card with a "File"
caption and an "N bytes" line. They now render inline, as Slack and Discord
show them. The spec is the Team Bridge visual refresh design spec §3.1
(finding D1).

## How the frames were made

- **Instrument:** the harness `browser` tool (the desktop app's browser host, one
  tab) on this worktree's Storybook. The Storybook was booted with
  `node scripts/with-storybook.mjs --port 6071`, and frames were taken at a
  2560x1440 device size with `&full=1&nav=0&panel=0&args=theme:<theme>`.
- **Before vs after:** one Storybook served both. For the "before" run, the four
  production files (`attachment-model.ts`, `bridge-attachment-group.tsx`,
  `audit-attachment-group.tsx`, `team-bridge-attachments.tsx`) were set to
  `origin/main`'s bytes (`git show origin/main:<file>`) and HMR reloaded them. The
  stories file kept this branch's version, so the new stories (three, six,
  panorama, file chips) also show their before state. The branch sources were
  restored afterwards (`git checkout`).
- **Pairs:** `*-before-after-<theme>.webp` has origin/main on the left and this
  branch on the right. The Storybook toolbar is cropped, the pair is scaled to
  50%, and it is encoded with `cwebp -q 82`.
- **Hover:** `attachments--bubble-one-image-hover-actions-radient.webp` is the
  Open/Save cluster that appears on pointer hover over a ready image.

## Stories, in `localOperatorDark` and `radient`

| Story | What it shows |
| --- | --- |
| Bubble one image | one picture at its own ratio, no border and no caption |
| Bubble four images | a 2x2 grid of square crops with a 4px gutter, one 10px outer corner |
| Bubble three images | the first image spans both rows and the other two stack |
| Bubble six images | 2x2, and the fourth tile reads `+2`; the lightbox walks all six |
| Bubble panorama | a 4.5:1 picture letterboxed on `media-surface` |
| Bubble file chips | S3b files as borderless chips (`PDF · 2.4 MB`, an unavailable one) |
| Bubble loading held | reserved boxes pulsing; the picture glyph appears after 1 s |
| Bubble placeholders | expired, deleted, withheld and failed tiles (same box, no border) |
| Member terminal refusals | 401/403/404 failure tiles in the 3-up grid |
| Wide chips | the composer strip (unchanged; context) |
| Narrow thread | the 280px compact group in the thread pane |
| Narrow four-image grid | the grid at an 800px window |
| Shared cards: mixed compact | images and six file chips at compact width |
| Shared cards: files | file chips alone |
| Owner audit: preview + metadata | the audit view drawing the same tile, without Save |

## No layout shift on ready

The `PendingToReady` and `PendingToReadyCompact` stories were each captured before
and after "Release synthetic preview bytes" was pressed, then compared with
`magick compare` on the binary diff mask. In both, the only changed regions are the
image box and the focused release button. The following message's band did not
change.
