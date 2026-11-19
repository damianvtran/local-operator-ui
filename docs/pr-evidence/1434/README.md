# New-tab address suggestions: before and after

The operator's report: on a **New tab** the address field printed
*"Address suggestions are unavailable."* and no list ever opened. The field was
in a browser-owned state (`browserOwnState`), where main refuses every native
suggestion projection — so the native child that paints the rows never existed,
and the field could only say the list was gone.

`fix/newtab-address-suggestions` renders the same rows as an in-DOM `listbox`
under the field for those browser-owned states, and adds the `Open "<typed>"`
and `Search DuckDuckGo for "<typed>"` rows.

| frame | tree | reading |
| --- | --- | --- |
| `before.png` | `d8ad3e9f3b` (the PR's pre-fix base, current `main` at sync) | New tab, `github.com` typed: the field carries the pill **"Address suggestions are unavailable."**; `data-address-rows="0"`, no `[role="listbox"]` in the document, no list box at all |
| `after.png` | `4ebae272b7` (PR head, the merge of `838325a2be` onto `d8ad3e9f3b`) | same keystroke on the same page: an in-DOM listbox whose header reads **Suggestions** with the rows **Open "github.com"** and **Search DuckDuckGo for "github.com"**; the pill is gone (`data-address-rows="2"`, one `[role="listbox"]`, `data-address-list-placement="dom"`) |

Both frames are the app photographing itself (`Page.captureScreenshot` over
CDP on the built app), full window content, default theme
(`localOperatorDark`), viewport 1380x900 at dpr 2 (2760x1800 pixels).

## Measured numbers on the synced head

Every figure is a `getBoundingClientRect()` read in the same evaluation as the
frame, in CSS pixels, at 1380x900. Both trees were read the same way.

| quantity | before (`d8ad3e9f3b`) | after (`4ebae272b7`) |
| --- | --- | --- |
| chrome band (`[data-tour-tag="browser-url-bar"]`) | x 260, y 69, **w 1120, h 37**, bottom 106 | x 260, y 69, **w 1120, h 37**, bottom 106 |
| address field (the input's own positioned box) | x 396, y 73, **w 912, h 28** | x 396, y 73, **w 912, h 28** |
| suggestion list container (`[data-address-list-placement]`) | absent | x **396**, y 106, **w 912**, h 105, bottom 211 |
| listbox (`[data-address-suggestions-list]`, inside the 1px border) | absent | x 397, y 135, w 910, h 75 |
| row height | — | **35.5** (two rows; 4px `py-0.5` around them = 75) |
| `data-address-rows` / `[role="listbox"]` count | `"0"` / 0 | `"2"` / 1 |
| start page / page content box | y 106, h 794, bottom 900 | y 106, h 794, bottom 900 |
| page scroll (`window.scrollY`, `scrollingElement.scrollTop`) | 0 / 0 | 0 / 0 |
| `document.scrollingElement.scrollHeight` | 900 | 900 |

So on this synced base: **the band stays 37px with the list open, the list's x
and width equal the field's exactly (396/912), and opening the list shifts no
page geometry** — the page box and both scroll readings are identical to the
list-closed reading taken before typing.

## How the pair was taken

Two source trees, one rig, the same keystrokes. Builds used the CI fixtures the
workflows use for non-publishing builds (no credentials):

```bash
VITE_GOOGLE_CLIENT_ID=ci-fixture.apps.googleusercontent.com \
VITE_GOOGLE_CLIENT_SECRET=ci-fixture-not-a-secret \
VITE_MICROSOFT_CLIENT_ID=00000000-0000-4000-8000-000000000001 \
VITE_MICROSOFT_TENANT_ID=00000000-0000-4000-8000-000000000002 \
  pnpm build
```

Driven headlessly — never a window, never focus:

```bash
node <session-scratch>/address-list-probe.mjs \
  --app <tree> --out <frames dir> --label before|after --address github.com
```

The rig is adapted from this repository's own `scripts/browser-chrome-s4b-probe.mjs`
(same boot, isolation and typing conventions): scratch `HOME`, config, log and
per-launch `--user-data-dir`, a scratch cwd whose `.env` points at a dead port,
`CMUX_`/`LOP_` stripped, notifications and telemetry off,
`--window-mode=headless`, `--use-mock-keychain`; it reaps its process group by
exact pid. The app's own log for each run records
`[window-mode] state: visible=false focused=false focusable=false
size=1380x900 content=1380x900` and quit on `SIGTERM`.

The address was typed through CDP's own input pipeline (`Input.insertText`) into
the focused real field; both runs report `data-address-editing="true"` and
`value="github.com"`.

## Build provenance

| tree | commit | build | `out/main/index.js` sha256 | `out/renderer/index.html` sha256 |
| --- | --- | --- | --- | --- |
| before | `d8ad3e9f3bd594eabcbf0d621676b98fe0c257e1` | `pnpm build`, 297.81s real, peak RSS 2,811,969,536 B (2.68 GiB) | `9a0e2c5478d7c4b8188f0f9e27b5776453db3b6748d7a3ef735ee37132205046` | `7aa37b89fda4d6576db786661df1b825c9e5be74613864e0f8b5895e928c4458` |
| after | `4ebae272b7494ddf4fe7bb5fa56e00d07532bda5` | `pnpm build`, 118.72s real, peak RSS 3,012,755,456 B (2.87 GiB) | `9a0e2c5478d7c4b8188f0f9e27b5776453db3b6748d7a3ef735ee37132205046` | `cf58ed62315a2306da32427691e3a4046e069f6cd0bfbd57ee8f80072951f391` |

`out/main/index.js` is byte-identical across the two trees, as expected: this
change is renderer copy and DOM, plus the overlay child's own list module. The
renderer entry document differs, and the head tree's URL bar carries the
`data-address-list-placement` attribute (`git grep` finds it on
`4ebae272b7` and not on `d8ad3e9f3b`); the head bundle contains the same
string.

## What these frames do not prove

- The **native** overlay child's behaviour on a presented page (a real site with
  its own suggestions); these two frames are the browser-owned state only.
- `Open "github.com"` / `Search DuckDuckGo for "github.com"` **committing** —
  the frames show the rows rendered; pressing one navigates (covered by the
  PR's own tests and QA's separate pass).
- VoiceOver/AT announcement, IME interaction and native hit routing.
- A real OS window's z-order (the app is headless by design), and any light
  theme, narrow-width, or load-error rendering.
- That no design concern remains; this record is geometry and pixels, not a
  design verdict.
