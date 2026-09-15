# The `/move` chip: real-browser frames

Fifteen frames in eleven states across three themes, of the composer's
working-directory chip, captured with the Local **`browser` tool** and looked at
one by one before being committed here. The set's own entry in
`docs/evidence/manifest.json` carries the same arithmetic (`frames: 15`,
`surfaces: 11`, `themes: 3`), which is the source a reader should trust over any
sentence here (agent review round 3, R3-2).

## Why this set exists, and why it is separate

The branch's earlier `chat-cwd-move` / `chat-move-picker` frames were withdrawn:
they were taken by a **scripted CDP browser** (`scripts/capture-evidence.mjs`), which
is not an acceptable method for this feature's visual evidence, and they photographed
the pre-remediation control. `scripts/capture-evidence.mjs` carries that note at the
`/move` entry it no longer declares and names this directory as where the replacement
belongs.

So these are **not swept frames** and must not be read as one: they are a declared
`supplementary` set in `docs/evidence/manifest.json`, taken once, by hand, through the
operator's own browser. Running the sweep will not regenerate them, and the sweep's
own count (`countsMean.frames`) excludes them on purpose.

## Method

```
cd ~/local-operator-ui-worktrees/cwd-move
env -u CMUX_* -u LOP_* HOME=/tmp/cwd-ev/home \
    pnpm exec storybook dev -p 6113 --no-open --quiet
# then, with the browser tool, one story at a time:
http://localhost:6113/iframe.html?id=<story-id>&viewMode=story&args=theme:<theme>
```

Per frame: navigate, wait for the story to mount and its `play` (where there is one)
to run, force a repaint, screenshot, then **look at the image** and check it against
the filename before keeping it. `Page`-level capture of a background tab can return a
pre-paint frame; the repaint step above is what makes the difference between a picture
of the chip and a picture of the ground. The device pixels are 2880 x 1634 (a 1440 x
817 CSS viewport at 2x) and the files are lossless WebP, the same convention as
`chat-cold-send-browser`.

Story ids: `chat-cwd-move--<state>` (this branch's own story file) and
`chat-message-input--cwd-chip-in-row` (added in this round; see below).

## What each frame is, and what it shows

| Directory | Story | What the picture shows |
| --- | --- | --- |
| `editable/` | `--editable`, light | The settled chip: folder glyph, `Working directory:`, a 16ch path column ellipsising `~/src/project`, the at-rest chevron. The BEFORE for every other frame here. |
| `pending/` | `--pending`, light + dark + `dracula` | A move in flight, with the backend's acceptance (the story passes it): the folder glyph is replaced by the app's `Spinner` (accent quadrant visible in the ring) and the **label slot reads `Moving session:`**, with the destination still legible in its own column. Tooltip: `Restarting this session's runtime…`. This is D11 answered in pixels — words at rest, not only on hover — and the ring is the D2 cue. |
| `pending-before-receipt/` | `--pending-moving`, light | The same state **before** the receipt: identical spinner and label, tooltip `Moving to ~/Downloads…`. The pair is the U3(r2) fix visible: the restart claim is not made until the backend makes it true. |
| `refused-settled/` | `--refused-settled`, light | The chip after a refusal revoked the value it was painting: no ring, no in-flight words, the path back to the directory the session is really in. D14's frame, which had none. |
| `grown-path/` | `--grown-path`, light + dark + `dracula` | The regression R-1 is about: the story mounts at a 13-character path and GROWS it after mount, and the tooltip is shown revealing **the full new path** plus the cost sentence. Measured once per mount this hover said `Click to change the working directory` and hid the path the chip was ellipsising. |
| `truncated-path/` | `--truncated-path`, light | The same tooltip carrying both facts — full path, then `Click to change the working directory. A running session's runtime restarts there.` — at mount, which is what U2(r2) asked for (the cost sentence used to be suppressed exactly when the path was hidden). |
| `menu-open-narrow/` | `--menu-open-narrow`, light | The chip's menu (the bare `/move` form's landing) at a **360px** chat column. The chip in this frame is the narrow variant — glyph, path, chevron, no label — which is D12: the story used to render the >=900px chip because the container name sat on the outer box, so it could not photograph the case it is titled for. |
| `unset/` | `--unset`, light | `No working directory set` — the empty state of the same chip. |
| `readonly-older-backend/` | `--readonly-older-backend`, light | The degraded chip: dim ink, no chevron, and the tooltip `This backend cannot move a live session. Start a new chat to use a different folder, or update the backend.` The only frame a user on an older backend ever sees, and BLOCKED in round 2. |
| `readonly-starting/` | `--readonly-starting`, light | The admission-window chip: `This session is still starting. Its working directory can be moved as soon as it is live.` The promise R-3 requires the typed form to keep. |
| `composed-row/` | `chat-message-input--cwd-chip-in-row`, light | The chip **inside the composed composer row** at a 1024px column and at the 240px floor, in one picture: D13's missing frame. At 1024px the chip carries label, path and chevron; at 240px the container query suppresses the text and the row still lays out with the glyph and chevron. |

## Honest limits of this set

- **Three themes of twelve.** Everything here is `localOperatorLight`, `localOperatorDark`
  and `dracula`. The twelve-theme sweep for this feature remains withdrawn; this set does
  not replace it, and no claim is made about the other nine themes.
- **The chip's width moves by ~7.5 CSS px when a move starts**, and the measurement is
  reported here rather than left for a reviewer to find: the ink box of the chip row is
  530px wide at rest against 515px in flight (both measured at 2x with
  `magick … -format %@` on the `editable` and `pending` frames above). It is the LABEL
  getting shorter (`Working directory:` to `Moving session:`), not the path: the path keeps
  its own column, and the two in-flight frames are **identical to the pixel** (515 = 515),
  so nothing reflows when the receipt lands. The alternative - the full sentence in that
  slot - was captured first and pushed the destination out of the chip entirely, because
  the chip sits at its own 19rem ceiling at the composer's width; that capture was
  discarded rather than kept, since the state it showed is not the one that ships.
- **Storybook states, not a live session.** Every frame is a story drive of the
  production `DirectoryIndicator` (with the two Electron calls the chip makes stubbed),
  not the app against a daemon. The live-flow half is QA's, in the PR thread — this set
  is the visual half a design round judges.
- **The chip's own typed field is absent.** `Enter custom path…` needs a key press, and
  the browser tool has no key-press action; typing a value and pressing Enter, and the
  `onBlur` cancel beside it, are therefore unphotographed here too.
- **No `receipts` frame is kept, and the reason is a gate rather than an oversight.** One was
  captured (`--receipts`, the five transcript lines) and `check-evidence` refused it: 99.39% of the
  frame is one colour against its 98.5% ceiling, because five short lines of text cannot fill a
  full-height transcript pane. The state stays reviewable as a story; it is not in the committed
  set, and it was deleted rather than kept as a frame a gate rejects.
- **`composed-row` is at two widths, not at every width the composer can take.** The
  pair is the composer's own column and the container's floor, which is what D13 asked
  for; the intermediate range is not photographed.
- **One frame per state at rest.** These are stills of a control whose in-flight state
  animates; the frozen-ring (`prefers-reduced-motion`) reading they were captured for is
  the point of `pending/`, and no reduced-motion emulation was used to get it — the
  stylesheet's cap is a static fact of the app rather than something a still can show.
