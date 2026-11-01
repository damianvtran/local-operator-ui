# Team Bridge newest-history anchor

Release: patch

## Reproduction and lineage

This is a **rendered fixture reproduction**, not a claim about the currently
installed desktop app. The harness browser rendered the shipped owner-audit
panel and shared message list with one synthetic bounded latest page: messages
9951–10000 in chronological order, 50 rows total. Before the change, row 9951
was visible at CSS y=235.09 while newest row 10000 was at y=2775.14, below the
720-CSS-pixel viewport. Both light and dark before-frames are immutable below.
The issue is not that the fixture fetched all older history: it contains only
one page and performs no backend request.

Source lineage explains that frame: `OwnerAuditPanelView` owned a plain
`overflow-auto` div with no timeline anchor. Member DM/channel/group and the
thread pane already use the shared `useStickToBottom`, which originally located
only Radix viewports. `TeamBridgeMessageList` deliberately delegates scrolling
to its owner. This change opts audit into that same hook with an explicit native
scroll-host mode, not a second audit renderer/scroll implementation.

Authoritative backend inspection: `radient-ml/agent-server`, `origin/main`
`d3d8579e53c3bcb5c6f9b763f8e37e839c02a3d6`:

- `internal/services/bridge_conversation_owner_audit.go`, `OwnerAuditHistory`,
  resolves the existing owner window and calls `messages.ListWindow`; its next
  older cursor is the last returned sequence.
- `internal/repositories/bridge_conversation_repository.go`, `ListWindow` /
  `findPage`, defaults to descending sequence and limits the query to `limit+1`
  (default 50; accepted limit at most 100). The repository declares unique
  `(tenant_id, conversation_id, seq)` and descending-sequence indexes.
- This store is **MongoDB, not SQL**. No live database/explain, production
  request latency or index-deployment state was inspected. Index/query statements
  here are source evidence, not runtime performance proof.
- Core's `desktop_team_bridge.py::owner_audit_messages` and
  `team_bridge/client.py::owner_audit_messages` preserve the newest-first,
  bounded owner-window route. UI already requests `limit: 50` without a cursor
  for the first page and uses decreasing `before_seq` for older pages. No backend
  order, authorization, audit-window or moderation change is needed or included.

## Gap / compatibility matrix

| Surface | Before | Change / retained boundary |
| --- | --- | --- |
| Owner-audit DM/channel/group | Correct bounded newest page, but oldest row initially visible | Shared end anchor before paint; deterministic `(seq,id)` merge |
| Ordinary human/agent DM, channel/group | Existing Radix shared end/live-edge behavior | Default hook mode/policy unchanged; synthetic Radix negative control retained |
| Existing member thread pane | Existing shared anchor and explicit hold behavior | Default behavior unchanged; no thread paging rewrite |
| Audit inline replies | Hub explicitly oldest-first with forward `after_seq` | Unchanged separate endpoint capability; this main-timeline patch does not claim newest-first inline reply paging |
| Audit older pages | Explicit older cursor, unbounded accumulated pages | At most six 50-row main-timeline pages, chronological render and visible-row/pixel retention |
| Newest page evicted | Previously not bounded | Window is explicitly not live; floating existing Refresh action resets to the uncursored newest page |
| Reader returns during slow eviction | An unconditional maxPages trim would remove a visible page | Recheck actual viewport before committing: cancel/revert that older attempt if a to-be-evicted row is visible; explicit later retry only |
| Off-edge incoming data | Audit did not share live-edge behavior | Keep position, show existing localized new-message count action; explicit action returns to end |
| Resize / disclosure reflow | No audit anchor policy | Observe the content wrapper and viewport, capture stable message ID + pixel offset |
| Account/org/conversation switch | Existing owner fence and private query keys | Retained; reset anchor identity, gcTime 0, delayed old-tenant result cannot become new-tenant data |
| Refusal / cancellation | Existing errors, no audit auto-retry | Retained; page-window cancellation does not erase existing readable pages |
| Attachment / unadmitted content | Owned by separate #1554 | No attachment/content adapters, byte reads, decoding, body provenance or moderation changes |

The six-page window slides only on explicit upward requests. Once its first page
parameter is no longer undefined, it cannot represent the real live edge.
Refresh resets the query, so it asks for exactly one uncursored latest page
rather than replaying middle-history cursors. At page 7, the page that would be
evicted is checked against actual visible row IDs after the HTTP response; if
the user returned to it while waiting, the new older result is discarded via
TanStack cancellation/revert. The six existing pages and visible data remain.
There is no automatic retry or fetch-all loop. The older cursor remains available
for a later explicit request. Exhausted/non-decreasing cursors stop pagination.

This bound applies to the **main audit timeline**, not a new virtualization or
redesign of existing inline reply disclosures. The existing separately opened
reply/thread paths are not rewritten. Audit still has no polling added by this
change; incoming-data tests exercise the shared follow policy, not a new live
subscription.

## Fresh targeted checks

`scripts/team-bridge-history-anchor.test.mjs` exercises real shipped hooks,
QueryClient and API decoder. Geometry is synthetic DOM geometry (not browser
frame proof). The pagination transport uses an owned real loopback HTTP server,
not live hub credentials:

- first open: exactly one GET, limit 50, no older cursor, newest 10000 down to
  9951; older pages only after explicit action;
- stable `(seq,id)` ordering, overlap dedup and retained available bodies;
- shared native and default Radix initial end anchoring, exact pixel retention
  on prepend/reflow, live-edge follow vs off-edge count action, scope/empty/short
  reset, observer cleanup and evicted-window refusal to pretend it is live;
- six-page/300-row bound at the seventh request; late visible-page eviction is
  canceled, preserving existing pages; explicit later cursor retry, no gaps or
  duplicates, and Refresh asks for one uncursored latest page;
- a repeated/non-decreasing older cursor stops; delayed old-tenant result cannot
  replace new-tenant data or survive private gc; permanent 403 is not retried.

Latest granted small run: **3 tests, 3 pass, 0 fail**. Biome passed on six touched
source/script files. The renderer TypeScript process was killed at
1.3 GiB by the granted 1.2 GiB group limit; the one centrally authorized retry
also exceeded its 2048 MiB process-group ceiling (tool rc -9, no compiler
diagnostics or completed time/peak report). **Neither is a typecheck pass.**
No further heavy retry is permitted. Both renderer and node TypeScript projects
remain required in CI; no local node-project pass is claimed. No dependency
installs, full local suite or full/native build by this lane.

## Rendered evidence and limits

- `history-before-dark.png`, `history-before-light.png`: original unanchored
  audit host, shipped panel/list with synthetic latest 50-row data.
- `history-after-light-frame1.png` / `frame2.png`: same bounded-page story with
  shared native-host anchoring. Newest 10000 visible at end. Consecutive PNGs
  are byte-identical, SHA256
  `c1d1e9cb0cacab5ae179df97b6a432762263f32e4b27522c0ee25b795afc32eb`.
- `history-light-off-edge-arrival.png`: actual rendered props-driven exercise,
  not HTTP/live data. Reader at message 9985, offset -2.81 px; after incoming row
  10001: same ID, same -2.81 px and same scrollTop 1868.5 while scrollHeight grew
  2756→2808. Existing localized new-message button appears without moving reader.
- Above-row text reflow in that exercise: scrollHeight 2808→3264, scrollTop
  1868.5→2324.5; same visible ID 9985, offset -2.81→-2.84 px (0.03 px rounding).
  This is text/disclosure-style reflow plus synthetic resize-hook coverage,
  **not** an actual delayed-image decode claim.

These frames precede the final nonvisual eviction visibility guard. They are
not represented as a complete terminal-state screenshot matrix. The remaining
fresh final dark/consecutive-frame, settled prepend pixel comparison, page-7 eviction, warm reopen, org-switch,
slow/error and actual image-height browser matrix is pending the central
Storybook lease and independent QA/design/UX review. The first-pass fixture and
light observations above are preserved rather than replaced or mislabeled.

No installed-app focus, credentials, raw CDP, throwaway browser engine or live
customer content was used. Storybook runs through the guarded repository wrapper;
only the harness browser drives its one owned background tab. Each batch closes
the tab and verifies exact owned process-group teardown and the listener port.

## Explicit push-gate resource exception

The manager authorized the repository's documented `PREPUSH_BYPASS` (never
`--no-verify`) solely to open the PR while local TypeScript exceeds the centrally
allocated memory ceilings. It skips **all three** hook legs: scripts lint,
changed-source lint, and both-project types. Hand-run equivalents for the two
lint legs are recorded in the PR; type proof is explicitly **missing**, not
substituted by the three passing tests. Both TypeScript projects and all required
CI checks must pass before merge, plus independent code/design/UX/QA and the
remaining browser matrix. This is permission to review, not permission to merge.
