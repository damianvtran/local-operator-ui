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

### The chord, in the built app

TWO RUNS, TWO CLAIMS, because the shortcut takes the New chat row's own gate —
the session catalogue — and a driver run's backend is what that gate reads:

```sh
# the feature: a live, ISOLATED backend this run owns, and a profile that is not
# a first-run one (a fresh profile in front of a fresh backend opens the wizard)
env VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:5396 pnpm build
env LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat $SCRATCH/token)" \
  node scripts/renderer-driver.mjs --scene new-chat \
    --backend http://127.0.0.1:5396 \
    --backend-records $SCRATCH/config/run/serve \
    --seed-onboarding-complete --out docs/evidence/new-chat-shortcut

# the gate: the same press with no reachable backend at all
node scripts/renderer-driver.mjs --scene new-chat --out /tmp/frames-no-backend
```

The supported harness (`docs/agent-driver.md`): the BUILT app, launched by its
own Electron in the documented `headless` window mode, driven over CDP, with the
pixels from `webContents.capturePage()`. The scene presses the chord through
Chromium's own input pipeline (`Input.dispatchKeyEvent`), not with a
`KeyboardEvent` built inside the page — the whole claim is that the press
reaches the listener, so a synthetic event that starts at the listener proves
nothing. `--backend` points the app's own transport at the run's backend and
reads the bearer from the environment; `--backend-records` hands the app the
serve record that backend wrote for itself, because `discovery.ts` admits a
daemon only when a record proves it is the one the app found; and
`--seed-onboarding-complete` writes the profile's own onboarding flags before the
app's scripts run, because a fresh profile in front of a fresh backend is a
first-run user whose six-step wizard is a modal over the window.

**The feature run's transcript** (`cmd-n-live-*`):

| Step | Measured |
| --- | --- |
| isolation | `the renderer was built against the backend this run started`; `holds a connection to this run's backend (127.0.0.1:5396)`; `holds NO connection to the operator's own backend (http://localhost:1111)` |
| before the press | `route /agent-hub`, `activeDraftKey null` |
| `⌘N` | `route /chat` after **4 ms**, `activeDraftKey "draft:9f085520-…"` — a FRESH draft, the same thing the New chat row stages |
| `⌘⇧N` | refused: `route /agent-hub`, draft unchanged |
| a bare `n` | refused: `route /agent-hub`, draft unchanged |

**The gate run's transcript** (`cmd-n-no-backend`, and this is the shape of the
review round's first finding): `with no backend ⌘N is inert, exactly as the New
chat row is disabled on the same capability — route /agent-hub after 5023 ms,
activeDraftKey null -> null`. The two frames of that pair are **byte-identical**
(`162962` bytes each, `magick compare -metric AE` = **0**): with no catalogue the
press changes nothing at all, which is the state the row is absent in.

The draft key is read from the store's own persistence
(`canonical-sessions-storage`, which is where `stageDraft` puts it), so this is
the app's state read through the app's own record rather than the harness's idea
of it. (The driver writes its frames as `before-cmd-n.png` / `after-cmd-n.png`;
the committed copies carry their mode in the name, `cmd-n-live-*` and
`cmd-n-no-backend`, so the two runs cannot be confused for one another.)
`⌘⇧N` and a bare `n` are the two refusals that matter: the first is
another app's chord, and the second belongs to whatever text field has focus.

**What these frames show.** `cmd-n-live-after.png` is the REAL app on the draft
the chord staged: the chat pane reading `New chat` / `The session starts when you
send your first message.`, the composer, and — in the sidebar — the New chat row
carrying its `⌘` and `N` caps, marked current because the draft it started is the
one on screen. `cmd-n-live-before.png` is where it came from: Agent hub with its
categories. Nothing in either frame is the operator's data: the backend is this
run's own, its catalogue is empty, and the scratch profile is its own.

**What they do not show.** Not the packaged app's install path, not a session
with history (the catalogue is empty), and not the keyboard on Windows or Linux:
the chord is pressed as `Meta+N`, which is the same physical key this harness
sends everywhere. The `--backend` mode and its two companion options exist
because this change needed them, and they are declared on the PR as new harness
surface rather than smuggled in as a scene tweak.

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
caption. On the two COMMITTED sidebar frames — `640x1440` device pixels each, the
crop described below — `magick compare -metric AE before-sidebar-dark.png
after-sidebar-dark.png null:` reports **2,904 differing pixels of 921,600
(0.315%)**, all inside a single **111x43 device-pixel box at +425+1058**. On the
full `2560x1440` capture those same 2,904 pixels are **0.079% of 3,686,400**; the
numerator is one number and the denominator is whichever file you are looking at,
which is why both are given. The same box at the same offset comes back for BOTH
palettes, which is the cross-check that the caps' geometry is not a
palette-dependent accident.

| State | Before | After |
| --- | --- | --- |
| Sidebar at rest, `localOperatorDark` | [`before-sidebar-dark`](before-sidebar-dark.png) — the row reads `New chat`, nothing else | [`after-sidebar-dark`](after-sidebar-dark.png) — the row reads `New chat` then the `⌘` and `N` caps |
| Sidebar at rest, `localOperatorLight` | [`before-sidebar-light`](before-sidebar-light.png) | [`after-sidebar-light`](after-sidebar-light.png) |
| The row block, 2x (device pixels) | [`before-row-dark`](before-row-dark.png) | [`after-row-dark`](after-row-dark.png) |
| After the row's own action | *(no before: the marking is unchanged)* | [`after-row-staged-light`](after-row-staged-light.png) — the staged draft marks the row current, wash and all, with the caps holding their own ground on it |
| The chord in the built app, against a real backend | [`cmd-n-live-before`](cmd-n-live-before.png) — Agent hub | [`cmd-n-live-after`](cmd-n-live-after.png) — the chat route 6 ms later, the staged draft's pane, and the row holding its current marking |
| The chord with NO backend | [`cmd-n-no-backend`](cmd-n-no-backend.png) — the gate: the press changes nothing, and this frame is byte-identical to its own `before` |

## The measurements behind the pixels

**Sizes, because two of them are quoted below.** The screenshots the browser
tool took are `2560x1440` device pixels — the operator's browser viewport,
`1280x720` CSS at device pixel ratio 2. The committed sidebar and row frames are
CROPS of those: `640x1440` and `640x200` device px, which is the 280 CSS px (560
device px) sidebar column plus 40 **CSS** px (80 device px) of the ground beside
it. The two chord frames are a different surface with its own size — `2760x1736`,
the driver's `1380x868` CSS viewport at DPR 2.

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
not the same height — 20 px wide each (`min-w-5`), **14 px** tall for the glyph cap
against **21.5 px** for the text cap, measured above. That is
`KeyboardShortcut`'s existing behaviour (`p-0.5` around a 10 px glyph against
`px-1.5 py-0.5` around a line of `text-mono-sm`), not markup this row introduces,
and the glyph compounds it: the symbol's stroke core measures ~1 device px against
the letter's ~2, so the modifier reads as a hairline inside a small chip beside a
solid key.

**This row is not the first place it shows**, which an earlier draft of this note
claimed and design round 1 corrected: `Ctrl+Enter` in the inline editor
(`inline-edit.tsx`, through the component's `keyIconMap`) already pairs a 21.5 px
text cap with a 14 px icon cap on Windows and Linux. So the mismatch is pre-
existing on a shipped surface, which changes the cost of fixing it — the fix would
repair a surface that already carries the defect rather than disturb a clean one,
but it still moves those footer caps (`⌘` and `↵`) on a surface with no story and
no harness, so it wants its own scoped change and its own frame. Reported here as
a follow-up rather than smuggled into this one; design round 1's disposition is the
same (ship behind a follow-up), and its measured detail is in that round's comment
on the PR.

**The ground the row gains when a draft is staged is not one the theme gate
asserts.** The contract enumerates four grounds and asserts every `INKS`/`CONTROLS`
row over them; this row adds a fifth by design — `bg-accent-wash` while an
untargeted draft is staged — and that is where the cap's step is thinnest measured
across the twelve palettes: fill against wash ΔE00 **3.2** (iceberg) against a fill
step of 4.40–14.94 on `surface`, with `ink-dim` on the wash at **4.49:1** in the
same palette. Nothing is broken today (the cap's own glyph is `ink-muted` and
clears the text floor on every ground it is drawn on, and the `+` between the caps
is `aria-hidden`, so the 4.5:1 text floor does not bind it), but a palette could
move it unnoticed. Recorded rather than fixed: the assertion set is the theme
gate's, not this PR's.
