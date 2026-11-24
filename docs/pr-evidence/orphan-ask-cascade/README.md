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
