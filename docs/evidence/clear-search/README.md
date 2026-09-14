# Clearing the Chats sidebar search field

The operator's report was "Can you have an x in the search bar to make it easier
to clear out when there's a search filter applied?" The field had exactly one
way out of a filter, and it was the wrong one for a pointer user: Escape, which
clears **and blurs**, so it empties the field and takes the caret away with it.
The alternative was selecting the text and deleting it, and nothing on screen
said the field could be emptied at all.

The change adds the repository's established clear control — the same one the
settings search has carried — rendered only while a filter is applied, and it
returns the caret to the field.

## What produced these frames

**The live renderer, driven over raw CDP — not Storybook.** The claims under
test are a real pointer click that changes React state and a caret that has to
come back to a field, and neither survives a fixture: the Chats sidebar has no
story at all (`capture-evidence.mjs`'s `STORIES` list contains nothing that
renders it), and a story could not produce the focus outcome of unmounting the
very button that was clicked — which is the behaviour this change had to get
right.

The surface is the app's own `src/renderer/index.html` served by Vite with the
app's aliases, Tailwind pipeline and the repo's `desktopProxyPlugin`, talking to
an **isolated Local Operator backend on its own port** (own config dir, own
desktop token) seeded with 7 agents, 2 teams and 7 sessions — the frames show
9 agent rows because the backend also ships two builtin roles (`architect`,
`scout`), and all 11 entity rows are the sidebar rendering its catalogue rather
than a fixture. Transport, catalogue, session rows and the sidebar's own filter
are all real: the query in these frames is matched by the shipped `matching`
predicate.

The CDP layer mirrors `scripts/capture-evidence.mjs`: a private headless Chrome
on a fresh user-data-dir, killed on exit, Node's built-in WebSocket speaking
DevTools directly, focus emulation on so `:focus` paints. Every wait is on a
condition rather than a duration — the rows arrive from three separate desktop
calls and a 5s poll re-renders the list underneath a capture. Two consecutive
runs of the `after` set produced **byte-identical** frames, which is what makes
the pair below comparable.

### What these frames therefore do not prove

- **Not the packaged Electron app.** The renderer runs in Chrome, so the preload
  bridge is a stub and `window.api.desktop` is deliberately left undefined,
  which routes the desktop transport down its real `/__desktop` HTTP path.
  Electron IPC, native dialogs and the packaged build are not exercised.
- **No model inference.** No session is ever admitted; the backend has no
  provider configured and the frames never open a chat.
- **Two themes, not twelve.** `localOperatorDark` and `localOperatorLight` — the
  two brand palettes, light included because that is where contrast defects
  hide. The twelve-theme sweep belongs to the Storybook pipeline and cannot be
  regenerated here.
- **A still shows the field's focus ring; it cannot show the caret.**
  `after-cleared` differs from `after-rest` in the field's own row and nowhere
  else in the frame, and the difference there is the input's 2px accent ring —
  the strongest pixel evidence in this set, and cited as such below. What no
  still can carry is the CARET: it is hidden in a capture, so which element
  holds focus is read from `activeElement` rather than from an image. The ring
  registers because the rig turns focus emulation on and drives the click
  through CDP's own input pipeline, where the programmatic `focus()` matches
  `html :focus-visible` (`src/renderer/src/styles/index.css`). A real pointer
  user's Chrome may decline the programmatic focus there — the heuristic is
  about how focus was arrived at — in which case the field shows no ring and the
  readback is the only witness; the clear keeps the caret either way.
- **Two states have no `before` counterpart** — `hover` and `focused` — because
  the control does not exist in that tree. The `before` set reaches the cleared
  state the only way it was reachable, with Escape, which is the behaviour being
  replaced.

## Before / after

Each state is captured on both trees at the same viewport, through the same
script, so the pair is comparable. Every frame is the sidebar column plus 24px
of the ground either side of it; the chat pane is cropped out because it is not
part of this change.

| State | Before | After |
| --- | --- | --- |
| Field at rest | [`before-rest`](before-rest/localOperatorDark.webp) — placeholder only | [`after-rest`](after-rest/localOperatorDark.webp) — **byte-identical**: with no filter applied the change is invisible |
| A filter applied | [`before-query`](before-query/localOperatorDark.webp) — `cod` in the field, and no way to clear it but Escape | [`after-query`](after-query/localOperatorDark.webp) — the `×` control sits inside the field's right edge |
| Cleared | [`before-escape-cleared`](before-escape-cleared/localOperatorDark.webp) — Escape cleared the query and **blurred**; the frame is byte-identical to rest, because nothing is left to see | [`after-cleared`](after-cleared/localOperatorDark.webp) — the control is gone with the query, and the caret is back in the field |
| Pointer over the control | *(no before — the control did not exist)* | [`after-hover`](after-hover/localOperatorDark.webp) — a fill step, nothing moves |
| Control reached by keyboard | *(no before — the control did not exist)* | [`after-focused`](after-focused/localOperatorDark.webp) — the ring hugs the control, inside the field (design round 1, D1) |

Light theme: [`before-query`](before-query/localOperatorLight.webp),
[`after-query`](after-query/localOperatorLight.webp),
[`after-hover`](after-hover/localOperatorLight.webp),
[`after-focused`](after-focused/localOperatorLight.webp),
[`after-cleared`](after-cleared/localOperatorLight.webp).

Three frames in this set are byte-identical **by construction**: `before-rest`,
`before-escape-cleared` and `after-rest` (in both themes). That is the claim,
not a leaky capture — at rest there is nothing to see on either tree, and the
pre-change clear left no trace distinguishable from a field that was never
filtered. The uniqueness assertion the other live-app sets use would flag this
pair, so it is stated here with the hashes instead:

```
d95a2c7c0a09  before-rest/localOperatorDark.webp
d95a2c7c0a09  before-escape-cleared/localOperatorDark.webp
d95a2c7c0a09  after-rest/localOperatorDark.webp
e7eb7999c1e5  before-rest/localOperatorLight.webp
e7eb7999c1e5  before-escape-cleared/localOperatorLight.webp
e7eb7999c1e5  after-rest/localOperatorLight.webp
```

## The caret comes back — and the ring says so

Both `before-escape-cleared` and `after-cleared` are pictures of an empty field.
What separates them is in `before-readback.json` / `after-readback.json`, read
from the page after each action:

```
before  rest             value=""     activeElement=BODY
before  query            value="cod"  activeElement=INPUT[Search chats and agents]
before  escape-cleared   value=""     activeElement=BODY                            <- cleared, caret lost
after   rest             value=""     activeElement=BODY
after   query            value="cod"  activeElement=INPUT[Search chats and agents]
after   hover            value="cod"  activeElement=INPUT[Search chats and agents]
after   focused          value="cod"  activeElement=BUTTON[Clear search]
after   cleared          value=""     activeElement=INPUT[Search chats and agents] <- cleared, caret kept
```

`before-escape-cleared` is the state the operator was stuck in: filtered, then
emptied, with focus on `<body>` and no hint of where to type next.

The click that produces `after-cleared` is a real `Input.dispatchMouseEvent`
press and release at the control's own coordinates, not a synthetic `.click()`.
That matters here: the control is rendered **only while the query is non-empty**,
so the click unmounts it in the same commit as the state update, and the
question the change had to answer was where the browser puts focus when the
focused element leaves the DOM. It puts it on `<body>` — so the focus is
restored explicitly (`clearSearch` in
`src/renderer/src/features/chat/clear-search.ts`), and **two independent
artifacts then record that it worked**:

- the readback above, which names the focused element directly;
- the frame itself. `after-cleared` and `after-rest` are identical above and
  below the field's row (0 differing pixels at a 20% difference floor) and
  differ inside it by 4,784 device pixels, whose difference map is the input's
  rounded 2px accent ring — the ring is in `after-cleared`, and absent from
  `before-rest`, `after-rest` and `before-escape-cleared`, which are all
  byte-identical to each other. So the pixel record of "the caret came back" is
  a ring the reader can see, not only a number in a JSON file.

## Geometry: the control is inside the field, and nothing moves under the pointer

Read from the live document at each state (`after-readback.json`):

```
input    {x:228, y:48, w:264, h:32}   padding-right 36px   (pr-9)
control  {x:460, y:50, w:28, h:28}    inset 4px from the input's right edge, vertically centred
text     clips at x:456               -> 4px clear of the control's own edge
```

The control is a 28×28 hit target (`icon-sm`, above the 24×24 minimum) on the
`size-7` step of the shared button. Box position and size are identical in the
`query` and `hover` samples (there is no control box in `rest` or `cleared` — it
is not rendered when the query is empty, which is `controlBox: null` in the
readback):

```
theme             state    control box              fill                    ink
localOperatorDark query    {x:460,y:50,w:28,h:28}   rgba(0, 0, 0, 0)        rgb(181, 175, 162)
localOperatorDark hover    {x:460,y:50,w:28,h:28}   rgb(22, 40, 29)         rgb(241, 238, 230)
localOperatorLight query   {x:460,y:50,w:28,h:28}   rgba(0, 0, 0, 0)        rgb(86, 81, 71)
localOperatorLight hover   {x:460,y:50,w:28,h:28}   rgb(231, 241, 232)      rgb(33, 30, 24)
```

Hover is therefore a colour step and nothing else — the `ghost` button's own
spec (`ink-muted → ink`, plus `bg-accent-wash`) — with no translate, scale or
layout change. **What the frames do not show** is the press state: a screenshot
taken between `mousePressed` and `mouseReleased` would have to race the
browser's own event loop, and this rig does not attempt it. The pressed step is
`active:bg-accent-wash active:text-accent`, asserted as a class in
`scripts/clear-search.test.mjs`, and its contrast is the `ghost` variant's
existing pairing — see the note on the contrast contract below.

### The keyboard ring sits inside the field (design round 1, D1)

The control is 28px inside a 32px field, so it has 2px of clearance, while the
shared `icon-sm` step draws a 2px outline at a **1px** offset — which needs 3px.
At the step's own offset the ring's top and bottom arcs crossed the field's
`border-control` line and read as a control bulging out of its field. This
instance pulls the ring inside its own box (`focus-visible:outline-offset:
-2px`), and the `focused` state is in the set to hold that:

```
theme             outline              offset   ring outer edge          field
localOperatorDark  2px solid rgb(56,201,106)   -2px   {x:460,y:50,w:28,h:28}   {x:228,y:48,w:264,h:32}
localOperatorLight 2px solid rgb(20,120,66)    -2px   {x:460,y:50,w:28,h:28}   {x:228,y:48,w:264,h:32}
```

An outline is drawn on the outside of the border box *inflated by the offset*,
so an offset of −2px with a 2px ring puts the ring's outer edge exactly on the
control's own box — 2px clear of the field's boundary vertically and 4px clear
of it horizontally, in both palettes. The ring is never clipped by the field and
never leaves it; `outline`, never `box-shadow`, so the contract's rule holds.
Both properties are asserted against this readback by the last test in
`scripts/clear-search.test.mjs`. What the frame still does **not** fix is the
design round's second half — while the control holds focus the field shows no
ring of its own, so the emphasis moves inside the field rather than staying
around it; that is the `:focus-within` alternative, which the round recorded as
a bigger change than this PR and did not take.

## Why no `CONTROLS` row was added

`scripts/contrast-contract.mjs` requires a row for a component with **its own
fill and border**. This control has neither at rest: the readback's
`rgba(0, 0, 0, 0)` fill and a computed `outline-width: 0px` are the transparent
ghost resting on the input's own `surface`, so its ink is `ink-muted` on a
ground the role loop already asserts for every palette. Its hovered pairing
(`accent-wash` fill, `ink` ink, on `surface`) is the row that file already
carries as `reading button, hovered`, which is the same pair of roles on the
same ground. `pnpm check-themes` reports `2207 assertions across 12 themes` both
before and after this change.

## Re-capturing this set

**These frames cannot be re-derived by `pnpm capture-evidence`.** The sidebar has
no Storybook story, so the sweep's `STORIES` list contains nothing that renders
it. `capture-evidence.mjs` preserves any directory declared in `manifest.json`'s
`supplementary` block across its wipe and carries the block through into the
manifest it writes, so a routine sweep leaves this set alone — but if it is ever
lost, it has to be re-taken by hand:

1. Seed an **isolated** config dir, never the operator's live store:
   `node out/evidence-harness/seed.mjs <scratch>/config` (7 agents, 2 teams, 7
   sessions; the script refuses a live path). These files are for a NARROW set of
   tests and mirror `scripts/seed-paging-session.mjs`; the harness itself lives
   in the gitignored `out/evidence-harness/`, as the `sidebar-new-chat` set's
   procedure describes, and would be lost with it.
2. Start the backend on a port you own:
   `LOCAL_OPERATOR_CONFIG_DIR=<scratch>/config LOCAL_OPERATOR_HOME=<scratch>/home
   LOCAL_OPERATOR_DESKTOP_TOKEN=<random> LOCAL_OPERATOR_DESKTOP_ORIGINS=http://localhost:5231
   local-operator serve --host 127.0.0.1 --port 11431`.
3. Serve the renderer with `out/evidence-harness/chat-sidebar.vite.mjs` and
   `LOCAL_OPERATOR_DESKTOP_BACKEND_URL=http://127.0.0.1:11431` plus the same
   token, so the proxy talks to that backend rather than to whatever `.env`
   names. Let **Vite** load that config (`vite --config …` or
   `createServer({ configFile })`) rather than importing it from Node: it pulls
   in `desktopProxyPlugin`, whose own import of `../../src/main/desktop-media`
   carries no file extension, which Vite resolves and Node's ESM loader refuses
   with `ERR_MODULE_NOT_FOUND`.
4. Point the app at this rig in a **scratch** `.env`:
   `VITE_LOCAL_OPERATOR_API_URL=http://localhost:5231` — the harness's own origin
   — and `VITE_DISABLE_BACKEND_MANAGER=true`. That plugin (`rigHealthPlugin` in
   the harness config) answers `/health` and `/v1/*` by forwarding to the
   isolated backend, and it exists because of the app's CSP: `index.html`'s
   `connect-src` names only `'self'` plus the shipped backend origins, so a fetch
   to any other port is refused by POLICY with no request sent at all, which is
   what painted the red offline banner across every frame of an earlier pass of
   this set. `capture.mjs` now fails the run if that banner is present.
5. `node out/evidence-harness/capture.mjs http://localhost:5231 docs/evidence/clear-search after`
   (and `before`, from a tree without the change — `git show origin/main:<path>`
   over `chat-sidebar.tsx` for the comparison half, restored afterwards). The
   `after` run takes five states (rest, query, hover, focused, cleared) and the
   `before` run three (rest, query, escape-cleared): `hover` and `focused` have
   no counterpart without the control. Both runs are deterministic — re-running
   one reproduces its frames byte for byte (the `after` frames in this commit
   are byte-identical to the first pass's, which is the same claim).

Three pieces of persisted state are seeded on every load, or the frames lie:

- `ui-preferences-storage` — carries the theme; without it a frame rehydrates
  as whatever the previous theme left behind.
- `onboarding-storage` — seed `isModalComplete`/`isTourComplete`, or the
  first-run wizard covers the sidebar and swallows pointer events, which
  silently produces hover frames identical to rest.
- `canonical-sessions-storage` — removed on every load, because `activeDraftKey`
  and `drafts` persist and a staging click in an earlier run rehydrates into the
  next one.

**One trap worth knowing** for the `before` half: the `before` frames must come
from a tree where the control genuinely does not exist, and a Vite dev server
holds the module graph. Restart the dev server (or confirm the rebuilt page has
no `[aria-label="Clear search"]` node) after switching source, or the "before"
frame is a picture of the change under test.
