# The New chat row, in line with the All chats row above it

The operator's report was "Can you make a style improvement in
local-operator-ui, remove the border around new chat and have it be the same
alignment, etc. as the all chats above it so that it looks more consistent and
in line."

The row wore `border-control`, and the app is `box-sizing: border-box`. That
edge therefore sat INSIDE the row's own `h-8` box, so the icon and the label
started 1px further right than the All chats row's directly above — a row that
has no boundary at all. Removing the class is the change; both rows then take
`rowStyle`'s own `px-1` inset and the two icon columns coincide.

## What produced these frames

**The live renderer, driven over raw CDP — not Storybook.** The claim under
test is a fact about a box: two rows in the same block land on the same left
inset only once the 1px edge is gone. A story cannot settle that, because the
Chats sidebar has no story at all — it reads the router, the canonical-sessions
store and the desktop capability hooks, so `capture-evidence.mjs`'s `STORIES`
list contains nothing that renders it — and a fixture would restate the class
rather than measure the box it produces.

The surface is the app's own `src/renderer/index.html` served by Vite with the
app's aliases, Tailwind pipeline and the repo's `desktopProxyPlugin`, talking to
an **isolated Local Operator backend on its own port** (own config dir, own
desktop token, `127.0.0.1:5371`). The catalogue is seeded by
`out/evidence-harness/seed.mjs`: 6 agents, 2 teams and 34 sessions, two of them
carrying an unseen completion, which is what puts a count on the All chats row
and populates both Active and Previous — the shape the operator's own screenshot
shows. The agent rows are the UNION of the six definitions the seed writes and
the six the backend ships as builtins (`local_operator/agent_seeds/`): `coder`,
`designer` and `reviewer` are named by both, so nine rows appear rather than
six. That is the sidebar rendering the backend's own catalogue, not a fixture.

The CDP layer mirrors `scripts/capture-evidence.mjs`: a private headless Chrome
on a fresh user-data-dir, killed on exit, Node's built-in WebSocket speaking
DevTools directly, focus emulation on so `:focus-visible` paints, and every wait
on a CONDITION rather than a duration. The harness lives in
`out/evidence-harness/` (gitignored): `new-chat-row.vite.mjs`, `seed.mjs`,
`capture.mjs`, on `NEW_CHAT_ROW_PORT` (5271) rather than a sibling set's port,
because several capture harnesses run on this machine at once.

Keyboard states are reached by real key events, never `element.focus()`:
`:focus-visible` is a heuristic on HOW focus arrived, so a script-invoked focus
can photograph a state a keyboard user does not get. Arrow-ring and Tab
traversal are real `Input.dispatchKeyEvent`s too.

### What these frames therefore do not prove

- **Not the packaged Electron app.** The renderer runs in Chrome, so the preload
  bridge is stubbed and `window.api.desktop` is deliberately left undefined,
  which routes the desktop transport down its real `/__desktop` HTTP path.
  Electron IPC, native dialogs and the packaged build are not exercised.
- **No model inference.** No session is ever admitted; the only session-creation
  path touched is `New chat`'s own `stageDraft`, which is local store state.
- **Two themes, not twelve.** `localOperatorDark` and `localOperatorLight` — the
  two brand palettes, light included because that is where contrast defects
  hide. The twelve-theme sweep belongs to the Storybook pipeline and cannot be
  regenerated here.
- **A still cannot show a 1px inset.** The frames show the pill is gone; the
  alignment is carried by the geometry readback below, which is the falsifiable
  part of this set.
- **No disabled frame.** The row's `disabled` rule is unreachable in a live
  renderer today (`showList = ready || stale`, and `ready` is exactly what gates
  the row, so no state renders the row while `ready` is false — the source
  comment records the measurement that disproved the earlier claim). The
  readback records `disabled: false` on the row in every state rather than
  faking the frame.
- **Note on the scroll position.** The focus and current frames are taken after
  a Tab walk, and Tab scrolls the sidebar's own list region to keep the focused
  row in view. That is the browser doing what a keyboard user's browser does,
  and it happens in the before and after sets alike because the walk is the
  same script. What the alignment rests on is not scrolled in ANY of the
  sixteen committed frames: the New chat row's own box is at `y=568` in every
  one of them, and the pinned partition the row lives in reports a scroll
  offset of `0` in every frame of the re-captured set. An earlier revision of
  this note stated the scroll as one set-wide fact ("every before/after pair …
  carries the same scroll"), which the set's own readback contradicted — the two
  light state frames were captured with the backend down and their row sat at
  `y=503.83` against `568` everywhere else (review finding M3).

## Before / after

Each state is captured on both trees at the same viewport, through the same
script, with the pointer parked outside the sidebar for the keyboard states.
Every frame is the sidebar column plus 24px of the ground either side; the chat
pane is cropped out.

| State | Before | After |
| --- | --- | --- |
| The block at rest | [`before-sidebar-rest`](before-sidebar-rest/localOperatorDark.webp) — the New chat row is a rounded `border-control` pill | [`after-sidebar-rest`](after-sidebar-rest/localOperatorDark.webp) — plain row, icon and label on the All chats column |
| New chat hovered | [`before-new-chat-hover`](before-new-chat-hover/localOperatorDark.webp) — the same colour step on the pill | [`after-new-chat-hover`](after-new-chat-hover/localOperatorDark.webp) — the same colour step on a row with no edge |
| New chat focused | [`before-new-chat-focus`](before-new-chat-focus/localOperatorDark.webp) | [`after-new-chat-focus`](after-new-chat-focus/localOperatorDark.webp) — the `2px solid` accent outline and its `2px` offset still clear the row |
| New chat current | [`before-new-chat-current`](before-new-chat-current/localOperatorDark.webp) — after a real Enter | [`after-new-chat-current`](after-new-chat-current/localOperatorDark.webp) — after a real Enter; `accent-wash` and `aria-current="page"` |

The current frames are taken **after** the key press, not before one: a
screenshot of a button is not evidence that pressing it works.

## The two rows line up — measured, not eyeballed

Read from the live document at the `sidebar-rest` frame, both themes, before
and after. `iconLeft` is the glyph box, `labelLeft` the label span, `inset` is
`iconLeft - rowLeft` and `centreOff` is the icon's vertical centre minus the
row's own.

```
BEFORE (localOperatorDark)
  All chats  box=(228,536) 264x32  iconLeft=232  icon 16x16  labelLeft=252  inset=4  centreOff=0  borderLeft=0px
  New chat   box=(228,568) 264x32  iconLeft=233  icon 16x16  labelLeft=253  inset=5  centreOff=0  borderLeft=1px

AFTER (localOperatorDark)
  All chats  box=(228,536) 264x32  iconLeft=232  icon 16x16  labelLeft=252  inset=4  centreOff=0  borderLeft=0px
  New chat   box=(228,568) 264x32  iconLeft=232  icon 16x16  labelLeft=252  inset=4  centreOff=0  borderLeft=0px
```

`localOperatorLight` reports the same numbers in both trees — the same two box
positions, the same `inset` 5 -> 4, the same zero vertical offset.

Pass criterion, and what it rules out:

- before, `inset` is **5** on New chat against **4** on All chats: the 1px
  border is inside the row's own `h-8` box, so the content is pushed in by one
  pixel on each side — exactly the "not in line" the operator reported;
- after, both are **4**, which is `rowStyle`'s own `px-1`, and both `labelLeft`s
  coincide at 252;
- both rows are **32px** tall before and after, and their boxes are identical
  across the change (`x:228, y:536` and `x:228, y:568`): the fix moves the row's
  CONTENT, not the row, so nothing below it reflows;
- `centreOff` is **0** for both rows in both trees, so "same alignment" includes
  the vertical centre and was not bought by moving the glyph off it.

The class expression read from the live row says the same thing in one line:

```
BEFORE  ... px-1 ... mb-1 w-full border border-control disabled:text-ink-disabled ...
AFTER   ... px-1 ... mb-1 w-full disabled:text-ink-disabled ...
```

## The states around it still work

Pointer-free keyboard traversal, from the top of the document, with real Tab and
arrow key events:

```
TRAVERSAL (one walk per theme, recorded per run rather than as one set-wide number)
  after/localOperatorDark   47 stops  newChatIndex=46  before="All chats 34"  afterTab="Active chats 2"
  after/localOperatorLight  47 stops  newChatIndex=46  before="All chats 34"  afterTab="Active chats 2"
```

Both runs agree on the stop count and on every neighbour, and the before set's
`47 / 46` matches them; the readback carries these fields per theme, which is
what makes them checkable. An earlier revision quoted `newChatIndex=46` as
though all four instrumented runs agreed, and the degraded light run did not:
it recorded **49** stops with a `Retry` at index 0 and index 9 and
`newChatIndex=48` (review finding M3).

So the row is its own stop in the Tab order and the walk continues past it (and
Shift+Tab comes back); and it is a stop in the sidebar's own arrow ring, where
`keyDown` moves focus by calling `.focus()` on the next `[data-chat-row]` —
which is the mechanism a disabled button would silently refuse.

Pressing Enter on the focused row, read from outside the nav:

```
BEFORE ENTER  paneTitles=["Start a chat"]                        ariaCurrentRows=[]
AFTER  ENTER  paneTitles=["New chat","What can I help you with today?"]  ariaCurrentRows=["New chat"]
```

The pane title is read from the chat header's own `h2`, outside `nav[aria-label="Chats"]`,
so the sidebar's own headings cannot be mistaken for it. `New chat` is
`chat-title.ts`'s rendering of an untargeted staged draft, which is why it is
proof the right draft was staged rather than merely that something happened.

Hover is a colour step and nothing lifts: on the hovered row
`background-color` steps to `rgb(40, 35, 24)` dark / `rgb(255, 254, 251)` light,
`transform` is `none`, and the row declares **no transition at all**
(`transition: all 0s`), so the step lands instantly. (The readback is taken with
the capture's animation-freeze stylesheet lifted, because that sheet overrides
`transition` and a computed-style read cannot tell an override from the row's own
declaration.)

Focus paints an outline, not a shadow: the focused row reports
`outline: 2px solid` at `offset 2px`, which is what keeps the ring clear of the
row's rounded 6px corners. The current-draft frame carries
`aria-current="page"` and `background-color` `rgb(22, 40, 29)` dark /
`rgb(231, 241, 232)` light — the `accent-wash` role — with `activeRow` null,
because the composer has taken focus by then, so the frame shows the wash rather
than a focus ring.

## Frame integrity

**No two frames in this set share a SHA-256** — asserted by the capture script
itself, which fails rather than writes if it finds one:

```
after-new-chat-current/localOperatorDark.webp     a98020966190a087
after-new-chat-current/localOperatorLight.webp    be78a6b2e3510437
after-new-chat-focus/localOperatorDark.webp       40a5bf566193a43d
after-new-chat-focus/localOperatorLight.webp      f8d6a79f72b232d4
after-new-chat-hover/localOperatorDark.webp       d98d2bfa2ab2d5dd
after-new-chat-hover/localOperatorLight.webp      9d9c89639a0c3607
after-sidebar-rest/localOperatorDark.webp         a0cc7ce6ae96bf08
after-sidebar-rest/localOperatorLight.webp        1a866775c757976a
before-new-chat-current/localOperatorDark.webp    cad24d938c70f80e
before-new-chat-current/localOperatorLight.webp   083c05d6128e77b3
before-new-chat-focus/localOperatorDark.webp      31afc451791d8148
before-new-chat-focus/localOperatorLight.webp     97cf8f6b88494e08
before-new-chat-hover/localOperatorDark.webp      5424c68d294ffc0a
before-new-chat-hover/localOperatorLight.webp     0c201ea3e9cd7fc0
before-sidebar-rest/localOperatorDark.webp        f182c146d32df75d
before-sidebar-rest/localOperatorLight.webp       aeee552c5c47f55a
```

The **after** set is byte-identical across two consecutive runs of the same
script: the capture was run twice with nothing changed in between and
`shasum -a 256` agrees on all eight digests above, which is what makes the
before/after pair comparable rather than merely similar. A third run, taken
after the branch was rebased onto a moved `main`, reproduced the same eight
digests again — which is also what shows these frames are pictures of the
tree under review rather than of the branch as it stood before the rebase.
Stated that narrowly on purpose — an earlier revision asserted the property for
both sets without publishing either run's digests, and the round-1 light
`focus` and `current` frames were re-taken this round precisely because they did
not hold it (review finding Q4). The `before` set is the single run that
produced it and is unchanged here.

Getting a clean run needed one real fix. The first pass photographed a
half-populated sidebar, because the rows exist from the first render while the
counts, the attention marks and the Active/Previous split arrive on later
calls — one run had every agent row's count missing and read "Nothing running
right now." where the next showed two active rows. The capture waits until the
row text is unchanged across three consecutive samples **and** the All chats row
reads the seeded total, and asserts that total at every frame.

**What makes a frame publishable is now stated in the repository, not only in
the capture script.** `scripts/new-chat-row-evidence.mjs` exports
`assertHealthyFrame`, and the capture calls it per frame; the same function runs
over the committed readbacks in `scripts/new-chat-row-evidence.test.mjs`, which
is part of `pnpm test:desktop`. A frame has to show the WHOLE seeded fixture —
`All chats 34`, `Active chats 2` and `Previous chats 32`, the two split totals
arriving on a later desktop call than the rows — with no `[role=alert]` in the
sidebar, none of `connectivity-banner.tsx`'s copy anywhere in the document (the
banner renders outside the sidebar, so no sidebar-scoped check can see it), no
`Retry` stop in the keyboard walk, and the row still at the position its own
run's rest frame gives it. Round 1 published two frames that every check in
force at the time passed: the cached counts still read "All chats 34" while the
window-level banner was up and the row had been pushed 64.17px out of place.
That recorded failure is now one of the guard's test cases.

## Re-capturing this set

**These frames cannot be re-derived by `pnpm capture-evidence`.** The sidebar
has no Storybook story, so the sweep's `STORIES` list contains nothing that
renders it; `capture-evidence.mjs` preserves any directory declared in
`manifest.json`'s `supplementary` block across its wipe and carries the block
through into the manifest it writes, so a routine sweep leaves this set alone —
but if it is ever lost, it has to be re-taken by hand:

1. Seed an isolated config dir (the script refuses the operator's live store):
   `node out/evidence-harness/seed.mjs <scratch>/config`.
2. Start an isolated backend on a port you own, with that config dir:
   `LOCAL_OPERATOR_CONFIG_DIR=<scratch>/config LOCAL_OPERATOR_HOME=<scratch>/home
   LOCAL_OPERATOR_DESKTOP_TOKEN=<random>
   LOCAL_OPERATOR_DESKTOP_ORIGINS=http://localhost:5271 local-operator serve
   --host 127.0.0.1 --port 5371`. Detach it (`start_new_session`) so a later
   command's timeout cannot take it down with the shell's process group.
3. Serve the renderer through `out/evidence-harness/new-chat-row.vite.mjs` with
   `LOCAL_OPERATOR_DESKTOP_BACKEND_URL` pointing at that backend and
   `NEW_CHAT_ROW_PORT=5271`, letting **Vite** load the config
   (`vite --config …`) rather than importing it from Node: it pulls in
   `desktopProxyPlugin`, whose own import of `../../src/main/desktop-media`
   carries no file extension, which Vite resolves and Node's ESM loader refuses
   with `ERR_MODULE_NOT_FOUND`.
4. Check the page before spending a run on it: `alerts: []` and a list that
   reads the seeded totals. A run whose sidebar is carrying the window-level
   "The server is offline…" banner is a picture of a different surface, and the
   guard below will refuse it anyway.
5. Capture: `node out/evidence-harness/capture.mjs http://localhost:5271
   docs/evidence/new-chat-row before|after`. Take `before` with the source tree
   at the pre-change commit (`git stash push -- <the one file>`), then `after`
   on the branch, so the pair comes from the same harness, viewport and script.

**The backend's port has to be one the page's own CSP admits.**
`src/renderer/index.html` pins `connect-src 'self' http://localhost:1111
http://127.0.0.1:1111 … http://localhost:8080 …`, so a cross-origin `fetch` to
an isolated backend on any other port is refused by the page — and the first
thing the app fetches that way is `/health`, which `useConnectivityStatus` polls
every 5s. Left unanswered it raises the window-level banner for the whole run
(measured: `Failed to fetch`, a `connect-src` violation in the console), which is
the same failure class as the frames this round re-took. Neither allowed port is
free on this machine — 1111 is the operator's own backend — so
`new-chat-row.vite.mjs` answers `/health` itself, on the dev origin, by proxying
it to THIS harness's isolated backend, and configures
`VITE_LOCAL_OPERATOR_API_URL` to that origin so `'self'` covers the ping. It is a
proxy rather than a canned body so the app's "is the server there" answer stays
the real one; every other call still reaches the isolated backend, through
`desktopProxyPlugin`.

Three pieces of persisted state must be cleared or seeded on every load, or the
frames lie (`capture.mjs` does all three):

- `canonical-sessions-storage` — `activeDraftKey` and `drafts` are persisted, so
  a staging press in an earlier run rehydrates into the next load and the "at
  rest" frame comes back already marked `aria-current="page"`;
- `onboarding-storage` — seed `isModalComplete`/`isTourComplete`, or the
  first-run "Connect a provider" wizard covers the sidebar and swallows the
  pointer events, which silently produces hover frames identical to rest;
- `ui-preferences-storage` — carries the theme.

Two behaviours of the rig are load-bearing rather than incidental. Enter on a
button needs the CHAR payload (`keyDown` with `text: "\r"`); a `rawKeyDown`
reaches the document and is seen by React, but does not trigger the browser's
default activation, so the current-draft frame silently comes back at rest. And
the animation-freeze stylesheet is lifted before every read, so the reported
`transition` is the row's own rather than the sheet's.

The capture exits non-zero instead of writing a frame it cannot stand behind:
`assertHealthyFrame` (`scripts/new-chat-row-evidence.mjs`) is called on every
frame with the run's own rest position as the baseline, so a run that loses the
backend mid-walk fails at the frame rather than publishing the set. The test
beside it, `scripts/new-chat-row-evidence.test.mjs`, checks the same function
against the round-1 failure and against the committed readbacks.
