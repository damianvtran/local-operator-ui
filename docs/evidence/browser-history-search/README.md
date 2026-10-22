# Browser address history and search — built-app evidence

What unit tests cannot claim, driven in the built app:

1. A page visited in one app run is suggested in the NEXT run, from the
   persistent history store, with no tab open on it (H1).
2. A live tab with no stored history row is still offered, marked
   `Already open — …` (H5), and keeps that marker at narrow width (H8).
3. Non-URL input shows the DuckDuckGo search row first and selected (H2/H3),
   and Enter commits that search URL on the active tab (H4).
4. A query with no match paints the no-match notice, not a badge or a false
   row (H6).
5. An RTL owner chrome paints an RTL child, and the row text is `dir=auto`
   (H7).

## What was under test

- Branch: `feat/browser-history-search`
- Head under test: `7a339858546fb561b7fab314ec5bf89c8132d93a`
  (`fix(browser): keep the open-tab marker legible at narrow widths`)
- Base: `main` at `c5503204ed0bc88e20dadb624de949788dc52b80` (the merged S4b
  product chrome).
- Build: `pnpm build` on the head above, 2026-10-22 02:12 EDT (06:12 UTC). The
  probe does not need OAuth or analytics credentials; the build used
  placeholders for those variables only.
- Build identity, recorded in `facts.json` (the scratch `build-identity.json`
  is pruned with the session): main loader `9a0e2c…`, renderer index
  `4a90ddb…`, overlay list document `023699a…`, `out/main/index.jsc`
  `0ec2d36…`. The loader hash is what the S4b probe has always recorded; the
  bytecode hash is here because this change is main-process code.

## Command

```
node scripts/browser-chrome-s4b-probe.mjs --out <scratch>/s4b-r2c-1792649569
```

The probe is the authoritative S4b rig (headless window mode, scratch
HOME/config/log/cwd, mock keychain, `CMUX_`/`LOP_` prefixes stripped, one
Electron per run reaped by process group). It runs the S4b geometry matrix and
then a two-run history scene sharing ONE `--user-data-dir`:

1. run 1 navigates to `http://127.0.0.1:<port>/history-target`, then to
   `/history-target-b` twice (a higher-frequency decoy), waits out the 500 ms
   store debounce, closes the visited tab, waits for the session capture to
   settle, and quits;
2. run 2 relaunches on the SAME profile, opens `/history-other` (a DIFFERENT
   page on the host), and asserts in this order: H1 history rows from run 1;
   H2/H3 search rows; H4 Enter commits DuckDuckGo; H5 `forgetSite(origin)` —
   the same store path as "Forget this site" — leaves the open tab as a
   `source: "tab"` row; H8 the same row at a 304px child viewport; H6 the
   no-match notice; H7 forced-RTL chrome.

The decoy is deliberate: the highest-scoring prefix becomes the inline
completion, which the model keeps out of the candidate rows when it is
displayed, so without a higher-ranked page the visited URL would be visible only
as selected text.

## Results

| Row | Claim | Status |
| --- | --- | --- |
| H1 | a visit from the earlier run is a history row, no tab open on it | PASS |
| H2 | `github` shows `Search DuckDuckGo for "github"` first and selected | PASS |
| H3 | `what is a vpn` shows the same row first and selected | PASS |
| H4 | Enter commits the highlighted search row's DuckDuckGo URL | PASS |
| H5 | an open tab with no stored history row is a tab row with `Already open —` | PASS |
| H8 | at narrow width the marker's title keeps a 78px floor (was 0) | PASS |
| H6 | a no-match query paints the notice and no rows | PASS |
| H7 | an RTL owner paints an RTL child with `dir=auto` row text | PASS |

Exact output is in `facts.json` and `matrix.md`. The S4b geometry rows (R1, R2,
P1–P3, D1/D3, T1–T3, E1, V1–V8, V11–V15) remain PASS; D2, V9, V10, F1 and BL1
remain their previously recorded BLOCKED rows.

## Frames

The PNGs are in `frames/` (after) and `before/` (the S4b popout before this
change). They are **gitignored** by repository policy, so they do not travel in
the commit; `frames.md` records their SHA-256 and the scratch path they were
written to.

- `frames/owner-history.png`, `frames/child-history.png`
- `frames/owner-search-github.png`, `frames/child-search-github.png`
- `frames/owner-search-vpn.png`, `frames/child-search-vpn.png`
- `frames/owner-open-tab.png`, `frames/child-open-tab.png`
- `frames/owner-narrow-open-tab.png`, `frames/child-narrow-open-tab.png`
- `frames/owner-no-match.png`, `frames/child-no-match.png`
- `frames/owner-rtl-search.png`, `frames/child-rtl-search.png`
- `before/owner-popout.png`, `before/child-rows.png`

## What is and is not proven

Proven by execution: the cross-restart store read, the tab source marker, the
row order and selection for both search queries, the DuckDuckGo navigation
commit, the no-match notice, the title floor at 304px, and the RTL child
direction with `dir=auto` row text.

Not proven here: native composite pixels, native hit routing, real macOS IME,
VoiceOver, Windows or Linux; the DuckDuckGo page BODY (Enter is asserted on the
committed navigation URL, not on rendered results); and the Urdu sentence
itself — H7 forces the owner document direction rather than switching the app
locale, so the row text is still the English sentence. The Urdu catalogue value
is covered by the independent translation audit, not by this frame.
