# PR #1334: current-main integration evidence

Baseline: main `19f094810f` (#1304 threads and #1308 reactions).
Candidate: reviewed #1334 `74ad1ae727` merged with that main, plus the resolution
and integration story/test in this evidence commit. The three conflicted files
were the page, message list and i18n ledger. The fresh-main notification caller
also needed the new `ChiefLabels` signature (caught by renderer typecheck).

## Rendered evidence

One Storybook dev process on port 6171, heap cap 2048 MiB. All frames came from
the browser tool, 1280×720 CSS pixels, 2560×1440 raster. No other browser engine.
Baseline frames use isolated temporary copies of the main page/model/list source,
with only module import paths redirected to those baseline copies. They were
removed after capture; they are not simulated CSS changes.

- `before-unnamed.png` / `after-unnamed.png`: duplicate Ben Tran → owner's chief
  of staff in rail, header, sender and placeholder.
- `before-named.png` / `after-named.png`: named-agent control remains Aida (Ben Tran).
- `before-sparse.png` / `after-sparse.png`: padding is INSIDE the list scroller.
  `geometry.json`: bottom padding 8→24 px; list width 992 px and bottom y=628
  unchanged; top 505.31→489.31, height 122.69→138.69. No panel margin/border added.
- `before-send-clicked.png`: clicked Send on the actual main view with unresolved
  send transport; the draft stays in the composer and no optimistic row appears.
- `after-pending.png`, `after-failed.png`, `after-mixed.png`: real list's sending,
  failed/Retry and ordered mixed rows. `after-loading.png`: loading state.
- `review-contact-sheet.jpg`: visual comparison aid, not replacement for originals.

## Browser-driven integration flow

`Team Bridge/Page/OptimisticIntegrationFlow` is a scripted transport around the
real `TeamBridgePageView`, `performSend`, and `threadWithPending`. Control buttons
settle the fake create/POST or feed, not the message row. This does NOT claim a
live backend or execution of the production React Query container glue.

1. Typed "Immediate first send", clicked Send; `flow-no-conversation.png` shows
   the row before resolving create (Create 1, POST 0).
2. Resolve create, Reject POST; `flow-failed.png` keeps the row with Not sent/Retry.
3. Click the row's Retry; `flow-retry.png` shows Sending, Create 1, POST 2.
   Model tests pin the repeated client_ref and created id.
4. Deliver server copy BEFORE resolving POST: `flow-feed-before-post.png`.
   Browser geometry query `li[data-message-id]` returned **one match**, not two.
5. Resolve POST: `flow-confirmed.png`, one settled server copy, no duplicate.

## Integration regression test

`scripts/team-bridge-reactions-behaviour.test.mjs` mounts the REAL message list:
local sending/sent/failed rows must expose no server reaction/reply toolbar or
reaction chips, even with forced toolbar/reaction metadata. Only failed offers
Retry, passing the same ref. Replacing with a confirmed server id restores tools;
Reply passes the expected conversation/root id. Existing thread tests cover tenant
query isolation and real thread-pane interaction; no live server claim.

## Cleanup

Storybook root PID 71180, wrapper 71186, node 71196, esbuild 71250/71435 were
terminated by exact PID and verified absent. Browser surface closed. Log and
baseline temporary source files deleted. Disk after cleanup: 7.1 GiB.
