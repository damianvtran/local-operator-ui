# Browser history and search — driven matrix

Run: `node scripts/browser-chrome-s4b-probe.mjs --out <scratch>/s4b-r2c-1792649569`
Head under test: `7a339858546fb561b7fab314ec5bf89c8132d93a`
Base: `c5503204ed0bc88e20dadb624de949788dc52b80`

| Row | Claim | Status | Actual evidence |
| --- | --- | --- | --- |
| H1 | a visit recorded in an earlier app run is suggested from history with no tab open on it | PASS | run 1 exited `code 0`; `openOnFixture: false`; query `127.0.0.1:56842`; rows `/history-target-b`, `/history-other`, `/history-target`, all `source: "history"`; child header `From your history` |
| H2 | typing `github` shows the Search DuckDuckGo row first and selected | PASS | row 0 `Search DuckDuckGo for "github"`, `data-address-suggestion-search="true"`, `aria-activedescendant` = row 0; child header `Suggestions` |
| H3 | typing `what is a vpn` shows the same search row first and selected | PASS | row 0 `Search DuckDuckGo for "what is a vpn"`, search marker, `aria-activedescendant` = row 0; child header `Suggestions` |
| H4 | Enter commits the highlighted search row's DuckDuckGo URL on the active tab | PASS | `github` → committed `https://duckduckgo.com/?q=github`; `what is a vpn` → committed `https://duckduckgo.com/?q=what+is+a+vpn`; asserted on the active tab URL, not the page body |
| H5 | an open tab with no stored history row is a tab row with its source mark | PASS | after `forgetSite(origin)`: one row, `url: http://127.0.0.1:56842/history-other`, `source: "tab"`; child title `Already open — S4b fixture`; header `Suggestions` |
| H8 | at narrow width the open-tab title/marker keeps a floor and does not collapse | PASS | child viewport 304px; `titleText: "Already open — S4b fixture"`, `titleWidth: 78` (the CSS floor is 6em = 78px at 13px). Before the floor this column was 0px at the same width |
| H6 | a query with no match shows the no-match notice and no rows | PASS | value `zzz-nohistory.example`; owner rows `[]`; child `notice: "No matching pages in your history."`, header `Suggestions` |
| H7 | an RTL owner chrome paints an RTL child and the row text is `dir=auto` | PASS | child `dir: "rtl"`, `.lo-row-text` `dir: "auto"`, row `Search DuckDuckGo for "github"`. Limitation: the app locale was not switched, so the sentence is English; the Urdu string is audited separately |

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
