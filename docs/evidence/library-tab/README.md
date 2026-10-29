# Library asset details — borderless inline editing, and the media lightbox

PR #1259 (`fix/library-asset-details`). The operator's report: the details panel's
Name, Description and Tags were the only boxed controls in a borderless UI, the
name's pencil and Clear buttons floated over the value, and the image/clip in the
details view was inert. The brief: **borderless chrome, subtle, not janky**.

Two arms, two themes, one fixture and one panel width:

- **BEFORE** — base `c9bbfe25f0`, the shipped `EditableField` / `TagsInputChips`
  preview and the inert media viewer, in `library-tab-before/`.
- **AFTER** — PR head `46042530e` (the round-1 remediation; the first after arm
  was `96dbca969d`), the borderless `InlineEditText` / `InlineTagEditor` preview
  and the shared `ImageLightbox` over the listing's media, in `library-tab/`.

Both arms mount the same fixture row (`la_0000000000000023`, "March invoices",
one description, two tags), in a 440px column, at 640x900, with
`localOperatorDark` and `localOperatorLight`. The media pair is 1280x900 because
the lightbox opens over the page's 440px dock, which the page only lays out at
`workspaceWidth >= 1152` (`library-page.tsx`); at 640 the same route falls back
to the full-view preview, which is a different surface.

**Where the frames live.** Frames are rig output and are NOT committed (the
split in #1256: `.gitignore` ignores `docs/evidence-frames/` and every frame
container under `docs/evidence/`). The capture below writes them to the ignored
`docs/evidence-frames/` tree, preserving each set's own path:
`docs/evidence-frames/library-tab/<state>/<theme>.webp` (and
`../library-tab-before/`, `../library-tab-live/` for the sibling sets). This
README, the manifest and `harness/` stay tracked; a fresh checkout has no
frames until the rig is run.

## The capture

**After arm** (this branch's remediation head `46042530e`, Storybook 8.6.12 on
`:6217`; the first after arm was shot at `96dbca969d` on `:6017`):

```
env -u XPC_FLAGS LOCAL_OPERATOR_UI_NO_BYTECODE=true pnpm storybook --port 6217 --no-open

env -u XPC_FLAGS node scripts/capture-evidence.mjs http://localhost:6217 \
  --only=library-tab--preview-inline \
  --themes=localOperatorDark,localOperatorLight --allow-backend \
  --theme-settle-ms=30000

env -u XPC_FLAGS node scripts/capture-evidence.mjs http://localhost:6217 \
  --only=library-tab--media-lightbox \
  --themes=localOperatorDark,localOperatorLight --allow-backend \
  --theme-settle-ms=30000
```

`--allow-backend` because the operator's own app is listening on the schema's
default `http://localhost:1111` for the whole pass. None of these stories calls
it: every read and write goes through the story's scripted
`window.api.desktop.request` / `.media` bridge, and a story that issues an
unknown op throws. `env -u XPC_FLAGS` because a tool child that inherits it
cannot resolve DNS on this host (measured; it breaks `getaddrinfo` in children),
and `--theme-settle-ms=30000` because the host carried a load average of 33 for
this pass and the shipped 10 s guard window is a 3-7x shortfall under that load
(the flag's own note). The two runs are narrowed passes; the manifest's
`partialCapture` records them.

The two runs reported `Captured 18 frames` and `Captured 8 frames`. **Eight of
the 26 files changed; the other 18 are byte-identical to the first after arm.**
The changed ones are the three lightbox states whose chrome gained the D1
`surface/85` plate (`media-lightbox`, `media-lightbox-solo`,
`media-lightbox-video`, both themes; the video frame's player ring is also
timing-dependent, which is Q3's documented gap), plus
`preview-inline-long-name-editing` (both themes), where the Q1 fix opens the
editor at the start of the value.
`media-lightbox-dismiss` is unchanged because the overlay is closed and no
chrome is drawn. Each old frame was replaced in place — the frames tree holds
one frame per state, not the old beside the new.

The round-2 remediation of PR #1259 re-took both runs at `22d00362de`, because
the shared lightbox's resting fade moved from 0.45 to 0.85 (design round 2's
D1). The pass reported `Captured 8 frames` and `Captured 18 frames`: six of the
eight lightbox frames came back byte-identical, the two
`media-lightbox-video` frames differ where the clip's decoded frame does (the
tuple makes no decoded-frame claim), and all 18 preview frames are
pixel-identical to their predecessors - one re-encode changed bytes only.

**Before arm** (scratch worktree at the base, one uncommitted story and one
uncommitted tuple block):

```
git -C ~/local-operator-ui worktree add \
  .worktrees/library-asset-details-before c9bbfe25f0
cd ~/local-operator-ui/.worktrees/library-asset-details-before
ln -s ../../node_modules node_modules

git apply ../../local-operator-ui/.worktrees/library-asset-details/docs/evidence/library-tab-before/harness/before-stories.patch
git apply ../../local-operator-ui/.worktrees/library-asset-details/docs/evidence/library-tab-before/harness/before-capture-entries.patch

pnpm exec storybook dev -p 6018 --ci --no-open

node scripts/capture-evidence.mjs http://localhost:6018 \
  --only=library-tab--preview-inline \
  --themes=localOperatorDark,localOperatorLight --allow-backend

node scripts/capture-evidence.mjs http://localhost:6018 \
  --only=library-tab--preview-media-inert-page \
  --themes=localOperatorDark,localOperatorLight --allow-backend
```

The two patches are the whole uncommitted delta: the `PreviewInline*` before
stories (the same ids as the after arm for the states that existed, plus
`PreviewMediaInertPage`), the one branch that serves a real SVG for the before
picture (base's stub serves markdown for every content read, which paints a
broken-image icon rather than the inert picture), and the matching capture
tuples whose selectors are the before code's own labels (`Edit Name`,
`Current value: …`). The frames were copied from that worktree's
`docs/evidence/library-tab/` into `library-tab-before/`; the worktree was then
removed. No committed file in that arm differs from `c9bbfe25f0`.

The original report is the operator's screenshot in the task thread. It is not
reproduced as a separate frame: the before hover frame
`preview-inline-long-name-hover/{dark,light}` is the same defect on the same
surface (the Clear control painting over the name), so the report's subject is
in the pair rather than named beside it.

## Measurements — what the run actually read

These are DOM reads from a private headless Chrome driven over CDP against the
same Storybook, one browser for the run, reaped by exact pid. They are separate
from the frames and are what makes the geometry claims falsifiable. The harness
is committed beside this README:

```
node docs/evidence/library-tab/harness/measure-claims.mjs http://localhost:6017
```

It is a rig, not a test: the frames are the evidence and the capture tuples are
what a sweep can fail on; this script is how a reviewer re-reads the computed
values the design round is asked to judge.

| claim | measurement (actual values) | verdict |
| --- | --- | --- |
| name is the header step, no label | `getComputedStyle(name).fontSize` **16px**, `fontWeight` **500**; header `<label>` count **0**, both themes | PASS |
| the reserved gutter exists, and is empty at rest | gutter `width` **20px**, `opacity` **0** at rest; text right **468**, gutter left **472** on the long name — a **4px** gap, text never under the slot | PASS |
| the pencil appears on hover | hover on `[data-inline-edit="name"]` matched `:hover`; computed `opacity` **0 -> 1**, and the geometry did not move (`textRight` **351.546875** both reads, gutter left **355.546875**, width **20**) | PASS |
| long name ends in an ellipsis BEFORE the gutter at rest | `textOverflow` **ellipsis**, `clientWidth` **226** against `scrollWidth` **450**, text right **468** < gutter left **472** | PASS |
| the same holds on hover | same values; `opacity` **1** | PASS |
| the same holds while editing | input `textOverflow` **clip**, `clientWidth` **226**, `scrollWidth` **450**, **`scrollLeft` 0** — the editor opens at the start of the value (the Q1 fix), selection **0..63**, input right **468** < gutter left **472**, X control `opacity` **1** | PASS |
| Escape restores the previous value | typed `changed`; after Escape the row reads `March invoice reconciliation notes for the fourth quarter close`, control label `Edit Name`, no input | PASS |
| editing is borderless and opens selected | input/textarea `borderTopWidth` **0px**, background **rgba(0, 0, 0, 0)**; name input focused, selection **0..14**; description textarea focused; X control `opacity` **1**, label `Cancel editing Name/Description` | PASS |
| the empty tag state is an add affordance, not a box | row text **"Add a tag"**, one `<button>`, **no `<input>`**, border **0px** on both axes, background transparent, height **20px** | PASS |
| click opens the lightbox | `[data-library-lightbox]` present, `role="dialog"`, title **"Launch still one"**, `[aria-label="Close asset"]` present | PASS |
| the group is the listing's media and opens on the played slide | **4** strip tiles; `aria-current` **la_…53** before the run's own walk | PASS |
| arrows move the slide | Next: **la_…53 -> la_…54**; Previous: **la_…54 -> la_…53** | PASS |
| a strip tile switches the slide | tile `la_…52` -> current **la_…52** | PASS |
| the preview underneath does not change | `data-library-preview` stayed **la_…51** across open, Next, strip press and close | PASS |
| Escape closes and returns focus | overlay **absent**, `document.activeElement` is the picture trigger | PASS |
| X closes and returns focus | overlay **absent**, focus is the picture trigger (solo, group and video) | PASS |
| a group of one has no carousel chrome | strip **absent**, `[data-image-viewer-prev]` **absent**, `[data-image-viewer-next]` **absent** | PASS |
| the clip lightbox is a real video | `<video data-lightbox-video>`, blob source, `duration` **2**, `readyState` **4**, strip present | PASS (DOM) |
| the decoded clip is on screen | headless Chromium with `--disable-gpu` paints the player's loading ring even at `readyState` 4 and leaves autoplay paused (`paused: true`, `currentTime: 0`); seeking did not change the painted surface | **GAP — Q3** |

### What the frames show, and what only the run asserted

- **Frames show**: the whole 440px panel in both themes; the pencil absent at
  rest and painted on hover; the long name's ellipsis and its 4px clearance from
  the gutter; the borderless selected editor opened at the START of the long
  value; the restored value after Escape; the empty tag row as `+ Add a tag`; the
  lightbox open on the third slide with its strip, arrows and the D1
  `surface/85` plate under the close/arrow/zoom chrome; the solo overlay without
  carousel chrome; the closed preview after Escape; the video lightbox over its
  player and controls.
- **The run asserted in the DOM, not in a still**: the computed name
  typography; the gutter's 20px width and `opacity: 0` at rest; the ellipsis's
  `scrollWidth`/`clientWidth` relationship; the editor's `text-overflow: clip`
  and scrolled position; the editor's focus and full selection; the empty tag
  row's lack of an `<input>` and border; the arrows' target ids; the strip tile's
  target id; the unchanged `data-library-preview` selection; focus return; the
  solo overlay's absent strip/arrows; the video's `readyState`.
- **Frames cannot show, and this set does not claim**: a click's cursor change;
  focus return after a still; the video's decoded pixels (see Q3).

## Findings

**Q1 — FIXED at `46042530e` (was MAJOR, product: the long name was clipped,
not ellipsized, while the editor was open).** The re-captured measurement shows
`inputScrollLeft: 0` with selection **0..63** and `inputRight` **468** <
gutter left **472**; the editor opens at the beginning of the 63-character
value, so the reader sees `March invoice reconciliation no…` instead of the
tail. The re-taken frame `preview-inline-long-name-editing/{dark,light}` shows
the start in both themes. The rest and hover states still satisfy the ellipsis
claim; an `<input>` still resolves `text-overflow: clip` while editing, which
is why the fix is the opening scroll position rather than an ellipsis.

**Q2 — FIXED at `46042530e` (was MAJOR, evidence soundness: the lightbox's
route-unchanged assertion was vacuous in Storybook).** The stories now assert
the preview's selected asset id across open, Next, a strip press and close; the
re-run measured `data-library-preview` **la_…51** at every step, and the
`/iframe.html` pathname is no longer read as a route proof. The tuple already
asserted the DOM selection id.

**Q3 — GAP, not a product failure: the video frame is the player's loading
state.** `--disable-gpu` headless Chromium does not paint the decoded video
surface: at `readyState` 4 the screenshot is a circular loading ring over the
player, and the controls read `0:00 / 0:02`. The lightbox-over-video state, its
controls and its strip are evidenced; the pixels of the clip are not. A native
or `inactive` run on a machine with a compositor is the instrument this needs.

**Q4 — FRAME ARTIFACT: the active strip tile's green ring.** In
`media-lightbox` the current tile carries a green `:focus-visible` outline
because the story's play pressed it through `userEvent` (a synthetic click that
Blink treats as keyboard-ish). The active-tile treatment itself is the `ring-ink`
hairline; a real pointer press leaves no green ring. This is the same artifact
`docs/evidence/chat-image-expand/README.md` records. Do not read the green ring
as the slide indicator's colour.

## Gaps this set does not cover

- Two themes only (`localOperatorDark`, `localOperatorLight`), as the task asked;
  the other 57 palettes are covered by `pnpm check-themes` for contrast, not by
  these frames.
- The before arm is a scratch-tree capture, not a sweep frame: its stories and
  tuples live in the two patches, not in `main`. It is declared as the
  supplementary set `library-tab-before` (18 frames) for exactly that reason.
- No before frame for the lightbox states: the lightbox did not exist on
  `c9bbfe25f0`. The before `preview-media-inert-page/{dark,light}` frames are
  the "picture and clip are inert" half; the after lightbox states are the other.
- The clip's decoded pixels (Q3), and any focus-dependent rendering.
- `pnpm check-evidence`'s result is reported in the PR's QA comment rather than
  duplicated here; it admits one sweep per machine and the run is recorded
  against this head.

## Frame inventory

All frames are 640x900 except the four `media-lightbox*` states and
`preview-media-inert-page`, which are 1280x900. Sizes are the bytes in the
ignored `docs/evidence-frames/library-tab/` tree.

### After (`library-tab/`)

| frame | dark | light |
| --- | --- | --- |
| `preview-inline-populated/` | 17,996 | 18,366 |
| `preview-inline-name-hover/` | 18,048 | 18,428 |
| `preview-inline-long-name/` | 19,646 | 19,788 |
| `preview-inline-long-name-hover/` | 19,710 | 19,862 |
| `preview-inline-long-name-editing/` | 19,704 | 20,336 |
| `preview-inline-name-editing/` | 18,038 | 18,496 |
| `preview-inline-name-escape/` | 18,322 | 18,672 |
| `preview-inline-description-editing/` | 18,816 | 19,498 |
| `preview-inline-empty-tags/` | 15,900 | 16,360 |
| `media-lightbox/` (1280x900) | 26,898 | 30,150 |
| `media-lightbox-dismiss/` (1280x900) | 42,124 | 42,890 |
| `media-lightbox-video/` (1280x900) | 30,828 | 37,278 |
| `media-lightbox-solo/` (1280x900) | 22,664 | 25,800 |

### Before (`library-tab-before/`)

| frame | dark | light |
| --- | --- | --- |
| `preview-inline-populated/` | 19,176 | 19,700 |
| `preview-inline-name-hover/` | 19,940 | 20,518 |
| `preview-inline-long-name/` | 21,100 | 21,638 |
| `preview-inline-long-name-hover/` | 21,634 | 22,272 |
| `preview-inline-name-editing/` | 20,412 | 21,010 |
| `preview-inline-name-escape/` | 19,180 | 19,700 |
| `preview-inline-description-editing/` | 20,686 | 21,246 |
| `preview-inline-empty-tags/` | 17,420 | 17,920 |
| `preview-media-inert-page/` (1280x900) | 43,914 | 45,280 |
