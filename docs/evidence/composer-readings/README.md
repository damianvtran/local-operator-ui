# The composer's readings row, in the live app

The row cannot be photographed in Storybook, and that is the whole reason this
set exists. It is one flex row whose **line** depends on the column's width, on
the working-directory chip's real shrink behaviour and on the real button sizes
(32px above a small window, 28px below); a hand-built row in a story would
certify a layout the product does not have (`docs/branding.md` § 8). So every
frame here is the app's own `src/renderer/index.html`, served by Vite with the
renderer stage's aliases and `desktopProxyPlugin`, talking to an **isolated**
`local-operator serve` on its own port and its own config dir, driven over raw
CDP by `out/evidence-harness/row-frames.mjs` (gitignored, like the harnesses in
the sets this one follows).

## The two trees, and what each number means

`before/` is the pre-change worktree at `78e694777`; `after/` is this branch.
Both were captured by the SAME script, on the same backend, at the same
sequence of **composer-box widths** — the track `CHAT_MEASURE` caps and the
number the design's § 6 frame list is written in. The driver aims the viewport
so the *measured* box lands on the target rather than trusting a viewport width
to imply it, which is why every frame is labelled with the box it actually
reached.

`numbers.json` beside each set is read out of the same live DOM at capture time,
per frame:

| number | what it answers |
| --- | --- |
| `column` / `container` | the chat column, and what the container query resolves against (the composer band's content box, i.e. the column less its 24px inset either side) |
| `box.w` | the composer box — the target |
| `row.clientWidth` / `row.overflowX` / `boxOverflowX` | the row's own content width and whether anything leaves it |
| `rowChildren[]` with `order`, `marginLeft`, `centre` | which item is on which line, in what order, and **which one is absorbing the free space** — i.e. that exactly one auto margin is live at any width |
| `readings[]` | each reading's `aria-label`, visible text, box and whether it is `aria-disabled` |
| `rowOnOneLine`, `stripParentIsRow` | the cluster is a direct child of the row, and whether it shares the row's line |

## The two mechanism facts this set carries

1. **The palette.** `dataset.theme` is applied by the seed script, and where the
   persisted preference did not take, the driver sets the attribute the theme
   contract resolves against (`docs/branding.md` § 1) and records
   `themeMechanism: "dataset attribute"` for that frame. No frame claims a click
   through the settings picker that did not happen. The `before/` set is
   `localOperatorDark` throughout: its light run came back dark, so those frames
   were **deleted rather than shipped mislabelled**.
2. **The sessions.** The readings are restored by the backend's own cold path
   from a turn-end checkpoint row that `out/evidence-harness/gen-checkpoint.py`
   writes with the backend's own pydantic models into an isolated config dir
   (`_restore_cold_details`) — the same row a real turn writes, not a hand
   written wire shape. `aaaa…` carries all four readings, `bbbb…` a 48-character
   aggregator slug, `cccc…` a saturated window that is an estimate, `dddd…` no
   checkpoint at all (the operator's report: the honest no-reading state, not
   zeros).

## What this set does NOT prove

- **Not the packaged Electron app.** The renderer runs in Chrome with a preload
  shim whose `window.api.desktop` is deliberately absent, so the desktop
  transport takes its real `/__desktop` HTTP path. Electron IPC is not
  exercised.
- **No live turn.** Nothing is sent to a model: no credentials are configured,
  and the accounting comes from the durable checkpoint. What a live owner
  republishes after a turn is the backend branch's QA, not this set's.
- **No draft strip.** The draft frames (`draft-*`) photograph the *pane*; the
  strip is absent from them because a draft's readings need
  `POST /v1/desktop/sessions/preview`, which exists only on the backend branch
  (`draft_preview: 1`). The draft's own rendering is proven by
  `scripts/composer-readings.test.mjs` and by the `Draft`/`DraftTooltip` stories;
  the live end-to-end cell is **pending the backend branch**.
- **Not the palette matrix.** Two palettes, not twelve; the twelve-theme sweep
  belongs to the Storybook pipeline.

## Re-capturing

```
out/evidence-harness/start-backend.sh <isolated-config-dir> <log>   # :8080, own HOME, own token
PYTHONPATH=<backend-tree> python out/evidence-harness/gen-checkpoint.py <isolated-config-dir>
out/evidence-harness/run.sh <tree-to-serve> <out-dir> <vite-port>
```

`run.sh` starts and stops the backend inside one invocation on purpose: a
backend left running between invocations was reaped, and the next run's every
frame then read "the server is not responding" — a harness fault that looks
exactly like a product defect. Three further traps are recorded in the harness's
own comments, each found by getting it wrong: the provider must be **registered**
through `PUT /v1/auth/providers/<id>/key` or the first-run wizard covers the
composer; a second document load leaves two SSE watches on one session and the
backend refuses the second with 409; and Chrome accumulates
`addScriptToEvaluateOnNewDocument` sources per tab, so a per-view seed is won by
the first view every time.

## Round 2: what changed under these frames

The `after/` set was re-captured in full at the remediation head, because the
round-1 review changed the row's anchor, the floor's chip and the draft's
readings — every claim the previous set carried. `before/` is unchanged
(`78e694777`, dark only, as recorded below).

Three things are new in the set rather than merely re-taken:

- **Every populated frame has text typed**, so the send button is the live
  accent control rather than the disabled one design D5 found in all fifteen
  round-1 frames. The harness types through the browser's own input pipeline
  (a `.value` assignment leaves React's tracker unaware) and refuses to take a
  frame whose send is still disabled.
- **The draft cells are live.** `run-tree.sh` drives the sibling backend branch
  and checks `draft_preview` on `/v1/capabilities` before the draft views open
  at all, so the strip in `draft-900` and `draft-220` is the real preview op's
  answer. `draft-no-strip-900` is the same pane against a backend WITHOUT the
  op: the cluster is absent and the controls are still flush right, which is
  the state round 1's blocker shipped wrong.
- **`hugename-*` is the truncation proof.** The committed `longname-*` frames
  do NOT truncate (`clientWidth === scrollWidth` at 750) — QA was right that
  round 1's caption claimed something its pixels did not show — so a
  139-character id is seeded and captioned as the frame that yields.

`numbers.json` gained `rowLineCount` (measured from painted geometry, so a
`display: contents` wrapper cannot hide a line), `nameSpan` (client/scroll
width, i.e. whether the name truncated), `chipText`, `send` and
`effortReading`. The `rowChildren[]` walk flattens `display: contents`: without
that it measured the button-line wrapper instead of the controls inside it and
reported the controls' auto margin as `0px`, which reads exactly like the
blocker this round fixed.
