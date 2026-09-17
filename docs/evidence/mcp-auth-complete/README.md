# MCP sign-in dialog — the footer at a settled grant

The operator's report, with this dialog's own frame: after signing in to
`hubspot` the dialog read `Sign-in complete.` with **two** controls under it,
`Close` and `Try again`. A retry under a completed sign-in is confusing and
reads as a failure — "there's no need to try again if the sign-in worked".

The retry is the probe's, and at a settled SUCCESS it is not one press away from
another attempt at the same thing: it re-runs the probe, the probe answers "this
server takes OAuth", and the dialog is handed back its own primary —
`Continue in browser` for a sign-in, `Replace grant and sign in` when the
`action` is a re-auth — a control that re-offers the grant that just succeeded,
sitting under a sentence that says it worked. The fix names that state
(`completed = operation?.status === "complete"`) and stands the retry down for
it, and for it alone.

## What produced these frames

**The shipped `McpAuthDialog`**, mounted by
`harness/mcp-auth-complete.tsx` inside a real `QueryClientProvider` and a real
router, behind a real desktop bridge — an injected `window.api.desktop.request`,
the same seam the product itself uses and the same one
`scripts/mcp-auth-surface.test.mjs` pins. The bridge is not a convenience here:
the footer under test is built from the `mcp.list` document the dialog's own 1s
poll reads, and Storybook's preview has no `desktop` branch to answer it, which
is why this surface is a harness rather than a story.

**The state is driven through the dialog's own controls.** The probe answers
`transport_oauth_supported: true`, `Continue in browser` is pressed as a real DOM
click, and the poll answers an operation whose `status` is the case's own word —
`complete`, `failed` or `cancelled`. Nothing about the phase or the footer is
forced into React state, so the frame is the state the shipped predicates
produce from a wire payload.

**Capture:** `harness/capture.mjs`, driving Chrome over raw CDP the way
`scripts/capture-evidence.mjs` does — a private `--headless=new` profile under the
system temp dir, the DevTools websocket, `Page.captureScreenshot` — with its argv
routed through `withMockKeychain` (a scratch profile has no login keychain, and
Chrome would otherwise ask the operator to authorize creating one). Each case
**asserts the footer it photographed before the shutter** and calls
`assertFramePaints` on the written frame, so a blank, unstyled or mislabelled
frame fails the run instead of reaching review.

## The capture

The port defaults to **5213** (`--port=<n>`, or `MCP_AUTH_EVIDENCE_PORT` for the
Vite server); the server binds loopback only. Storybook walks forward when a port
is taken — this rig does not, it fails, so a busy port is a re-run with a
`--port`.

**Run one rig at a time over one `node_modules`.** Vite's dependency cache lives
under that shared directory, and a second run's page then misses its 60 s
readiness budget and dies with `the harness never reported the state it settled
in` — which reads as a state failure rather than the load timeout it is (QA round
1, Q3). The teardown signals the Vite server's process GROUP for the same reason:
a run that ends on its error path must not leave a server holding the port, which
is how the next run came to fail for a reason that looked like a state.

```sh
# AFTER — this branch's tree, written into the directories named below.
node docs/evidence/mcp-auth-complete/harness/capture.mjs --tree=after

# BEFORE — the PR's base (cfc28c817), materialised OUTSIDE the repository so
# nothing is written into the repository's own .git, with the harness copied in
# and this worktree's node_modules linked alongside it. The same bytes come out of
# da9e75a616, this branch's first base: the frames were first captured there and
# re-taken from cfc28c817, and both captures agree byte for byte because
# `mcp-auth-dialog.tsx` is identical in the two trees (`git diff da9e75a616
# cfc28c817 -- src/renderer/src/features/chat/components/run-details/
# mcp-auth-dialog.tsx` is empty). To reproduce from the other base, substitute the
# SHA in the archive line.
git archive cfc28c817 | tar -x -C /tmp/mcp-auth-before
mkdir -p /tmp/mcp-auth-before/docs/evidence/mcp-auth-complete
cp -R docs/evidence/mcp-auth-complete/harness \
  /tmp/mcp-auth-before/docs/evidence/mcp-auth-complete/harness
ln -s "$PWD/node_modules" /tmp/mcp-auth-before/node_modules
cd /tmp/mcp-auth-before && node docs/evidence/mcp-auth-complete/harness/capture.mjs \
  --tree=before --out=<this worktree>/docs/evidence/mcp-auth-complete
```

`--tree` is not decoration: the base tree cannot satisfy `after` and this tree
cannot satisfy `before`, because each run asserts its own footer. Pointing the
rig at the wrong tree fails the run rather than committing a mislabelled frame —
which is also the property that proves the before/after pair is a pair.

Each frame is a 1000x700 viewport at device scale factor 2, **clipped to the
dialog's own box plus 16px of the scrim around it** (704x412 pixels of file). The
subject is a two-control footer inside a 320x174 dialog; a 2760px-wide frame of
the whole window would spend 96% of its pixels on the page behind it. The dialog's
own geometry and the page size are printed by the run and quoted under each frame
below.

## The frames

| Frame | What it shows |
| --- | --- |
| [`complete-before/localOperatorDark.png`](complete-before/localOperatorDark.png), [`…Light.png`](complete-before/localOperatorLight.png) | **The defect, on the base tree.** `Sign-in complete.` with the footer reading `["Close", "Try again"]` — the operator's own screenshot, reproduced from the base commit's component under this rig (captured from `da9e75a616` and re-taken byte-identically from `cfc28c817`, the PR's base). |
| [`complete-after/localOperatorDark.png`](complete-after/localOperatorDark.png), [`…Light.png`](complete-after/localOperatorLight.png) | **The fix.** The same dialog, the same settled `complete` operation, the same sentence — and the footer reading `["Close"]` alone. |
| [`failed-after/localOperatorDark.png`](failed-after/localOperatorDark.png), [`…Light.png`](failed-after/localOperatorLight.png) | **The control.** A `failed` operation still reads `Sign-in failed.` with `["Close", "Try again"]`, so the change is shown to be scoped to a settled success rather than a blanket removal of the retry. |
| [`cancelled-after/localOperatorDark.png`](cancelled-after/localOperatorDark.png), [`…Light.png`](cancelled-after/localOperatorLight.png) | The same control for `cancelled`: `Sign-in cancelled.` with both controls, unchanged. |

Measured, in the two brand themes:

- the footer the dialog renders is read from the DOM (`Close`'s own parent) and
  printed by the run: `["Close"]` for `complete-after`, `["Close", "Try again"]`
  for `complete-before`, `failed-after` and `cancelled-after`;
- the before/after pair differs by **15,612 pixels** in the dark theme and
  **15,632** in the light — 5.38% and 5.39% of the 704x412 frame — and the
  differing pixels form **one 375x72 box at +206+258** in both. Both counts come
  from decoding the two PNGs channel by channel — this rig's own decode,
  independent of ImageMagick — and `magick compare -metric AE` agrees on the dark
  count and reads one pixel more in the light (15,633): it classifies one
  anti-aliased edge pixel differently, and the box is identical either way;
- what those pixels ARE is two mechanisms the box's single rectangle does not
  distinguish, and the distinction matters for reading the pair: in the before
  frame the footer holds `Close` in the LEFT slot and `Try again` in the right
  one, and in the after frame it holds `Close` alone in the right slot. So the
  retired control's own columns (`206`-`405`) account for **14,308** of the
  differing pixels, and the surviving button — the same border box in both frames,
  both at the footer's 100 CSS px minimum width — accounts for the remaining
  **1,304** dark / **1,324** light, which is its label ink alone (`Try again` →
  `Close`). Nothing else in the frame moved;
- the panel's own geometry is identical in all six frames (320x174 at 340,263 in
  the 1000x700 viewport), so the pair differs in its controls and not in its
  layout;
- the six `after` frames came back **byte-identical** across two runs of the
  capture (md5 of each frame unchanged), so a re-run of this rig reports the same
  pixels rather than a sampled state.

**A lone right-aligned `Close` is this dialog's own shape, not one this change
invented.** The `probing` state — which this PR does not touch — renders exactly
that footer: design round 1 measured the surviving control at the same device box
(`422-621 x 258-329`) as the completed frame's, the two frames differing only
inside the sentence band, and the panel keeping its `320x174` in all four of
`probing`, `complete`, `failed` and `cancelled`. Nothing collapses when the second
control leaves: the freed ~190 px of content box is plain ground, and the
surviving control keeps the footer's own padding (25.5 CSS px from the panel's
right and bottom edges) in every state.

## What these frames do NOT prove

- **Not the packaged Electron app.** The bridge is stubbed at the IPC seam
  (`window.api.desktop.request`) — the branch `desktopRequest` takes in Electron —
  so the preload hop, the main-process transport and a real backend's
  `mcp.control`/`mcp.list` payloads are all outside these frames.
- **Not the run panel's own row.** The panel never rendered this control for a
  completed grant (`mcpGrantStates` drops a newest `complete` operation), so the
  row is out of scope and untouched.
- **Not the rest of the dialog.** The probe's other answers (key entry, the
  "cannot determine" notice), the recorded press failure's callout, the cancel
  control and the granting phase are unchanged by this fix and are not framed
  here.
- **Not what a press of `Try again` does.** The `remedy` transition owner is
  stubbed at its own interface; the frame is about which controls are offered,
  not about what a press performs.
- **No interaction and no animation.** Each frame is one settled state, so hover,
  focus rings and the dialog's entrance are not shown; the `Try again` press path
  is not photographed at all.
- **Not the swept evidence set.** These are a bespoke rig's PNG frames, so
  `pnpm check-evidence`'s sweep does not re-read them (the sweep walks `.webp`
  under `docs/evidence`): `assertFramePaints` is called by each capture run
  instead. What is checked after the fact is the manifest's `srcTree`/`scriptsTree`
  stamp, which this change re-derives.
- **Not the second half of the claim.** The DOM assertion — one action in the
  footer at a completed grant and both at a `failed`/`cancelled`/unreadable-status
  one — is re-run by `scripts/mcp-auth-complete-no-retry.test.mjs` on every
  `pnpm test:desktop`, against this same component. That test is the
  discriminating proof; these frames are the picture of it. Its fourth case — a
  status word this build has not been taught — is deliberately NOT a differential
  one: it reads the same on both trees, and it exists to fail if a later refactor
  ever folds "cannot read this" into "settled".
