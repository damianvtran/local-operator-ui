# Chat search — finding a conversation by what was said in it

The sidebar's search used to filter the rows it already held: the title, plus
the agent or team the row was bound to. A conversation is remembered by its
subject, and the sidebar never had that text — so a session whose subject only
emerged after its opening message, or one whose title was auto-generated from
something forgettable, could not be found from the app at all. The CLI's
`/resume` picker could already do it.

These frames are the change, captured on two trees against the same store. The
`before` halves are `origin/main`'s shipped sidebar search; the `after` halves are
this branch at `bed8de048`, the head the capture ran against, driven by the same
harness against the same seeded store.

| Tree | Version | What it is |
| --- | --- | --- |
| `before` | `origin/main` (0.17.3) | the shipped sidebar search: name and label only. These frames are still pictures of main's panel rather than of a superseded one: `chat-sidebar.tsx` and the components it draws the list with are the SAME blob (`350012054012402e1ac84b2b076f8f80e75e22a8`) at 0.17.3 and at 0.19.6, so the shipped path they show has not moved between the two |
| `after` | `feat/chat-search-content` at `bed8de048` | the same sidebar asking `GET /v1/desktop/sessions/search`. Every `after-*` frame was captured in one session against that head, except the two marked **stale** in the table below |

| State | Before | After |
| --- | --- | --- |
| Sidebar at rest | the query path is the only changed path, and the pair below shows the list it feeds | [`after-rest`](after-rest/localOperatorDark.webp) — 6 rows under `Agents`, `All chats 6`, `Previous chats 6`, an empty box: the shipped rest state |
| Query `retention` | [`before-retention`](before-retention/localOperatorDark.webp) — **1 row**: the one whose TITLE contains the word. The sessions about the retention sweep are absent, and nothing in the panel says anything is missing | [`after-retention`](after-retention/localOperatorDark.webp) (dark, [light](after-retention/localOperatorLight.webp)) — **3 rows**: `Retention sweep notes` first, then `Migrate the billing reconciliation pipeline to the new ledger` and `Refactor the loader`, each carrying `· in conversation` because its CONVERSATION is why it is there |
| Query `classifer` (a typo) | [`before-typo`](before-typo/localOperatorDark.webp) — **nothing at all**: an empty panel, no count, no explanation | [`after-typo`](after-typo/localOperatorDark.webp) — **1 row**: `Investigate throughput`, surfaced by the word `classifier` inside it and marked as such |
| Query `kubernetes` (no match) | [`before-nomatch`](before-nomatch/localOperatorDark.webp) — an empty panel | [`after-nomatch`](after-nomatch/localOperatorDark.webp) — the same rows, plus `Nothing in your chats matches “kubernetes”.` |
| A row carrying its own STATE (`· Not sent yet`) | not reachable without a failed first send | [`after-unstarted`](after-unstarted/localOperatorDark.webp) — `Watchlist dossiers · Not sent yet`; the binding is withheld to the tooltip, because a row draws ONE statement and the row's own state outranks it |
| **A NESTED row at the DEFAULT width** (design round 5's D19 — the case this set was re-shot for) | not covered before this pass | [`after-nested-280`](after-nested-280/localOperatorDark.webp) (dark, [light](after-nested-280/localOperatorLight.webp)) — under `coder 3`, a nested row carrying `· Not sent yet` and another carrying `· in conversation`, both drawn whole at the default 280px |
| **A 64-character binding** (review round 4's R21) | not covered before this pass | [`after-longbinding-280`](after-longbinding-280/localOperatorDark.webp) — `Ship the search endpoint · release-pod-ob…`: the slot truncates INSIDE its 45% cap and the row stays whole |
| Either case at the narrowest width the sidebar drags to | not covered before this pass | [`after-longbinding-240`](after-longbinding-240/localOperatorDark.webp) — the same binding at the 240px clamp |
| A query past the op's own bound (review round 7's R37) | not reachable: the box had no bound to break | [`after-overlimit`](after-overlimit/localOperatorDark.webp) — `Search terms are limited to 256 characters. This one is longer, so only chat names are being searched.`, with no `Retry` offered and no `Searching conversations…` under it |
| Query `classifer` against a backend that cannot search conversations | the same empty panel | [`after-namesonly`](after-namesonly/localOperatorDark.webp) — **STALE FRAME, kept deliberately**: see "What this pass did not capture" |
| A search route that fails while the rest of the backend answers | — | [`after-searchfail`](after-searchfail/localOperatorDark.webp) — **STALE FRAME**, same reason |

Read out of the live DOM in the same runs, not from the pixels — and from THIS
run's head, so the dumps below are the rows as they draw now rather than as they
drew before the marker row was relaid out.

```text
rest       "Chats Agents architect 1 coder 3 designer manager reviewer scout … All chats 6 … Previous chats 6"
retention  "Chats Agents coder 3 Recent Retention sweep notes Recent Migrate the billing reconciliation pipeline to the new ledger · in conversation, matched in conversation Recent Refactor the loader · in conversation, matched in conversation … All chats 3 matching … Previous chats 3"
classifer  "… Agents architect 1 Recent Investigate throughput · in conversation, matched in conversation … All chats 1 matching"
kubernetes (no rows) — the panel holds the sentence and nothing else
dossiers   "… Recent Watchlist dossiers · Not sent yet … All chats 1 matching … Previous chats 1 matching"
endpoint   "… All chats 1 … Previous chats 1 Recent Ship the search endpoint · release-pod-observability-remediation-and-incident-response-lead"
```

Read the row text in that dump against the one it replaces: a row the conversation
search found draws the mark ALONE now — `Investigate throughput · in conversation` —
where the `cf0db490e` frames showed `Investigate throughput · coder · in
conversation`. At most one bounded statement per row, decided by
`rowTrailingStatement`, which is what the re-shoot was for.

**And the numbers behind the question a picture cannot settle.** A screenshot shows
that a slot LOOKS truncated; only the boxes say whether anything was actually
clipped, and whether the row overflowed. Read from the same runs, per row: the row's
content box (`clientWidth` less its padding), the title span's client width, the
trailing statement slot's client and scroll widths, whether each is clipped
(`scrollWidth > clientWidth`), whether the row's own content overflows its
container, and how far the row's right edge sits inside the panel's.

| state | row | content box | title client | title clipped | statement slot | slot client / scroll | slot clipped | row overflows | row vs panel |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| nested @280 | `Retention sweep notes` (nested, `not_sent`) | 224.0 | 120.0 | yes | `· Not sent yet` | 76 / 76 | no | no | 12px inside |
| nested @280 | `Migrate the billing reconciliation pipeline…` (nested) | 224.0 | 103.3 | yes | `· in conversation` | 93 / 93 | no | no | 12px inside |
| nested @240 | `Retention sweep notes` (nested, `not_sent`) | 184.0 | 80.0 | yes | `· Not sent yet` | 76 / 76 | no | no | 12px inside |
| nested @240 | `Migrate the billing reconciliation pipeline…` (nested) | 184.0 | 63.3 | yes | `· in conversation` | 93 / 93 | no | no | 12px inside |
| long binding @280 | `Ship the search endpoint` (flat) | 256.0 | 112.8 | yes | `· release-pod-…-lead` | 115 / 390 | yes | no | 8px inside |
| long binding @240 | `Ship the search endpoint` (flat) | 216.0 | 91.0 | yes | `· release-pod-…-lead` | 97 / 390 | yes | no | 8px inside |
| unstarted @280 | `Watchlist dossiers` (flat, `not_sent`) | 256.0 | 152.0 | no | `· Not sent yet` | 76 / 76 | no | no | 8px inside |

Three readings in that table are the whole case, and none of them is visible in a
frame:

- **The statements are never clipped.** Every `· …` slot has `scrollWidth ==
  clientWidth` — 76 for `· Not sent yet`, 93 for `· in conversation` — in every state
  and at both widths. D19's defect was a bare `·`, which is what a statement slot
  clipped away looks like.
- **The binding slot is capped at exactly 45%, and the cap is what truncates it**:
  115.2 of a 256.0 content box, and 97.2 of 216.0 — 45.0% both times. Its own
  `scrollWidth` is 390, so a 64-character name really is cut, and `rowOverflowsItself`
  is false, so the cut stays inside the row. Both halves of R21's fix are needed and
  both are here: the cap without `truncate` would not truncate, and `truncate`
  without the cap would have pushed the row wide.
- **Nothing overflows anywhere, above or below the clamp.** Every row's right edge
  sits inside its panel — 8 or 12px in, which is the row's own padding — and no row's
  content scrolls, at 280 and at 240.

The frames are the operator's own window at device-pixel-ratio 2, and the window's
height moved between shots (1634 or 1746 device px, 817 or 873 CSS px), so the
picture's height is a property of the window the capture ran in and not of the
panel: the dimension every claim above is about is the sidebar's, which `?width`
sets and the reports record (280px default, 240px at the clamp, both verified as
`styleWidth` on the element).

The mark is the same `· …` idiom and the same `text-meta text-ink-muted` roles
as the `· coder` qualifier beside it, in words: the visible words are
`aria-hidden` and the sentence is carried by an `sr-only` span, so a screen
reader hears `, matched in conversation` once rather than punctuation followed by
a sentence. It sits OUTSIDE the truncating span, so a long title truncates and
the mark never does, and it is rendered only on the rows that carry it —
reserving the slot list-wide cost every title ~39% of its width, including rows
that matched by their own name and therefore had nothing to explain (design
round 2, D9).

**Which trailing statement a row draws is a rule, not a flex negotiation.**
`rowTrailingStatement` in `features/chat/chat-search.ts` answers at most one of
`conversation` (the mark), `not_sent` (the row's own state) or `binding`, in that
order. Two elements truncate: the title, and the binding slot inside the cap it
carries — 45% of the row — because that slot holds a user-authored name, and a
64-character agent name has no natural width that leaves room for the chat's own
name (review round 4, R21). Until review round 6 (R31) this paragraph said the
title was the *only* element that truncates, which the binding slot's own
`truncate` had made false.

That cap is where a number earned its place. Three earlier layouts instead asked
CSS to rank the claims, and each failed in the opposite direction: one truncating
span let the ellipsis land inside a qualifier and render an orphan `·` (design
round 2, D10); every slot unbounded and `shrink-0` starved the title (design
round 4, D18); a title floor with shrinkable qualifiers clipped a qualifier to a
bare `·` and overflowed the container (design round 5, D19). The history lives on
`rowTrailingStatement` now.

## What these frames are evidence OF

- A query finds a session by the text of its conversation, not only its name,
  and the row says why it is there.
- A mistyped query (`classifer`) is answered by the bounded soft tier instead of
  returning nothing.
- Results are ranked, not merely filtered: the name match comes first and the
  conversation matches after it, in a list that is still grouped by agent.
- Nothing matched (`kubernetes`) says so rather than going blank, and says
  nothing at all when the search could not run, because then the claim is not
  checkable.
- While the box has no answer yet (the debounce plus the round trip), the panel
  says `Searching conversations…` instead of either collapsing silently or
  filling the list with the previous question's hits.
- A query past the op's bound is refused by the SURFACE, by name and before the
  wire: `Search terms are limited to 256 characters. This one is longer, so only
  chat names are being searched.`, with no `Retry` offered for a state a retry
  cannot change (review round 7, R37).
- The row's trailing statement is bounded: at most ONE per row, on nested rows as
  well as flat ones, drawn whole at both ends of the sidebar's clamp, with a
  64-character binding truncated inside its 45% cap rather than pushing the row
  wide (design round 5's D19, review round 4's R21).
- Nothing else about the panel moved: the rest state, the group structure and
  the row anatomy are the shipped ones.

## What they are NOT evidence of

- **Not the packaged Electron app.** The renderer runs in the operator's real
  browser, so the preload bridge is a no-op stub and `window.api.desktop` is
  deliberately undefined, which routes the desktop transport down its real
  `/__desktop` HTTP path. Electron IPC, native dialogs and packaging are not
  exercised here.
- **No model inference and no session is started.** The backend is isolated with
  a scratch config dir and home; every row is seeded. Nothing is sent anywhere.
- **Two themes, not twelve.** `localOperatorDark` and `localOperatorLight` — the
  two brand palettes, light included because that is where contrast defects
  hide. The twelve-theme sweep belongs to the Storybook pipeline and this
  surface has no story.
- **The phone's search and the TUI picker**, which share the same backend
  mechanic, are covered by that repository's tests rather than by these frames.

## What this pass did not capture

The set was re-shot at `bed8de048` in one session, through the operator's own
browser, and the browser bridge dropped repeatedly under this machine's load — so
this pass is a large part of the set rather than all of it. What is missing is
listed here rather than left to be discovered, because a set that quietly omits a
state reads as a state that passed.

- **`after-nested-240` — the reading is in, the frame is not.** The boxes at 240px
  are in the table above and they say what D19 needs said: at the narrowest width
  the sidebar drags to, every statement is still drawn whole (76 and 93 client px,
  nothing clipped), every title truncates rather than being starved, and no row
  overflows. The screenshot did not land before the bridge stopped answering, so
  there is no picture of it yet; it is the first frame of the next pass.
- **A clipped answer** (a query with more matches than the op's page of 100), and its
  `100+` / `At least 100 chats match this search; the list stops there` copy. Not
  photographed. The store for it exists and was verified through the real route:
  120 seeded sessions whose conversation mentions `invoices` and whose titles do not,
  so `sessions.search?q=invoices` answers with exactly `limit` hits and the catalogue
  route returns `truncated: true`. Vite was pointed at it for the shot and the bridge
  dropped first. The decision itself is covered by `scripts/chat-search.test.mjs`
  (`searchAnswerIsClipped`), which is not a picture.
- **`after-namesonly` and `after-searchfail` are STALE, and they are kept only
  because they are the only committed frames of those two states.** Both were taken
  at `cf0db490e`, and in the run they came from the isolated backend had died — so
  each carries the app's own `server is offline` strip across the top, a state this
  README does not otherwise claim to be showing. Neither contains a session row
  (both panels show the notice over an empty list), so they do not carry the row
  layout that moved; what they are evidence of is the notice copy and nothing else.
  The next pass re-shoots both, and they should be REPLACED rather than kept.
- **The light palette for `after-longbinding-280`.** Its dark half is here; the light
  half of that pair is the next pass's. `after-nested-280` has both.

None of this is a disagreement about the code. The two states the last three design
rounds were actually about — a nested row at the default width, and a binding that is
a 64-character name — are both in this set now, with their boxes.

## Re-capturing this set

**`pnpm capture-evidence` cannot re-derive these frames**: the sidebar has no
Storybook story, so the sweep's `STORIES` list contains nothing that renders it.
The set is declared in `manifest.json`'s `supplementary` block, which the sweep
preserves.

1. **Seed an isolated store** (never the operator's). Its shape is what makes the
   claim falsifiable rather than decorative: one row whose NAME holds the query,
   one whose CONVERSATION holds it under an unrelated title, one with a long
   title whose body holds it (so the mark's survival past a truncating title is
   visible), one that holds a word only as a misspelling away from the query, two
   that must NOT match, and a subagent child that must stay out of both search
   and list. `seed_chat_search.py` in the gitignored `out/evidence-harness/` does
   exactly that, writing each row's transcript, title sidecar and binding through
   the real writers.
2. **Start that backend** with its own config dir, home, port and desktop token:
   `LOCAL_OPERATOR_CONFIG_DIR=<scratch>/config LOCAL_OPERATOR_HOME=<scratch>/home
   LOCAL_OPERATOR_DESKTOP_TOKEN=<random>
   LOCAL_OPERATOR_DESKTOP_ORIGINS=http://127.0.0.1:<vite-port>
   local-operator serve --host 127.0.0.1 --port <backend-port>`.
3. **Serve the renderer** with Vite loading `electron.vite.config.js` itself
   (`createServer({configFile})`-style): importing that config from a plain Node
   script fails, because `scripts/vite-plugins/replace-backend-config` has no
   file extension, which Vite resolves and Node's ESM loader refuses. The
   harness config lives in `out/evidence-harness/` (gitignored) and does three
   things no shipped config does: it rewrites the CSP's `connect-src` (which
   pins 1111/8080 — on a developer machine those are the OPERATOR's own
   backends) to the isolated origin, it sets `VITE_LOCAL_OPERATOR_API_URL` to
   it, and it injects the preload stub plus the persisted store seeds
   (`onboarding-storage`, `ui-preferences-storage`, `canonical-sessions-storage`)
   **before** the app boots. Without the onboarding seed the first-run wizard
   covers the panel; without the stub the renderer dies on `window.api` before a
   frame paints (three separate crashes were fixed in the stub: `ipcRenderer`,
   `systemInfo.getAppVersion`, `updater.onUpdateDownloaded`).
4. **Drive it in the browser** at `?theme=<palette>`, type the query into
   `input[aria-label="Search chats and agents"]`, and screenshot. Read the
   sidebar's text as well as looking at it: the counts, the marker and the
   no-match sentence are assertions, not impressions.
5. **Repeat on the `before` tree** — a worktree of `origin/main` served by the
   same harness on its own port, against the same seeded backend — and check that
   no two frames in a state share a SHA-256.

### The states this pass still owes

In the order a next pass should take them: `after-nested-240` (its boxes are already
in the table above), the light half of `after-longbinding-280`, the clipped answer
(Vite restarted against the second store — 120 sessions whose conversation mentions
`invoices` and whose titles do not, so `sessions.search?q=invoices` answers with a
full page of 100), and then `after-namesonly` and `after-searchfail` against the two
degrade proxies, which should REPLACE the two stale frames rather than sit beside
them. The over-limit state is `?q=` holding any 257-character query, and the state
statement is `?drafts=<an unstarted session id>`.
