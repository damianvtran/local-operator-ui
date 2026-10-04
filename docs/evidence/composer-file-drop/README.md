# The composer's drop target: a real file drag, before and after (issue #789)

Twenty-eight frames from `scripts/renderer-driver.mjs`'s `composer-drop` scene — ten
here (the head tree, one per cell) and eight in `composer-file-drop-baseline/` (the
base tree this branch is folded onto). The app is the BUILT tree, launched in the
documented `headless` window mode at 1380x900 and photographed through its own
`capturePage()`; the `.webp` files are `cwebp -q 90` conversions of each run's
PNGs, un-resized, and each run's own log sits beside its frames.

## What the pair is for

The issue's claim is that the composer presents a drop affordance it does not
implement: nothing in the band cancelled `dragover`, so the file fell through to
the page and was discarded in silence. **A `drop` event does not fire at all
without that cancel**, so the base tree's frames and the head tree's frames are
the same gesture against the same rig — the difference is the app.

- the base tree's half is driven with `--drop-expect discarded`, which asserts
  the defect (the drop leaves NOTHING behind, while a paste in the same pane still
  attaches a file — the drift the issue reports);
- the head tree's half is driven with `--drop-expect accepted`, which asserts the
  gesture lands and says what it landed as.

The base half is a DETACHED WORKTREE at this branch's fold point
(`origin/main` = `4b5c81df9e`) with this branch's `scripts/renderer-driver.mjs`
copied in, so both halves are driven by the same rig bytes; only `src/` differs
(`diff -q` between the two `renderer-driver.mjs` files is empty in the run that
produced this pair).

## The run, exactly

```sh
# 1. the app, built against the backend this run owns
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080 \
  VITE_GOOGLE_CLIENT_ID=rig VITE_GOOGLE_CLIENT_SECRET=rig \
  VITE_MICROSOFT_CLIENT_ID=rig VITE_MICROSOFT_TENANT_ID=rig \
  pnpm build

# 2. the daemon: a scratch config root, and the HOSTING written into it before it
#    starts (a fresh root holds none, and every turn dies in
#    `HostingNotConfiguredError` without it - see `docs/agent-driver.md`)
printf 'values:\n  hosting: test\n  model_name: mock-model\n' > "$ROOT/config.yml"
LOCAL_OPERATOR_CONFIG_DIR="$ROOT" LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat token.hex)" \
  local-operator serve --port 8080 --hosting test --model mock-model

# 3. the scene, once per tree (`--drop-expect` names which half this run is)
LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat token.hex)" \
node scripts/renderer-driver.mjs --scene composer-drop \
  --backend http://127.0.0.1:8080 \
  --backend-records "$ROOT/run/serve" \
  --drop-expect accepted \
  --out "$LOCAL_OPERATOR_SCRATCHPAD/frames" \
  --seed-onboarding-complete --window-size 1380x900
# the base tree's half: the same command with --drop-expect discarded, run in a
# detached worktree at origin/main (`4b5c81df9e`) carrying this branch's
# scripts/renderer-driver.mjs
```

The head run is 27 PASS / 0 FAIL and the base run 20 PASS / 0 FAIL; both logs are
committed beside their frames (`head-run.log`, `baseline-run.log`), and the
scene's exit status is non-zero on any FAIL.

## Why the gesture is a real drag over CDP

`Input.dispatchDragEvent` with `files` goes through Chromium's own drag pipeline,
so `dataTransfer.files` holds real Files backed by paths on disk. That is not a
convenience: Electron 44 removed the `File.path` augmentation, the drop path
names the file through `webUtils.getPathForFile` in the preload, and a `File`
CONSTRUCTED IN THE PAGE answers `""` from that call. A synthetic `DragEvent`
carrying a hand-made `DataTransfer` — which is how `wysiwyg/insert-image-dialog`
drives its own drop, because it only wants bytes — would therefore exercise the
FALLBACK arm and never the path the real gesture takes. The preload hop is
covered separately by `scripts/preload-updater-surface.test.mjs`, and the
refusing arm of the same gate by `scripts/composer-file-drop.test.mjs` (see
*What these frames do not show*).

## The frames

| Committed frame | What it shows |
| --- | --- |
| `dragover/localOperatorDark.webp` | the band mid-drag, before the drop: the composer box carries the DASHED accent ring the drop-target state paints |
| `single-image/localOperatorDark.webp` | one image dropped: one tile, its real thumbnail and its caption |
| `multiple-files/localOperatorDark.webp` | two files in one `dataTransfer.files`: both tiles, in the drag's own order |
| `non-image/localOperatorDark.webp` | a `.txt` dropped: a tile like any other path-backed attachment |
| `armed-focused/localOperatorDark.webp` | armed while the composer is FOCUSED: the same box, and the ring is dashed where the focus ring alone is solid |
| `armed-non-image-tile/localOperatorDark.webp` | armed WITH a non-media tile on the band: the tile keeps its own ground and its own box while the ring is up |
| `running-turn/localOperatorDark.webp` | a drop and a paste while a turn is genuinely running (the mock provider's own `[bash:15]` marker → `sleep 15`) |
| `wire-parity/localOperatorDark.webp` | the wire half: the dropped image and the pasted one, both sent |
| `read-at-send/localOperatorDark.webp` | the same path dropped twice with different bytes written behind it between the sends |
| `off-composer/localOperatorDark.webp` | a file dropped over the transcript, where nothing accepts it |

WHY THE FILES ARE NAMED `localOperatorDark.webp` AND NOT BY THEIR CASE: the
frames gate derives a frame's expected ground FROM ITS FILENAME
(`check-evidence.mjs`: `<set>/<cell>/<theme>.webp`, looked up in `PALETTES`), so
a frame called `composer-drop-1-single-1380x900.webp` is a frame no palette
names and the sweep refuses it (measured: all fourteen of the first cut's frames
were refused). The cell directory carries the case instead; the run's own labels
(`composer-drop-1-single-1380x900.png`, listed in `head-run.log`) map one-to-one
onto the cells above, in the order the scene runs them.

## The readings behind the frames

- **The representation is the PATH.** After one dropped image the persisted
  draft store (`conversation-input-store`, `persist`ed to localStorage) holds
  `/…/composer-drop-fixtures/rig-drop-large.png` — a path, not a data URL. That
  is the same representation the attach button stores, and it is what keeps a
  dropped file out of the draft's storage budget (a 5 MB image as a data URL is
  ~6.7 MB of a budget that is usually 5-10 MB). The paste route in the same run
  holds `data:image/png;base64,…` — the two are deliberately different, which is
  why the send is compared on the wire rather than in the chip.
- **A dropped image is indistinguishable from a pasted one where it counts.** Both
  sends were admitted, and the daemon's transcript names ONE blob for the two:
  `{"attachment": "16811551d75cc7c152bdae893957cbe3", "mime_type": "image/png"}`
  on both rows.
- **The path is read at SEND time.** Case 6c drops the same path twice with
  different bytes written behind it between the two sends; the two messages carry
  different images, and the PASS line carries both digests
  (`digestA=inline:8119bd239779bfa4 digestB=inline:08bfc188bd4abb83` in
  `head-run.log`) rather than asserting an inequality the log cannot show.
- **The gate is the paste's gate.** While a turn runs, the canonical composer does
  not refuse input (`chat-content.tsx` passes `currentJobId=null` for a canonical
  conversation, so `isBusy` is false), and the scene measures the invariant that
  matters there: the drop and the paste attach the SAME number of files in the
  same state, and that number is not zero. On the base tree the same state reads 1
  from the paste and 0 from the drop.
- **Armed is a SHAPE, not a wash** (design round 1, D1/D2; UX round 1, U3). The
  box's ring is solid while the field is focused and DASHED while a file is over
  it — read off the same element in one run (`resting.outlineStyle=solid`,
  `armed.outlineStyle=dashed`). The band's ground is not repainted, so a
  non-media tile (whose fill is `accent-wash`, the token the first cut also put on
  the band) keeps its boundary: `tileGround=rgb(29, 27, 25) boxGround=rgb(50, 45,
  34)` unchanged, box height 238px in both states.
- **A non-target drop does not take the window.** Measured on the base tree, with
  the rig's drag interception ARMED and then DISARMED, and controlled against the
  router's own settling: `window.location.href` is where it was and the composer is
  still mounted (`settled: true`, `composer: true` in the run's own reading). So no
  window-level navigation guard was added — see the PR body for why the guard the
  issue suggests would be a regression rather than a fix — and the base tree's half
  records the same fact.

## What these frames do not show

- **A human's own drag.** This is a dispatched drag through Chromium's input
  pipeline, not a hand on a trackpad, so it cannot say what macOS paints during
  the gesture (the green copy badge the issue reports), nor anything about a drag
  between applications.
- **The refusing arm of the drop gate.** A chat composer refuses input only
  through `unavailable` / `secretAnswer`, and a conversation this machine has
  deleted is not something a rig can create (the daemon exposes no session-delete
  route); a chat route for an id the daemon never had mounts a NOT-refusing
  composer (measured, and the scene records it in its own output). That arm is
  covered by `scripts/composer-file-drop.test.mjs` instead, which mounts the
  shipped component and drops on it with `unavailable` set.
- **The packaged artifact.** Everything here is the built tree
  (`out/`), headless, against an isolated daemon on 8080.

## The tile thumbnail, which the first cut of this set got wrong

The first cut's frames showed empty tiles and its README explained them as "a
property of the rig's `file://` renderer: the request never leaves the process".
That was wrong, and the run's own app log said so. The renderer DOES issue
`GET /v1/static/images`; the rig's own Content Security Policy blocked it —
fourteen violations in one run's log — because the driver's widening never
reached `img-src`. The widening appends to three directives (`frame-src`,
`media-src`, `img-src`), and each list ends at `;` except the last, which ends at
the attribute's quote; bounded on the quote, `img-src` and `media-src` matched
nothing and every append landed at the policy tail (agent review round 1, CR1-1
= QA round 1, Q-1).

The fix bounds each list at its own terminator and skips a directive that already
lists the origin (the appends were unconditional, so every run grew the policy).
The frames in this set were re-captured with it: the tiles draw their real
thumbnails, and a run's app log carries zero CSP violations for the dropped
fixtures. The scenario the wrong explanation described — an image whose load
fails — is real but this rig no longer produces it.
