# Browser address history and search — built-app evidence

What unit tests cannot claim, driven in the built app:

1. A page visited in one app run is suggested in the NEXT run, from the
   persistent history store, with no tab open on it (H1).
2. Cmd+L, ArrowDown, Enter commits the highlighted history row, and Cmd+L,
   Enter on an untouched field lowers the popout and navigates nothing
   (H9/H10).
3. A live tab with no stored history row is still offered, marked
   `Already open — …` (H5), and keeps that marker at narrow width (H8).
4. Non-URL input shows the DuckDuckGo search row first and selected (H2/H3),
   and Enter commits that search URL on the active tab (H4).
5. A no-match query paints the no-match notice, not a badge or a false row
   (H6), and a complete host query does not match a lookalike domain (H11).
6. An RTL owner chrome paints an RTL child, and the row text is `dir=auto`
   (H7).

## What was under test

- Branch: `feat/browser-history-search`
- Head under test: `ca944e127c73d9824e636bcd1b14180db790171d` (round-3
  convergence). Later commits are test/docs only and move no product byte.
- Base: `main` at `c5503204ed0bc88e20dadb624de949788dc52b80` (the merged S4b
  product chrome).
- Build: `pnpm build` on the head above, 2026-10-22 03:13 EDT (07:13 UTC). The
  probe does not need OAuth or analytics credentials; the build used
  placeholders for those variables only.
- Build identity, recorded in `facts.json` (the scratch `build-identity.json`
  is pruned with the session): main loader `9a0e2c…`, renderer index
  `6a157a3…`, overlay list document `4f8775c…`, `out/main/index.jsc`
  `bace2ad…`.

## Command

```
node scripts/browser-chrome-s4b-probe.mjs --out <scratch>/s4b-r3b-1792653343
```

The probe is the authoritative S4b rig (headless window mode, scratch
HOME/config/log/cwd, mock keychain, `CMUX_`/`LOP_` prefixes stripped, one
Electron per run reaped by process group). It runs the S4b geometry matrix and
then a two-run history scene sharing ONE `--user-data-dir`:

1. run 1 navigates to `http://127.0.0.1:<port>/history-target`, then to
   `/history-target-b` twice (a higher-frequency decoy), waits out the 500 ms
   store debounce, closes the visited tab, waits for the session capture to
   settle, and quits;
2. between runs, the scene adds stored `www.example.com` rows and a lookalike
   `www.example.com.evil.test` row to the same document;
3. run 2 relaunches on that profile and asserts H10 (untouched Enter), H1
   (cross-run history), H9 (arrow-selected commit), H2/H3 search rows, H4 Enter
   searches, H5 `forgetSite(origin)` leaves a tab row, H8 that row at a 304px
   child viewport, H6 the no-match notice, H7 forced-RTL chrome, and H11/H12
   the lookalike and `www` prefix rows.

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
| H9 | Cmd+L, ArrowDown, Enter commits the highlighted history row | PASS |
| H10 | Enter on an untouched field with no row lowers the popout, no navigation | PASS |
| H5 | an open tab with no stored history row is a tab row with `Already open —` | PASS |
| H8 | at 304px the marker keeps a 104px title floor (was 0) | PASS |
| R2-notices | error, empty and no_match each paint at 104px with no rows | PASS |
| H6 | a no-match query paints the notice and no rows | PASS |
| H7 | an RTL owner paints an RTL child with `dir=auto` row text | PASS |
| H11 | `www.example.com` does not match `www.example.com.evil.test` | PASS |
| H12 | the prefix `www` recalls the stored www page (fresh IPC) | PASS |

Exact output is in `facts.json` and `matrix.md`. R2-notices runs on the same
child document the S4b matrix uses: the legacy S2 probe aborts looking for the
deleted dock, so it cannot drive R2 on this base. The S4b geometry rows (R1, R2,
P1–P3, D1/D3, T1–T3, E1, V1–V8, V11–V15) remain PASS; D2, V9, V10, F1 and BL1
remain their previously recorded BLOCKED rows.

## Frames

The PNGs are in `frames/` (after) and `before/` (the S4b popout before this
change). They are **gitignored** by repository policy, so they do not travel in
the commit; `frames.md` records their SHA-256 and the scratch path.

- `frames/owner-history.png`, `frames/child-history.png`
- `frames/owner-search-github.png`, `frames/child-search-github.png`
- `frames/owner-search-vpn.png`, `frames/child-search-vpn.png`
- `frames/owner-open-tab.png`, `frames/child-open-tab.png`
- `frames/owner-narrow-open-tab.png`, `frames/child-narrow-open-tab.png`
- `frames/owner-no-match.png`, `frames/child-no-match.png`
- `frames/owner-rtl-search.png`, `frames/child-rtl-search.png`
- `frames/owner-boundary.png`, `frames/child-boundary.png`
- `before/owner-popout.png`, `before/child-rows.png`

## What is and is not proven

Proven by execution: the cross-restart store read, the arrow-selected commit,
the untouched-Enter dismissal, the tab source marker at narrow width, the row
order and selection for both search queries, the DuckDuckGo navigation commit,
the no-match notice, the host boundary against a lookalike domain, the `www`
prefix recall, and the RTL child direction with `dir=auto` row text.

Not proven here: native composite pixels, native hit routing, real macOS IME,
VoiceOver, Windows or Linux; the DuckDuckGo page BODY (Enter is asserted on the
committed navigation URL, not on rendered results); and the Urdu sentence
itself — H7 forces the owner document direction rather than switching the app
locale, so the row text is still the English sentence. The Urdu catalogue value
is covered by the independent translation audit, not by this frame.
