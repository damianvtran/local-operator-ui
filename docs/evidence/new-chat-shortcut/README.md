# The New chat shortcut: ⌘N / Ctrl+N, and the cap that says so

The operator's request was "make it so that cmd+N (ctrl+N on Win/Linux) starts a
new chat in local-operator-ui as a shortcut (and show this shortcut with shortcut
style and subtle keycaps beside new chat)".

Two claims follow from that sentence, and they need different evidence:

1. **The chord starts a new chat in the running app.** A keyboard binding is the
   one kind of change whose failure mode is silence: the handler can be perfect
   and the listener never mounted, and no unit test can see that, because a unit
   test calls the predicate directly. That is measured in the BUILT Electron app,
   with a real key event, by `node scripts/renderer-driver.mjs --scene new-chat`.
2. **The row prints the cap, in the app's own shortcut style.** That is a fact
   about pixels on the sidebar's own ground, in more than one palette, and it is
   measured in the shipped `ChatPage` against a real isolated backend, driven in
   the operator's own browser.

## What produced these frames

### The chord, in the built app (`before-cmd-n.png`, `after-cmd-n.png`)

```
node scripts/renderer-driver.mjs --scene new-chat --out docs/evidence/new-chat-shortcut
```

The supported harness (`docs/agent-driver.md`): the BUILT app, launched by its
own Electron in the documented `headless` window mode, driven over CDP, with the
pixels from `webContents.capturePage()`. The scene presses the chord through
Chromium's own input pipeline (`Input.dispatchKeyEvent`), not with a
`KeyboardEvent` built inside the page — the whole claim is that the press
reaches the listener, so a synthetic event that starts at the listener proves
nothing.

The run's own transcript, which the frames are captioned from:

| Step | Measured |
| --- | --- |
| before the press | `route /agent-hub`, `activeDraftKey null` |
| `⌘N` | `route /chat` after **3 ms**, `activeDraftKey "draft:02d7ef52-…"` — a FRESH draft, the same thing the New chat row stages |
| `⌘⇧N` | refused: `route /agent-hub`, draft unchanged |
| a bare `n` | refused: `route /agent-hub`, draft unchanged |

The draft key is read from the store's own persistence
(`canonical-sessions-storage`), which is where `stageDraft` puts it, so this is
the app's state read through the app's own record rather than the harness's idea
of it. `⌘⇧N` and a bare `n` are the two refusals that matter: the first is
another app's chord, and the second belongs to whatever text field has focus.

**What these two frames do and do not show.** They show the ROUTE the press
moved — Agent hub before, chat after — and nothing about the two screens
themselves: a driver run has no backend, so both are the app's offline surface
(`/agent-hub` renders its categories with `Failed to load agents: The backend
could not complete this request.`, which is what a real app with no server
shows). The assertion is the evidence for this half; the frames are how a reader
sees the app move. Measured against this repository's own committed
`docs/evidence/renderer-driver/chat-dark.png`, the landed frame differs by
**1 pixel of 4,790,400**: the chord lands the app on exactly the screen the
driver's own scene photographs, which is what "it started a new chat" means when
no backend can hold the session.

### The cap, in the shipped sidebar (`before-*` / `after-*`)

```
# 1. an isolated backend: own config dir, own HOME, own random token, own port
SCRATCH=/tmp/lo-new-chat-shortcut-evidence
mkdir -p $SCRATCH/{config,home,logs,cwd}
openssl rand -hex 32 > $SCRATCH/token
env HOME=$SCRATCH/home LOCAL_OPERATOR_CONFIG_DIR=$SCRATCH/config \
  LOCAL_OPERATOR_LOG_DIR=$SCRATCH/logs \
  LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat $SCRATCH/token)" \
  LOCAL_OPERATOR_DESKTOP_ORIGINS=http://localhost:5206 \
  local-operator serve --host 127.0.0.1 --port 5396

# 2. the harness page, with the token and the backend URL in THIS process only
LOCAL_OPERATOR_DESKTOP_BACKEND_URL=http://127.0.0.1:5396 \
  LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat $SCRATCH/token)" \
  npx vite --config scripts/new-chat-shortcut-evidence.vite.mjs

# 3. in the operator's own browser, at the operator's own window size
#    http://localhost:5206/new-chat-shortcut-evidence.html                    (dark)
#    http://localhost:5206/new-chat-shortcut-evidence.html?theme=localOperatorLight
```

The surface is the app's own `ChatPage` mounted by
`scripts/new-chat-shortcut-evidence.{html,tsx,css}`, which is the same shape
`draft-pick-evidence` uses: the shipped components, the shipped canonical
sessions store, and the shipped `desktopRequest` taking its same-origin
`/__desktop` branch through `scripts/vite-plugins/desktop-proxy.ts` to a real,
isolated `local-operator serve`. Nothing between the backend's capability answer
and the cap is stubbed — and the capability answer is what puts the row on screen
at all (`ready = desktopFeatureEnabled(capabilities.data, "session_catalogue",
2)`, `showList = ready || stale`).

Interaction and screenshots are the **`browser` tool** driving the operator's
real browser; nothing here installs or scripts a browser engine. The `before`
halves are the same page with only the sidebar's own file at HEAD
(`git checkout HEAD -- src/renderer/src/features/chat/components/chat-sidebar.tsx`),
re-captured through the same harness at the same viewport and cropped by the same
`magick -crop`.

### What these frames do not prove

- **Not the packaged Electron app.** The renderer runs in the operator's browser,
  so the preload bridge is stubbed and `window.api.desktop` is deliberately left
  undefined, which routes the transport down its real `/__desktop` HTTP branch.
  Electron IPC and the packaged build are not exercised here — they are the other
  half of the pair above, which runs in the built app and has no backend.
- **An EMPTY catalogue.** The isolated backend is fresh, so `All chats` carries no
  count badge and the rows under `Active chats` / `Previous chats` are the empty
  sentences. The agent and team rows are the backend's own builtin seeds, not a
  fixture. This means these frames do NOT show the cap beside a populated count
  column; what they show is the column the cap occupies, measured below.
- **Two palettes, not twelve.** `localOperatorDark` and `localOperatorLight` — the
  two brand palettes, light included because that is where a too-faint cap hides.
  The twelve-theme sweep belongs to the Storybook pipeline and is not regenerated
  here; the twelve palettes' own numbers are computed below.
- **No model inference and no session.** No turn is ever sent; the only
  session-creation path touched is the row's own `stageDraft`, which is local
  store state.
- **The canvas collision is not driven here.** `⌘N` inside the open canvas pane is
  the canvas's "new file", and the scope rule that decides whose press it is
  (`src/renderer/src/features/chat/components/canvas/canvas-shortcut-scope.ts`) is
  asserted in `scripts/new-chat-shortcut.test.mjs`. Neither of these two runs can
  open a canvas — the driver has no backend and no session, and the harness page
  has none either — so that rule has unit evidence and not a frame.

## Before / after

The pair differs by ONE thing, and the measurement says so rather than the
caption: `magick compare -metric AE` reports **2,904 differing pixels of
3,686,400 (0.079%)** between `before-*` and `after-*`, all inside a single
**111x43 device-pixel box at +425+1058** — the caps. The same box at the same
offset comes back for BOTH palettes, which is the cross-check that the caps'
geometry is not a palette-dependent accident.

| State | Before | After |
| --- | --- | --- |
| Sidebar at rest, `localOperatorDark` | [`before-sidebar-dark`](before-sidebar-dark.png) — the row reads `New chat`, nothing else | [`after-sidebar-dark`](after-sidebar-dark.png) — the row reads `New chat` then the `⌘` and `N` caps |
| Sidebar at rest, `localOperatorLight` | [`before-sidebar-light`](before-sidebar-light.png) | [`after-sidebar-light`](after-sidebar-light.png) |
| The row block, 2x (device pixels) | [`before-row-dark`](before-row-dark.png) | [`after-row-dark`](after-row-dark.png) |
| After the row's own action | *(no before: the marking is unchanged)* | [`after-row-staged-light`](after-row-staged-light.png) — the staged draft marks the row current, wash and all, with the caps holding their own ground on it |
| The chord in the built app | [`before-cmd-n`](before-cmd-n.png) — Agent hub | [`after-cmd-n`](after-cmd-n.png) — the chat route, 3 ms later |

## The measurements behind the pixels

Frames are `2560x1440` device pixels — the operator's browser viewport,
`1280x720` CSS at device pixel ratio 2. The sidebar column is 280 CSS px wide
(`ChatLayout`'s default, at its `min 240 / max 360` clamp), and each frame here is
the sidebar plus 40 device px of the ground beside it.

**The caps' geometry**, read off the frames by scanning the cap fill (all values
in CSS px, i.e. device px / 2):

| Property | Measured |
| --- | --- |
| Each cap | 20 px wide (`KeyboardShortcut`'s `min-w-5`) |
| The `⌘` cap | 14 px tall |
| The `N` cap | 21.5 px tall |
| The pair's right edge | x = 268 = the sidebar's 280 px minus its 8 px padding minus the row's own 4 px inset — i.e. the row's OWN trailing edge, the column the `All chats` count and the entity rows' overflow control occupy |
| The cap block | 55.5 px wide, centred in the 32 px row (`h-8`) |

**The caps are the contract's own roles, measured in the rendered pixels** (the
1-unit difference from the palette hex is the screenshot's colour conversion):

| | Sidebar ground | Cap fill | Cap glyph |
| --- | --- | --- | --- |
| `localOperatorDark` | `srgb(29,26,21)` ≈ `surface` `#1e1a14` | `srgb(14,12,8)` ≈ `sunken` `#0f0c08` | `srgb(180,175,164)` = `inkMuted` `#b5afa2` |
| `localOperatorLight` | `srgb(250,248,242)` ≈ `surface` `#faf8f1` | `srgb(238,233,221)` ≈ `sunken` `#efe9db` | `srgb(85,81,72)` = `inkMuted` `#565147` |

**And the pair is legible in all twelve palettes**, computed from
`src/renderer/src/shared/themes/palettes/` with the repository's own colour
maths. The cap's `sunken` fill against the sidebar's `surface` ground, ΔE00 /
`inkMuted` on `sunken`, contrast:

```
iceberg           3.75 /  6.33:1      dune             4.59 /  9.97:1
localOperatorLight 4.40 / 6.51:1     monokai          5.11 /  9.02:1
localOperatorDark 4.48 /  8.94:1     sage             5.27 /  6.68:1
obsidian          4.49 /  8.03:1      dracula          7.10 /  8.59:1
neon              7.77 /  7.95:1      tokyoNight       8.68 /  8.68:1
radient           8.80 / 12.59:1      synth           14.94 /  9.46:1
```

The ink clears `docs/branding.md` § 3's 4.5:1 text floor everywhere (worst
6.33:1, iceberg), and the fill is a perceivable step on every ground: the
contract's own "a human can tell these apart" threshold is ΔE00 3.0, and the
closest palette in the tree is 3.75. No new `CONTROLS` row is owed for this: a
cap is not a control with a boundary of its own, and its ink is already governed
by the contract's `INKS` list, which asserts `inkMuted` against `sunken` on every
theme.

**One finding this set records rather than fixes.** The two caps in one chord are
not the same height — 14 px for the glyph cap against 21.5 px for the text cap,
measured above. That is `KeyboardShortcut`'s existing behaviour (`p-0.5` around a
10 px glyph against `px-1.5 py-0.5` around a line of `text-mono-sm`), and this row
is the first call site that pairs an ICON with a LETTER in one chord: every
existing site pairs like with like (`Esc`, `⌘+Enter`, `Ctrl+Enter`), so the
mismatch has never been visible. Fixing it means changing the cap heights on
those other sites too (the inline editor's footer), which is a visual change to a
surface this request did not ask for and which has no story or harness to
re-capture it with — so it is reported here as a follow-up rather than smuggled
into this change.
