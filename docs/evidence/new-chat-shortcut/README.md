# The New chat shortcut: ⌘N / Ctrl+N, and the cap that says so

> **SUPERSEDED IN PART, 2026-09.** The frames and measurements here are the record
> of the round that added this chord, and they are still accurate about those
> frames. Two things they describe have since moved, in
> `docs/evidence/chat-sidebar-current-row/`: the caps no longer carry a `bg-sunken`
> fill (so the geometry table below gives a cap HEIGHT that is now 20 CSS px for
> every cap rather than 14 px for the `⌘` and 21.5 px for the `N`), and the
> `outline-control` edge this row grew while it was current has been retired along
> with the fill that made it necessary. The chord, the gate and the row's own
> ground measurements are unaffected.

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
| `⌘N` | `route /chat` after **6 ms**, `activeDraftKey "draft:8078943e-…"` — a FRESH draft, the same thing the New chat row stages |
| `⌘⇧N` | refused: `route /agent-hub`, draft unchanged |
| a bare `n` | refused: `route /agent-hub`, draft unchanged |

**The gate run's transcript** (`cmd-n-no-backend`, and this is the shape of the
review round's first finding): `with no backend ⌘N is inert, exactly as the New
chat row is disabled on the same capability — route /agent-hub after 5012 ms,
activeDraftKey null -> null`. The two frames of that pair are **byte-identical**
(`167486` bytes each, `magick compare -metric AE` = **0**): with no catalogue the
press changes nothing at all, which is the state the row is absent in. The frame
committed here is that run's `after` (the state the inert press left), and it is
the run of round 3's re-shoot rather than round 2's — see the note on the pair at
the end of this section.

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
send your first message.`, the empty state under it, the composer with the focus
ring the run left on it, and — in the sidebar — the New chat row carrying its `⌘`
and `N` caps, marked current because the draft it started is the one on screen, and
edged, because on a current row the caps' own fill IS the ground and the boundary
is what says they are caps *(that edge is gone: the cap carries no fill now — see
the note at the top)*. `cmd-n-live-before.png` is where it came from: Agent
hub with its categories. Nothing in either frame is the operator's data: the
backend is this run's own, its catalogue is empty, and the scratch profile is its
own.

**The pair was RE-SHOT once, for `#228`, and the re-shoot is the reason its pane
changed.** `#228` replaced the composer's suggestion stack, so the pane in these
frames carries the new tip line (`search chats and agents to reopen an earlier
session`) and its own single row of suggestions rather than the two rows the
earlier captures showed — a change in the pane around this PR's subject, not in
the subject. That is measured rather than asserted: at fuzz 0 the two `after`
frames differ by 378,855 of 4,791,360 pixels inside `2254x853+466+469`, while the
caps' own region differs by **0 pixels in three crops** (x 900-1040, 930-1030 and
880-1040 across the row band), the New chat row's band by 8 pixels of antialiasing
and the rail by none. The `before` frame did not move at all: it is byte-identical
(148,464 B, `magick compare -metric AE` = 0) to the capture it replaces, and is
committed from this run because the pair has to be one run. Focus is the one thing
these two `after` frames do not share — the run's own ⌘N press left the ring on the
composer rather than where the previous capture had it — and it is named here
rather than left for a reader to find.

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
  (`src/renderer/src/features/chat/keyboard-scopes.ts`, the same module the
  sidebar's own cap comes from) is asserted in
  `scripts/new-chat-shortcut.test.mjs`. Neither of these two runs can
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

**The two frames round 2 re-shot, and how they differ.** `after-row-staged-light.png`
and `cmd-n-live-after.png` were captured BEFORE `#218` moved this row's ground, so
both photographed a surface the app no longer paints (the light and the dark wash),
and the staged-row frame is also the frame round 2's structural edge first appears
in. The committed copies are now this head's:

| Frame | AE against the frame it replaces, at **fuzz 0** (any pixel that differs at all) | Where the difference is |
| --- | --- | --- |
| `after-row-staged-light.png` | **30,724 of 128,000 = 24.0031%** | the whole **528x64 current-row band at +16+98**, because `#218` repainted that row's ground. Counted by cropping the caps' union box `111x43+425+108` and comparing the crops, then blanking that same box on both frames and comparing the rest: **2,505** of the 30,724 lie inside it and **28,219** outside — the ground is most of the change |
| `cmd-n-live-after.png` | **378,855 of 4,791,360 = 7.9071%** | `2254x853+466+469` — the pane and the composer's focus ring, not the row: the rail (`x 0..459`) differs by **0** pixels, the chats sidebar (`x 460..999`) by **51** (max channel delta 17: antialiasing on its own chrome), the New chat row's band by **8** (`y 1320..1329`, ±3 units on the `All chats` label), and the caps' own region by **0 in three separate crops**. Re-shot because `#228` rewrote the composer's suggestion stack — see the round-2 note below |
| `cmd-n-live-before.png` | **0 (byte-identical, 148,464 B)** | Agent hub, unchanged by `#228` at every pixel; re-taken with its sibling in the same run so the pair is one run, and the equality is stated rather than assumed |

**Those numbers are counts and boxes at different tolerances if they are read the
old way, so here they are at one.** `magick compare -metric AE` at **fuzz 0** puts the
change across the whole current-row band rather than in one box: the ground `#218`
repainted is most of it.

**That split is measured by cropping, not by subtracting.** Cropping the caps' union
box `111x43+425+108` out of both frames and comparing the crops gives **2,505**
differing pixels inside it; blanking that same box on both frames and comparing what
is left gives **28,219** outside it — and 2,505 + 28,219 = 30,724, the fuzz-0 total.
Two earlier accounts of this paragraph were wrong in two different ways, and both are
worth naming because each hid the other: the first paired the fuzz-0 count with a box
measured at a 10% threshold, and the second took its inside count from a `112x44`
envelope while naming the `111x43` box, so its halves came from two rectangles and
did not sum to the total. The numbers above are one box, counted twice.

**The caps did not move, and that is the layout-neutrality claim in pixels.** Their
boxes are the SAME rectangles in both frames — the glyph cap `40x28` device px at
`+425+116`, the letter cap `40x43` at `+496+108` (20 CSS px wide each, `14` and
`21.5` CSS px tall) — and 596 of the pixels inside them changed: the **508** the new
edge's own colour accounts for, plus its antialiased corners. Strip a
two-device-pixel ring from each box and **12** pixels a side differ, the ring's inner
corners: the fill and the glyphs are where they were, so an inset outline moved
nothing, and what moved is the ground the caps are drawn on. **The REST state is
untouched, measured three ways**:
re-capturing the same two palettes through the same harness at the same viewport
returns `magick compare -metric AE` **0** for `after-sidebar-dark.png`,
`after-sidebar-light.png` and `after-row-dark.png`, at the same byte sizes as the
committed files (76,991 / 76,734 / 8,656) — that is the measurement saying this
round changed the current-row state and nothing else.

**`cmd-n-no-backend.png` was re-shot in round 3, and the reason given for not
re-shooting it was beside the point.** Round 2 left it alone because its SUBJECT —
the gate, the press changing nothing with no catalogue — was untouched by that
round's change, and that was true; but the frame was a capture of an older tree
regardless, and QA's round 3 measured it away from this head by **1,293 pixels
(0.0270% of the frame) inside `357x28+42+1586`**: the rail's own `Search` row and
its `⌘+K` hint, which this head paints where that capture had nothing — the row
entered the rail with the command-palette work (`290e4f8eb`, the commit that brought
both the row and its `⌘+K` hint), after the capture.
The frame committed now is this head's, from the documented no-backend run
(`--scene new-chat` with no `--backend`), whose transcript is above; the pair is
byte-identical at 167,486 bytes each, which is the property the set claims for it.
Nothing about the subject changed, which is exactly why the old frame's periphery
was the only thing wrong with it and why "the subject is untouched" was never the
question this frame's freshness turned on.

| State | Before | After |
| --- | --- | --- |
| Sidebar at rest, `localOperatorDark` | [`before-sidebar-dark`](before-sidebar-dark.png) — the row reads `New chat`, nothing else | [`after-sidebar-dark`](after-sidebar-dark.png) — the row reads `New chat` then the `⌘` and `N` caps |
| Sidebar at rest, `localOperatorLight` | [`before-sidebar-light`](before-sidebar-light.png) | [`after-sidebar-light`](after-sidebar-light.png) |
| The row block, 2x (device pixels) | [`before-row-dark`](before-row-dark.png) | [`after-row-dark`](after-row-dark.png) |
| After the row's own action | *(no before: the marking is unchanged)* | [`after-row-staged-light`](after-row-staged-light.png) — the staged draft marks the row current, and the caps carry the structural edge that says they are caps on it (`sunken` on `sunken`, 1.00:1, is what this frame showed before round 2's fix — see below) |
| The chord in the built app, against a real backend | [`cmd-n-live-before`](cmd-n-live-before.png) — Agent hub | [`cmd-n-live-after`](cmd-n-live-after.png) — the chat route 2 ms later, the staged draft's pane, and the row holding its current marking with the same edge on its caps |
| The chord with NO backend | [`cmd-n-no-backend`](cmd-n-no-backend.png) — the gate: the press changes nothing, and this frame is byte-identical to its own `before` (167,486 bytes each, AE 0). Re-shot in round 3 because its rail periphery was an older tree than this head's (`Search` and its `⌘+K` hint are `290e4f8eb`'s row); the subject did not move, and the re-shoot is what makes that claim about THIS head |

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
6.33:1, iceberg), and the fill is a perceivable step on the SIDEBAR's own ground.
The closest pair the contract's adjacent-grounds list holds to its field floor is
3.75 (`iceberg`, `sunken` against `surface`; the `elevated`/`sunken` pair is 5.85) —
that list is held to `FIELD_SEPARATION_FLOOR`, ΔE00 2.0, in
`scripts/contrast-contract.mjs`, and it is deliberately not every ground pair in
the tree: `canvas` against `sunken` is closer than either (ΔE00 1.23 in obsidian)
and is not in it, for the reason that file states where it lists the pairs — the
near-black palettes cannot separate those two by luminance at all, so the blocks
that render `sunken` on `canvas` carry a `hairline` edge instead of relying on the
step. "Closest asserted" is the claim here, and it is the stronger one. The caps' ink is governed by the contract's `INKS`
list, which asserts `inkMuted` against `sunken` on every theme.

**The one state where that step does not exist is the row the chord creates**, and
it is why round 2 added a structural edge (design round 2, D4; review F1; QA Q-1;
UX U4). `#218` moved this row's current ground to `rowCurrent = "bg-sunken text-ink
hover:bg-sunken"`, which is the caps' OWN fill — the same role — and
`after-row-staged-light.png` shows it: the row's ground and the caps' interior are
the same sampled pixel, `srgb(238,233,221)`, i.e. **1.00:1 and ΔE00 0.00 in all
twelve palettes**, so the caps read as plain monospace glyphs exactly when the user
has just used the chord they name. The glyph ink stays legible there
(6.33-12.59:1) — this was the affordance, not legibility.

The fix is a boundary on the caps while that row is current, drawn as an INSET
OUTLINE (`outline-solid outline-1 -outline-offset-1 outline-control`) so that it
does not enter the box model: an outline draws outside layout, so the caps'
geometry below is unchanged in both states and the row does not shift as it becomes
current — the same 1px shift this row retires `border-control` on the ROW itself
for. In the re-shot frame the edge samples `srgb(132,127,114)` against the role's
own `borderControl` `#857f70` — the frames render the role one unit low, exactly as
they render the grounds — and it measures **3.13-5.91:1** against that ground across
the twelve palettes (worst: iceberg 3.13): `docs/branding.md` § 3's 3:1 structural
floor, cleared in every one. QA's alternative, the cap stepping to `bg-elevated`
inside a current row, was measured too (1.20-1.55:1, ΔE00 5.85-16.70) and rejected
for a reason that is NOT its contrast — those numbers clear the same ΔE00 3.0
"perceivable step" bar the rest-state chip is judged by — but the ROLE: it would
raise the one element on a row whose whole point is being recessed.

**That guarantee is asserted, not described.** A `CONTROLS` row could not carry it
— the pairing is a class against a role — so it lives in
`scripts/contrast-contract.mjs`'s `STRUCTURAL_CALL_SITES`, as TWO entries: the
condition that puts the edge on the element, and the class it puts there. Either
one alone can be deleted while the file still reads as a row with an edge on it,
which is why both are pinned. The palette half was already asserted: `sunken` is
one of the contract's four `GROUNDS`, so every `INKS`, `CONTROLS` and structural
row already runs over it, and `borderControl` clears 3:1 on all four in every
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

**The deferral this set used to carry is CLOSED, and round 2 says so rather than
leaving an open item that no longer exists.** Design round 1 recorded that the
staged draft's ground was a FIFTH ground the theme gate did not assert
(`bg-accent-wash`, with the cap's fill against it at ΔE00 3.2 in iceberg), recorded
rather than fixed because the assertion set is the theme gate's and not this PR's.
`#218` closed it from the other side: the current ground is now `sunken`, one of the
contract's four `GROUNDS`, and therefore already covered by every `INKS`,
`CONTROLS` and structural row, with the grounds-separation pass keeping `sunken`
apart from `surface` (ΔE00 3.75, the closest pair that list holds) and `elevated`
(5.85) in all twelve palettes. What remained open on that ground was the caps' own
step on it, and that is what the edge above answers — pinned at the call site.
