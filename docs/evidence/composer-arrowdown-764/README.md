# The composer's ArrowDown states — issue #764's capture

Two states of the composer issue #764 is about, photographed on the FIXED head
(`5ccfb2093`, the commit that hands ArrowDown back to the textarea when no
recall is engaged):

- **`draft-wrapped/localOperatorDark.webp`** — the composer on a staged draft
  holding a long, single-paragraph draft: **four visual rows** (the geometry the
  scene read beside the frame: `scrollHeight` 99, `lineHeight` 21.7, padding 12
  → `rows: 4`; the box itself stands 99px, its grown state). The sidebar lists
  the draft row (`Draft: We're fixing the arrow k…`), and the composer's status
  row carries the working-directory chip and `mock-model`. The `PINNED` header
  above the `User` row is drawn empty here while the second frame carries its
  `Aida` row — a settling shutter rather than a rendered state, since the section
  is drawn only while it has rows (the `pinnedShown && view.groupBy === "section"
  && pinned.length > 0` guard at `chat-sidebar.tsx:8381`; the header itself at
  `:8394`), and the sidebar is not this change's surface. Brand dark palette.
- **`recall-engaged/localOperatorDark.webp`** — after the box was emptied and a
  real `ArrowUp` was sent through CDP's input pipeline: the newest submitted
  message stands in the box (`Check why the composer arrow keys stopped moving
  the caret`), and the store read beside the frame records the recall as engaged
  (`currentHistoryIndex` at the newest entry; the readout is committed as
  `recall-engaged/store-read.json`, with its provenance — re-derived in the
  remediation pass — under "The capture's own numbers"). The caret paints after the
  recalled text. The sidebar's DRAFTS row has left — the emptied store row is
  no longer a draft — and the scratch daemon's own `Aida` row stands under
  PINNED.

## What a still cannot show — read this before citing these frames

**Neither frame photographs the fix.** The defect and its repair are KEY-ROUTING
facts — *which handler claims an ArrowDown* — and no still can carry them. The
discriminating evidence lives in the suite and in QA's live walk:

- `scripts/composer-seeding.test.mjs` pins the byte shape: the arm must hand the
  key back *before* `preventDefault`, and the old "branch opens straight onto
  `preventDefault`" shape is asserted absent (it fails on the pre-fix bytes for
  exactly that reason);
- `scripts/credential-composer.test.mjs` drives the shipped composer: on the
  single-paragraph draft ArrowDown is **not claimed** at every caret, and once a
  recall is engaged it **is** claimed and still steps;
- the live key walk (a real keydown moving the caret between the wrapped draft's
  visual rows) is QA's, on the running app.

Both frames are of the FIXED head, **not a before/after pair**: the before side
of a key-routing defect has no different pixels, so a pair here would claim a
visual difference that does not exist. One palette is the honest scope — the
change touches no colour role or layout rule — and the other eleven themes'
contract belongs to the theme gates. The state scope is the same shape: the set
frames the two states the issue is about — the wrapped draft with no recall
engaged, and the recall held in the box — while the empty composer, a narrow
viewport (where the same draft wraps harder) and the recall-on-a-wrapped-message
case (U1, below) are not framed.

## What produced these frames

The built app, launched by its own Electron in `headless` window mode (the
driver's own `--window-mode=headless`; the scene itself does not re-assert window
facts), driven by
a TEMPORARY scene in `scripts/renderer-driver.mjs` (**`composer-arrowdown-764`;
the scene is NOT in this diff** — the #771 precedent — and its patch is posted
on the PR thread with the capture records, so a re-run can re-apply it) and
photographed with `webContents.capturePage()`. The run's log recorded **18 PASS
/ 0 FAIL, ALL CHECKS PASSED**, and the whole log is committed beside the frames
as `capture-run.log`.

The scratch daemon is load-bearing: **the chat pane does not mount its composer
without a backend answer** — measured, against the dead port the driver picks by
default, as the pane rendering `The Local Operator server did not answer this
request. Retry` with **zero textareas** — so the run mirrors the
`chat-sidebar-drafts` recipe with a throwaway daemon of the installed runtime:

```sh
RIG=<scratch>/764-shoot
# 1. a throwaway daemon of the installed runtime, on a free port
mkdir -p "$RIG/daemon/root"
printf 'values:\n  hosting: test\n  model_name: mock-model\n' > "$RIG/daemon/root/config.yml"
LOCAL_OPERATOR_CONFIG_DIR="$RIG/daemon/root" \
  LOCAL_OPERATOR_DESKTOP_TOKEN="<a fresh token>" LOCAL_OPERATOR_LOG_DIR="$RIG/daemon/logs" \
  lop serve --host 127.0.0.1 --port 16543 --hosting test --model mock &

# 2. the app, built against the same URL
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:16543 \
VITE_GOOGLE_CLIENT_ID=<placeholder> VITE_GOOGLE_CLIENT_SECRET=<placeholder> \
VITE_MICROSOFT_CLIENT_ID=<placeholder> VITE_MICROSOFT_TENANT_ID=<placeholder> \
  pnpm build

# 3. the scene
LOCAL_OPERATOR_DESKTOP_TOKEN=<the same token> \
  node scripts/renderer-driver.mjs --scene composer-arrowdown-764 \
  --backend http://127.0.0.1:16543 --seed-onboarding-complete \
  --theme localOperatorDark --out "$RIG/frames"
```

The scene seeds the draft pane and its recall history through the two stores'
own `localStorage` values (`canonical-sessions-storage`, `conversation-input-store`)
and releases the seed with a `Page.reload`; the draft is then typed through
`Input.insertText` after a real pointer click, and the recall frame's empty box
is produced by emptying the store row and reloading — the deterministic door to
the state a reader is in after clearing their draft, disclosed here as the rig's
own step. The frames land as `<out>/<label>.png`; they were converted with
`magick <frame>.png -quality 88 <theme>.webp` and both were checked with
`assertFramePaints` (the sweep's own frame predicate) before committing.

## The capture run's log

The capture's own output is committed beside the frames as `capture-run.log`.
Its checks segment, verbatim (the tail, from the scene's first check to the
runner's last line):

```console
[PASS] the seeded draft is the pane's active conversation
[PASS] the composer mounts on the seeded draft
[PASS] the recall history is in the composer's own store
[note] pane diagnostic
        {"text":"Local Operator New chat ⌘ N Search ⌘ K Aida Agents Projects Schedules Browser Agent hub Agents No agents yet 10 built-in agents are ready to install — aida, architect, coder, copy-reviewer, designer, manager, reviewer, scout, tui-designer and ux-reviewer. You can edit them once installed. Install all built-in agents Create agent Teams Create team PINNED Scheduled (1 wake) Aida · aida now , las","textareas":1,"tourTags":16,"composer":true,"dialogs":0}
[PASS] the draft reaches the composer's box
[PASS] the composer's own store carries the draft
[note] the draft's own geometry
        {"scrollHeight":99,"clientHeight":99,"lineHeight":21.7,"paddingY":12,"rows":4,"boxHeight":99}
[PASS] the draft wraps over several visual rows
[PASS] draft-wrapped-dark draws the dark palette its name claims
        DOM localOperatorDark #22201c; mean luma 38.2 vs 32.1 own / 237.3 other
[PASS] the box is empty before the arrow press
[PASS] ArrowUp engages the recall: the newest submitted message stands in the box
[PASS] the store records the recall as engaged
[PASS] recall-engaged-dark draws the dark palette its name claims
        DOM localOperatorDark #22201c; mean luma 36.8 vs 32.1 own / 237.3 other
[PASS] no process from this run outlived its boot

frames: diagnostic-offline-pane.png, draft-wrapped-dark.png, recall-engaged-dark.png
frames directory: /Users/damian/.local-operator/sessions/447b01dada03/scratchpad/764-shoot/frames
app log: /var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-renderer-driver-92096/app-scene.log
scratch kept: /var/folders/qd/1q2xkcls0tg60vh97jjngxc40000gn/T/lo-renderer-driver-92096 (the frames are also in --out)

ALL CHECKS PASSED
```

The sweep's own frame predicate (`assertFramePaints`) runs outside the app's
log; re-checked on the two committed blobs in this pass, verbatim:

```console
paints OK: docs/evidence/composer-arrowdown-764/draft-wrapped/localOperatorDark.webp
paints OK: docs/evidence/composer-arrowdown-764/recall-engaged/localOperatorDark.webp
```

## The capture's own numbers

- frame labels: `draft-wrapped-dark`, `recall-engaged-dark` (the trailing
  `-dark` is the palette assertion both frames passed);
- draft geometry at the shutter: `{scrollHeight: 99, clientHeight: 99,
  lineHeight: 21.7, paddingY: 12, rows: 4, boxHeight: 99}`;
- the store readout behind the recall frame, verbatim (committed pretty-printed
  as `recall-engaged/store-read.json`; **re-derived in remediation round 1** —
  the capture's own log kept the assertion, not the row — same scene and seed,
  and `currentInput` stays `""` because it is the engaged walk's stash, so the
  index at the newest entry is the engagement):

  ```json
  {"currentInput":"","submittedMessages":["Summarise the failing shard from last night's CI run.","Check why the composer arrow keys stopped moving the caret."],"currentHistoryIndex":1,"unredactedChars":0}
  ```

- viewport 1380x900, device pixel ratio 2 (frames are 2760x1800).

## Not this PR (deferred)

**U1 (UX round 1, NIT — pre-existing).** While a recall IS engaged, a recalled
message that itself wraps cannot be traversed with the arrow keys: the
first/last-line tests count LOGICAL lines, so at every caret of a wrapped
recalled message the walk claims the arrows and steps history instead of moving
the caret (QA's recon reads the same on both builds: from the engaged wrap,
`ArrowUp` steps `2 -> 1` and repositions the caret rather than traversing a
row). Base and head behave identically, so this is #673's own asymmetry —
recorded for a separate issue, not fixed by this change.
