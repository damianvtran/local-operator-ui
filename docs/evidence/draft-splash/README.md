# The composer band and the transcript pane on a New chat, before and after

> **The earlier generation of this set, and nothing more.** The PNGs and
> readbacks in this directory were taken with the retired raw-CDP instrument,
> with `before` at `ef40c81e2` and `after` at pre-rebase heads; references
> below to “this round” describe that historical capture generation. They are
> kept, unchanged and labelled, because they remain the record of the band's
> containment work and of the states the fresh set does not stage (the send
> path, the draft-to-session flip, a real session's hold).
>
> **The fresh capture lives in [`../draft-splash-browser/`](../draft-splash-browser/README.md)** —
> taken through the operator's own paired browser via the `browser` tool at
> `8f764cb83` (after) and `d12fecbcf` (before), with its own instrument, heads
> and numbers. Nothing here is re-stamped as fresh, and no frame in this
> directory was re-shot.

The operator's report: "the skeleton loader seems to be stuck on new chats …
instead of showing the normal splash composer visuals". On a fresh **New chat**
the band rendered the hydration skeleton and its `Loading conversation…` line
permanently, in place of `What can I help you with today?` and the suggestion
chips.

The cause was one read. The composer was gated on
`!canonical.view.hydrated` (`chat-content.tsx`), and a New chat is a staged
**draft**: `chat-page.tsx` calls `useCanonicalSessionStream(undefined, false)`,
the hook's effect returns before subscribing (`if (!sessionId || !enabled)
return`), and no page can ever be applied to a pane that has no session. So
`hydrated` stayed `false` for as long as the pane was open, and the band was told
"still loading" forever — the one state in which it may show neither the greeting
nor a transcript (design D22).

Restoring the splash put the band's own containment under the camera, and
**that is what round 1 changed here**: at the app's own minimum window height the
restored chip stack made the band taller than the pane and the column cut the
last chip row through its glyphs (design D1). The frames below are of both
claims, at four sizes, because the second only appears near the app's window
floor.

**`main` moved under the work, and it carried the second half of the operator's
report with it.** #150 (`perf/session-switch-instant`) took the hydration
placeholder out of the band and gave the transcript PANE its own hold
(`transcript-pane.ts`: `recordCount === 0 && !hydrated && !speaks`). On that base
the same New chat painted the pane's placeholder — three shimmer bars and its
`Loading conversation…` — **above** the band this branch had restored: two
contradictory claims on one screen, and the half a reader would take as a stuck
loader that was never fixed. **This round fixes it at the source**: the pane's
hold is now keyed on the same composed fact the band reads
(`CanonicalSessionHandle.awaitingHydration` — there is a stream for this session
and no page has been applied), so a pane with no session owes nothing and makes
no claim, while a real cold session's hold is unchanged. `transcript-pane.ts`'s
32-row matrix in `scripts/session-switch.test.mjs` was restated over that input
(a session-less draft and a settled-empty conversation are deliberately the same
row), and `scripts/draft-splash.test.mjs` asserts the composition for both
readers against the shipped hook, including that the pane's call site cannot read
the raw `hydrated` field.

So every `after-draft-*.png` here is a New chat with **no loading claim anywhere
in the document**: placeholders 0, shimmer bars 0, none outside the band, no
visible `Loading conversation…` — read document-wide at every size, and the
driver refuses to publish a frame that shows one. That is the acceptance bar for
both halves of the report, and it is why the after frames no longer carry the
pane's three bars. See *What these frames do not prove* for the two states this
set does not stage.

## What produced these frames

**The shipped `ChatPage`, in a browser, against a real backend — driven by this
repository's OWN capture instrument over raw CDP.** Not Storybook, and not the
app's Electron window.

- `scripts/draft-splash-evidence.vite.mjs` serves
  `scripts/draft-splash-evidence.html`, which mounts the shipped `ChatPage`
  under a minimal shell (`QueryClientProvider`, the app's own `ThemeProvider`,
  `MemoryRouter`) plus the three `window.api` / `window.electron` shims the app
  needs to mount in a browser at all (all three sites are byte-identical on
  `origin/main`; none is on the path under test). The config carries
  `desktopProxyPlugin()` — the same plugin `electron.vite.config.js` registers —
  so the shipped `desktopRequest` takes its same-origin `/__desktop` branch
  (`desktop-api.ts:62-82`), a path the product already ships for browser
  development rather than a harness fork of it.
- Behind that proxy is a real `local-operator serve` with a throwaway
  `LOCAL_OPERATOR_CONFIG_DIR`, `hosting: test` / `model_name: mock`, on its own
  port and with its own `LOCAL_OPERATOR_DESKTOP_TOKEN`, so no tokens are spent
  and the operator's config and sessions are never touched. The token and the
  backend URL are read by the Vite process and never reach the page.
- Historically, `scripts/draft-splash-capture.mjs` drove a **private headless Chrome over raw
  CDP** (a temp `--user-data-dir`, `--headless=new`, the already-installed Chrome
  binary, the built-in WebSocket): the mechanism `scripts/capture-evidence.mjs`
  and `scripts/diff-body-evidence.mjs` already use for this repository's
  committed evidence. Nothing is downloaded, no browser-automation dependency is
  added, and no login is involved — the page is a localhost harness talking to a
  throwaway backend.

**Historical instrument disclosure, not authorization.** The prior capture
reported an unavailable browser bridge and used a private headless Chrome over
raw CDP. That was **not compliant** with the operator's browser-tool-only rule.
There is no localhost, no-login, existing-tooling or unavailable-bridge exemption.
The old explanation claiming one is withdrawn. The actual capture instrument is
still recorded in `readback-*.json` and the manifest `source`; preserving those
records does not authorize rerunning it. Fresh capture uses
only the browser tool — as the fresh set did, once that browser's `localhost`
origin had been approved.

**Two worktrees at once, one backend each.** `--label=after` is the branch head;
`--label=before` is a worktree at `ef40c81e2` with the same harness files copied
in. The backend is **restarted with a fresh config dir before each run**, and
each `readback-*.json` records the commit its run was a picture of
(`capturedAtHead`, and `capturedAtSrcTree` for the source tree the manifest's own
`srcTree` is held to) — the tie that makes the pair mean anything is a stamp
rather than a paragraph.

**The two halves are of different generations, and that is stated rather than
implied.** `before` is `ef40c81e2`, which was `origin/main` when round 1 captured
it and is now an ancestor of this branch's base: it is the tree the BAND's
skeleton was the defect on, and it predates the pane's own hold entirely. `after`
has been re-shot twice on `main`'s ground — once for the rebase onto `142e86904`,
and again for this round's fix to the pane hold that rebase inherited (below). So
the pair is not "this branch against its own base": the `before` half carries the
round-1 defect, and the `after` half carries the fixed band and the fixed pane on
the historically captured tree. Re-shooting `before` on the new base is not something this instrument can
do honestly: its settled-draft expectation is the band's skeleton, and on
`142e86904` the band renders neither the skeleton nor the greeting for a draft
(the greeting branch is gated on `!isHydrating`, and a draft is `awaitingHydration
=== false` and `!hydrated === true`), so the run would refuse to publish rather
than photograph that state.

**The `after` half was re-shot a second time for this round, and only the
`after` half again.** Fixing the pane's hold changes what a New chat renders: the
pane no longer takes 230px of the column at the default window and 156px at the
two constrained sizes, so the band's splash owns the column at every size, and an
after frame from the previous pass would be a picture of a geometry the app no
longer has. That historical re-take used the now-retired capture script at
the recorded generation's head, and its readback records that head and the `src` tree the
frames are a picture of.

Each run photographs four viewports, each in its **own page load** (the
canonical sessions store persists to localStorage, so a second size would
otherwise open the session the first size's send created), and each runs the
whole sequence: the settled New chat, then a real send through the composer's own
Send button, then the settled conversation.

| Size | Why this one |
| --- | --- |
| 1380x872 | the app's own default window (`DEFAULT_WINDOW_WIDTH/HEIGHT` = 1380x900, minus the 28px macOS title bar) |
| 900x572 | the second size design round 1 measured the overflow at |
| 830x572 | the narrowest window that still takes the splash branch at the app's minimum HEIGHT (`WINDOW_MIN_HEIGHT` = 600 → 572 CSS) |
| 800x572 | the minimum window itself, whose 520px column takes the small view — the control for the splash half of the change (both trees paint neither the greeting nor a skeleton there); its composer box does move, and the before/after table below records why |

The harness publishes its own readback in `#probe` (`window.__draftSplashMarker`
for the echo check, `window.__draftSplashChipList` parsed from the product), and
the driver reads it at the settled draft, at the click of Send, immediately after
the flip's shutter, at the first painted echo and at the settled conversation.
That readback is what the frames are checked against — the run FAILS rather than
publishing when an error surface is on screen, when the draft state was never
entered, when the band disagrees with what the label says it should show, **when
anything outside the band claims to be loading** (the pane's own placeholder,
counted document-wide: placeholders, their shimmer bars, and the visible
caption), **when the band or its suggestion stack runs past the pane or a chip
row is cut**, or when the admitted send never painted a row.

## Before / after

| Frame | What it shows |
| --- | --- |
| [before-draft-1380x872-frame1.png](before-draft-1380x872-frame1.png), [-frame2.png](before-draft-1380x872-frame2.png) | The defect: a New chat settled with the hydration skeleton above the composer, no greeting and no chips. `readback-before.json` reads `greeting 0, skeleton 1, chips 0`, band 768px. The two frames differ by **7,165 pixels — 7,148 of them inside the skeleton's own row** (`1052x28+304+402`), its shimmer moving, which is why the pair is here rather than one still. |
| [after-draft-1380x872-frame1.png](after-draft-1380x872-frame1.png), [-frame2.png](after-draft-1380x872-frame2.png) | The same state on this round's tree: `What can I help you with today?`, the composer, and **7 suggestion chips** drawn from `DEFAULT_MESSAGE_SUGGESTIONS` (25 entries in `chat-content.tsx`; `message-input.tsx` samples `MAX_SUGGESTIONS = 7` of them at random, so the labels differ run to run and only the count and the membership are stable — both are asserted). The band is the **whole 872px column** (`104 + 768 = 872`) and the stack is **3 rows of 3, 104.5px in a 347.3px room — uncapped, because with the pane collapsed it fits**. Nothing on the screen claims to be loading: a draft owes no page, so the pane makes no claim and yields the column, and the splash is the only content above the composer. Those two consecutive frames are **byte-identical** (0 pixels): the movement the previous pass photographed here was the pane's placeholder pulse, and the pane no longer paints one. |
| [-band-1380x872.png](after-draft-band-1380x872.png), and the same clip at [900x572](after-draft-band-900x572.png), [830x572](after-draft-band-830x572.png), [800x572](after-draft-band-800x572.png) | The band clipped to its own box, at every size, for the close read. The 830x572 clip is the size D1 is about. |
| [before-draft-900x572-frame1.png](before-draft-900x572-frame1.png), [before-draft-830x572-frame1.png](before-draft-830x572-frame1.png) and their `-frame2` / `-band-` siblings | The same New chat on the pre-fix tree at the constrained heights: the skeleton, band 468px — inside the pane, because the skeleton is 228px of content. **The overflow those sizes are about is the CHIPS'**, which the pre-fix tree only reaches through an ordinary empty conversation (QA reproduced it there: 6–7 rows, `chipRowBottom` 582.5/600.5 against a 572px window), not through New chat. |
| [after-draft-900x572-frame1.png](after-draft-900x572-frame1.png), [after-draft-830x572-frame1.png](after-draft-830x572-frame1.png) | The fix at those sizes: 7 chips, the stack capped — **5 of its 6 rows (179.5px of 217px)** at both — and the band `104 + 468 = 572`, the whole column again, with the last visible row inside it and the boundary in the gap below it. |
| [before-draft-800x572-frame1.png](before-draft-800x572-frame1.png) / [after-draft-800x572-frame1.png](after-draft-800x572-frame1.png) | The minimum window: `greeting 0, skeleton 0, chips 0` in the BAND on **both** trees — the `isSmallView` branch, which this change does not touch. The pair differs by **11 pixels**, the composer's caret, because with the pane yielding the column the composer sits exactly where the pre-#150 tree puts it. The previous pass's 114,932-pixel difference here was the pane's placeholder (31,866) plus the composer being pushed down by the pane it no longer competes with (83,066). |
| [before-send-after-flip.png](before-send-after-flip.png), [after-send-after-flip.png](after-send-after-flip.png) | The state just after the identity flip, read back immediately after the shutter: a real session whose page is owed, so the one state in this set where the pane's hold is live. `bandAtFlipShot` caught `greeting 1, skeleton 0, chips 7` at the default size on BOTH trees — the post-flip state of an empty authoritative page, which both reach — and the before half's `greeting 0, skeleton 1` at 900x572 and 830x572, where the pre-fix band holds its skeleton; the after half reads `greeting 1, chips 7` at all three splash sizes. Whether the echo has painted by then is a race the frame does not claim to have won; the readback says which state it caught. |
| [before-send-first-painted.png](before-send-first-painted.png), [after-send-first-painted.png](after-send-first-painted.png) | The first frame in which the admitted send is painted in the transcript, read from the harness's per-frame trace: the message is a row and the band shows no greeting, no skeleton and no chips. |
| [after-send-settled-1380x872-frame1.png](after-send-settled-1380x872-frame1.png), [-frame2.png](after-send-settled-frame2.png), and `send-settled-<size>-frame1` at the other three sizes | The settled conversation, and — at 900x572 and 830x572 — the ADMITTED-SEND state the peer change at the same height budget also has to hold in: greeting gone, chips gone, the transcript column painted, and the band still exactly the pane (`736.3 + 135.7 = 872` at the default window; `404.3 + 167.7 = 572` at 900x572 and 830x572; `442 + 130 = 572` at 800x572). Nothing is capped in that state; the constraint is only that it is inside the pane. |

## The containment, and its numbers

The band deliberately carries no bound of its own — a `max-height` or an
`overflow` on it erases the slash popup, which is an unportaled
`absolute bottom-full` child of the composer box — so the bound lives on the one
thing in it that grows without one, the suggestion stack, and it is MEASURED
rather than stated: a chip row has no fixed height (a label long enough to wrap
inside its own chip makes its row taller than its neighbours), so the cap has to
land on a row boundary the layout chose. `suggestion-stack.ts` returns the bottom
edge of the last row that fits, and `message-input.tsx`'s layout effect feeds it
the room the band has left. The band is never given a bound and no ancestor of
the slash popup acquires one.

| Size | Band box | Band / column | Stack: rows visible / laid out | Stack box vs its content | Boundary |
| --- | --- | --- | --- | --- | --- |
| 1380x872 | 104 + 768 = 872 | 768 / 872 | 3 / 3 | 104.5px, no cap | in the gap |
| 900x572 | 104 + 468 = 572 | 468 / 572 | 5 / 6 | 179.5px of 217px | in the gap |
| 830x572 | 104 + 468 = 572 | 468 / 572 | 5 / 6 | 179.5px of 217px | in the gap |
| 800x572 | 104 + 468 = 572 | 468 / 572 | no chips (small view) | — | — |

The band's top edge is the column's own top (104), at every size and in every
state, because the pane yields the free height whenever it has nothing to paint —
at a draft because a draft owes no page, and in a settled-empty conversation
because the read proved it empty. That is the same single row of the pane's rule
in both cases (see the head of this file). The cap's budget is the BAND's, which
is what `message-input.tsx` measures: `window.innerHeight` minus the band's top
edge and its padding, less everything in the splash the stack does not decide.

**What the cap is holding back, in the same run's own numbers.** The stack's own
content is 217px against its 179.5px box at 900x572 and at 830x572, so the cap
holds back 37.5px at both: uncapped, the band would be **505.5px in a 468px column
— 37.5px past the pane and 37.5px past the window**. That is the defect the
designer measured at these sizes, arriving by the chips rather than by the
skeleton. At the default window nothing is held back: the stack fits uncapped in
a 347.3px room.

**Where the cap engages is now the sample's call at one of the two sizes, and
that is a fact about the geometry rather than a flake.** The budget at a 572px
window is 179.5px, and a draw that wraps into five rows measures exactly that —
within half a pixel of the budget — while a draw that wraps into six measures
217px and is capped. So the wide constrained column (900x572, 620px) can be
drawn short enough to fit while the narrow one (830x572, 550px) wraps past the
budget; measured on the way to these frames, `--require-cap=830x572,900x572`
failed six consecutive samples at 900x572 on "this sample never reached the cap"
and the run that published above engaged it at both. The historical capture
therefore required the cap at **830x572**, the size D1 is about and the
narrowest column at the constrained height, and the 900x572 frames are still held
to the containment properties at every size (nothing past the pane, no row cut,
the boundary in the gap) so a frame there cannot show an overflowing stack.

**Historical correction (R2-1): rows were visually clipped whole, NOT made
noninteractive.** The old assertion that nothing behind the cap was reachable
was wrong: those buttons remained focusable and could immediately send unseen
text. Round 2 fixes that in `MeasuredSuggestionStack` using native `disabled`,
`aria-hidden` and `visibility: hidden`, preserving flex boxes for measurement
and returning focus to the composer when resize omits its row. These historical
frames do not prove that new interaction behavior. At 830x572 the band carries all 7 sampled suggestions in the
document (`chips: 7` in the readback) and paints the whole rows that fit — at
this run's sample, 5 of the 6 rows it lays out. The alternative considered was a scroller, and it
was rejected on this app's own numbers: `global-scrollbar-styles.tsx` gives every
scroll container an 8px scrollbar, so a stack that gains or loses one re-wraps
the very labels it is measuring, and a wrap that depends on whether it overflowed
can oscillate between the two states. The cap is `overflow: clip` with a 4px
`overflow-clip-margin`, which cuts nothing (the boundary sits in the `gap-2`
below the last row) and still leaves the last visible chip's 1px-offset 2px focus
ring in the picture. This is a product decision as much as a containment one, and
the designer is free to overrule it.

## The numbers

From `readback-before.json` / `readback-after.json`, written by the same runs as
the frames beside them.

| Quantity | before | after |
| --- | --- | --- |
| settled band reading, 1380x872 | greeting 0, skeleton 1, chips 0 | greeting 1, skeleton 0, chips 7 |
| settled band reading, 900x572 / 830x572 / 800x572 | 0/1/0 · 0/1/0 · 0/0/0 | 1/0/7 · 1/0/7 · 0/0/0 |
| band box (x, y, w, h) at 1380x872 | 280, 104, 1100, 768 | 280, 104, 1100, 768 |
| band box at the three smaller sizes | 280, 104, 620, 468 · 280, 104, 550, 468 · 280, 104, 520, 468 | the same three boxes as the before half |
| loading claims in the document at the draft (placeholders / shimmer bars / outside the band / visible caption) | not read — this reading was added for this round; what this tree paints is its band's own skeleton (`skeleton 1` above) | **0 / 0 / 0 / none at every size** |
| suggestion stack (rows visible / laid out; box vs content), per size | none — the band paints a skeleton in place of it | 3/3, 104.5px of 104.5px · 5/6, 179.5px of 217px · 5/6, 179.5px of 217px · no chips |
| consecutive draft frames, per size | 7,165 / 7,148 / 7,164 / 0 | 0 / 0 / 17 / 0 |
| traced frames / frames with the echo painted | 31/14 · 34/15 · 30/13 · 34/14 | 30/12 · 34/15 · 28/11 · 25/11 |
| traced frames with a claim AND the echo painted | 0 at every size | 0 at every size |
| band reading when Send was clicked | skeleton at 1380/900/830 | greeting + chips at 1380/900/830 |
| the pane's own hold at the draft (readback) | `draftStreamView.hydrated: false`, `transcriptPainted: false` — this tree predates #150, so its pane paints nothing | `hydrated: false` **and `awaitingHydration: false`**, `transcriptPainted: false` — no page is owed, so the pane makes no claim and yields the column |

Two quantities move between runs and are reported per run rather than pinned.
The trace length is the harness's own mutation-driven sampling (30/12 here,
28/11 at 830x572), and the after tree's two settled frames now **do not move at
all** at 1380x872, 900x572 and 800x572 (0 pixels) and differ by **17 pixels, the
composer's caret**, at 830x572 — the same row-or-caret split this set shipped
before the rebase. The movement the previous pass measured in that pair (9,540 /
1,782 / 1,781 / 9,531) was the pane's placeholder, which the pane no longer
paints; its absence is one of this round's claims rather than a lost reading.
The before tree's pair always moves: 7,165, 7,148 and 7,164 pixels across the
three splash-bearing sizes, which is the reason the pair is captured at all. A
single still could not show that the skeleton is animating rather than painted
once. The two movers are named rather than lumped: of the 7,165 pixels at
1380x872, **7,148 are the skeleton's shimmer inside its own row and the remaining
17 are the composer's caret**, which is why the row crop and the total are quoted
apart.

**The pair differs only inside the chat column.** Measured with ImageMagick
`compare` over the two frames of the same size, one tree against the other, and
over the regions the change cannot reach. The regions are this round's: the after
tree's band now STARTS at the column's top (104) because the pane collapses, so
there is no "pane above the band" left to measure apart from the band. The
previous pass's split at the band's top edge measured the pane's placeholder on
one side of it and the splash on the other.

| Size | whole frame | sidebar (`280xH+0+0`) | chat chrome (`(W-280)x104+280+0`) | chat column (`(W-280)x(H-104)+280+104`) |
| --- | --- | --- | --- | --- |
| 1380x872 | 136,666 | **0** | **0** | 136,666 |
| 900x572 | 133,947 | **0** | **0** | 133,947 |
| 830x572 | 137,844 | 19,933 | **0** | 117,911 |
| 800x572 | 11 | **0** | **0** | 11 |

Nothing outside the chat column moved: the chrome strip above it is 0 at every
size and the sidebar is 0 except at 830x572. The one exception is unchanged and
is the run's own doing rather than the change's: that size is the third load of
the run, so its sidebar lists the two sessions the run's own sends created, and
their relative times ("2 minutes ago" against "1 minute ago") are the run's own
clock. The default window's pair is clean in every region outside the column,
which is the zero worth having rather than assuming — the first pass of this set
had the two runs' sidebars differing by 15,619 pixels of hover wash, because the
driver's own click left the pointer on a row. The driver now parks the pointer on
neutral ground before every shutter.

**What the column's numbers say.** At the default window the pair differs by
136,666 pixels, all inside the column: the before tree paints a 28px skeleton row
where the after tree paints the greeting and seven chips, and the band's top edge
is the column's top on both. At 800x572 it is 11 pixels — the composer's caret —
because the small view paints neither the splash nor a skeleton on either tree
and the pane no longer pushes the composer down. The previous passes' "pane,
above the band" column (10,167 / 2,415 / 2,415 / 31,866) has no claims in it left
to measure: on this state the pane holds nothing, so that region is the band's own
ground.

**The admission flip, measured frame by frame rather than from stills.** The
harness records one reading per animation frame for as long as mutations keep
arriving, and the driver asserts the property over those frames at every size: no
traced frame may carry the echo AND the greeting, the skeleton or the chips at
once. 0 frames did, in either tree at any size, while 11–15 frames carried the
echo in each run — so the property was exercised rather than vacuously true.
Two of the one-frame states this rules out are worth naming, because neither is
visible in a pair of stills: a greeting painted over the row the user just sent,
and a skeleton painted over it. The trace also shows what the fix keeps honest in
the other direction: once the pane IS a real session with no page yet it waits,
as design D7 requires — which is why the band reading at the click of Send
(`bandAtSendClick`) is the one the fix moves, and the reading after the echo
paints is clean on both trees.

## What these frames do not prove

- **No Electron IPC hop and not the packaged build.** There is no main process
  here; `desktopRequest` reaches the backend by its `/__desktop` branch instead
  of `ipcRenderer`. The transport module, the store and the components are
  byte-identical either way — what differs is which of two shipped branches
  carries the bytes. This is a Vite dev server rendering the shipped components.
- **Not captured from the operator's browser or from the app window.** See the
  instrument note above: the frames come from a private headless Chrome driven
  over CDP. Nothing here is a picture of the live app's own window, and nothing
  here exercised a real login.
- **The `Chat | Raw` tab strip in the pane header is development-only.** Every
  frame carries it, directly under the `New chat` title
  (`chat-header.tsx:127-128` records the row as `isDevelopmentMode()`-gated), and
  it does not exist in a packaged build. It is named here because the sibling
  `chat-title` set lost a re-take to exactly this: an artefact nobody declared
  reads as part of the app.
- **One theme** (`localOperatorDark`). The light palettes are not photographed;
  the band's classes are theme-independent, which is an argument rather than a
  frame.
- **The pane's two other states are not staged here, and they are the ones that
  keep its hold honest.** This set's claim about the pane is the DRAFT: no page is
  owed, so nothing may claim to be loading, and the readback carries the composed
  reading (`awaitingHydration: false`) beside the raw one. What it does not carry
  is a real cold session DURING its history read, or a read that FAILS — the two
  states in which the pane is supposed to hold and to speak. Those are pinned
  where they happen rather than photographed here: the 32-row matrix in
  `scripts/session-switch.test.mjs` (which now walks the same composed input the
  pane reads, so a session whose read failed still resolves to the notice), and
  the `hydrating`/`slow` frames of the `session-switch` set, whose rig forces the
  stream delay and refuses to write a frame without the pane's placeholder on
  screen. `draft-splash.test.mjs` also drives the shipped hook for both readings:
  a draft owes nothing, and a cold session does. **That pair was re-run against
  this head rather than left to a pointer.** `node
  scripts/session-switch-latency.mjs --frames=…` on this tree, with the switch's
  stream delay forced to 4s, read `placeholder: true, placeholderOpacity: 1` for
  `hydrating` and `placeholder: true, placeholderOpacity: 0.72` (dark) / `0.73`
  (light) for `slow` — the claim IS on screen and at the pulse's trough, which
  the harness refuses to write the frame without — and `placeholder: false,
  content: true` for `settled`, which is the same claim RESOLVING when the rows
  land. Those frames were NOT committed here: `settled`, `error` and `mark` came
  back byte-identical to the ones that set already carries, and
  `hydrating`/`slow` are pulse-phase and fixture dependent, so re-stamping
  another set with this round's pass would claim an attribution the pixels do not
  make. The reading is the evidence; the committed frames stay theirs.
- **`model_name: mock`.** No real provider, no real latency, no tool path.
- **No paint timing.** These are stills plus a DOM-read trace; the trace's clock
  is the harness's own `performance.now()`, not a compositor timeline.
- **The pre-fix tree's D1 overflow is not in these frames.** The `before` frames
  of the New chat show the skeleton (the round-1 defect); the chips' overflow is
  what D1 measured, and on the pre-fix tree that path is an ordinary EMPTY
  CONVERSATION, which this harness does not stage (QA's independent pass
  reproduced it on both trees and owns that reading). What the frames do carry is
  the after tree's containment at those sizes, with the cap demonstrably engaged
  at 830x572 — `--require-cap=830x572` makes the driver reload and re-sample
  until it is, so the frame cannot be of a stack that never needed containing —
  and the 900x572 frame held to the same containment properties, though whether
  the cap engages there depends on the sample's wrap (see *The containment*).

## Where this set is declared

`draft-splash` is a declared `supplementary` set in
`docs/evidence/manifest.json`, at **0 frames** — which is the honest count for
its `.webp`-only tally (`check-evidence.mjs`'s `frames()` counts `.webp`; the
frames here are PNG, as `chat-shell`'s and `chat-shell-empty-centre`'s are).
It is declared rather than omitted because an undeclared directory is invisible
to `scripts/check-evidence.mjs`: the moment a `.webp` lands here without this
entry being updated, `onDisk !== set.frames` and the gate names this set.
Declaring it also puts the instrument and the reason on the record, which is what
the note above is for.

The fresh frames are declared separately as `draft-splash-browser`, with its
own `source`, `capturedAt` and `capturedAtHead`. It is a SIBLING of this
directory rather than a directory inside it: the sweep refuses a declaration
nested inside another declared one, because the frames in it would be counted
twice. The two generations stay legible per set instead of being merged into
one stamp that would describe neither.

## Fresh validation — browser tool only

**Done for the settled draft, at four sizes, and only that.** The fresh frames
sit in [`../draft-splash-browser/`](../draft-splash-browser/README.md): the operator's own paired
browser driven by the `browser` tool (Local Operator extension), at `8f764cb83`
with `before` at `d12fecbcf` (`origin/main`, this branch's merge base) carrying
this branch's own harness pages, both against one isolated
`hosting: test` / `model_name: mock` backend. That README carries the
instrument, the sequence, the numbers behind each frame and the limits.

**Still not covered by any browser evidence on this head:** trusted keyboard
traversal (the `browser` tool exposes no Tab/Enter/Space input), the
`draft-to-session` flip and the states after a send, a cold or failing
hydration, and a second theme. The mounted React DOM tests exercise the shipped
`MeasuredSuggestionStack` and `Button` with explicit rectangle fixtures, not a
layout engine: they prove observer lifecycle, focus recovery and non-actionable
omitted controls, and they do not replace the browser gate.

`scripts/draft-splash-capture.mjs` now fails closed. Its historical raw-CDP source
is preserved in git at `85eb7546a` for audit, **not for agents to execute**. No
other capture tooling is changed by this remediation. Do not download, launch or
script a browser engine; an unavailable browser tool means BLOCKED, never fallback.

1. Coordinate an isolated `local-operator serve` with QA. Use a throwaway config
   and synthetic sessions, mock hosting/model, and a separate backend port. Scrub
   all inherited `CMUX_*` variables. Supply `LOCAL_OPERATOR_DESKTOP_TOKEN` and
   `LOCAL_OPERATOR_DESKTOP_BACKEND_URL` only to the Vite process; never print them
   or pass them to the browser. Do not touch QA's existing tree or live sessions.
2. Start only the HTTP harness (this command does not launch a browser):

   ```sh
   LO_DRAFT_SPLASH_PORT=15214 pnpm exec vite --config scripts/draft-splash-evidence.vite.mjs --host 127.0.0.1
   ```

3. Use the **browser tool** to open
   `http://127.0.0.1:15214/draft-splash-viewport.html?size=830x572`.
   On `origin_not_allowed`, request approval and wait; if not approved, record
   BLOCKED and stop browser validation. The outer page is harness-only controls;
   its fixed-size same-origin iframe mounts the actual `ChatPage` through
   `draft-splash-evidence.html` and the shipped desktop proxy.
4. Click the four viewport controls (1380x872, 900x572, 830x572, 800x572) to resize
   the **same** React tree; `Reload at selected size` covers initial-small then
   large. Use the product's New chat/send controls inside the frame. The
   `Read geometry and focus` control publishes chip disabled/hidden/focus states,
   row boxes, stack client/scroll height, and the original page `#probe` text in
   the outer `#readback`, readable with the browser tool.
5. `Focus next/last enabled suggestion` and `Activate focused suggestion (DOM
   click)` are explicit DOM probes, not trusted Tab/Enter/Space. They support the
   browser tool's click/read schema without claiming synthetic clicks prove native
   keyboard behavior. Verify real Tab/Enter/Space with the user or a browser-tool
   keyboard capability when available; otherwise leave that matrix cell BLOCKED.
6. Cover capped whole rows, wrapping labels, focused-late-row then shrink (focus
   must land in composer), expand (hidden rows become available), small→large,
   cold hydration→empty, send→empty/remount, and slash popup containment. QA must
   supply the real isolated backend states/faults for hydration, failure and send;
   this viewport wrapper does not fake those states.
7. Take before/after and first/settled screenshots **with the browser tool**,
   read them back, and record actual geometry. Store fresh round-2 artifacts in a
   new evidence directory with their actual head and instrument. Do not overwrite
   these historical PNGs/readbacks or re-stamp their manifest onto new source.
8. Close your owned browser tab when finished (or explicitly retain it only for
   the pending user approval/immediate continuation).
