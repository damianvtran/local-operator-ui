# Chat search — finding a conversation by what was said in it

The sidebar's search used to filter the rows it already held: the title, plus
the agent or team the row was bound to. A conversation is remembered by its
subject, and the sidebar never had that text — so a session whose subject only
emerged after its opening message, or one whose title was auto-generated from
something forgettable, could not be found from the app at all. The CLI's
`/resume` picker could already do it.

These frames are the change, captured on two trees against the same store. The
`before` halves are `origin/main`'s shipped sidebar search; the `after` halves are
this branch, driven by the same harness against the same seeded store.

**BOTH HALVES ARE OLDER THAN EITHER TREE NOW, and the reason is not this branch.**
While this set was being re-shot, `main` went 0.17.3 → 0.20.1 and **started moving
the same sidebar**: #136 put a clear control INSIDE the search field and #139
realigned the New chat row. Both are visible in every frame of this set, and the
search field is in all of them, so no frame here is a picture of what either tree
draws today. The argument this table used to make — that `chat-sidebar.tsx` was
byte-identical between the `before` tree and then-current main, so the shipped
halves had not moved — is true up to 0.19.7 and false from 0.20.0, where main's own
claim to that file begins. Re-shooting the whole set on both sides of the 0.20.1
sync is the OPEN FOLLOW-UP; the attempt made in this round got no browser window at
all (the capture bridge's daemon was up with no browser attached to it, and
`browser tabs` reports exactly that), so nothing was re-shot and nothing is
claimed to have been. What survives the staleness, and why, is stated with each
claim below: the ROW-level readings are unaffected, because the code that draws
the rows is this branch's and the sync did not touch it — it is the FIELD in the
frame, and only the field, that is behind.

| Tree | Version | What it is |
| --- | --- | --- |
| `before` | `origin/main` at **0.17.3** | the shipped sidebar search: name and label only — captured when main's sidebar was the blob below. Main's sidebar has moved since (#136, #139), so read these as the shipped search path of that session, and not as today's panel |
| `after` | `feat/chat-search-content` at `bed8de048` (plus the accessibility round's frames, whose pixels are identical — see below) | the same sidebar asking `GET /v1/desktop/sessions/search`, and it is this branch's own panel: the merge that brought main's field, its clear control and the row alignment in is **after** these frames were taken, which is the other half of the staleness above |

| State | Before | After |
| --- | --- | --- |
| Sidebar at rest | the query path is the only changed path, and the pair below shows the list it feeds | [`after-rest`](after-rest/localOperatorDark.webp) — 6 rows under `Agents`, `All chats 6`, `Previous chats 6`, an empty box: the shipped rest state |
| Query `retention` | [`before-retention`](before-retention/localOperatorDark.webp) — **1 row**: the one whose TITLE contains the word. The sessions about the retention sweep are absent, and nothing in the panel says anything is missing | [`after-retention`](after-retention/localOperatorDark.webp) (dark, [light](after-retention/localOperatorLight.webp)) — **3 rows**: `Retention sweep notes` first, then `Migrate the billing reconciliation pipeline to the new ledger` and `Refactor the loader`, each carrying `· in conversation` because its CONVERSATION is why it is there |
| Query `classifer` (a typo) | [`before-typo`](before-typo/localOperatorDark.webp) — **nothing at all**: an empty panel, no count, no explanation | [`after-typo`](after-typo/localOperatorDark.webp) — **1 row**: `Investigate throughput`, surfaced by the word `classifier` inside it and marked as such |
| Query `kubernetes` (no match) | [`before-nomatch`](before-nomatch/localOperatorDark.webp) — an empty panel | [`after-nomatch`](after-nomatch/localOperatorDark.webp) — the same rows, plus `Nothing in your chats matches “kubernetes”.` |
| **A clipped answer** — more matches than one page | not reachable: no conversation search at all | [`after-clipped`](after-clipped/localOperatorDark.webp) — the second store answering `invoices` with exactly `limit` rows: `All chats 100+` / `Previous chats 100+`, spoken as `At least 100 matching`, every visible row marked `· in conversation`. The badge's `+` is the app's own reading of the answer — the op carries no truncation flag — and `searchAnswerIsClipped` is the rule that decides it (`scripts/chat-search.test.mjs`). `2880x1746`, `1440x873@2`, settled before the shutter: 100 rows, badge at `100+`, nothing in flight |
| A row carrying its own STATE (`· Not sent yet`) | not reachable without a failed first send | [`after-unstarted`](after-unstarted/localOperatorDark.webp) — `Watchlist dossiers · Not sent yet`; the binding is withheld to the tooltip, because a row draws ONE statement and the row's own state outranks it |
| **A NESTED row at the DEFAULT width** (design round 5's D19 — the case this set was re-shot for) | not covered before this pass | [`after-nested-280`](after-nested-280/localOperatorDark.webp) (dark, [light](after-nested-280/localOperatorLight.webp)) — under `coder 3`, a nested row carrying `· Not sent yet` and another carrying `· in conversation`, both drawn whole at the default 280px. Both halves are a MATCHED pair: `2880x1746`, read at `1440x873@2`, each with its own reading under [`readings/`](readings), and both taken through a SETTLE GATE — the panel had to show `coder 3`, the statements and no search in flight before the shutter. That gate is not ceremony: the first attempt at this pair photographed the pre-answer fallback (`coder 1`, one row) while looking settled, because `Searching conversations…` appears only once rows are LOST (design round 7, D26) |
| **The same at the narrowest width the sidebar drags to** | not covered before this pass | [`after-nested-240`](after-nested-240/localOperatorDark.webp) (dark, [light](after-nested-240/localOperatorLight.webp)) — the nested rows at the 240px clamp, both palettes, both with their readings |
| **A 64-character binding** (review round 4's R21) | not covered before this pass | [`after-longbinding-280`](after-longbinding-280/localOperatorDark.webp) — `Ship the search endpoint · release-pod-ob…`: the slot truncates INSIDE its 45% cap and the row stays whole; the light half of this pair is still to come, see below |
| The same binding at the narrowest width | not covered before this pass | [`after-longbinding-240`](after-longbinding-240/localOperatorDark.webp) — the same at the 240px clamp |
| A query past the op's own bound (review round 7's R37) | not reachable: the box had no bound to break | [`after-overlimit`](after-overlimit/localOperatorDark.webp) — `Search terms are limited to 256 characters. This one is longer, so only chat names are being searched.`, with no `Retry` offered and no `Searching conversations…` under it |
| A count that is a FLOOR rather than a total | not reachable: the panel counted rows it already held | no frame of its own yet: the badge draws `100+` on a full page, and its accessible name is `At least 100 matching`. Until design round 6 (D23) it was `100+ or more matching`, which said "or more" twice; the glyphs are `aria-hidden` now and the sentence is spoken once, which alters no pixel and so needed no re-shoot |
| Query `classifer` against a backend that cannot search conversations | the same empty panel | [`after-namesonly`](after-namesonly/localOperatorDark.webp) — **NOT a picture of the current tree**: a `cf0db490e` frame carrying a `server is offline` strip over a state whose whole point is that the backend answers. See the section below |
| A search route that fails while the rest of the backend answers | — | [`after-searchfail`](after-searchfail/localOperatorDark.webp) — **NOT a picture of the current tree**, same reason |

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

## What is missing, and what is stale

This set was re-shot at `bed8de048` through the operator's own browser, over two
windows, because the bridge drops repeatedly under this machine's load. What is in
the set is the state table above. What is not, or is in it but stale, is here —
named rather than left to be discovered, because a set that quietly omits a state
reads as a state that passed.

- **`after-namesonly` and `after-searchfail` are not pictures of this tree, and the
  frames say so themselves.** Both are `cf0db490e` frames from the first pass, both
  are `1184x1935` — a portrait window (592x967 CSS, sidebar about 330px, nav rail
  about 260px) — and in the run they came from the isolated backend had DIED, so
  each carries the app's own `server is offline` strip across the top, over a state
  whose whole point is that the backend answers while one route fails. They are the
  last frames in this set from the older run. Neither contains a session row (both
  panels show the notice over an empty list), so they do not carry the row layout
  that moved; what they are evidence of is the NOTICE COPY, and that alone.
  **Replacing them is an open follow-up**, not an omission: two windows against the
  two degrade proxies (`:7344` names-only, `:7346` search-failed) is the whole job.
- **The clipped answer is in the set now** ([`after-clipped`](after-clipped/localOperatorDark.webp),
  `2880x1746`, `1440x873@2`): the second store answering `invoices` with exactly
  `limit` hits, the badge reading `100+` and the heading's spoken claim
  `At least 100 matching`. It took three attempts — the first two caught the panel
  mid-load (`Loading agents…`, no rows), which is not a picture of the state — so
  this one was gated the same way the row pair is: no shutter until the report
  showed 100 rows, the badge at `100+` and nothing in flight.
- **The readings are committed, not just cited.** [`readings/`](readings) holds one
  JSON per frame this branch re-shot, plus the two accessibility probes below, in
  the shape the other sets use. Each file is what the harness POSTed from the page
  it names — and for the row pair it is the AT-SHOT snapshot, because the live file
  keeps being rewritten every 600ms after the screenshot and a reading copied later
  can describe a state nobody photographed (which is exactly how D26 happened). The
  two stale frames below have no reading: they came from the older run, off the
  older harness.
- **The light half of `after-longbinding-280`.** The dark half is here and a light
  reading with identical numbers exists; the light frame is the outstanding half of
  that pair.
- **`after-nested-240` is no longer missing.** Design round 6 accepted it as a
  recorded gap with the boxes read; both palettes are in this set now, `2880x1746`,
  `1440x873@2`, each with its own report.

The nested-280 pair was a MISMATCH when design round 6 read it — the light half at
`817` CSS against the dark half's `873`, with no reading behind it (D21) — and that
is what the re-shoot fixed: both halves were taken in one session at the same
viewport, and every number in the table above is a reading from one of the two
runs. The last pass's frames are `2880x1634` (817 CSS) and this pass's are
`2880x1746` (873 CSS), because the window the capture ran in changed height between
the two sessions; a pair is matched within itself, which is the property the pairs
are read for.

### The counts' accessible names — the one claim a frame cannot carry

The badge draws its digits and hides them from the accessibility tree, so that the
number is spoken ONCE and not as glyphs plus words (design round 6, D23). That only
works if something else carries the number in every state, and the first version
of the fix carried it only when a query was present, which left the default state
of the primary navigation announcing `All chats` where the panel draws
`All chats 6` (design round 7, D25). Both states are in
[`readings/a11y-rest.json`](readings/a11y-rest.json) and
[`readings/after-nested-280-dark.json`](readings/after-nested-280-dark.json), whose
`badges` field is the accessible name computed the way the a11y tree computes it —
the element's contents with `aria-hidden` subtrees excluded — beside the text the
panel draws:

| state | drawn | spoken |
| --- | --- | --- |
| rest, no query | `All chats 6` / `Previous chats 6` | `All chats 6` / `Previous chats 6` |
| query `retention`, 3 matches | `All chats 3 3 matching` | `All chats 3 matching` |
| clipped answer | `All chats 100+ At least 100 matching` | `All chats At least 100 matching` |

Read live in the app the frames were taken in, in one session, through the
operator's own browser — the rest row's names were also read straight off the
accessibility tree (`button "All chats 6"`, `button "Previous chats 6"`), which is
the same answer by construction.

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
