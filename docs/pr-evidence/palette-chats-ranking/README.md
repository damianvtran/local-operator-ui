# The `#` Chats palette: rank by match tier, then by recency

Four frames from a REAL Electron render of the built app, in the documented
`headless` window mode, driven over CDP's own input pipeline. Before/after are
the same scene over the same stand-in daemon: `palette-ranking-before.png` is the
base tree (`f2d6d52602`, `origin/main` at the time of the branch), the `after`
frames are the branch head.

## The operator's report, reproduced

Typing `robot` into the palette put the 500-hour-old
`Robotnik: force the approval latch fix` above the 1-hour-old `Dr. Robotnik`,
because `scoreItem` added **+0.15** to any name the query *prefixed* and recency
was only the last tie-break. Both frames are the same four-conversation fixture,
the same query and the same launch:

| frame | rows, top to bottom |
| --- | --- |
| `palette-ranking-before.png` | Robot · **Robotnik: force the approval latch fix** · Dr. Robotnik |
| `palette-ranking-after-best.png` | Robot · **Dr. Robotnik (1h)** · Robotnik: force the approval latch fix (Oct 31) |

`Robot` leads both, as it should: its name IS the query (tier 0, and the exact
`+0.3` bonus is kept). The pair that moves is the defect.

## What the `after` frames add

- **The tier, then the clock.** The old title and the recent title are the same
  tier (a word-start anywhere in the name), so the clock decides - the honourific
  and the leading word move nothing.
- **An age column on every chat row**, right-aligned and fixed-width (`1h`, `27m`,
  `Oct 31`): the row carries the fact the order reads. No row changes height -
  the ages are one `text-meta` line inside the row's own `h-9`.
- **`ctrl s`, taught in the footer** (`Ctrl+S Sort`), and **`palette-ranking-after-recent.png`**
  is that press: the chip `Chats · Most recent` appears in the field row and the
  order becomes the clock's alone (Dr. Robotnik 1h, Robot Nov 8, Robotnik Oct 31).
  The chip is drawn only when the order is not the default; "best match" is what
  a palette does and a chip restating it is noise on every open.
- **`palette-ranking-after-page-two.png`** is the page walk: 30 matching chats in a
  scoped list, and Down pressed past row 24 of 24. The second page is the
  remaining six, the selection lands on its FIRST row (`chat-many24`), and the
  footer count switches from `showing the best 24 of 30 matches` to
  `showing 6 of 30` - a paged list is not "the best N", so the claim changes with
  it.

## The rig, and how to reproduce it

Two scratch pieces, neither committed (they are a session's harness, not the
repo's):

1. `stub-two-chats.mjs` - `docs/evidence/sidebar-row-space/harness/stub-daemon.mjs`
   copied wholesale with its fixture replaced by four conversations: the two
   Robotnik titles above, `Robot` (the exact name, 300h old) and one filler. The
   copy exists because the shared fixture's six titles contain none of the pair
   this report is about. Mtims are relative to the process clock, so the labels
   read `1h` rather than a date that says nothing.
2. `palette-frame.mjs` - launches the stand-in and the BUILT app
   (`LOCAL_OPERATOR_UI_WINDOW_MODE=headless`, `--use-mock-keychain`,
   `--window-size=1380x900`, a session-unique `--user-data-dir`, `HOME` and
   `LOCAL_OPERATOR_CONFIG_DIR` under the session's scratch, `/out/` never used
   from the operator's profile), points the app at the stub through the cwd
   `.env` the repo's own driver writes, presses the rail's Search row with a real
   pointer sequence, types `robot` through `Input.insertText`, presses `ctrl s`
   as a real key event, and captures with `Page.captureScreenshot`.

The app must be built with `VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:18321`
and a stand-in listening there; `LOCAL_OPERATOR_UI_NO_BYTECODE=true` because the
bytecode plugin needs a babel plugin this tree does not install.

## What a still cannot carry

- The **selection following a row id** across a re-sort (the `ctrl s` pair keeps
  the same row active) and the page walk's index arithmetic are read off the
  run's `aria-activedescendant` values in its log, not off the pixels.
- **Keyboard reach** of `ctrl s` is pinned in `scripts/palette-shortcut.test.mjs`
  (`paletteSortIntent`), the tiers and the comparators in
  `scripts/palette-search.test.mjs`, and the preference's migration in
  `scripts/palette-recents.test.mjs`.
- Hover, focus rings and every theme other than `localOperatorDark` are out of
  this set: the change adds no fill and no border, and the age reuses the row's
  existing `text-ink-dim`/`text-meta` roles.

## Round 1 remediation (agent review, UX, design and QA findings)

The frames below were taken on the remediation commit's build. The `before-*`
pair is the previous head (`61207dbf90`) built from a detached worktree, so the
two runs differ only in the change under review.

| frame | what it shows | measured |
| --- | --- | --- |
| `footer-before-640.png` | `#robot`, Most recent, 640 px viewport | footer **87 px, two lines**, count `the best 24 of 30 matches` over an order that shows the newest |
| `footer-after-640.png` | same query and width | footer **37 px, one line**, `showing 24 of 30 1/2`; scrollWidth 576 = clientWidth 576 |
| `footer-before-468.png` | same, 468 px viewport | footer 87 px, **scrollWidth 541 in a 421 px box** (clipped) |
| `footer-after-468.png` | same, 468 px viewport | footer 37 px, scrollWidth 421 = clientWidth 421; the walk caps and the count step out below 784/560 px, the arrows and `Ctrl S` stay |
| `long-title-best.png` | a 130-character title in the list | title truncates in place, age `2d` right-aligned in its column, list scrollWidth 640 = clientWidth 640 (D1) |
| `scoped-chip-recent.png` | `#robot` + `ctrl s` | chip `# Chats · Most recent` spaced in the scoped chip (D3/Q1), one-line footer |

Both narrow runs emulate the viewport (`Emulation.setDeviceMetricsOverride`),
because the app enforces a minimum window width; the numbers above are the
dialog's own `clientWidth`, which is what the design round measured.
