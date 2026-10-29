# The real app's first presented approvals card (#1488) — QA round 2

Design round 1 named one gap in the committed evidence: the frames on this PR were
the card **document**, captured in an offscreen window, so they could not show the
real app's first *presented* card over a live page. This directory is that run.

It is the **built app at the PR head**, not the card document on its own:
`out/main/index.js` (V8 bytecode, built here), launched through the real Electron
binary by the QA rig in the worktree, headless, with a private profile seeded to a
non-default palette. The card is presented by the app's own approvals queue, over a
real loopback page whose script raises web permission requests that the app's
session policy denies.

| build | value |
| --- | --- |
| commit | `d60e5d5e2edb4c02e2120ef4fc6508a114aae07b` (`fix/approvals-first-paint-palette`) |
| build command | `pnpm build` in a worktree of that commit (`.env` copied from the primary checkout) |
| `out/main/index.js` | `sha256 9a0e2c5478d7c4b8188f0f9e27b5776453db3b6748d7a3ef735ee37132205046`, 72 bytes (the bytecode loader stub) |
| `out/main/index.jsc` | `sha256 c7a46cb513adf5e65afd1c544814c81d9b38a394b40f95abf1afbf93829dac4a`, 6,163,560 bytes (the compiled main) |
| `out/main/bytecode-loader.cjs` | `sha256 cdcfbe2ab18e7ce3fd8c143e6183fafbcf802508465003549de0075833224c22` |
| `out/renderer/index.html` | `sha256 c15ced14b2e346f01e1ba3ebe17d5584a5b2e9dd060aedc2e35855f9423f46dd`, 4,020 bytes |
| wall time | 21.9 s |
| peak owned memory | 3,810 MB (`max(footprint, RSS)` over the build's process group; budget 9,216 MB, no breach) |
| free space | 33 GiB before, 33 GiB after (the disk is shared; this run's own tree is the worktree's `out/`) |

## What the two runs did, in order

Both runs are the same sequence with a different seeded palette (`runs.json` holds
each run's assertions, timeline and frame readings):

1. **Seed the profile the way the app persists preferences.** The store writes
   `ui-preferences-storage` lazily, so a fresh profile has no blob. The rig writes
   the store's own envelope — `{"state": {"themeName": "<palette>"}, "version": 4}`
   (the key and version read from `ui-preferences-store.ts`) — plus the
   `onboarding-storage` flags that dismiss the first-run wizard, then reloads. The
   app's theme provider then applies it: `[window-chrome] applied themeId=<palette>`
   in `app.log`, and `document.documentElement.dataset.theme === <palette>` read
   over CDP.
2. **Open the app's `/browser` route** through its own hash router.
3. **Open a real loopback page through the app's own address bar**: a real click on
   `[data-tour-tag="browser-address"]`, real CDP text insertion of the URL, a real
   Enter. The page's script asks for geolocation and notifications; the app's
   session policy denies both, and logs it
   (`[browser] denied a geolocation permission request from http://127.0.0.1:<port>/page`).
4. **Attach to the card's own target** (the controller releases and recreates the
   child, so the rig re-resolves the current target on every read).
5. **Raise one pending access request through the app's own `/rpc`** — the call an
   agent makes — `{"method": "request_access", "params": {"url": "<page>",
   "requester": "session:qa-1488-synthetic"}}`. It answered
   `{"state": "pending", "entry_id": …}` and the app logged
   `session:qa-1488-synthetic is asking for access to http://127.0.0.1:<port> (1 pending)`.
6. **Sample the card's own document every ~90-115 ms from just before that call**,
   recording `data-theme`, `visibilityState`, the viewport, the URL and the card's
   text; and capture the app's three layers at three moments (first presented,
   mid-settle, settled).
7. **Tear down by process group** and assert no pid from the run survives
   (`teardown.survivors === []` in every `facts.json`).

## The claim, per palette

`first-presented.png` is the composite at the **first sample the card document
reports as visible**. The palette it paints is the seeded one.

| palette | first visible sample | card document `data-theme` | card centre pixel | page pixel under it |
| --- | --- | --- | --- | --- |
| obsidian | 353 ms after the request | `obsidian` | `#353438` | `#1d314d` |
| kanagawaLotus | 376 ms after the request | `kanagawaLotus` | `#f1ecc1` | `#1d314d` |

The three moments per palette — first presented, mid-settle (~0.8 s) and settled
(~2.3 s) — are **byte-identical** to each other:

```
74a5af37…  dark/first-presented.png = dark/mid-settle.png = dark/settled.png
21b11bdf…  light/first-presented.png = light/mid-settle.png = light/settled.png
```

That identity is the finding rather than an accident of capture: the correction the
operator reported (the card repainting ~1 s after it appeared) leaves the framed
pixels unchanged here, because the palette was already right at the first visible
frame.

## What the timeline shows, including the one default-palette state

Sampling starts before the queue is raised. In both runs the sequence is:

| moment | card document | visibility | viewport |
| --- | --- | --- | --- |
| before the queue | `localOperatorDark`, empty text, card background `#322d22` (the stylesheet default) | `hidden` | 368x112, the unmeasured minimum |
| first visible (≈0.35 s) | the seeded palette, the queued entry's text on the card | `visible` | 368x383 |
| every sample after | the seeded palette; no other value | `visible` | 368x383 |

So the **only** default-palette state observed is a hidden, still-clipped document
that has not yet run its first-paint script — never a frame a person could see.
`timeline.json` in each palette directory is the raw sample list.

## How to read the frames

Each frame is a **layered reconstruction**, not a photograph of an OS window:
`first-presented.png` is the app's window renderer, then the page view at the
content rect the renderer reported (`x 260, y 106, 940x694` in CSS px), then the
card view anchored to that rect's bottom-right corner — in the order Electron
composites them, at devicePixelRatio 2 and averaged down to CSS pixels.

The window's own background is translucent (the app's glass), and a headless window
has no desktop behind it, so the composite's chrome region sits on a neutral
`#7a7a7a` ground. The page and card layers are the app's own pixels and are not
modified.

Each `compose.json` records the measurement behind these stills: the card's own
top-left pixel is fully transparent (`[0,0,0,0]`, the ring), the composite at that
point equals the page's pixel there (the live page shows through the ring), and the
composite's card centre equals the card layer's centre while differing from the page
underneath (the card surface covers the page).

## What this proves, and what it does not

Proven on this head, macOS arm64, headless:

- the first frame the card document reports as visible carries the user's palette,
  in a non-default dark palette and in a light one;
- no visible card sample carries `localOperatorDark` at any point before, during or
  after the card's appearance, through ~2.5 s of settlement;
- the card is presented over a live page, and the page shows through the card's
  transparent ring in the composite;
- the presented card document's URL carries the palette
  (`…?count=1&theme=dark&palette=<palette>`), so the palette is a first-paint value
  and the model push only confirms it;
- the app's own permission policy denied the page's geolocation and notification
  requests, and logged the denials.

Not proven, and stated as limits rather than passes:

- **The composite is a reconstruction.** No capture of this app contains a native
  `WebContentsView` over another one; the layers are the app's own surfaces placed
  at the bounds the app reported. An OS-level window screenshot was deliberately not
  taken (it needs the frontmost window, which is the focus theft the window modes
  exist to prevent).
- **Sampling granularity.** The timeline samples every ~90-115 ms from outside. A
  flash shorter than that interval between two samples cannot be excluded by
  sampling alone; what closes the gap is that the document's first visible sample is
  already themed and every later one agrees, and that the three composite moments
  are byte-identical.
- **The card was once observed in the default palette while hidden** (table above).
  That is a hidden document, not a presented frame; it is recorded, not excused.
- **Windows and Linux are out of scope** — not run, not claimed. Rendering, the
  opaque fallback (`process.platform !== "darwin"`) and the compositing path there
  are unmeasured here.
- **The requester is synthetic.** The consent entry was raised through the app's real
  `/rpc` with `requester: "session:qa-1488-synthetic"`; no agent process drove it.
  The app's own label for it is what the card shows.

## Reproducing

The rig lived in the QA session's scratchpad (`real-app-1488.mjs`, `compose.py`,
`assemble-evidence.py`) and is not committed: it is this run's instrument, not a
maintained harness. The sequence it performs is the seven steps above; the two run
directories' `facts.json` record every command, assertion and response it saw,
including the `/rpc` bodies and the app's browser log lines.

Guards around the launch: `--window-mode=headless`, `--use-mock-keychain`, a private
`--user-data-dir`, scratch `HOME` / `LOCAL_OPERATOR_CONFIG_DIR` /
`LOCAL_OPERATOR_LOG_DIR`, `CMUX_*` / `LOP_*` / `XPC_FLAGS` stripped, notifications
and telemetry off, and teardown by process group with a proven-empty survivor check.
