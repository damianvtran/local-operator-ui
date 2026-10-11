# Chat image actions — the hover menu on every picture

The operator's ask (2026-10-11): hovering an image offers its actions — open
file location, open in OS, open in canvas, copy to clipboard — "either in an
ellipsis expand menu or other UX". Before this change the menu existed only for
path-backed pictures (`file-actions-menu`, behind `isLocalFile`), so every
durable screenshot (`blob:`), every pasted picture (`data:`) and every markdown
image had no controls at all.

These frames are the VISUAL half of the evidence: what the menu offers on each
kind of picture, at rest and open, in both brand themes. The other half — the
actions really executing (clipboard verified by a paste, open-in-OS, open in
canvas) — is not in this set; see "What is not here" at the bottom.

## The states

Twelve directories, two palettes (`localOperatorDark`, `localOperatorLight`),
twenty-four frames.

| directory | the picture under it | the menu it opens |
| --- | --- | --- |
| `durable/`, `durable-hover/`, `durable-menu-open/` | a canonical transcript image backed by a DIGEST, bytes fetched over the media relay (the kind that had no menu before this change) | `Copy image` |
| `live-hover/` | a canonical image carried inline (`data:`) | `Show in canvas`, `Copy image` |
| `legacy-hover/`, `legacy-menu-open/` | a path-backed attachment (`/Users/example/...`) | `Show in canvas`, `Open file`, `Open folder`, `Copy file path`, `Copy image` |
| `thumbnail-hover/`, `thumbnail-menu-open/` | a condensed action-group strip; the SECOND tile carries the pointer | `Copy image` (the strip is digest-backed, so it is the durable row) |
| `markdown-hover/`, `markdown-menu-open/` | a markdown image (`![...](/Users/example/...)`) — the `img` component added by this change | `Open file`, `Open folder`, `Copy file path`, `Copy image` |
| `canvas-viewer/`, `canvas-menu-open/` | the canvas image viewer (path-backed; the chrome controls are always visible, so no hover is needed) | `Open file`, `Open folder`, `Copy file path`, `Copy image` |

The rest state (`durable/`) is the "uncluttered" half of the claim: no trigger
is painted until the pointer (or focus) arrives. Every OTHER state is driven by
real CDP input — `durable-hover` etc. move the pointer onto the picture;
`*-menu-open` then press the trigger, and the capture fails if
`[role="menuitem"]` is not in the DOM, so no frame here can be a picture of a
menu that never opened.

## The capture

```
pnpm storybook --port 6129 --no-open
node scripts/capture-evidence.mjs http://localhost:6129 \
  --only=chat-image-actions \
  --themes=localOperatorDark,localOperatorLight \
  --allow-backend --theme-settle-ms=30000
```

- **`--allow-backend`** because the operator's daemon answers on the default
  `http://localhost:1111`; nothing in these stories talks to it (the durable
  stories answer their digest fetches from the story's own relay stub).
- **`--theme-settle-ms=30000`** because the FIRST run of this pass died on its
  first frame ("document carries theme \"\" after 10s") while Storybook was
  still compiling the story modules cold under host load; the default 10s
  budget is the knob's own documented case. Later runs at the default would
  also have passed — the knob is kept in the record because it is what the
  committed frames were taken with.
- **Two themes, not twelve**: this set was taken at the two brand palettes on
  purpose (host under heavy load) — the role tokens are what the menu paints
  with, and the twelve-theme sweep judges grounds, not menus. Widen with
  `--themes=` on any later pass; `--only=` re-runs will accumulate into
  `partialCapture` rather than replace it.
- The stories live in `src/renderer/src/features/chat/components/image-actions.stories.tsx`.
  The durable states install a relay stub (`window.api.desktop.media`) that
  answers ONLY the digests the file declares — anything else gets a 404, so a
  scope or op regression paints the unavailable note instead of borrowing
  bytes — and a painted-image latch holds the shutter until every blob-backed
  picture has decoded.

## What the frames show, and the two decisions beside them

- **The durable picture now has a menu** (`durable-menu-open`): the frame the
  operator's report is about. Before this change that picture had no trigger of
  any kind.
- **`Show in canvas` is absent where it cannot work**: a `blob:` picture gets no
  canvas entry (the viewer is path-backed and its documents persist — a
  session-only handle would paint a dead tab after restart), and the canvas
  viewer's OWN chrome has no `Show in canvas` because that is where the picture
  already is. Both are visible as the shorter menus in the frames.
- **The markdown frame's picture shows the browser's broken-image marker.** The
  fixture's path (`/Users/example/workspace/dashboards/march-render.png`) names
  no file under Storybook's http origin — in the packaged app the same `src`
  resolves on `file://` and paints. The CLAIM of that frame is the wrapper and
  its menu, which is what this change added; the picture's own bytes are the
  markdown renderer's pre-existing behaviour and unchanged by it.
- **The strip's second tile carries the portrait fixture** (different bytes from
  its neighbours, on purpose — the media-slot set's own lesson: a column of
  same-shaped tiles cannot show what the aspect does).
- **No layout shift**: every menu is an absolute overlay; the picture's box is
  the same in the rest and open states (compare `durable/` against
  `durable-menu-open/` — same frame, same reserved box).

## The manifest record

`docs/evidence/manifest.json` moved with this pass: `frames` 13775 -> 13799
(+24 on disk), `surfaces` 1688 (the STORIES table this change grew), `head` and
`partialCapture.refreshedAtHead` = `f57a55cab` (the commit the frames were taken
at, the branch's own head), `addedFrames` 766 -> 790. The `surfaces` count moved
with the table even before any frame existed (the manifest gate compares it to
the committed STORIES literal), which is why the story file and the capture
entries landed in one commit.

## The round-1 remediation re-capture (design D1)

Round 1's design pass measured the REVEALED trigger at 1.63:1 over a dark
picture in the light palette (strongest dot `#47484c` on the picture strip
`#26272e` in `durable-hover/localOperatorLight.webp`) — a ghost button has no
fill at rest, so its glyph sat on whatever the picture painted. The fix gives
the revealed trigger its own ground, `accentWash` (a chip), so the glyph reads
against a token on every surface and both palettes. The whole set was re-taken
at the fixed tree with the same command as above; the at-rest states carry no
trigger either side of the fix, so their claim is unchanged.

Re-measured the same way (ImageMagick 1-px row dumps through the glyph, the
trigger box at x362-389, y64-91):

| frame | glyph (strongest dot) | behind the glyph | ratio |
| --- | --- | --- | --- |
| `durable-hover/localOperatorLight` — BEFORE (this set's first capture) | `#47484c` | the picture strip `#26272e` | **1.63:1** |
| `durable-hover/localOperatorLight` — AFTER | `#474f46` | the chip `#e7f2e9` | **7.35:1** |
| `durable-hover/localOperatorDark` — AFTER | `#b1c0b4` | the chip `#17281e` | **8.15:1** |

The chip's pair is asserted on every palette by
`scripts/contrast-contract.mjs`'s `image actions trigger` row; the before
numbers above are this README's, read off the previous commit's frame
(`git show <pre-fix head>:docs/evidence/chat-image-actions/durable-hover/localOperatorLight.webp`).

## What is not here

The live per-action pass — clipboard verified by an actual paste,
`openFile`/`showItemInFolder` driven against a real path, open-in-canvas against
a real document — was NOT run in this pass: the host was under fleet-wide memory
pressure (load average >250 at one point, swap 8/9 GB) and a built-app plus
backend rig is exactly the class of run the fleet's memory guard exists for. The
actions' code paths are exercised by `scripts/image-actions.test.mjs` (resolver
per kind, refusals, canvas branch guards) and the live exercise is left to the
QA round on the real app. No frame here claims an action EXECUTED; they claim
what the menu OFFERS, which is this set's question.
