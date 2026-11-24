# Orphan ask evidence

Storybook `Notifications/Page` stories `OrphanAsk{List,Detail,Loading,Error,Dismissed}{Before,After}`,
captured with the harness browser at 2560x1440 (downscaled to 1280 wide).

- **before-*** frames: the page at base `c78604c41b2` (product source reverted, the
  new stories kept), over a bridge answering as core did: no `conversation_deleted`
  flag, every door `404 requested_not_found`.
- **after-*** frames: the PR head, over the fixed-core contract: row flagged
  `conversation_deleted: true`, no transcript asks in the detail read, decline /
  dismiss settle, a plain answer is `409 conversation_deleted`.

`error-after` uses a 503 on Decline to show a refusal drawn in place;
`dismissed-before` shows Dismiss → "No longer needed" refused with the 404 sentence.

## Round 1 remediation (design D1/D4)

Same stories and capture method, on the remediation head:

- `r1-after-dismissed.png` — `OrphanAskDismissedAfter`: after Dismiss the pane shows
  "Dismissed" under "Waiting on you"; the "Decline or dismiss it to clear it" notice is gone.
- `r1-after-declined.png` — `OrphanAskDeclinedAfter` (new story): the same end state for Decline.
- `r1-after-detail.png` — `OrphanAskDetailAfter`: open orphan, section heading now
  "Waiting on you" (was "Waiting on you in this conversation").

## QA live frames (`qa-live/`)

QA round 1's frames from the BUILT app (`capturePage`) against a real core serve
from core PR #4529 @ `3f2f33a3555b`, UI @ `7fee39456a7a`, downscaled to 1400 px wide.
Numbering matches the QA report's matrix (U1–U10): `01-list-populated` …
`12-list-end`. Frames 08/09 show Q-U1/Q-U2 (row and detail out of step after an
out-of-band delete) as found, before this remediation.
