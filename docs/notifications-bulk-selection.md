# Frozen notification selection

The Notifications page extends its existing selection set, range selection,
operation receipt planner, and shared optimistic cache. It does not enumerate
all result IDs in the renderer or issue a write for each row.

## Scope and compatibility

- The header checkbox and Cmd/Ctrl+A select the **filtered result**, including
  unloaded pages. Kind, Priority, From and Unread/All are sent to core's existing
  notifications GET preview. A token freezes that result; new arrivals do not
  silently join it. Changing filters clears the token.
- Unchecking a row narrows the token through `excluded_ids` (at most 500).
  Explicit partial selections retain observed IDs/revisions and the observed
  sequence fence. Partial writes use batches of at most 500, preserving every
  confirmed operation receipt if a later batch fails.
- `notification_bulk_selection: 1` enables the frozen selection controls.
  Older servers show an unavailable checkbox/Dismiss all control with an upgrade
  explanation, never silently substitute the loaded page for the full result.
- `notification_bulk_ask_read: 1` **and** `selection_version: 2` enable read/unread
  of frozen ask notifications. V1 labels explicitly say **updates**, name the
  eligible count, and disable those actions for ask-only frozen selections.
  Explicit ask reads retain the pre-existing observed-token path.
- Read keeps updates in All. Dismiss removes updates from the inbox, not the
  conversation. Dismiss all confirms only when the snapshot includes unloaded
  updates or unanswered asks.

## Asks are not disposable updates

Dismiss and its Undo never settle an ask. The selected-ask callout explains
what stays; **Review unanswered asks** opens the existing ask surface. Actually
withdrawing an ask remains a separate, explicitly confirmed irreversible action,
not part of this reversible bulk operation. Reading an ask changes only its
notification read mark; actionable `waiting_count` remains unchanged.

New asks stay visible, unchecked, and live while a frozen selection is open.
A localized scope notice explains arrivals outside the gesture. **Known race:**
an ask core captures during the preview round trip can be included in the
server's frozen count while its later-visible checkbox remains unchecked;
read/unread is reversible, and dismissal still cannot touch it. The UI does not
invent membership from counts or local timestamps.

## Shared optimistic state and guarded Undo

The shared `beginOptimisticWrite` facade owns row projections, aggregate intents,
rollback, and settlement. Frozen-scope deltas are **totals**, not an extra delta
on top of known-row changes. Global counts, per-session counts, and reconciliation
rows have different server watermarks and must not borrow each other's fence.
Compact counts never prove which individual rows changed.

V2 sends at most 500 `reconcile_ids`, prioritizing visible deep-scroll rows. These
are read metadata only: they cannot expand the mutation. The same response gives
current list-row projections/absent IDs, not full bodies or ask answers. Ask
projections go back into waiting caches; newer cached revisions/sequences win.
This avoids an unbounded re-fetch of every retained infinite-query page.

Bulk Undo starts a **new aggregate intent** from the original operation receipt.
It is optimistic for counts and authoritative for rows: rows return from the
same response's reconciliation rather than from guessed per-row inverses that
could briefly change a skipped or concurrently written item. Single-row Undo
keeps the existing per-row optimistic path. Only confirmed receipts earn an
Undo offer; partial batch outcomes retain their confirmed prefix and identify
unconfirmed work.

Journal Undo travels through foreground-checked `notifications.read` IPC,
even for dismissal Undo, because a journal can restore a read mark. The wire is
still the same PATCH endpoint. A background/hidden/minimized window is refused
before network dispatch; a normal foreground user click supplies that condition.

## Row alignment

The original lead cell had only a 6px in-flow unread dot. Its 24px absolute
checkbox inherited that cell's static top while the whole row centered the cell,
so the checkbox hung below the first text line. The leading, priority, and action
cells now share one first-line-height token and the text's top padding. The
checkbox itself has a 24px hit target. Row growth below the first line cannot
move these centers.

`Notifications/Page/RowAlignment` renders the production row in one-line,
two-line, wrapped-title, wrapped-subtitle, High badge, and compact-source cases.
Its play assertion measures checkbox center versus the first line within 1px
and enforces the 24px target. The wrapping cases deliberately stress the real
component instead of assuming current ellipsis will always hide taller content.

## Verification surfaces and outstanding evidence

- `scripts/notifications-operations.test.mjs`: filtered 650-result snapshots,
  exclusions, ask exclusion/read scope, replay/conflict, sequence-guarded Undo,
  transport serialization, and bounded reconciliation that cannot expand scope.
- `scripts/notifications-page-pill.test.mjs`: mounts the production page with
  real React Query and the stateful fixture. Exercises header indeterminate
  state, Shift-click, Cmd/Ctrl+A, full-result selection, confirmation, partial
  receipts, Undo, ask review, old-core fallback, and visible unchecked arrivals.
  This is interaction/model evidence, **not layout or native foreground proof**.
- `scripts/desktop-contract.test.mjs`: the shipped foreground guard refuses
  journal Undo before transport. Native window facts are mocked; the positive
  is not native foreground evidence.
- Story states: Populated, MultiSelect, BulkAllSelected, BulkMixedAsks,
  BulkBeyondLoaded, BulkUndoToast, BulkOlderCore and RowAlignment. Async bulk
  states hold the existing capture shutter latch until their assertion settles.

Rendered light/dark before/after frames and native real-path validation remain
**BLOCKED**, not passed: the harness browser host is unhealthy after its runtime
  generation disappeared, and the manager imposed a fleet-wide hold on new
native/Storybook/live-app rigs. The stories and geometry assertions are prepared
but have not been rendered in this lane. No screenshots are fabricated, and
unit tests are not substitutes for independent QA, design, or UX review.
