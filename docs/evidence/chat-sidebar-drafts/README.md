# Clearing drafts from the sidebar

The operator's two reports (2026-09-26), which this set photographs:

1. drafts stayed in local-operator-ui after sending them — returning to a team's
   New chat re-populated the box with a message that had already been sent;
2. the sidebar's `Draft:` rows had no way to be removed: *"Each one should have a
   deletion on hover and also a subtle clear all UX"*.

**Round 1's remediation re-captured this set** (design D1/D2, UX U1/U2): the
per-row discard and `Clear all` now stand an undo offer in the sidebar lane, a
row whose send hop is live is withheld from the acts, and discarding the draft
that owns the pane stages a fresh one instead of leaving the pane composerless.
Three states are new (`drafts-pending-disabled`, `drafts-undo-restored`,
`drafts-deleted-open`) and the rest were re-taken at the folded tip.

The store-side half of (1) is asserted by `scripts/drafts-clear-on-send.test.mjs` (the
pre-send composer record retired at `finishDraft`, the launch sweep, the
delivered-only resolution, and the discard offer's snapshot/restore) and the
sidebar half by `scripts/chat-sidebar-drafts.test.mjs`. This set is the rendered
half: the rows, the pointer's reveal, both removal gestures, the offer in the
lane, and the relaunch.

## What produced these frames

**Instrument: `scripts/renderer-driver.mjs`, `--scene drafts`** — the built app,
launched by its own Electron in `headless` window mode, photographed with
`webContents.capturePage()`. No `capture-evidence`, no `screencapture`, nothing
that takes the operator's focus; the run asserts `visible=false focused=false`.

**A scratch backend is required, and it needs no wire.** The sidebar's list is
gated on the session catalogue capability, so a run with no backend draws the
offline surface and has no drafts section to photograph — measured here before
the scene was given a daemon. Drafts themselves are LOCAL state: the scene writes
the two stores' own `localStorage` values through CDP (the `seedOnboardingComplete`
pattern) and releases the seed with a `Page.reload`, which is also the relaunch
its last frame is about. The daemon only has to answer the catalogue read:

```sh
# 1. a throwaway daemon of the installed runtime, on a free port
mkdir -p "$RIG/root"
printf 'values:\n  hosting: test\n  model_name: mock-model\n' > "$RIG/root/config.yml"
LOCAL_OPERATOR_CONFIG_DIR="$RIG/root" LOCAL_OPERATOR_DESKTOP_TOKEN=<token> \
  LOCAL_OPERATOR_LOG_DIR="$RIG/logs" \
  lop serve --host 127.0.0.1 --port 6543 --hosting test --model mock

# 2. the app, built against the same URL (the driver asserts the pair)
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:6543 \
VITE_GOOGLE_CLIENT_ID=[redacted] VITE_GOOGLE_CLIENT_SECRET=[redacted] \
VITE_MICROSOFT_CLIENT_ID=[redacted] VITE_MICROSOFT_TENANT_ID=[redacted] \
  pnpm build

# 3. the scene
LOCAL_OPERATOR_DESKTOP_TOKEN=<token> \
  node scripts/renderer-driver.mjs --scene drafts \
  --backend http://127.0.0.1:6543 --seed-onboarding-complete --out <scratch>/frames
```

`--seed-onboarding-complete` is load-bearing: without it the first-run modal's
scrim (`fixed inset-0 z-50 bg-scrim`) covers the window and the pointer never
reaches a row — measured, and the scene's first attempt photographed the scrim.

**Two runs, one script.** The before half checked `origin/main` `38dc028e72`'s
`src` out into the same worktree and built it there; the after half is the folded
tip `3d340b5e66`. The raw logs are **committed beside the frames**
(`before-run.log`: 14 PASS / 4 FAIL; `after-run.log`: 37 PASS / 0 FAIL), and the
four failures are the change's own claims:

```
[FAIL] the pointer reveals the discard control            (no such control exists before)
[FAIL] the live hop's control is revealed and disabled    (no such control exists before)
[FAIL] a relaunch does not resurrect the discarded drafts (nothing was deleted before)
[FAIL] the offer frames hold the offer, stable            (no offer exists before)
```

The keyboard claims are not in these frames: reachability (the control is a
sibling of the row's button, in the Tab ring, revealed by `group-focus-within`)
is asserted in `scripts/chat-sidebar-drafts.test.mjs`, and the chord/ring
contracts in `chat-keyboard-regions.test.mjs`. A frame proves what a pointer and
a press produce; it cannot prove Tab order.

## Before / after

Each state is the sidebar column. Rows are seeded in the operator's own shapes:
a held claim with a `deadline_exceeded` error, a draft whose text lives in the
composer store, one typed draft, and a row whose send hop is LIVE
(`pending: true`); a targeted `draft:agent:coder` is seeded too and is
deliberately NOT a row (the scene asserts it, and asserts that `Clear all` leaves
it and its composer text alone).

| State | Before | After |
| --- | --- | --- |
| Rows at rest | [`before-drafts-rest`](before-drafts-rest/localOperatorDark.webp) — four `Draft:` rows, no control anywhere | [`after-drafts-rest`](after-drafts-rest/localOperatorDark.webp) — the same rows and the same width; the discard control spends nothing while it is hidden |
| Pointer on the typed row | [`before-drafts-hover`](before-drafts-hover/localOperatorDark.webp) — hover is a bare colour step | [`after-drafts-hover`](after-drafts-hover/localOperatorDark.webp) — the trash glyph stands in its slot; the row's own box keeps the ground under the pointer |
| Pointer on the live-hop row | [`before-drafts-pending-disabled`](before-drafts-pending-disabled/localOperatorDark.webp) — hover is a bare colour step | [`after-drafts-pending-disabled`](after-drafts-pending-disabled/localOperatorDark.webp) — the control is revealed and DISABLED (dimmed); a real press on it moves nothing, so a discard can never be followed by a silent send |
| After the discard press | [`before-drafts-deleted`](before-drafts-deleted/localOperatorDark.webp) — nothing removes a row | [`after-drafts-deleted`](after-drafts-deleted/localOperatorDark.webp) — the pressed row is gone, the other rows stand, the composer's own record for that key went with it, and the lane stands the offer: `Draft discarded.` with its Undo |
| After the offer's Undo | [`before-drafts-undo-restored`](before-drafts-undo-restored/localOperatorDark.webp) — no offer to press | [`after-drafts-undo-restored`](after-drafts-undo-restored/localOperatorDark.webp) — the row and its composer record are back, and the offer retired with the press |
| After discarding the OPEN draft | [`before-drafts-deleted-open`](before-drafts-deleted-open/localOperatorDark.webp) — the draft is open and nothing can remove it | [`after-drafts-deleted-open`](after-drafts-deleted-open/localOperatorDark.webp) — the row goes and the pane KEEPS a composer (a fresh draft staged in its place), instead of the bare `New chat` surface the round-1 report measured |
| After `Clear all` | [`before-drafts-cleared`](before-drafts-cleared/localOperatorDark.webp) — no such control | [`after-drafts-cleared`](after-drafts-cleared/localOperatorDark.webp) — every settled row is gone and the batch's offer reads `3 drafts discarded.`; the live-hop row is deliberately left standing |
| After a relaunch (reload) | [`before-drafts-relaunch`](before-drafts-relaunch/localOperatorDark.webp) — the rows the reader could not remove are still there | [`after-drafts-relaunch`](after-drafts-relaunch/localOperatorDark.webp) — the discarded drafts do not come back, the live-hop row (never discarded) is still there, and the offer does not outlive the app |

The press frames are taken **after** a real press through CDP's own input
pipeline (`Input.dispatchMouseEvent`), not before one: a screenshot of a button
is not evidence that pressing it works. The scene's own checks read the store
back over `localStorage` after each press — the deleted key's composer row is
gone, the targeted draft's survives, the restored key's row is back — so the
frames and the state are the same moment. The offer frames use
`captureWithToast`, which records the lane's own sentence on the frame it keeps.

## What these frames do not prove

- **Not the packaged app, and not a model turn.** The app is a checkout's build,
  driven headless; no message is ever admitted on a wire, so nothing here is
  about what an owner answers. The `deadline_exceeded` row and the `pending` row
  are seeded shapes, not refusals this run produced.
- **Not the offer's lifetime or the snapshot's rules.** The 15s ceiling, the
  one-slot replacement, the restore's "newer state wins" guard and the disabled
  row's marker are asserted at the store level in
  `scripts/drafts-clear-on-send.test.mjs`; the frames catch the offer at its
  raise and at its press.
- **One theme.** `localOperatorDark` only; the twelve-theme sweep belongs to the
  Storybook pipeline and is not regenerated here.
- **Not the sweep's own resolution.** The launch sweep (`draft-resolution.ts`)
  reads a session's history tail from a live daemon; its delivered / silent /
  read-failure arms are asserted at the store level in
  `scripts/drafts-clear-on-send.test.mjs`, not photographed here.
- **Not the composer's relaunch.** The operator's "coming back to a New chat
  with a team found the old message" is a store-level claim (the same suite),
  which is the shape that can assert it without a turn: the rendered half of
  that flow needs a real send against a live owner and belongs to the QA pass's
  matrix.

## Re-capturing

The frames cannot be re-derived by `pnpm capture-evidence` (the sidebar has no
story, and the scene lives in the driver). Re-run the three commands above on the
tree in question; the scene writes the eight labels it always writes
(`drafts-rest`, `drafts-hover`, `drafts-pending-disabled`, `drafts-deleted`,
`drafts-undo-restored`, `drafts-deleted-open`, `drafts-cleared`,
`drafts-relaunch`), and the before half is the same command on the base tree's
`src`. The `.webp` files here are `cwebp -q 90` conversions of the run's `.png`s.
