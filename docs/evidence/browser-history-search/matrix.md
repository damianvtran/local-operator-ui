# Browser history and search — driven matrix

Run: `node scripts/browser-chrome-s4b-probe.mjs --out <scratch>/s4b-history-8f9-1792645397`
Head: `042dc3feeeb2f4bf7e1f3a9d9365a5a2999d20dd`
Base: `8f9fe72ec7ec9aa69b70346031294c61ee732902`

| Row | Claim | Status | Actual evidence |
| --- | --- | --- | --- |
| H1 | a visit recorded in an earlier app run is suggested from history with no tab open on it | PASS | run 1 exited `code 0`; `openOnFixture: false`; query `127.0.0.1:62229`; rows `http://127.0.0.1:62229/history-other` and `http://127.0.0.1:62229/history-target`, both `data-address-suggestion-source="history"`; child header `From your history` |
| H2 | typing `github` shows the Search DuckDuckGo row first and selected | PASS | row 0 text `Search DuckDuckGo for "github"`, `data-address-suggestion-search="true"`, `aria-activedescendant` = row 0; child paints the same row |
| H3 | typing `what is a vpn` shows the same search row first and selected | PASS | row 0 text `Search DuckDuckGo for "what is a vpn"`, search marker, `aria-activedescendant` = row 0; child paints the same row |
| H4 | Enter commits the highlighted search row's DuckDuckGo URL on the active tab | PASS | `github` → committed `https://duckduckgo.com/?q=github`; `what is a vpn` → committed `https://duckduckgo.com/?q=what%20is%20a%20vpn`, read before any redirect (an earlier run observed DuckDuckGo redirecting it to `?q=what+is+a+vpn`); both asserted on the active tab URL, not the page body |

## Heuristic table

Pinned by `scripts/browser-address-autocomplete.test.mjs` (unit, not built-app):

| Input | Intent |
| --- | --- |
| `example.com`, `example.com/path?q=1` | url |
| `https://example.com`, `http://example.com` | url |
| `file:///tmp/a.txt` | url (never searched; host still refuses to navigate it) |
| `localhost:3000`, `127.0.0.1:8080`, `192.168.1.1` | url |
| `foo bar`, `what is a vpn`, `how to cook rice` | search |
| `github` | search (single word, no dot) |
| `1.2` | search (numeric last label, not a TLD) |
| `javascript:`, `data:`, `about:` | blocked |

## Not driven here

- `D2` (native page focus), `V9` (live approval), `V10` (zero tabs), `F1`
  (Tier 1/2 fault injection) and `BL1` keep their S4b BLOCKED status.
- Native composite pixels, native hit routing, IME, VoiceOver and non-macOS
  platforms.
