# Browser history and search — driven matrix

Run: `node scripts/browser-chrome-s4b-probe.mjs --out <scratch>/s4b-r3b-1792653343`
Head under test: `ca944e127c73d9824e636bcd1b14180db790171d`
Base: `c5503204ed0bc88e20dadb624de949788dc52b80`

| Row | Claim | Status | Actual evidence |
| --- | --- | --- | --- |
| H1 | a visit recorded in an earlier app run is suggested from history with no tab open on it | PASS | run 1 exited `code 0`; `openOnFixture: false`; query `127.0.0.1:58419`; rows `/history-target-b`, `/history-other`, `/history-target`, all `source: "history"`; child header `From your history` |
| H2 | typing `github` shows the Search DuckDuckGo row first and selected | PASS | row 0 `Search DuckDuckGo for "github"`, search marker, `aria-activedescendant` = row 0; child header `Suggestions` |
| H3 | typing `what is a vpn` shows the same search row first and selected | PASS | row 0 `Search DuckDuckGo for "what is a vpn"`, search marker, `aria-activedescendant` = row 0; child header `Suggestions` |
| H4 | Enter commits the highlighted search row's DuckDuckGo URL on the active tab | PASS | `github` → committed `https://duckduckgo.com/?q=github`; `what is a vpn` → committed `https://duckduckgo.com/?q=what%20is%20a%20vpn`; asserted on the active tab URL, not the page body |
| H9 | Cmd+L, ArrowDown, Enter commits the highlighted history row | PASS | selected `http://127.0.0.1:58419/history-target-b` (`source: history`), `aria-activedescendant` named it, and the active tab URL after Enter equals it. `arrowCommitted: true` |
| H10 | Enter on an untouched field with no row lowers the popout and navigates nothing | PASS | `untouchedClosed: true`; URL before and after `http://127.0.0.1:58419/history-other` — the popout dismissed, no navigation |
| H5 | an open tab with no stored history row is a tab row with its source mark | PASS | after `forgetSite(origin)`: one row, `http://127.0.0.1:58419/history-other`, `source: "tab"`; child title `Already open — S4b fixture`; header `Suggestions` |
| H8 | at narrow width the open-tab title/marker keeps a floor and does not collapse | PASS | child viewport 304px; `titleText: "Already open — S4b fixture"`, `titleWidth: 104` (the 8em floor at 13px). The assertion fails unless the viewport is ≤360px |
| R2-notices | error, empty and no_match notices each paint at 104px with no rows | PASS | child root height 104, row count 0, notice visible with its own text for all three kinds |
| H6 | a query with no match shows the no-match notice and no rows | PASS | value `zzz-nohistory.example`; owner rows `[]`; child `notice: "No matching pages in your history."`, header `Suggestions` |
| H7 | an RTL owner chrome paints an RTL child and the row text is `dir=auto` | PASS | child `dir: "rtl"`, `.lo-row-text` `dir: "auto"`, row `Search DuckDuckGo for "github"`. Limitation: app locale not switched, so the sentence is English |
| H11 | a complete host query does not match the lookalike domain | PASS | query `www.example.com`; history rows are the real `/`, `/page`, `/other`; no `evil.test` history row. The lookalike is still an open tab in the profile, so it appears once as `source: tab`, which is a real suggestion |
| H12 | the prefix `www` recalls a stored www page | PASS | fresh IPC `addressHistory({query:"www", limit:6})` returned `https://www.example.com/` (plus `/page`, `/other` and the seeded lookalike). Read directly from main, so a stale H11 renderer row cannot satisfy it |

## Heuristic table

Pinned by `scripts/browser-address-autocomplete.test.mjs` (unit, not built-app):

| Input | Intent |
| --- | --- |
| `example.com`, `example.com/path?q=1` | url |
| `https://example.com`, `http://example.com` | url |
| `file:///tmp/a.txt` | url (never searched; the field refuses it before Enter) |
| `localhost:3000`, `127.0.0.1:8080`, `192.168.1.1` | url |
| `intranet/wiki`, `nas/d/1` | url (host/path is a site path, not a single word) |
| `foo bar`, `what is a vpn`, `how to cook rice` | search |
| `github` | search (single word, no dot) |
| `1.2` | search (numeric last label, not a TLD) |
| `javascript:`, `data:`, `about:` | blocked |

## Not driven here

- `D2` (native page focus), `V9` (live approval), `V10` (zero tabs), `F1`
  (Tier 1/2 fault injection) and `BL1` keep their S4b BLOCKED status.
- Native composite pixels, native hit routing, IME, VoiceOver and non-macOS
  platforms.
- The Urdu sentence in the child: direction and `dir=auto` are driven, the app
  locale is not switched.
