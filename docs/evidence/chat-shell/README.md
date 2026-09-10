# Chat shell layout evidence

Before/after frames and geometry for four reported defects in the chat shell:
the app-level scroll, the off-centre chat view with the wrong-coloured empty
band, the chat header style, and the working-directory widget.

## What produced these frames

**The real Electron app**, not Storybook. `electron-vite dev` running this
worktree's source, with the app's own main and preload processes, its real IPC
bridge, and a real `local-operator serve` backend on `127.0.0.1:1111` paired
through a shared `LOCAL_OPERATOR_DESKTOP_TOKEN`. Frames were captured over the
Chrome DevTools Protocol against that window, using the same raw-CDP approach
as `scripts/capture-evidence.mjs`.

That means the account is signed in, the agent list, sessions and transcripts
are genuine backend responses, and the populated frames are a real conversation
with real tool rows. The 12-theme sweep is deliberately **not** regenerated
here; these are `localOperatorDark` only, which is the default theme and the one
the reported screenshot was taken in.

**What these frames do not prove:** the packaged/notarised build (this is the
dev main process, not an installed app), native dialogs, auto-update, or any
theme other than `localOperatorDark`. The canvas-open frame is 2x scale; the
rest are 1x.

## Before / after

| Frame | Observed behaviour |
| --- | --- |
| [before-empty-1380-frame2.png](before-empty-1380-frame2.png) | The reported state. A full-width "Working directory" input bar spans the top of the chat, the header is squat and unbalanced, and the composer band is visibly darker than the panel it sits in. |
| [after-empty-1380-frame2.png](after-empty-1380-frame2.png) | Bar gone, ground uniform, header reads as a header, and the working-directory chip sits in the composer toolbar beside the attach button showing `~`. |
| [before-empty-1000-frame2.png](before-empty-1000-frame2.png) / [after-empty-1000-frame2.png](after-empty-1000-frame2.png) | Same pair at 1000x800. The before header renders 61.4px here against 46.5px at 1380 - the same declared bar, two different heights. |
| [before-empty-760-frame2.png](before-empty-760-frame2.png) / [after-empty-760-frame2.png](after-empty-760-frame2.png) | Same pair at 760x800, the narrowest width sampled. |
| [before-populated-1380-frame2.png](before-populated-1380-frame2.png) / [after-populated-1380-frame2.png](after-populated-1380-frame2.png) | A real conversation. The user bubble ("Continue") gains a visible edge; the read-only chip appears in the composer. |
| [before-populated-1000-frame2.png](before-populated-1000-frame2.png) / [after-populated-1000-frame2.png](after-populated-1000-frame2.png) | Same pair at 1000x800. |
| [after-canvas-open-1380.png](after-canvas-open-1380.png) | Canvas panel open, confirming the column still bounds itself with a second panel in the row. See "Not fixed here" below. |

`*-frame1.png` and `*-frame2.png` are consecutive captures about 1.2s apart. In
every pair the chat column is byte-identical between the two; the only pixels
that differ are the sidebar's spinning "working" status glyphs, which are live
session activity rather than layout settling. Measured with ImageMagick, the
worst pair differs by 635 of 1,203,360 pixels (0.05%), all inside the sidebar.

## The numbers behind the pictures

From `before-geometry.json` and `after-geometry.json`, captured in the same run
as the frames beside them.

| Window | `documentElement.scrollHeight - clientHeight` | Header height | Composer band ground |
| --- | --- | --- | --- |
| 1380x872 before | **308** | 46.5px | (transparent, inherits) |
| 1380x872 after | **0** | **56px** | (transparent, inherits) |
| 1000x800 before | **340** | 61.4px | `rgb(22, 19, 14)` = `canvas` |
| 1000x800 after | **0** | **56px** | `rgb(30, 26, 20)` = `surface` |
| 760x800 before | **340** | 61.4px | `rgb(22, 19, 14)` = `canvas` |
| 760x800 after | **0** | **56px** | `rgb(30, 26, 20)` = `surface` |

The chat column is `rgb(30, 26, 20)` in every row, so the before rows show the
band painting the *page* ground inside a *panel*-ground column - the ground step
running backwards. The header declares one height and rendered two different
ones before the fix; it now renders its declared 56px at all three widths.

### The scroll: what it actually was

The recon spec predicted this delta would be `0` and that the scrollbar must
belong to a descendant. **That prediction is wrong.** There is a real document
scrollbar, 308px at 1380x872 and 340px at the two narrower widths.

The owner is not the chat column. It is the `sr-only` status labels in the chat
sidebar: `sr-only` is `position: absolute` with no `top`/`left`, so it stays at
its static position, and **no ancestor was a containing block** - every one was
`position: static`. An `overflow: hidden` only clips a descendant whose
containing block it is, so `app.tsx`'s `h-screen overflow-hidden` looked like a
guarantee and was not one. A long sidebar pushed those 1x1 labels past the
viewport and stretched `<html>` behind an app that appears bounded.

Proven rather than asserted, in the running app:

```
patchedParents: 20
docDelta: { before: 308, withPositionRelative: 0, reverted: 308 }
verdict: CONFIRMED
```

Giving the escaping labels a positioned ancestor collapses the delta to zero;
reverting restores it exactly. The fix adds `relative` to the app root, which
makes the clip it already declared actually bind.

The `sr-only` utility itself is correct and was **not** changed: its computed
style matches the canonical definition exactly (`absolute`, 1x1, `overflow:
hidden`, `clip-path: inset(50%)`, `margin: -1px`, `white-space: nowrap`). After
the fix all 21 labels are still rendered at 1x1 and still in the accessibility
tree, so screen readers continue to announce them - they are contained, not
hidden.

## The measure decision (defect 2b)

Three options were rendered in the live app before choosing, with edges measured
at 1380x872. `option-a-today.png`, `option-b-composer-62ch.png` and
`option-c-prose-uncapped.png` are those frames.

| Option | Transcript inner | Agent prose | Composer | Verdict |
| --- | --- | --- | --- | --- |
| A: today | 496-1348 | 536-1083 | 496-1356 | Three right edges. The reported "not centred". |
| B: composer adopts 62ch | 496-1348 | 536-1083 | 653-1199 | Rejected. |
| C: prose uncapped | 496-1348 | 536-1348 | 496-1356 | Rejected. |

**B was rejected** because equal *width* is not equal *alignment*: the prose is
left-anchored at the 40px agent gutter while the composer is `mx-auto` centred,
so at the same 62ch width their centres still sit 117px apart (809 vs 926) and
the composer reads as a floating island narrower than the tool rows above it.

**C was rejected** because it deletes a cap that `markdown.css` documents as
deliberate: at 900px a paragraph runs past 100 characters per line. The audit is
explicit that the 62ch cap is correct and the defect is that nothing else shares
it.

**Neither is applied in this PR.** Both change the reading measure, which is a
design decision rather than a defect fix, and the spec asks for it to go to the
design round with a rendered frame of each option - which these three frames
are.

What *is* fixed here is the part that is unambiguous: the transcript is the
scroll container and the composer is not, so its 8px scrollbar took width off
one side only and its `mx-auto` centre sat 4px left of the composer's.
`scrollbar-gutter: stable both-edges` reserves the gutter on both sides:

```
before:            transcript centre 922, composer centre 926, delta 4
stable both-edges: transcript centre 926, composer centre 926, delta 0
reverted:          transcript centre 922, composer centre 926, delta 4
```

## The working-directory chip

Verified by driving the real chip in the real app, not by reading the code:

- **Live session**: renders read-only (`data-lo-cwd-chip="readonly"`), showing
  `~`, with a tooltip explaining that the directory is fixed at session start.
- **Draft session**: renders editable (`data-lo-cwd-chip="editable"`). A real
  pointer click opens the menu with all four tiers present: `Enter custom
  path...`, `Browse for directory...`, recent directories, and the ten default
  directories.
- **The write lands**: choosing "Documents" from that menu changed the chip to
  `~/Documents`, and choosing "Home" changed it back to `~`. This is the path
  that was dead before - the chip used to PATCH the agents REST API with a
  session id.
- The legacy full-width bar is absent in every after frame
  (`legacyBarPresent: false`).

## Not fixed here

With the canvas panel open the row overflows horizontally and the chat column
collapses to its 220px floor. **This is pre-existing, not a regression**, and
this branch slightly improves it - measured on the same conversation at the same
window size:

| | row overflow | header | doc scroll |
| --- | --- | --- | --- |
| `origin/main` | 128px | 63.7px | 308 |
| this branch | 120px | 56px | 0 |

The cause is a 450px-minimum canvas plus a 220px-minimum chat column plus a
900px-preferred transcript demanding more width than the row has; fixing it
means giving the canvas a shrink policy, which is a separate change to the
canvas panel and outside this slice.

## Reproducing

```
# backend, paired with the app through a shared token
export LOCAL_OPERATOR_DESKTOP_TOKEN=$(openssl rand -hex 32)
local-operator serve --host 127.0.0.1 --port 1111

# the app, with the same token in its environment
LOCAL_OPERATOR_DESKTOP_TOKEN=$... npx electron-vite dev --remoteDebuggingPort=9333
```

Then drive `http://127.0.0.1:9333/json/list` over CDP as
`scripts/capture-evidence.mjs` does.
