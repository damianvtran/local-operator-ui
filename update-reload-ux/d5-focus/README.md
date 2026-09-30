# D5 — the band's `:focus-visible` ring, after the `outline-offset-0` fix

Design round 2 set an acceptance test for D5: real keyboard focus arriving by
**Tab**, the band at the window's bottom edge **in the same frame as that edge**,
both themes. UX round 2 took that pair and it showed **three** sides — the ring's
bottom stroke fell outside the shell's `overflow: hidden` column, because the
band's bottom edge *is* the window's bottom edge (`chat-layout.tsx` mounts the
indicator as the last in-flow child of that column; `app.tsx` and
`styles/index.css` add no bottom padding anywhere on the chain). Design named the
follow-up exactly: `outline-offset-0` on the button, or 1px of slack in the shell.

This folder is that fix, re-shot with the same rig shape.

Head under review: **`adbd67c793`** (the round-3 remediation commit). The fold that
followed it (`9a6924d780`) leaves every path these frames were taken from
byte-unchanged — `git diff <pre-fold> HEAD -- <the PR's fifteen source/script
paths>` is empty — so the frames describe the folded head too.

Viewport 1280×800, dpr 1, headless Chrome (`--headless=new`), `--use-mock-keychain`,
a private `--user-data-dir`, killed by pid and process group on exit. Nothing here
was taken from the operator's app or config, and nothing was written into a
repository except these files.

## The fix

`outline-offset-0!` on the band's button (`update-quiet-indicator.tsx`).

The `!` is the whole of the fix and not decoration: the app's focus rule is
**unlayered** — `html :focus-visible { outline-width: 2px; outline-offset: 2px }`
in `styles/index.css` — so it outranks every Tailwind utility, and the plain
`outline-offset-1` that used to be on that button was **silently ignored**. Measured
at the window edge before the fix: `outline-offset: 2px`. It is the same escape the
`Button` size variants already use (`focus-visible:outline-offset-1!`).

## The measurement

The row profile counts green pixels per row: a row with >150 is a horizontal
stroke; the two vertical strokes contribute 4–8 px. `strokeRows` lists every row
above that threshold.

| Placement | theme | ring stroke rows | green px | read |
|---|---|---|---|---|
| shipped story (`app-update`) | Dark | 149, 150, 175, 176 | 1599 | closed |
| shipped story (`app-update`) | Light | 149, 150, 175, 176 | 1651 | closed |
| **window edge** (shell's box) | Dark | **773, 774, 799** | 1388 | closed |
| **window edge** (shell's box) | Light | **773, 774, 799** | 1438 | closed |
| *before the fix* — UX round 2, same placement | both | `[771, 772]`, last row 799 carrying 6 px | — | open at the bottom |

Row 799 in the after take carries **220 px** of green (a horizontal stroke), where
the before take's row 799 carried **6** (the two verticals running off the edge).

Geometry, both themes, on the window-edge story: the control is 24 px tall at
`y 774.5…798.5` inside a 28 px row at `y 772…800` — so the ring at offset 0
(2 px wide) spans `772.5…800.5` and its outer half-row is the window's last row by
construction. `geometry.json` has the boxes and the profiles per frame, including
`:focus-visible` asserted at shutter time (`matchesFocusVisible: true`).

Honest reading of the residual: **four sides, and the bottom stroke is 1 full row
plus 2 half rows rather than 2 full rows**, because the band's bottom edge and the
window's bottom edge are the same line. Nothing of the ring leaves the window any
more. Design's stated alternative — 1px of slack in the shell — would buy the other
half-row at the cost of moving the band 1 px off its own edge; the offset fix was
the one design named first and it is the one applied.

## Files

| File | What it is |
|---|---|
| `band-focus--localOperator{Dark,Light}.png` | The **shipped** story `common-updatequietindicator--app-update`, Tab-focused, on the story's own ground. |
| `band-focus-at-window-edge--localOperator{Dark,Light}.png` | The same shipped component in a **scratch story** that reproduces the shell's box (`h-screen` + `overflow: hidden`, the band its last in-flow child). The window's bottom edge **is** in this frame (row 799). |
| `*-CROP--*.png` | Nearest-neighbour crops of the ring (4× for the shipped story, 6× for the edge pair). |
| `geometry.json` | The measured boxes, the outline, and the green-pixel row profiles. |

## How the frames were taken

Real keyboard, not `focus()`: a programmatic `.focus()` does not match
`:focus-visible` in Blink, so the rig presses `Input.dispatchKeyEvent`
`rawKeyDown`/`keyUp` Tab until `document.activeElement` matches
`[data-update-indicator-open]`, and **aborts** rather than filing a resting band
under a focus name if it never does. The element's `:focus-visible` match is
asserted at shutter time and recorded per frame.

## What this is not

Storybook frames of the shipped component in the shell's *box*, plus a source read
of the shell's ancestors — **not** a capture of the running Electron app. The
frames settle the geometry question (four sides or three), which the stories do
model once the band is placed where the shell places it; they do not settle
placement under a real transcript and sidebar, which round 1 recorded as owed and
still is.
