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
- **A still cannot show focus.** See "The caret comes back" below: that claim is
  carried by the readback, not by the pixels.
- **Two of the three states are unreachable in the `before` tree**, because the
  control does not exist there. The `before` set reaches the cleared state the
  only way it was reachable — Escape — which is the behaviour being replaced.

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

Light theme: [`before-query`](before-query/localOperatorLight.webp),
[`after-query`](after-query/localOperatorLight.webp),
[`after-hover`](after-hover/localOperatorLight.webp),
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

## The caret comes back — and a still cannot show it

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
after   cleared          value=""     activeElement=INPUT[Search chats and agents]   <- cleared, caret kept
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
`src/renderer/src/features/chat/clear-search.ts`), and the readback above is
what proves it, because the caret is hidden and a programmatic focus after a
mouse gesture paints no focus ring.

## Geometry: the control is inside the field, and nothing moves under the pointer

Read from the live document at each state (`after-readback.json`):

```
input    {x:228, y:48, w:264, h:32}   padding-right 36px   (pr-9)
control  {x:460, y:50, w:28, h:28}    inset 4px from the input's right edge, vertically centred
text     clips at x:456               -> 4px clear of the control's own edge
```

The control is a 28×28 hit target (`icon-sm`, above the 24×24 minimum) on the
`size-7` step of the shared button. Box position and size are identical in the
rest, hover and cleared samples:

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
4. `node out/evidence-harness/capture.mjs http://localhost:5231 docs/evidence/clear-search after`
   (and `before`, from a tree without the change — stash
   `chat-sidebar.tsx` for the comparison half).

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
