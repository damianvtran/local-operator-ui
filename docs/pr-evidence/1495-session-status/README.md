# Session status marks: blocked input versus failure

`ChatSessionStatus` drew the two blocking-input states, `approval` and `answer`,
with `CircleAlert` in `text-warning` — the same silhouette the `error` state uses
in `text-danger`. Waiting for the operator and something having failed were
therefore separated by colour alone.

Both blocking-input states now use `MessageCircleQuestion` in `text-warning`.
`error` keeps `CircleAlert` in `text-danger`. The mark is 16px in every row
before and after, and the sidebar rows and the recent-session switcher inherit
the change through the same component.

## State matrix

| State | 16px mark | Acknowledgement |
| --- | --- | --- |
| Running (`busy`) | spinning `LoaderCircle`, `text-accent` | unchanged |
| Clean completion, unseen | `Check`, `text-success`, `unread` in the accessible name | the check and the name clear on acknowledgement |
| Clean completion, read | `Circle`, `text-ink-dim` | unchanged |
| Blocked on approval | `MessageCircleQuestion`, `text-warning` | identical before and after |
| Blocked on answer | `MessageCircleQuestion`, `text-warning` | identical before and after |
| Error | `CircleAlert`, `text-danger` | existing icon and ink retained, unread naming unchanged |

No new state, badge, glow, palette, background or user-facing copy is involved.

## Frames

Eight frames: two stories, two themes, one tree before the change and one after.

- `before/neighbours/localOperator{Light,Dark}.webp` and
  `after/neighbours/localOperator{Light,Dark}.webp` — the 860px specimen. The
  story opens with the unread `error` row and the wedged row, then the full
  read/unread matrix in two columns. This is where the separation is visible:
  `approval` and `answer` beside `error` in one frame.
- `before/amber-class/localOperator{Light,Dark}.webp` and
  `after/amber-class/localOperator{Light,Dark}.webp` — the 520px one-column
  comparison of the four marks a reader meets in one list: approval,
  interrupted, not answering, failed. Each row is captioned with the icon it
  draws, and the approval caption names its icon, so that caption reads
  `CircleAlert, warning` in the before frame and `MessageCircleQuestion, warning`
  in the after one.

The stored frames are 860×752 for `neighbours` and 520×332 for `amber-class`.

## Measured

Contrast of the two inks over `surface`, computed from the palettes in
`src/renderer/src/shared/themes/palettes/local-operator.ts` with the WCAG
relative-luminance formula. `surface` is `#2b2721` in `localOperatorDark` and
`#f7f5ee` in `localOperatorLight`.

| Token | Dark | Light |
| --- | --- | --- |
| `warning` (`#e0b04b` dark, `#8a5800` light) | 7.41:1 | 5.54:1 |
| `danger` (`#ef8078` dark, `#b23a31` light) | 5.67:1 | 5.43:1 |

Both inks clear 4.5:1 against the ground the marks sit on, in both themes.

Pixel delta between the two trees, per pair of frames. These are two independent
captures of a lossy format, so a small nonzero delta appears across most of the
image; the columns count pixels whose largest per-channel delta clears a
threshold.

| Pair | Any delta | > 8 | > 16 | Bounding box at > 16 |
| --- | --- | --- | --- | --- |
| `neighbours`, light | 10,089 | 992 | 714 | x 40–454, y 228–541 |
| `neighbours`, dark | 19,628 | 1,044 | 682 | x 40–454, y 228–541 |
| `amber-class`, light | 14,569 | 1,459 | 1,161 | x 40–324, y 52–78 |
| `amber-class`, dark | 16,656 | 1,447 | 1,130 | x 40–324, y 52–129 |

At a 16/255 threshold the `neighbours` delta is confined to three horizontal
bands — y 228–243, 476–491 and 525–540 — which are the `answer — unread` /
`approval — unread` row, `answer — read` and `approval — read`: one glyph each,
with the rest of the matrix unchanged. In `amber-class` the same threshold
leaves the approval row alone (y 52–78); the dark pair carries one further pixel
at y 129, the boundary of the next row.

## Reproducing

Both stories are captured through the repository's own Storybook path, which
boots the server, runs the capture and reaps the server's process group:

```sh
node scripts/with-storybook.mjs -- node scripts/capture-evidence.mjs "$STORYBOOK_ORIGIN" \
  --only=chat-session-status \
  --dirs=neighbours,amber-class \
  --themes=localOperatorLight,localOperatorDark \
  --theme-settle-ms=120000
```

`$STORYBOOK_ORIGIN` is set by `scripts/with-storybook.mjs` for the command it
wraps. `--only` and `--dirs` intersect, so the run takes these two stories and
nothing else; `--theme-settle-ms` raises the theme-settle budget from its 10s
default, which a cold Storybook overruns on its first page load. The capture
writes `docs/evidence-frames/chat-session-status/{neighbours,amber-class}/<theme>.webp`
(the ignored frames tree) and records a `partialCapture` entry in the tracked
`docs/evidence/manifest.json`; a regenerating run should restore the manifest
before committing anything.

The before frames were taken from `origin/main` at
`46702fae6efe54db83608088f02103ac2d51c865`, the after frames from
`1f3cd9bb3696a4fbffa0f8b2d5351e33cb65ed14`. The two trees differ in
`src/renderer/src/features/chat/components/chat-session-status.tsx` (the icon
mapping, whose comments record the token roles), in the one `amber-class`
caption line that names its icon, and in the test's icon assertions. Both runs
used the machine's installed Chrome, the same stories, themes and viewports.
