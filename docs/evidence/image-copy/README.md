# Image copy — the clipboard's one writable image type

The operator's report (2026-10-11): pressing "Copy image" on a picture in the
chat transcript raised "Failed to copy image" — six times in the app log
(`[renderer] Failed to copy image:  [object DOMException]`, session
`9c59d684d16b`), while PNGs in the same session copied fine.

Root cause, confirmed in the built app before the fix: Chromium's sanitized
async clipboard write accepts only `text/plain`, `text/html` and `image/png`,
and the menu passed each blob's own MIME
(`new ClipboardItem({ [blob.type || "image/png"]: blob })`). Every non-PNG
write rejected with
`NotAllowedError: Failed to execute 'write' on 'Clipboard': Type image/jpeg not supported on write.`
— the DOMException the catch turned into the toast. The before half's committed
log carries the exact line, twice, from two real clicks.

The fix: `pngForClipboard` in
`src/renderer/src/features/chat/utils/image-actions.ts` passes PNG bytes through
untouched and decodes everything else through an `<img>` object URL onto a
canvas re-encoded as `image/png`; the menu writes the transcoded blob.
`isClipboardImageEncoded` is the pure decision the tests share.

## The states

| state | what it is | the question it answers |
| --- | --- | --- |
| `before-jpeg-refused` | `origin/main` (`7a392ecf943`): the JPEG press | the report, reproduced — the failure toast, the clipboard still holding exactly what it held |
| `after-jpeg-copied` | this change (`2bc40aa4026`): the JPEG press | the fix — "Image copied to clipboard", and the clipboard's `image/png` is 320x200 |
| `after-png-copied` | this change: the PNG press | the pass-through half the fix must not disturb — still a PNG, still at its own 240x160 |

Six frames, two palettes (`localOperatorDark`, `localOperatorLight`), three
presses per palette. The scene drives the theme switch itself, so each half is
ONE launch covering both palettes; every frame's run log is committed beside the
frames.

## The capture

Both halves are the SAME scene bytes
(`scripts/renderer-driver.mjs`, scene `image-copy`; the fixture
`scripts/image-copy-fixture.mjs`), differing only in the tree they run against
and the `--copy-expect` half they assert. The driver refuses to run against a
renderer older than its own sources, so the tree under it is the tree the frames
describe.

```bash
# RIG is this session's scratch; the daemon is killed by exact pid when the run ends.
RIG=<scratch>/image-copy; mkdir -p "$RIG/config"
node scripts/image-copy-fixture.mjs "$RIG/config"
printf 'values:\n  hosting: test\n  model_name: mock-model\n' > "$RIG/config/config.yml"
openssl rand -hex 32 > "$RIG/token"
LOCAL_OPERATOR_CONFIG_DIR="$RIG/config" \
LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$RIG/token")" \
LOCAL_OPERATOR_NO_NOTIFICATIONS=1 \
  local-operator serve --host 127.0.0.1 --port 8080 --hosting test --model mock-model &

# AFTER half, on this change's tree (HEAD 2bc40aa4026, the scene edits uncommitted at capture):
env -u XPC_FLAGS LOCAL_OPERATOR_UI_NO_BYTECODE=true pnpm build
LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$RIG/token")" \
  node scripts/renderer-driver.mjs --scene image-copy \
    --backend "http://127.0.0.1:8080" --backend-records "$RIG/config/run/serve" \
    --seed-onboarding-complete --copy-expect after --out "$RIG/frames-after" --clean

# BEFORE half, on a throwaway worktree at origin/main (7a392ecf943), same scene bytes:
git -C <repo> worktree add .worktrees/imgcopy-base origin/main
cd .worktrees/imgcopy-base && ln -s ../../node_modules node_modules
cp ../imgview-copy/scripts/renderer-driver.mjs ../imgview-copy/scripts/image-copy-fixture.mjs scripts/
env -u XPC_FLAGS LOCAL_OPERATOR_UI_NO_BYTECODE=true pnpm build
LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$RIG/token")" \
  node scripts/renderer-driver.mjs --scene image-copy \
    --backend "http://127.0.0.1:8080" --backend-records "$RIG/config/run/serve" \
    --seed-onboarding-complete --copy-expect before --out "$RIG/frames-before" --clean
```

The `.webp` files are `cwebp -q 90` conversions of each run's `capturePage`
PNGs; the runs' own logs (`image-copy-{after,before}-run.log`) are force-added
with `git add -f` past `.gitignore`'s `*.log`. The pass ran each half through a
small runner that kept its own rig directory, so the committed logs' headers
name `<rig>/{after,before}/frames-{after,before}`; the recipe above is the same
scene and the same flags, driver-level. Frame label to committed path:
`copy-jpeg-failed-<dark|light>` → `before-jpeg-refused/`,
`copy-jpeg-copied-*` → `after-jpeg-copied/`, `copy-png-copied-*` →
`after-png-copied/`.

## What the read-backs say

The other half of the evidence is the clipboard itself, read from the MAIN
process (`clipboard.read()`, Electron 44's W3C-style API — there is no
`readImage`) after each real press. The numbers below are the after run's, as
committed in its log:

| press | toast | clipboard after |
| --- | --- | --- |
| JPEG (`after-jpeg-copied`) | "Image copied to clipboard" at 187 ms / 184 ms | `image/png`, **320x200**, 98032 bytes, signature `89504e47` |
| PNG (`after-png-copied`) | "Image copied to clipboard" at 180 ms / 185 ms | `image/png`, **240x160**, 1103 bytes, signature `89504e47` |
| JPEG (`before-jpeg-refused`) | "Failed to copy image" at 108 ms / 105 ms | unchanged — the same 1103-byte PNG on both palettes |

**The clipboard re-encodes on the OS round trip, so the PNG row's byte
count is not the fixture's.** The fixture's PNG is 981 bytes; the read-back is
1103, the same digest on both palettes — deterministic re-encoding, not drift.
Byte-exactness of the pass-through is therefore claimed where it IS answerable:
the `ClipboardItem` the menu writes, pinned by
`scripts/chat-image-expand.test.mjs` ("Copy image on a PNG is the byte-exact
pass-through, with no canvas in the path"). The scene's claim is the pair the
clipboard keeps — type and the source's own dimensions — and the note in its
log says so rather than hiding the difference.

**The before half's "unchanged" comparison is against a non-empty clipboard**:
the after run's last write on the same machine left the 1103-byte PNG on it, so
the refusal is shown holding a real payload byte-stable through the press, not
shown against an empty clipboard. Both halves' JPEG copies wrote 98032 bytes at
320x200 — the transcode is deterministic across halves and palettes.

**The press-to-toast window is what the write spends**, and the timings above
are the measurement the transcode's comment cites: the clipboard write needs the
click's transient activation, so the whole path (resolve bytes, decode, canvas,
`toBlob`, `write`) has to land well inside it — it lands in ~185 ms against the
~5 s Chromium allows.

## What the scene proves, and what it cannot

The scene presses the item with a real pointer event through the input pipeline
(the transient activation the write needs only comes from trusted input), and
the driver's own checks hold the frames it takes: the toast text must be on the
frame, the palette must be the one the file names, and two shots must read the
same. What it cannot see is enumerated in `docs/agent-driver.md` — it is the
app photographing itself in `headless` mode, one launch per half.

The jsdom suite (`scripts/chat-image-expand.test.mjs`) mounts the same menu with
no canvas and no `createImageBitmap`; its PNG case runs the pass-through path
(it would throw or fall through if the menu tried to canvas-encode a PNG), and
**the encode path cannot run in jsdom at all** — its comment says so rather than
faking it. The encode is this set's, end to end.

## What is not covered

- **WEBP/GIF/SVG presses.** The predicate's unit matrix
  (`scripts/image-actions.test.mjs`) covers the decision for every type; the
  decode path is shared, but only JPEG and PNG bytes are seeded in the fixture,
  so no frame shows a WEBP or SVG landing on the clipboard.
- **A picture beyond the canvas limit** (a side over 16384 px). The function
  throws a sentence a toast can carry rather than silently downscaling; that
  branch has no frame.
- **Consumers outside the app** — pasting into another program is not
  exercised; the claim is about what the app writes.
- **The other menu actions** (`Open folder`, `Add to context`) are untouched by
  this change and not photographed here.
- **A design round's pass over the toasts' colour/spacing**: the frames carry
  the states and the log carries the two-shot stability and mean-luma readings;
  the contrast contract for the toast is the toast container's own, unchanged.

## Provenance

Frames captured 2026-10-11 ~22:28 -0400 (the log mtimes), one run per half.
After half: `fix/image-copy-clipboard` at `2bc40aa4026`
(`7a392ecf943` + the fix), with the scene edits uncommitted in the working tree
at capture time — no frame is carried between halves. Before half: a throwaway
worktree at `origin/main` = `7a392ecf943`.
