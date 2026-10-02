# The composer's ArrowDown states — issue #764's capture

Two states of the composer issue #764 is about, photographed on the FIXED head
(`5ccfb2093`, the commit that hands ArrowDown back to the textarea when no
recall is engaged):

- **`draft-wrapped/localOperatorDark.webp`** — the composer on a staged draft
  holding a long, single-paragraph draft: **four visual rows** (the geometry the
  scene read beside the frame: `scrollHeight` 99, `lineHeight` 21.7, padding 12
  → `rows: 4`; the box itself stands 99px, its grown state). The sidebar lists
  the draft row (`Draft: We're fixing the arrow k…`), and the composer's status
  row carries the working-directory chip and `mock-model`. Brand dark palette.
- **`recall-engaged/localOperatorDark.webp`** — after the box was emptied and a
  real `ArrowUp` was sent through CDP's input pipeline: the newest submitted
  message stands in the box (`Check why the composer arrow keys stopped moving
  the caret`), and the store read at capture time records the recall as engaged
  (`currentHistoryIndex` at the newest entry). The caret paints after the
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
contract belongs to the theme gates.

## What produced these frames

The built app, launched by its own Electron in `headless` window mode, driven by
a TEMPORARY scene in `scripts/renderer-driver.mjs` (**`composer-arrowdown-764`;
the scene is NOT in this diff** — the #771 precedent — and is kept with the
branch's capture rig) and photographed with `webContents.capturePage()`. The run
asserts `visible=false focused=false`, and its log recorded **18 PASS / 0 FAIL,
ALL CHECKS PASSED**.

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

## The capture's own numbers

- frame labels: `draft-wrapped-dark`, `recall-engaged-dark` (the trailing
  `-dark` is the palette assertion both frames passed);
- draft geometry at the shutter: `{scrollHeight: 99, clientHeight: 99,
  lineHeight: 21.7, paddingY: 12, rows: 4, boxHeight: 99}`;
- the recall read beside the frame: the box holds the newest submitted message
  and the store's `currentHistoryIndex` equals it — the engaged state the
  ArrowDown walk (unchanged) starts from;
- viewport 1380x900, device pixel ratio 2 (frames are 2760x1800).
