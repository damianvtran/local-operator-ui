# The composer band on a New chat, before and after

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

**This rebase lands the fix on a `main` that has since moved, and the moved
ground is in these frames.** `main`'s #150 (`perf/session-switch-instant`) took
the hydration placeholder out of the band and gave the PANE its own hold
(`transcript-pane.ts`: `transcriptPaneHoldsPlaceholder` = `recordCount === 0 &&
!hydrated && !speaks`), so on this base the same New chat paints that placeholder
in the transcript region — every `after-draft-*.png` here carries its three bars
and its `Loading conversation…` — while the band below it is the half this branch
restores: the greeting and the chips. Both halves hold; together they are the one
screen a reader sees. The pane's term has no "there is no session here" in it,
and this branch does not add one: `hydrated` is false for a session-less draft by
construction, so the pane holds for as long as a New chat is open. That is
`main`'s rule rather than this change's, and it is recorded here — with the
measurement, and with the band that the driver's assertions actually read —
because a reader of these frames has to know which half of the screen they are
evidence for. See *What these frames do not prove* below.

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
- `scripts/draft-splash-capture.mjs` drives a **private headless Chrome over raw
  CDP** (a temp `--user-data-dir`, `--headless=new`, the already-installed Chrome
  binary, the built-in WebSocket): the mechanism `scripts/capture-evidence.mjs`
  and `scripts/diff-body-evidence.mjs` already use for this repository's
  committed evidence. Nothing is downloaded, no browser-automation dependency is
  added, and no login is involved — the page is a localhost harness talking to a
  throwaway backend.

**Why this instrument and not the browser tool.** The operator's own browser
bridge was unavailable at capture time: `lop browser status` reported
`extension connected: no` (`paired, not connected` for both installs — the
extension's service worker asleep with its Chrome having run since 07:21), the
cmux socket at `~/.local/state/cmux/cmux.sock` did not exist, so the `browser`
tool had no backend at all, and `lop browser drive` refuses with "open its
browser". The standing rule that a page is driven in the operator's OWN browser
exists because a throwaway browser cannot hold a real login; a localhost harness
page against a throwaway backend holds none, which is why the repository's own
existing capture mechanism was used rather than a second browser stack. It is
disclosed here, in each `readback-*.json` (`instrument`) and in the manifest's
`source` so no reader mistakes these frames for frames of the live app window.

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
skeleton was the defect on. `after` was re-shot after the rebase onto `main`
(`142e86904`), because the upstream delta changes what the same screen renders —
an after frame from the pre-rebase tree would show a pane that no longer exists.
So the pair is not "this branch against its own base": the `before` half carries
the round-1 defect and the `after` half carries `main`'s pane beside this branch's
band. Re-shooting `before` on the new base is not something this instrument can
do honestly: its settled-draft expectation is the band's skeleton, and on
`142e86904` the band renders neither the skeleton nor the greeting for a draft
(the greeting branch is gated on `!isHydrating`, and a draft is `awaitingHydration
=== false` and `!hydrated === true`), so the run would refuse to publish rather
than photograph that state.

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
| 800x572 | the minimum window itself, whose 520px column takes the small view — the control that this change did not touch that branch |

The harness publishes its own readback in `#probe` (`window.__draftSplashMarker`
for the echo check, `window.__draftSplashChipList` parsed from the product), and
the driver reads it at the settled draft, at the click of Send, immediately after
the flip's shutter, at the first painted echo and at the settled conversation.
That readback is what the frames are checked against — the run FAILS rather than
publishing when an error surface is on screen, when the draft state was never
entered, when the band disagrees with what the label says it should show, **when
the band or its suggestion stack runs past the pane or a chip row is cut**, or
when the admitted send never painted a row.

## Before / after

| Frame | What it shows |
| --- | --- |
| [before-draft-1380x872-frame1.png](before-draft-1380x872-frame1.png), [-frame2.png](before-draft-1380x872-frame2.png) | The defect: a New chat settled with the hydration skeleton above the composer, no greeting and no chips. `readback-before.json` reads `greeting 0, skeleton 1, chips 0`, band 768px. The two frames differ by **7,165 pixels — 7,148 of them inside the skeleton's own row** (`1052x28+304+402`), its shimmer moving, which is why the pair is here rather than one still. |
| [after-draft-1380x872-frame1.png](after-draft-1380x872-frame1.png), [-frame2.png](after-draft-1380x872-frame2.png) | The same state on the fixed tree: `What can I help you with today?`, the composer, and **7 suggestion chips** drawn from `DEFAULT_MESSAGE_SUGGESTIONS` (25 entries in `chat-content.tsx`; `message-input.tsx` samples `MAX_SUGGESTIONS = 7` of them at random, so the labels differ run to run and only the count and the membership are stable — both are asserted). The band is 538px of the 872px column (`333.9 + 538.1 = 872`) and the stack is **5 rows of 5, 179.5px tall in a 269.8px room — uncapped, because at the default window it fits.** The band's top edge is where the PANE's own block ends: since #150 the pane holds a row-less unread conversation, and a New chat's draft is one, so every after frame carries `Loading conversation…` and its three bars above the splash (see the head of this file). Those two consecutive frames differ by **9,540 pixels, all of them inside the pane's placeholder** — its pulse. |
| [-band-1380x872.png](after-draft-band-1380x872.png), and the same clip at [900x572](after-draft-band-900x572.png), [830x572](after-draft-band-830x572.png), [800x572](after-draft-band-800x572.png) | The band clipped to its own box, at every size, for the close read. The 830x572 clip is the size D1 is about. |
| [before-draft-900x572-frame1.png](before-draft-900x572-frame1.png), [before-draft-830x572-frame1.png](before-draft-830x572-frame1.png) and their `-frame2` / `-band-` siblings | The same New chat on the pre-fix tree at the constrained heights: the skeleton, band 468px — inside the pane, because the skeleton is 228px of content. **The overflow those sizes are about is the CHIPS'**, which the pre-fix tree only reaches through an ordinary empty conversation (QA reproduced it there: 6–7 rows, `chipRowBottom` 582.5/600.5 against a 572px window), not through New chat. |
| [after-draft-900x572-frame1.png](after-draft-900x572-frame1.png), [after-draft-830x572-frame1.png](after-draft-830x572-frame1.png) | The fix at those sizes: 7 chips, the stack capped — **4 of its 5 rows (142px of 179.5px)** at 900x572 and **4 of its 6 rows (142px of 217px)** at 830x572 — and the band `156 + 416 = 572`, with the last visible row inside it. |
| [before-draft-800x572-frame1.png](before-draft-800x572-frame1.png) / [after-draft-800x572-frame1.png](after-draft-800x572-frame1.png) | The minimum window: `greeting 0, skeleton 0, chips 0` in the BAND on **both** trees — the `isSmallView` branch, which this change does not touch. The pair now differs by 114,932 pixels and none of them is a band claim: 31,866 are the pane's placeholder appearing in the comparison and 83,066 are the composer moving down inside the band, because on this base the pane keeps the top 225.9px instead of collapsing (`329.9 + 242.1 = 572`). The pre-rebase pair differed by 11 pixels, the composer's caret. |
| [before-send-after-flip.png](before-send-after-flip.png), [after-send-after-flip.png](after-send-after-flip.png) | The state just after the identity flip, read back immediately after the shutter: a real session whose page is owed. `bandAtFlipShot` caught `greeting 0, skeleton 1` (before) and `greeting 1, skeleton 0, chips 7` (after) — the post-flip state of an empty authoritative page, which both trees reach — so this pair carries the band reading rather than the band. Whether the echo has painted by then is a race the frame does not claim to have won; the readback says which state it caught. |
| [before-send-first-painted.png](before-send-first-painted.png), [after-send-first-painted.png](after-send-first-painted.png) | The first frame in which the admitted send is painted in the transcript, read from the harness's per-frame trace: the message is a row and the band shows no greeting, no skeleton and no chips. |
| [after-send-settled-1380x872-frame1.png](after-send-settled-1380x872-frame1.png), [-frame2.png](after-send-settled-frame2.png), and `send-settled-<size>-frame1` at the other three sizes | The settled conversation, and — at 900x572 and 830x572 — the ADMITTED-SEND state the peer change at the same height budget also has to hold in: greeting gone, chips gone, the transcript column painted, and the band still exactly the pane (`y 404.3 + h 167.7 = 572`). Nothing is capped in that state; the constraint is only that it is inside the pane. |

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
| 1380x872 | 333.9 + 538.1 = 872 | 538 / 872 | 5 / 5 | 179.5px, no cap | in the gap |
| 900x572 | 156 + 416 = 572 | 416 / 572 | 4 / 5 | 142px of 179.5px | in the gap |
| 830x572 | 156 + 416 = 572 | 416 / 572 | 4 / 6 | 142px of 217px | in the gap |
| 800x572 | 329.9 + 242.1 = 572 | 242 / 572 | no chips (small view) | — | — |

The band's top edge is where the pane's own block ends — the placeholder at a
draft — so it starts 230px below the column's top at the default window and 52px
below it at the two constrained sizes. The cap's budget is the BAND's, which is
what `message-input.tsx` measures: `window.innerHeight` minus the band's top edge
and its padding, less everything in the splash the stack does not decide.

**What the cap is holding back, in the same run's own numbers.** The stack's own
content is 217px against its 142px box at 830x572 and 179.5px against 142px at
900x572, so the cap holds back 75px and 37.5px: uncapped, the band would be
**491px at 830x572 (75px past its 416px pane, and 75px past the window) and
453.5px at 900x572 (37.5px past)**. That is the defect the designer measured at
these sizes, arriving by the chips rather than by the skeleton.

**Rows the cap leaves out are dropped whole, and nothing behind them is
reachable.** At 830x572 the band carries all 7 sampled suggestions in the
document (`chips: 7` in the readback) and paints the whole rows that fit — at
this run's sample, 4 of the 6 rows it lays out. The alternative considered was a scroller, and it
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
| band box (x, y, w, h) at 1380x872 | 280, 104, 1100, 768 | 280, 333.9, 1100, 538.1 |
| band box at the three smaller sizes | 280, 104, w, 468 | 280, 156, 620, 416 · 280, 156, 550, 416 · 280, 329.9, 520, 242.1 |
| consecutive draft frames, per size | 7,165 / 7,148 / 7,164 / 0 | 9,540 / 1,782 / 1,781 / 9,531 (the pane's placeholder, at every size) |
| traced frames / frames with the echo painted | 31/14 · 34/15 · 30/13 · 34/14 | 37/16 · 36/16 · 39/11 · 38/14 |
| traced frames with a claim AND the echo painted | 0 at every size | 0 at every size |
| band reading when Send was clicked | skeleton at 1380/900/830 | greeting + chips at 1380/900/830 |
| the pane's own hold at the draft | `hydrated: false`, `transcriptPainted: false` → the pane collapsed | the same reading, and #150's rule holds the pane on it, so the placeholder is in every after frame |

Two quantities move between runs and are reported per run rather than pinned.
The trace length is the harness's own mutation-driven sampling (37/16 here,
39/11 at 830x572), and the after tree's two settled frames now differ by 9,540 /
1,782 / 1,781 / 9,531 pixels across the four sizes — **all of it inside the
pane's placeholder**, whose pulse is the only thing moving in that pair on this
base. The pair this set shipped before the rebase was byte-identical at 1380x872
and 800x572 and moved 17 pixels, the composer's caret, at the other two (code
review round 1's N1 corrected the row-or-caret split; the before tree's reading
is unchanged). The before tree's pair always moves: 7,165, 7,148 and 7,164
pixels across the three splash-bearing sizes, which is the reason the pair is
captured at all. A single still could not show that the skeleton is animating
rather than painted once. The two movers are named rather than lumped: of the
7,165 pixels at 1380x872, **7,148 are the skeleton's shimmer inside its own row
and the remaining 17 are the composer's caret**, which is why the row crop and
the total are quoted apart.

**The pair differs only inside the pane.** Measured with ImageMagick `compare`
over the two frames of the same size, one tree against the other, and over the
regions the change cannot reach:

| Size | whole frame | sidebar (`280xH+0+0`) | header | pane, above the band | band |
| --- | --- | --- | --- | --- | --- |
| 1380x872 | 69,851 | **0** | **0** | 10,167 | 59,684 |
| 900x572 | 87,453 | **0** | **0** | 2,415 | 85,038 |
| 830x572 | 95,500 | 19,933 | **0** | 2,415 | 75,567 |
| 800x572 | 114,932 | **0** | **0** | 31,866 | 83,066 |

Nothing outside the pane moved: the header is 0 at every size and the sidebar is
0 except at 830x572. The pane's own two columns are worth reading apart rather
than as one number, because they are two different claims: the column above the
band is the placeholder `main`'s #150 paints on a session-less draft, and the band
column is this change. The one exception is the 830x572 sidebar, and it is the
run's own doing rather than the change's: that size is the third load of the run,
so its sidebar lists the two sessions the run's own sends created, and their
relative times ("2 minutes ago" against "1 minute ago") are the runs' own clock.
The default window's pair is clean in every region outside the pane, which is the
zero worth having rather than assuming — the first pass of this set had the two
runs' sidebars differing by 15,619 pixels of hover wash, because the driver's own
click left the pointer on a row. The driver now parks the pointer on neutral
ground before every shutter.

**The pane column's numbers are the placeholder's.** The `before` tree here is
`ef40c81e2`, which predates #150, so this column measures the placeholder
APPEARING where that tree's band used to be: the band's top edge moves from 104px
to 333.9px at the default window, and the 10,167 pixels above the band are the
placeholder's own bars and caption over ground the pre-rebase band occupied. In
the band itself the two trees differ by the splash: 59,684 pixels at 1380x872,
where the before tree paints a 28px skeleton row and the after tree paints the
greeting and seven chips.

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
- **The pane's `Loading conversation…` in every `after` frame is `main`'s, and
  this set is not evidence about it.** `transcript-pane.ts`'s
  `transcriptPaneHoldsPlaceholder` is `recordCount === 0 && !hydrated &&
  !speaks`; a session-less draft is `hydrated: false` with no records and no
  statement of its own, so the pane holds for as long as a New chat is open — the
  readback records exactly that reading (`draftStreamView.hydrated: false`,
  `transcriptPainted: false`) in the same run that paints the greeting below it.
  The band is what this change moves and what the driver's assertions read
  (`data-lo-composer-band`); the pane's half of the screen is photographed, not
  tested. The two halves are one screen and they make opposite claims, which is
  recorded here rather than fixed: the pane's rule has no "there is no session"
  term in it, and giving it one is either a change to `transcript-pane.ts`
  (extending `session-switch.test.mjs`'s matrix) or a line in `chat-content.tsx`
  handing the pane the composer's composed fact — neither of which is this
  branch's, and both of which are for the PR's own review round to route.
- **`model_name: mock`.** No real provider, no real latency, no tool path.
- **No paint timing.** These are stills plus a DOM-read trace; the trace's clock
  is the harness's own `performance.now()`, not a compositor timeline.
- **The pre-fix tree's D1 overflow is not in these frames.** The `before` frames
  of the New chat show the skeleton (the round-1 defect); the chips' overflow is
  what D1 measured, and on the pre-fix tree that path is an ordinary EMPTY
  CONVERSATION, which this harness does not stage (QA's independent pass
  reproduced it on both trees and owns that reading). What the frames do carry is
  the after tree's containment at those sizes, with the cap demonstrably engaged
  — `--require-cap=830x572,900x572` makes the driver reload and re-sample until
  it is, so the frame cannot be of a stack that never needed containing.

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

## Re-capturing

The two trees are served at once and photographed side by side:

```sh
ROOT=$(mktemp -d /tmp/lo-draft-splash-XXXXXX)
PORT=8111
TOKEN=$(openssl rand -hex 32)
printf 'version: 0.0.0\nvalues:\n  hosting: test\n  model_name: mock\n' > "$ROOT/config.yml"
# Scrub inherited cmux vars: an inherited CMUX_WORKSPACE_ID has renamed real
# workspaces before.
for n in $(env | sed -n 's/^\(CMUX_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "$n"; done
HOME="$ROOT" LOCAL_OPERATOR_CONFIG_DIR="$ROOT" \
LOCAL_OPERATOR_DESKTOP_TOKEN="$TOKEN" \
  <path-to-a-warm-backend>/.venv/bin/local-operator serve --host 127.0.0.1 --port "$PORT" &

# BEFORE - a worktree at `ef40c81e2` (the round-1 base; see the generation note
# above), with the harness files copied in
cd <before-worktree>
cp <branch>/scripts/draft-splash-evidence.{html,css,tsx,vite.mjs} scripts/
cp <branch>/scripts/draft-splash-capture.mjs scripts/
LO_DRAFT_SPLASH_PORT=5212 LOCAL_OPERATOR_DESKTOP_TOKEN="$TOKEN" \
LOCAL_OPERATOR_DESKTOP_BACKEND_URL="http://127.0.0.1:$PORT" \
  node scripts/draft-splash-capture.mjs --label=before \
    --sizes=1380x872,900x572,830x572,800x572

# restart the backend on a fresh config dir, then:
# AFTER - the branch worktree, port 5210 (this is the re-take the rebase ran)
LO_DRAFT_SPLASH_PORT=5210 ... node scripts/draft-splash-capture.mjs --label=after \
  --sizes=1380x872,900x572,830x572,800x572 --require-cap=830x572,900x572
```

Ports are `LO_DRAFT_SPLASH_PORT` (5204 in the config's default, 5210/5212 for
this set, so two trees can run at once and neither collides with the sibling
harnesses on 5199-5203 or with another session's). `--sizes` is the viewport
list, each with its own page load and its own draft → send → settled pass; the
first entry carries the full per-frame flip trace in the readback. `--require-cap`
names the sizes at which the run must have reached the suggestion stack's cap,
which the driver enforces by reloading for a new random sample and failing rather
than publishing a frame that proves nothing. The driver starts and stops its own
Vite server, launches its own Chrome, and writes the frames and readbacks into
this directory; it fails loudly instead of publishing a degraded run — including
when `src/` is dirty against the commit its readback is about to record.

**This set was re-shot on the rebase onto `main` (`142e86904`), and only the
`after` half was.** The upstream delta (#150) changes what the same screen
renders — the band's hydration branch is gone and the pane paints its own
placeholder — so an `after` frame taken before the rebase would be a picture of a
tree that no longer exists. The re-take is the `AFTER` command above, at the
rebased head, and its readback records that head and the source tree the frames
are of. The `before` half is NOT re-shot and is left where it is: it is a picture
of `ef40c81e2` (see the generation note above), and the driver cannot honestly
photograph the new base in that role — a draft on `142e86904` renders neither the
band's skeleton nor its greeting, so the `--label=before` expectation (the
skeleton in the band) would fail the run rather than publish a frame.
