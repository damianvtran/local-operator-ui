# The sidebar toast lane, retired — rendered evidence

The chat sidebar's three messages — the archive offer, the archive refusal, and
the draft-discard offer — as **ordinary sonner toasts** in the app's one
bottom-right container, photographed in the running app in both palettes. The
change is the operator's request of 2026-09-27 (*"instead of having a separate
sidebar notification, we should probably just use the normal sonner toast"*), and
the design record it supersedes is `docs/design/sidebar-row-space.md` §10 (D11,
supersession entry at the end of the section).

**The BEFORE frames are cited, not re-shot.** They are the lane's own committed
states, pinned by the manifest and taken on `origin/main`, so duplicating them
here would be a second home for the same reading:

| state | before (the lane, as `origin/main` draws it) | after (this set) |
| --- | --- | --- |
| archive offer | [`session-archive/undo-offer`](../session-archive/undo-offer/localOperatorDark.png) | [`after-archive-offer`](after-archive-offer/localOperatorDark.webp) |
| archive refusal + Retry | [`session-archive/archive-refused`](../session-archive/archive-refused/localOperatorDark.png) | [`after-archive-refusal`](after-archive-refusal/localOperatorDark.webp) |
| draft-discard offer | [`chat-sidebar-drafts/after-drafts-deleted`](../chat-sidebar-drafts/after-drafts-deleted/localOperatorDark.png) | [`after-drafts-offer`](after-drafts-offer/localOperatorDark.webp) |
| the discard offer's Undo | [`chat-sidebar-drafts/after-drafts-undo-restored`](../chat-sidebar-drafts/after-drafts-undo-restored/localOperatorDark.png) | [`after-drafts-undo`](after-drafts-undo/localOperatorDark.webp) |
| the offer against the composer | [`sidebar-row-space/after/offer-toast-280`](../sidebar-row-space/after/offer-toast-280/localOperatorDark.png) | [`after-offer-vs-send`](after-offer-vs-send/localOperatorDark.webp) |

Each directory holds `localOperatorDark.webp` and, where the scene drives the
app's theme switch, `localOperatorLight.webp` (`cwebp -q 90` conversions of the
runs' PNGs) - the two `after-drafts-*` directories are **dark only**, because
the `drafts` scene does not drive the theme switch (its own committed set carries
`themes: 1`; the `--theme localOperatorLight` launch of this pass produced dark
pixels and is not committed as light). The runs' own logs are committed beside
them: `*-before-run.log` is the same scene on `origin/main` = `0f23c76de5`,
`*-after-run.log` is this change's tree.

## The numbers the frames are of

From `measurements/offer-toast-280-{dark,light}.json` (identical in both
palettes), the offer raised at the 280 panel:

- **one container, one message**: the placement read inside the scene is
  `{"containers": 1, "inPanel": false, "overlapsSend": true}` and the geometry's
  `toasts` is `{"total": 1, "painted": 1}` — with the lane's second container
  gone, sonner's "a positioned toast is drawn in every mounted container"
  behaviour has exactly one container to draw in, and the CSS confinement block
  that used to hide the other copies is deleted with it;
- **the card**: `x 1000..1356, y 826..876` (356 × 50) — the library's `--width`
  at this viewport, anchored to the viewport's bottom-right, **outside the panel**
  (`panel x 0..280`), with **no band element anywhere** (`band: false`);
- **the D12 trade, measured rather than asserted**: the composer's Send control
  is `x 1232..1264, y 836..868`, so it sits **inside** the card's own box. That
  overlap is the exact finding design round 2's D12 turned the old placement on,
  and the operator re-accepted it when asking for the standard toast; the scene
  asserts the boxes are *read*, not that they are disjoint (`overlapsSend` and
  `overlapsForm` are echoed by the reading);
- **what is unchanged in the frames**: the list behind the card reserves no
  space for it (the scene's own `"a standing message reserves NO space"` reading
  is byte-equal rows, both scrollTops, the list's box, and the entity region's box
  to the pixel; the only movement an accepted departure leaves is the browser's
  own end-of-list clamp).

## What the runs reported

| scene | before (`origin/main` `0f23c76de5`) | after (this change) |
| --- | --- | --- |
| `session-archive` (dark, light) | 70 PASS / 0 FAIL | 69 PASS / 0 FAIL (one superseded clause pair merged) |
| `drafts` | 54 PASS / 1 FAIL | 54 PASS / 1 FAIL |
| `row-space` | 48 PASS / 8 FAIL | 48 PASS / 8 FAIL |

**The failures are pre-existing at this base, NOT this change's**, and they are
identical in both trees, which is why both logs are committed: the `drafts`
failure is `and the next step moves past it rather than sticking` (the Arrow ring
past the inapplicable `Clear all`, red on `origin/main` at this head too), and
the `row-space` eight are the pin/width clauses (`at rest the unpinned title
measures the widths the spec promises …` etc.), red on `origin/main` under this
host's conditions in the same run.

**And the full `pnpm check-evidence` pixel pass names this tree's remaining
failures too: they are all older than this set.** Run on this branch's head
(2026-09-28, once a peer's machine lease freed), it reports the two
`canvas-file-freshness` frames (`dominant colour #FFFFFF … not a picture of the
app` in files named `localOperatorDark`), `run-panel-reveal`'s
`press-800x600-after-fix/localOperatorLight` (dark pixels in a `Light` name), and
two manifest sets that predate this branch (`browser-approval-badges` with
`why`/`capturedAt` missing and 49 frames off disk, and
`chat-header-identity/before-main` with only a `path`). Every one of them is
present on `origin/main` unchanged: `git diff --name-only origin/main --
docs/evidence/canvas-file-freshness docs/evidence/run-panel-reveal` is empty, and
both manifest entries are byte-identical to main's. Every frame THIS set adds is
clean under the same pass, which is what the `.webp` names and the drafts note
above exist for.

The `session-archive` difference — 70 checks
before, 69 after — is this change's own scene edit: the superseded band-era
clauses were replaced by the re-scoped ones this set's frames are of (the
accepted-departure clause now reads the browser's end-of-list clamp, and the
"yield" pair was one check).

**What could not be reproduced**: the operator's *"these don't properly show
up"*. Every lane-era run in this session drew its message (the before logs'
`undo-offer`/`archive-refused`/`drafts-deleted` frames all carry the card), so the
complaint is recorded as **not reproduced** rather than demonstrated. What the
change does about the class it names is structural and is in the design record:
the raise now lives on `UndoToasts` in `main.tsx`, mounted for the app's whole
life, where it used to live in `ChatSidebar` — the panel, which unmounts with the
collapsed sidebar and the other region doors.

## How these frames were taken

`scripts/renderer-driver.mjs` on the tree built from this change (base
`0f23c76de5`; the branch was then folded onto `origin/main` = `8367cbfaee`,
whose commits touch no geometry these frames are of), one headless launch per
palette, the app's own Electron and
`webContents.capturePage()`; each scene's committed scratch daemon answers the
catalogue (and the `drafts` scene uses the installed runtime's
`lop serve --hosting test --model mock` in an isolated config dir, per
`docs/evidence/chat-sidebar-drafts/README.md`). The exact invocations are in the
runs' own headers and in the sibling sets' READMEs, which these runs followed
unchanged apart from the port the rig bound (a free loopback port, the same for
the build and the daemon).
