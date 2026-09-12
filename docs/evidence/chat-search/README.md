# Chat search — finding a conversation by what was said in it

The sidebar's search used to filter the rows it already held: the title, plus
the agent or team the row was bound to. A conversation is remembered by its
subject, and the sidebar never had that text — so a session whose subject only
emerged after its opening message, or one whose title was auto-generated from
something forgettable, could not be found from the app at all. The CLI's
`/resume` picker could already do it.

These frames are the change, captured on two trees against the same store:

| Tree | Version | What it is |
| --- | --- | --- |
| `before` | `origin/main` (0.17.3) | the shipped sidebar search: name and label only |
| `after` | `feat/chat-search-content` | the same sidebar asking `GET /v1/desktop/sessions/search` |

| State | Before | After |
| --- | --- | --- |
| Query `retention` | [`before-retention`](before-retention/localOperatorDark.webp) — **1 row**: the one whose TITLE contains the word. The sessions about the retention sweep are absent, and nothing in the panel says anything is missing | [`after-retention`](after-retention/localOperatorDark.webp) (dark, [light](after-retention/localOperatorLight.webp)) — **3 rows**: the name match first, then `Migrate the billing reconciliation pipeline …` and `Refactor the loader` below it, each marked `· in conversation` because its CONVERSATION is why it is there. Heading counts follow the filter |
| Query `classifer` (a typo) | [`before-typo`](before-typo/localOperatorDark.webp) — **nothing at all**: an empty panel, no count, no explanation | [`after-typo`](after-typo/localOperatorDark.webp) — **1 row**: `Investigate throughput`, surfaced by the word `classifier` inside it and marked as such |
| Query `kubernetes` (no match) | [`before-nomatch`](before-nomatch/localOperatorDark.webp) — an empty panel | [`after-nomatch`](after-nomatch/localOperatorDark.webp) — the same rows, plus `Nothing in your chats matches “kubernetes”.` The box now searches conversation text, so a blank panel asserts a much stronger claim than it used to; the sentence is `aria-live` for the same reason |
| Sidebar at rest | the query path is the only changed path, and the pair above shows the list it feeds | [`after-rest`](after-rest/localOperatorDark.webp) — unchanged from the shipped rest state: the same agents, teams, counts and groups, because search runs only when a query is present |

Read out of the live DOM in the same runs, not from the pixels:

```
before  q=retention   "… Agents coder 1 … All chats 1 … Previous chats 1"
after   q=retention   "… Agents coder 3 … Migrate the billing reconciliation pipeline to the new ledger · in conversation, matched in conversation
                       … All chats 3 matching … Previous chats 3 … Refactor the loader · coder · in conversation, matched in conversation"
before  q=classifer   "… All chats New chat Active chats Nothing running right now. Previous chats"   (empty)
after   q=classifer   "… Agents architect 1 … Investigate throughput · in conversation, matched in conversation … All chats 1 matching"
after   q=kubernetes  "Nothing in your chats matches “kubernetes”. … All chats New chat Active chats … Previous chats"
```

The mark is the same `· …` idiom and the same `text-meta text-ink-muted` roles
as the `· coder` qualifier beside it, in words: the visible words are
`aria-hidden` and the sentence is carried by an `sr-only` span, so a screen
reader hears `, matched in conversation` once rather than punctuation followed
by a sentence. It sits OUTSIDE the truncating span in a column reserved for the
whole result list, so a long title truncates and the mark never does.

## What these frames are evidence OF

- A query finds a session by the text of its conversation, not only its name,
  and the row says why it is there.
- A mistyped query (`classifer`) is answered by the bounded soft tier instead of
  returning nothing.
- Results are ranked, not merely filtered: the name match comes first and the
  conversation matches after it, in a list that is still grouped by agent.
- Nothing matched (`kubernetes`) says so rather than going blank.
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
