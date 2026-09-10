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
| [after-canvas-open-1380.png](after-canvas-open-1380.png) | Canvas panel open. **Recaptured in round 1** - see "D1: the canvas-open frame was wrong" below. |

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
| 1380x872 after | **0** | **56px box, 55px content** | (transparent, inherits) |
| 1000x800 before | **340** | 61.4px | `rgb(22, 19, 14)` = `canvas` |
| 1000x800 after | **0** | **56px box, 55px content** | `rgb(30, 26, 20)` = `surface` |
| 760x800 before | **340** | 61.4px | `rgb(22, 19, 14)` = `canvas` |
| 760x800 after | **0** | **56px box, 55px content** | `rgb(30, 26, 20)` = `surface` |

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
collapses to its 220px floor. **This is pre-existing, not a regression, and this
branch does not improve it — it is about 12px worse** - measured on the same
conversation at the same window size:

| | row overflow | header | doc scroll |
| --- | --- | --- | --- |
| `origin/main` | 128px | 63.7px | 308 |
| this branch (round 1, remeasured) | **140px** | 56px | 0 |

**The 120px figure and the improvement claim were both withdrawn in round 1**,
after re-capture put this branch at 140px against `origin/main`'s 128px. See
below.

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


---

# Round 1 remediation

## D1: the canvas-open frame was wrong, and so was the number resting on it

The design round found that the committed `after-canvas-open-1380.png` was a
frame of **`origin/main`**, not of this branch, on four independent
discriminators: a 40px header avatar (branch renders 32), a 63.5px header
(branch renders 56), a `hairline` user-bubble edge (branch renders
`border-control`), and no cwd chip in the composer toolbar. The reviewer was
right. The frame has been **recaptured from the branch** rather than quietly
deleted, and it is the file at that same path now.

The claim that rested on it is withdrawn. Re-measured on the branch, on the
same conversation and window size, the canvas-open row overflow is **140px,
not 120px** - so this branch does not improve the pre-existing overflow, it is
about 12px worse than `origin/main`'s 128px. The cause is unchanged and still
out of scope (a 450px-minimum canvas plus a 220px-minimum chat column plus a
900px-preferred measure demand more width than the row has), but the honest
statement is "pre-existing, not fixed here, and marginally worse", not "this
branch improves it".

## The production framing, which no frame in the set showed

`chat-content.tsx` renders the Chat/Raw tab strip behind `isDevelopmentMode()`,
so every frame captured from `electron-vite dev` - including all of the
originals - shows a 32px tab row that a packaged user never sees. In a
packaged build the header's bottom rule sits **directly against the
transcript**, which is where the rule's contrast matters most and which was
uncaptured.

Both adjacencies are now in the set:

| Frame | What it shows |
| --- | --- |
| [after-empty-1380-devmode-tabrow.png](after-empty-1380-devmode-tabrow.png) | The dev framing every earlier frame was taken in: 32px tab row between header and transcript. |
| [after-empty-1380-production-framing.png](after-empty-1380-production-framing.png) | The packaged adjacency, with the dev-only tablist removed: the header rule sits directly on content. |

Measured in both: header 56px, bottom rule `rgb(131, 124, 109)` =
`border-control` = **4.18:1** on `surface`, against the `hairline` **1.32:1**
it was (D3). The sidebar's own header rule in the same frame is the same role
at the same ratio, so the two rules at the top of the window are now drawn at
one weight rather than 3.2x apart.

## Document scroll: the operator's report

The operator reported that the whole app still scrolls out of view, on Chat
and on Settings. It reproduces, and the reason it reproduces for him and not
in these measurements is that **his build predates the fix**: `origin/main` is
v0.16.0 and its `app.tsx` root is `<div className="flex h-screen
overflow-hidden">` with no `relative`. The containing-block fix is in this
branch and has not shipped.

Driven authenticated (own backend, own isolated config dir, 40 real sessions
in the sidebar, onboarding dismissed, focus-emulated) at his proportions:

| Route | his build (root `static`, no document rules) | this branch |
| --- | --- | --- |
| `#/chat` @1024x673 | `scrollHeight - clientHeight` **1099**, scrolled to **1099** | **0**, scrolled to **0** |
| `#/settings` @1024x673 | **3742**, scrolled to **3742** | **0**, scrolled to **0** |

`scroll/his-build-settings-scrolled-off.png` is the operator's screenshot: the
entire app scrolled off the top leaving a black page.
`scroll/this-branch-settings-scroll-refused.png` is the identical gesture on
this branch.

Two things worth recording for whoever measures this next:

- **Settings and Chat fail for different reasons.** At 1024x673 Settings has
  **1584 elements below the fold but only 1 `sr-only`** - its driver is the
  tall settings form, not the offscreen labels - while Chat has 32-33 `sr-only`
  below the fold. One containing-block fix covers both, which is why a
  chat-only measurement could not have caught Settings.
- **The probe was made to go RED before it was trusted.** A first pass
  reported 0-of-20 scrollable across five routes and four viewports, which was
  an artifact of an unpopulated app rather than a result. The revert control
  above (1099/3742 with the rules stripped, 0 with them restored) is what makes
  the green readings evidence.

### The document-level rules are defence in depth, not the fix

`styles/index.css` now pins `height: 100%; overflow: hidden` on `html`, `body`
and `#app`, with `position: relative` on `body` and `#app`. Isolated against
each other on every real route, **each of the two fixes is independently
sufficient**: root `relative` alone gives 0, the document rules alone give 0,
both give 0. So the CSS is not what rescues the operator - the root `relative`
he does not have already does that.

It is kept because the root is only one of `#app`'s four children: React
portals mount as its siblings (the toast region, the react-query devtools
container) and anything portaled to `document.body` is a sibling of `#app`
itself, so the root's `overflow: hidden` has no authority over any of them.
Injected probes measured that path at **900px** (tall sibling of the root) and
**727px** (absolutely positioned child of `body`) of real document scroll with
the root fix in place. No real surface currently mounts such an element, so
that escape is **latent, not active** - the rules make the guarantee structural
rather than dependent on no future portal ever being tall. A
`position: fixed`-below-the-fold control passes throughout, which is what
proves overlays still cover the window.

## The measure (D4)

The design round's spec is implemented in `features/chat/chat-measure.ts`:
one shared token consumed by the transcript and the composer, expressed as
**container queries** rather than `sm:`/`md:` viewport breakpoints.

Re-measured at 1380x872, comparing like with like (the transcript's measure
column against the composer's own box):

```
before round 1:  transcript [524..1356]   composer [532..1348]   right-edge delta 8px
after round 1:   transcript [524..1356]   composer [524..1356]   right-edge delta 0
```

The 8px was the transcript's reserved scrollbar gutter, which the composer did
not account for; matching the total inset gives the two one outer edge instead
of two that nearly agree. Centres were already 0 and remain 0.

The viewport-breakpoint point was real: with the canvas open at a 1380px
window the chat column collapses to its 220px floor while `md:` is still
active, so `md:max-w-[900px]` was being applied to a 220px column. The
container query asks the width of the column instead of the window.

At 1000px and 760px the composer is 20px wider than the transcript column;
that is the pre-existing `isSmallView` path (the chat column is under 550px, so
the band uses its dense `px-1` padding), not the measure.

## Chip states (U2 / D2)

The read-only and editable chips were byte-identical at rest and on hover.
Measured again on the same chip either side of one send:

| state | colour | background | `aria-disabled` |
| --- | --- | --- | --- |
| editable, at rest | `rgb(181, 175, 162)` | transparent | absent |
| editable, hover | `rgb(241, 238, 230)` | `rgb(22, 40, 29)` | absent |
| read-only, at rest | `rgb(145, 139, 125)` | transparent | `true` |
| read-only, hover | `rgb(145, 139, 125)` | transparent | `true` |

The read-only chip no longer moves under the pointer, and the two states are
no longer the same colour. Per `branding.md`, the distinction is carried by
colour rather than opacity.

---

# Round 2 remediation

## R1 / Q-1: the composer band's scroller clipped the slash-command popup

Round 1 bounded the composer band with `max-h-[70%]` plus `overflow-y-auto`.
The bound was right; the scroller was a blocker. The slash popup renders
`absolute bottom-full` **inside** that band and is not portaled, so the band
became a clipping context on the exact axis the popup needs, and the popup was
painted on the wrong side of the scroller's edge.

What decides severity is the **band's height, not the viewport**: on an empty
chat the greeting and suggestion chips sit inside the band, making it tall
enough to contain the popup, while an ordinary conversation leaves the band at
composer height and the popup escapes above its top edge. That is why the
defect survived round 1 — nothing had opened the popup on a populated chat.

The overflow was not recoverable by scrolling. `bottom-full` puts it above the
scroller's origin, so `scrollHeight === clientHeight`, `maxScroll` is 0, and a
written `scrollTop` of 9999 reads back 0.

**The fix moves the bound onto the popup's SIBLINGS.** The previews (attachment
tiles and stacked replies) are the composer's only unbounded content, so they
now carry `max-h-[240px] overflow-y-auto` themselves — the same pattern the
textarea beside them already uses (`max-h-28` plus its own scroller). The band
ends up bounded as a consequence and needs no clipping context of its own.

Measured in the real running app (`docs/evidence/chat-shell/slash-popup/`),
hit-testable rows of 38, `/` typed with `char`-only dispatch:

| state | viewport | before | after |
| --- | --- | --- | --- |
| transcript | 1380x872 | **0/38** | **9/38** |
| transcript | 1024x673 | **0/38** | **9/38** |
| transcript | 1024x500 | **0/38** | **9/38** |
| greeting | 1380x872 | 2/38 | 9/38 |
| greeting | 1024x673 | **0/38** | 8/38 |
| greeting | 1024x500 | **0/38** | 8/38 |

Before, the ancestor walk named exactly one clipping ancestor — the band
itself. After, no ancestor clips the popup in any of the six cases, and the
send controls stay on screen in all of them.

The empty-chat branch is fixed too. Note it did **not** regress identically:
at 1024x673 the greeting made the band tall enough to contain the popup, so
that case failed only at other heights.

`scripts/canonical-chat.test.mjs` pins the rule that no ancestor of the popup
may establish a vertical clipping context, and that the bound exists on a
sibling below it. Six mutants, six killed, each asserted as landed, confirmed
to parse, and restored clean.
