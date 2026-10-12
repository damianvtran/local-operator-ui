# Journal-order consumer continuity (implementation ready for terminal gates)

This is a **continuity checkpoint, not a completed UI fix or release claim**.
The companion core PR is `damianvtran/local-operator#2274`, converged at
`d02d02fa9013dc80a6a1a8c7200764f52f6a04b2`. Independent code/QA rounds 1–4
are answered; round 4 is clean. Whole-tree CI remains the coordinating
manager's terminal gate. No version bump, merge or release was performed here.

## Implemented consumer slice

- Capability-gated `journal_order` from the production chat caller through
  strict IPC requests and SSE subscription; bounded raw `order_ids` on existing
  snapshot/history/event requests. Older capability absence retains the
  explicit legacy ordering lane and request shape.
- `journal-order.ts`: source-coordinate map, opaque equality generation,
  authoritative-domain installation, separate order revision, causal call
  ownership, source-only tuple comparator and explicit provisional admission
  slots. The comparator does not mix time/ordinal pairwise or use publication
  sequence. Tool/supplement own entry coordinates remain separate from owner
  placement. Missing metadata cannot erase previously learned coordinates.
- Metadata-only `journal_order_ready` heals a quiet echo by ID and clears its
  local/provisional retractability. Source-mode seal does not use timestamps to
  delete cached records. Metadata updates retain record-owned payload/images.
- Snapshot frame dispatch revisions, reconcile request/commit revisions,
  tail request/commit revisions, and stable-ID loader request/commit revisions.
  The latter is the same path checkpoint/deep paging uses. Source revision is
  separate from view epoch/turn generation/planner history watermark.
- A single-flight authoritative `sessions.get` repair for mismatched/reconcile
  metadata. A ready notification arriving during a building response causes
  one sequential read for that distinct requested domain, not token polling.
  Older page results do not write the planner history watermark.

## Verified here, not a full consumer gate

Commands from this worktree, serial and bounded by the harness/desktop runner:

- `node scripts/run-desktop-tests.mjs scripts/transcript-journal-order.test.mjs
  scripts/transcript-reducer.test.mjs`: **180 passed**, including 175 existing
  reducer tests + five source tests (reverse/backwards/equal-ts visible custom;
  quiet metadata-only echo + seal/retract/image reference; same-ID omitted
  metadata update; non-authoritative wrong-domain no payload/cursor mutation;
  same-conversation delayed older page stale after authoritative reset).
- `pnpm check-types`: main + renderer **passed**.
- `pnpm exec biome check` over journal helper, reducer, loader, canonical hook,
  new matrix: **passed**, no fixes. Giant pre-existing desktop-contract/stream
  files reported their existing top-level-regex lint locations in the initial
  broader check; baseline attribution/full repository lint still needs a real
  gate, not an assumed pass.

Private raw logs stay in the implementer's scratchpad: `ui-source-matrix3.log`,
`ui-source-types3.log`, `ui-source-biome-final.log`. These are not browser or
original-session UI execution evidence. Initial custom fixture used the wrong
`data` vs established `details` shape; corrected from the existing test helper.

## Completed consumer matrix and real-path observations

- The source matrix now covers 17 cases: causal tool/supplement ownership and
  reverse versions; backwards/equal-ms reverse-page overlap and unchanged reread;
  metadata-only echo protection/images; omission and generation reset; 1030 cached
  IDs in 512/512/6 bounded batches; missing IDs without polling; cold ready races;
  stale request and commit fences; strict IPC opt-in/off/legacy bounds; captured
  journal-coordinate overlaps. It is registered in the explicit desktop test list.
- Three additional cases drive the shipped session hook with its established
  transport/React stand-in: late stream snapshot, outstanding tail/stable-ID read,
  and outstanding reconcile walk cannot roll back a newer authoritative source.
  These assert state/cursor/payload, not pixels or real React scheduling.
- The existing snapshot repair resolves all cached IDs in bounded same-domain
  batches. Attempts reset on a new authoritative domain. A ready fact racing an
  old ready reply remains owed. A stale flight wakes the new source once rather
  than sealing untried IDs or polling missing IDs on tokens.
- Source audit found the browser EventSource/dev proxy omitted journal options;
  the production browser path now forwards the same bounded declaration as IPC.
  Real socket tests cover old/off/on and rejection before forwarding malformed IDs.
- A published-base reducer probe (`dac6e400359`) reproduced sidecar-before-owner
  after equal-ms reverse admission AND complete reread, and with a strictly earlier
  sidecar clock. The source matrix preserves source order for those same shapes.
- The same real fixture's coordinate mapping uses the captured journal-line
  windows named in the fixture test header, including silent rows. Overlap checks
  establish 400 unique continuous offsets 305..704. The after replay explicitly
  uses a SYNTHETIC replay domain over those captured offsets, not a live domain.
- Actual browser-tool production replay was inspected: the 19:00 send is above
  the 19:07 note, with a 685px pane; consecutive settled frames were byte-identical.
  Original pre-crash memory is lost (manager report): no original live before-frame
  or successful original-image claim. Missing attachment bytes stay placeholders.
- A separate isolated real TCP HTTP/SSE router/index + production session hook,
  CanonicalTranscript and real checkpoint bridge exercised backward before_id
  reads. An initially unmounted target 1100 rows back landed at pane-top +24.02px
  after the real reads, with source clocks deliberately backwards. A quiet cached
  ID outside tail105..204 healed to coordinate0 via one metadata repair; its local/
  provisional flags disappeared without new tokens/commits. Private frames, DOM
  geometry, request logs and carrier setup are under the implementer's session
  scratchpad `source-browser/`, not new public original-session evidence.

## Explicit pre-existing boundary

`reveal-record.ts` documents the D7 near path at 12 pages / 1200 mounted rows.
The 4100-row first checkpoint is outside that contract; its real click issued
12 bounded backward requests and refused rather than landing on another row.
The anchored far-window path is explicitly unimplemented in v1. This source-order
slice preserves the limit: it does NOT claim arbitrary-distance checkpoint success
or add a new paging design. An initially unmounted in-budget target is the success
proof. The isolated quiet empty cold facade also retains the production unproven
hydration state rather than fabricating a confirmed-empty conversation.

## Remaining terminal gates

1. Commit implementation, confirm/fold main only while PR994 is DIRTY, preserve
   parallel owners and derive evidence counts from the committed merged tree.
   Current repo AGENTS.md retires srcTree/scriptsTree hashes; do not resurrect them.
2. Freeze/push the UI head and update PR994 with exact matrix, source/capability
   boundaries and private rendered proof paths. Whole desktop/build gate is CI.
3. Manager coordinates independent fresh delta code/QA/design review, merges and
   release/installed-app validation. No version bump, human reviewer, merge or
   release belongs to this implementer slice.

The production source/IPC/state integration is committed so a runtime/context
cut does not strand it. The source consumer is now rendered and exercised here, but has not yet passed
its fresh independent terminal rounds; do not merge on author-only evidence.
