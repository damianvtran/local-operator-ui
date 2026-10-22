# An ended console must not look alive, and opening with nothing live must start one

Before/after frames and readings for the operator's report (2026-10-21), with the
round-1 remediation. The instrument is `scripts/console-ended-proof.mjs`, committed
and re-runnable: the BUILT app in the documented `headless` window mode, a REAL
`lop serve` daemon the run starts and owns (scratch HOME, config dir and profile,
port 47391), and the app's own `Page.captureScreenshot` for every frame. No window
is shown and no `screencapture` runs.

## Provenance, at this revision

The **after** set was built and captured at the app head `03b918de2f`
(the round-2 remediation; its parent folds `origin/main` `ac80e7a679` into
`fix/console-ended-live`). The **before** set was built at `a08d47b032`,
the PR's original base. Both builds were made with
`VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:47391 pnpm build`; the captures ran
after the build.

The PNGs are **not committed**: `.gitignore` excludes `docs/evidence/**/*.png`
because frames are regenerable rig output. They live at this path on the capture
host, and `before-readings.json` / `after-readings.json` (committed) are the runs'
own reports. The reader should treat the readings as the durable record and the
PNGs as the pictures beside them.

Q-4's provenance caveat from round 1 is closed: the after build (`out/`) was
written after the final source edit and the frames were taken from that build.
Timing: after run `2026-10-22T11:07:31.985Z`, before run
`2026-10-22T10:01:07.833Z`.

## The frames

| before | after | state | what the pair shows |
| --- | --- | --- | --- |
| `before-live-opened.png` | `after-live-opened.png` | a running console | Control: both paint the live accent cursor (`background rgb(56,201,106)`, `blink true`), an editable textarea, and the rail lit (`aria-pressed=true`) at 1 live. The ended treatment does not leak into the live state. |
| `before-ended-pane-open.png` | `after-ended-pane-open.png` | the process exited, pane open | Before: the terminal cell after the prompt still has the accent, blinking cursor and an editable textarea (`readOnly false`); the rail is `aria-pressed=true` at `0 live`; no marker. After: `cursorCells: []` on a FOCUSED terminal — DECTCEM (`CSI ? 25 l`) makes xterm stop rendering the cursor, and the reading also returns `caret: null`; the textarea is `readOnly`, the band reads "End of history" / "This terminal is read-only. Select text to copy it.", and the rail is `aria-pressed=false`. |
| `before-ended-key.png` | `after-ended-key.png` | one real key (`a`) through Chromium | Before: nothing says the key was refused; the caret is unchanged. After: the band and the `<output aria-live="polite">` carry "This terminal has ended, so that key was not sent. Open a new console to type again." |
| `before-rail-zero-live.png` | `after-rail-zero-live.png` | the rail with 0 live, pane open, BEFORE any key | Before `aria-pressed=true`; after `aria-pressed=false`. The after frame is the clean pre-key state (round 1's frame was taken after the refusal and carried that band). |
| `before-reopen-nothing-live.png` | `after-reopen-nothing-live.png` | close the pane, then the user's open with nothing live | Before: `created false`; the pane reopens on the recording. After: `created true`; a new surface exists, is selected, and the active element is the terminal's textarea with a live caret. |
| — (base cannot reach it) | `after-one-live-one-ended.png` | lens set to the ended row, close, open with one live and one ended | After: `surfaceCount [2,2]`, no create, selected tab is the LIVE surface (`con:2`), caret live. The frame and `after-reopen-nothing-live` show the same terminal state but are no longer byte-identical (the live caret blinks; hashes `1e66998f36` vs `fb57a2fa83`). The reading proves the lens was the ended row before the open and the live row after (UX U4). |
| — (base cannot reach it) | `after-all-ended-open.png` | two ended, user opens | After: `surfacesBefore` two `running:false`; `surfacesAfter` three, the third running and selected. Before the same cell has **one** ended surface (`before-all-ended-open.png`): the base's open never created, so a second ended surface could not be made by this sequence — the label is the sequence's, not a claim about the base's count. |
| — (base never reaches it) | `after-rail-unread-dot.png` | a console ended while the pane was CLOSED | After: rail unlit, dot present, label `Console (⌘J), 1 finished since you looked` — the unread mark is distinguishable from a live indication. The base cannot reach this cell (its open did not create the live surface the sequence ends), and the mark itself is not new. |
| — (base never reaches it) | `after-ended-row-looked-at.png` | that ended row clicked after the mark | After: the history is shown (marker present, `readOnly:true`) and the dot is gone — looking at the surface the mark names clears it. |
| `before-history-focused.png` | `after-history-focused.png` | the textarea holds keyboard focus on history | After reading: `active true`, `focusVisible true`, `outlineWidth 2px`, `outlineStyle solid`, `outlineColor rgb(131,124,109)` (the `border-control` role) — a visible focus indicator where the caret used to be. Before has no such treatment. The after frame is byte-identical to `after-ended-pane-open`: the terminal already holds focus when the process ends, so the ring is present in both; the reading is what names it. |
| `before-history-glyph-cursor.png` | `after-history-glyph-cursor.png` | `printf 'ABC\r'` then `kill -9 $$`, cursor left over the glyph | Before: the green block sits over the character row and the tab/banner say `0` / `exit code 0`. After: the characters `ABC` are intact, `cursorCells: []` and `caret: null` on a focused terminal (DECTCEM, D1/U6), and the tab/banner say `SIGKILL` / "killed by SIGKILL" (Q-3, D5). |
| `before-relaunch-restored.png` | `after-relaunch-restored.png` | quit with a live surface, relaunch, select the restored surface | Before: sidecar `exit_code:null`, no reason, pane "exit code not observed". After: sidecar `exit_code:1`, no reason, pane "exit code 1". |

### Byte-identical frames, stated rather than hidden

- **Five** before frames — `ended-pane-open`, `ended-key`, `history-focused`,
  `reopen-nothing-live` and `all-ended-open` — share `5d02f929fa`: one state on the
  base. A key into the dead terminal changes nothing, a reopen with nothing live
  creates nothing, and the base's "two ended" sequence never got a second ended
  surface. They do not independently evidence five steps; the readings do, and the
  identical bytes are the defect. `before-rail-zero-live` is **not** in that group
  (`0f05e495ad`): it is the rail reading, one state later.
- `after-ended-pane-open`, `after-rail-zero-live` and `after-history-focused` share
  `06cced9236`: the terminal already holds focus when the process ends, and the
  rail frame is the same state taken before a key. The round-1
  `after-rail-zero-live` was post-key; this one is pre-key.
- `after-one-live-one-ended` (`1e66998f36`) and `after-reopen-nothing-live`
  (`fb57a2fa83`) show the same terminal state but differ: the live caret blinks
  between captures. The discriminator is the lens reading (see the table).

## Actual readings, quoted

Ended, pane open:

```json
"before": {"caret":{"color":"rgb(43,39,33)","background":"rgb(56,201,106)","blink":true},
           "textareaReadOnly":false,"rail":{"pressed":"true"},"marker":null,
           "tab":"zsh\n1"}
"after":  {"textareaReadOnly":true,"rail":{"pressed":"false"},
           "marker":"End of history\nThis terminal is read-only. Select text to copy it.",
           "tab":"zsh\nexit 1"}
// the after frame paints no caret; `console-mirror.test.mjs` pins the DECTCEM write
// and the rig reports `cursorCells: []` on the focused terminal (D1/U6)
```

Focus ring:

```json
{"historyBox":{"x":740,"y":139,"width":596,"height":761,
  "outlineWidth":"2px","outlineStyle":"solid","outlineColor":"rgb(131, 124, 109)"},
 "active":"textarea","focusVisible":true}
```

Marker band, empty vs refused: `{"beforeTop":848,"afterTop":848}` — no shift.
Repeated refusal: `{"firstSeq":"1","announceSeq":"2","announce":"This terminal has
ended, so that key was not sent…"}`. Tab on history: the active element is a
`button`, `inTerminal:false` — focus leaves.

Open with nothing live:

```json
"before": {"created":false,"surfacesAfter":[{"running":false}]}
"after":  {"created":true,"surfacesAfter":[{"running":false},{"running":true}]}
```

Unread dot (after only; the base does not reach the state):

```json
{"pressed":"false","label":"Console (⌘J), 1 finished since you looked","blip":true}
```

Through the open (pane closed, one hidden completion, then the rail press):
`[{at:0,blip:true},{at:120,blip:true,selected:"con:4"},{at:300,blip:true},
{at:700,blip:true}]`; after clicking the ended row: `blip:false`. The mark survives
the open's fallback and the new live surface, and clears only on the look.

Signal exit and labelled tab:

```json
"before": {"banner":"This terminal has ended\nexit code 0","tab":"zsh\n0"}
"after":  {"banner":"This terminal has ended\nkilled by SIGKILL","tab":"zsh\nSIGKILL"}
"after, non-signalled": {"tab":"zsh\nexit 1"}
```

## What these frames do NOT prove

- One machine, one shell (`zsh`), one theme (`localOperatorDark`), one grid
  (74–56 columns). The palette claim is a role claim (history ink `inkMuted`, the
  focus ring `border-control`) and is asserted by `console-pane.test.mjs`; the
  other 58 palettes are not photographed.
- The natural `app_quit` fallback is not in a frame: this host's quit observed the
  exit inside the bound (`exit_code:1`). The fallback path is covered by
  `console-host.test.mjs`. QA round 1 exercised the sentence by rewriting a
  sidecar, which is the app's restore path with a synthetic cause.
- The key in `after-ended-key` is a real Chromium key event into the focused
  textarea; the frames do not make a screen reader speak. The live region's
  attributes and text are read from the DOM.
- `document.hasFocus()` is supplied by CDP focus emulation; the app was never
  frontmost. The rig refuses port 1111, strips inherited `CMUX_*`/`LOP_*`, and
  kills its daemon and app process groups by exact pid.

## Re-running

```sh
# the rig starts the daemon; only the pairing address has to be built in
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:47391 pnpm build
node scripts/console-ended-proof.mjs --pair 47391 --out <dir> --keep
```

`--keep` leaves the scratch tree and prints its path; without it the tree is
removed. `readings.json` is written into `--out`.
