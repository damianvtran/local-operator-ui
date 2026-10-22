# Browser address history and search — built-app evidence

Two claims that unit tests cannot make:

1. A page visited in one app run is suggested in the NEXT run, from the
   persistent history store, with no tab open on it.
2. Non-URL input shows the DuckDuckGo search row first and selected, and Enter
   commits that search URL on the active tab.

## What was under test

- Branch: `feat/browser-history-search`
- Head: `e6d4773fbc0baeb7ab0e3f1a67545ca81548985c`
  (`test(browser): expose a suggestion row's source in the listbox`)
- Base branch: `feat/browser-chrome-s4b` at
  `1e52d32b8828d0861efde1a5a6e59f1077ada5f4`
- Build: `pnpm build` on the head above, 2026-10-22 00:33 local. The probe does
  not need OAuth or analytics credentials; the build used placeholders for
  those variables only.
- Build identity (`build-identity.json` in this directory): main loader
  `9a0e2c…`, renderer index `cfc37c…`, overlay list document `9c8bf7…`,
  `out/main/index.jsc` `9b882e…`. The main-loader hash is what the S4b probe has
  always recorded; the bytecode hash is added here because this change is
  main-process code.

## Command

```
node scripts/browser-chrome-s4b-probe.mjs --out <scratch>/s4b-history-evidence
```

The probe is the authoritative S4b rig (headless window mode, scratch
HOME/config/log/cwd, mock keychain, `CMUX_`/`LOP_` prefixes stripped, whole
process group reaped). It now runs the S4b geometry matrix and then a two-run
history scene sharing ONE `--user-data-dir`:

1. run 1 navigates to `http://127.0.0.1:<port>/history-target`, then to
   `/history-target-b` twice (a higher-frequency decoy), waits out the 500 ms
   store debounce, closes the visited tab, waits for the session capture to
   settle, and quits;
2. run 2 relaunches on the SAME profile, opens `/history-other` (a DIFFERENT
   page on the host, so the popout can raise and the visited URL is not an open
   tab), raises the popout, and queries the host.

The decoy is deliberate: the highest-scoring prefix becomes the inline
completion, which the model keeps out of the candidate rows, so without a
higher-ranked page the visited URL would be visible only as selected text. With
it, `/history-target` is a LIST row with `source: "history"`.

## Results

| Row | Claim | Status |
| --- | --- | --- |
| H1 | a visit from the earlier run is a history row, no tab open on it | PASS |
| H2 | `github` shows `Search DuckDuckGo for "github"` first and selected | PASS |
| H3 | `what is a vpn` shows the same row first and selected | PASS |
| H4 | Enter commits the highlighted search row's DuckDuckGo URL | PASS |

Exact evidence is in `facts.json` and `matrix.md`. The S4b geometry rows (R1,
R2, P1–P3, D1/D3, T1–T3, E1, V1–V8, V11–V15) remain PASS; D2, V9, V10, F1 and
BL1 remain their previously recorded BLOCKED rows.

## Frames

The PNGs are in `frames/` (after) and `before/` (the S4b round-3 popout, copied
rather than rebuilt). They are **gitignored** by repository policy, so they do
not travel in the commit; `frames.md` records their SHA-256 and the scratch path
they were written to.

- `frames/owner-history.png` — popout field with the host typed
- `frames/child-history.png` — the native list: header plus two history rows
- `frames/owner-search-github.png`, `frames/child-search-github.png`
- `frames/owner-search-vpn.png`, `frames/child-search-vpn.png`
- `before/owner-popout.png`, `before/child-rows.png` — S4b before the change

## What is and is not proven

Proven by execution: the cross-restart store read, the source marker, the row
order and selection for both queries, the DuckDuckGo navigation commit, and the
overlay child painting the same current row as the owner listbox.

Not proven here: native composite pixels, native hit routing, real macOS IME,
VoiceOver, Windows or Linux; and the DuckDuckGo page BODY — Enter is asserted on
the committed URL, not on a rendered search result. The sandbox had network: the
`what is a vpn` commit was observed redirected to the `+/&ia=web` spelling.
