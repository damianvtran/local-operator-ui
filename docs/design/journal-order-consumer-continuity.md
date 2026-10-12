# Journal-order consumer continuity (implementation in progress)

This is a **continuity checkpoint, not a completed UI fix or release claim**.
The companion core PR is `damianvtran/local-operator#2274`, frozen at
`2975a77c73bdc79e28e1c6ab36bb48f486cc791b`. Independent code/QA rounds 1–3
are answered; round 3 is clean. Whole-tree CI remains the coordinating
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

## Still required before updating PR994 / claiming complete

1. Complete the accepted tiny matrix: source tool/supplement causal anchors,
   generation/cache-loss/omission, building-ready repair race, source snapshot/
   reconcile/tail commit fences, IPC default/opt-in bounds and real isolated
   API→UI quiet correction. Reproduce source-order pins against the old reducer.
2. Audit every remaining ordering/cursor/fold path, especially reverse-page
   supplementary revisions and planner/reconcile stop criteria. Provisional
   admission anchors are explicitly provisional; carriage must replace them.
3. Do not truncate metadata coverage silently: the initial request is bounded
   to 512 IDs, and the echo is prioritized. Large-cache unresolved remainder
   needs bounded same-domain/revision batching; no claim all rows ranked yet.
4. Derive the same real fixture's all-complete-row ordinals without modifying
   IDs/timestamps/order; explain synthetic replay generation vs captured source
   coordinates. Update the existing faithful component replay story to the
   source-primary after state. No live backend/original-session sends.
5. Real browser rendered before/after + backward paging/checkpoint landing with
   initially unmounted target, bounded pane height and actual production
   component. Inspect frames; update evidence README/manifest and stamps in
   commit-then-derive order per AGENTS.md. Existing earlier frames are not new
   source-primary evidence. No installed/scripted browser engine.
6. Run final scoped scripts/lint/type/evidence gates; use CI for the whole-tree
   desktop gate under resource-light instructions. Fold current main only if
   PR994 is confirmed DIRTY, preserve unrelated owner edits, rederive stamps
   after actual fold. Then push/update PR994 with exact new evidence and ask
   coordinating manager for independent delta code/QA/design as applicable.

The production source/IPC/state integration is committed so a runtime/context
cut does not strand it. It is not yet independently reviewed or rendered, and
must not be merged based only on the targeted green tests above.
