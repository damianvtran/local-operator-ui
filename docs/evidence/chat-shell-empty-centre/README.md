# Empty-state centring evidence

Before/after frames and geometry for the operator's ask on the empty chat
state: "Its section should expand to the full height and the composer and its
surrounding components should be vertically centered in the view." The band
that holds the greeting, the composer and the suggestion chips now claims the
chat column's full height and centres that group when there are no messages,
and keeps its old natural-height, bottom-anchored behaviour the moment a
transcript exists.

## What produced these frames

**The real Electron app**, `electron-vite dev`, driven over raw CDP against an
isolated `local-operator serve` backend, same approach as
`docs/evidence/chat-shell/`. Three things about the isolation are load-bearing
and are why the frames can be trusted to be this branch's:

- The app ran from a **copy** of the worktree under the operator's scratch, not
  the worktree itself. `src/main/backend/config.ts` loads `.env` with dotenv
  `override: true` from `process.cwd()`, so the main process ignores any spawn
  environment and pairs with whatever `.env` says — and the shared worktree's
  `.env` pins a peer session's backend on 1111. The copy carried its own `.env`
  (backend on 8080, one of the two origins the renderer's CSP allows) and a
  symlinked `node_modules`, so captures never touched the worktree a parallel
  remediation agent was committing in.
- **Origin is asserted inertly**: the bound vite port is parsed from vite's own
  stdout (electron-vite ignored the requested port and bound 5173/5174) and the
  page's `window.location.port` is compared against it. No fetch is used for
  the assertion, so a stale window on a peer's CDP port cannot answer it.
- A **unique page marker** is written into `document.title` after every reload
  and asserted back with each measurement; a mismatch aborts the run. The
  canary runs both directions (a sentinel that must NOT be found, a nonce that
  MUST be) plus a render sanity count, so a dead instrument cannot report a
  pass.

The populated state is a real transcript seeded into the session's
`transcript.jsonl` (four rows, checked against `encode_message_payload`'s
shape); rendering it needs no model call. The empty state is reached through
the sidebar's real "New chat" control, which stages a draft — bare `#/chat`
renders a picker, not the empty state. The navigation rail is collapsed via the
persisted preferences store because at 1024px of window the expanded rail
(220px) plus the chat sidebar (280px) leave a 524px column, and `isSmallView`
trips below 550px of COLUMN width, which suppresses the greeting and chips
entirely; the operator's screenshot shows the greeting at 1024x673, so their
rail was collapsed and this reproduces that column.

Every state is entered from a fresh reload of the boot picker, because the
composer's textarea is a growable part that keeps whatever height its previous
content gave it: a draft opened directly after a populated conversation
measured 459px where the same draft opened from boot measured 421.5px.

## The numbers

From `before-measurements.json` / `after-measurements.json`, captured in the
same runs as the frames beside them. `aboveBand` is the free space above the
band inside the column (the dark void in the before frames); `inBand` is the
free space above/below the centred group inside the band's content box.

| Window | State | band h | band grow | transcript h | aboveBand | band share of column | inBand free | popup hit-test |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1024x673 | empty before | 421.5 | 0 | 147.5 | 251.5 | 62.6% | 16/16 | 9/38 |
| 1024x673 | empty after | 569 | 1 | 0 | 104 | 84.5% | 89.8/89.7 | 7/38 |
| 1024x500 | empty before | 421.5 | 0 | 32 | 136 | 84.3% | 16/16 | 5/38 |
| 1024x500 | empty after | 421.5 | 1 | 0 | 104 | 84.3% | 16/16 | 5/38 |
| 1380x872 | empty before | 346.5 | 0 | 421.5 | 525.5 | 39.7% | 16/16 | 9/38 |
| 1380x872 | empty after | 768 | 1 | 0 | 104 | 88.1% | 208/208 | 9/38 |
| 1024x673 | populated before/after | 135.7 | 0 | 433.3 | 537.3 | 20.2% | n/a | 9/38 |
| 1024x500 | populated before/after | 135.7 | 0 | 260.3 | 364.3 | 27.1% | n/a | 9/38 |
| 1380x872 | populated before/after | 135.7 | 0 | 632.3 | 736.3 | 15.6% | n/a | 9/38 |

Two readings of the centring claim, because one number flatters itself. The
band already carried `justify-center`, so the group was ALWAYS centred inside
the band (`inBand` 16/16 before and after at 1024x673): that number cannot
distinguish the defect from the fix. What the operator reported is where the
band sits in the COLUMN, and that is what moves: `aboveBand` collapses from
251.5/525.5px of void to 104px (the header alone), the transcript's empty
scroller goes to zero height, and the band's share of the column rises to
84-88%. At 1380x872 the group then sits with 208px of band above it and 208px
below — centred in the column, not merely in a bottom-anchored band.

## The non-empty case is unchanged, byte-identically

The three populated frames are **the same files** before and after: identical
sizes and identical md5 (`62cc94358425`, `c266dade15aa`, `28470d9a5be0`). The
measurements agree field-for-field on band rect, composer rect, transcript
rect, `flex-grow`, `flex-shrink` and transcript height. The conditional is
`messages.length === 0`, and the canonical transcript yields its `grow` on the
same condition (`records.length === 0`), so the two never split the column's
free space and neither votes in the state it does not own.

## The slash popup: unchanged where it was healthy, worse where it already leaked

The popup is `absolute bottom-full` on the composer box and is not portaled, so
centring the composer lifts the popup with it. At 1380x872 nothing changes:
9/38 rows hit-testable before and after, popup top 260.5 -> 31, no clipping
ancestor. At 1024x673 the hit-test count goes 9/38 -> 7/38 and at 1024x500
5/38 -> 5/38.

That is **not a new clipping context**. The walk over the popup's ancestors
finds no box that cuts it: every `overflow-hidden` ancestor spans the full
viewport (0 to 673), and the popup's own top (-87.3 at 1024x673 after) is above
the VIEWPORT, not inside a clipped box. The rows that miss are rows the
upward-opening list painted off the top of the window. And the leak is
pre-existing, not introduced here: the before state at 1024x673 already put the
popup top at -13.5 with 9/38 hit-testable, and 1024x500 at -129 with 5/38.
Centring lifts the composer 74px and widens an existing overflow by 74px.

It is reported rather than fixed because the fix belongs to the popup's own
positioning (a flip/shift or a viewport-aware bound in `slash-commands.tsx`),
which is a separate change from the empty-state layout and outside this
slice's bounds. The measurements that make the distinction are in the JSON:
`clippedByAncestor` (null everywhere), `offscreenTop`, `rowsAboveViewport`,
and a second reading taken with the popup scrolled to its own top.

## Known nondeterminism in the empty frames

The suggestion chips are a shuffled sample, so the chip SET differs between
runs, and their wrap (4 vs 5 rows at 1024) changes the band's natural height by
37.5px between otherwise identical runs. That is pre-existing behaviour of the
suggestion list, not of this change; it is why the non-empty claim rests on
byte-identical frames and field-identical geometry rather than on pixel
comparison of the empty frames, whose content legitimately varies.

## What these frames do not prove

The packaged build (dev main process only), themes other than
`localOperatorDark`, the hydrating skeleton state (no slow backend available to
hold it open), and any viewport beyond the three sampled. The 1024 frames are
captured with the navigation rail collapsed, matching the operator's
screenshot; with the rail expanded the column drops under the 550px small-view
threshold and the greeting is suppressed by design.
