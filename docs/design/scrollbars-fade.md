# The scrollbar: one thumb that fades everywhere

Design direction for the operator's ask, quoted verbatim:

> 1. Fade-out after inactivity: thumbs fade out after a short, UX-friendly idle
>    period; they must never be permanently stamped on screen.
> 2. Reveal on intent: fade IN when the pointer moves in/near the thumb or the
>    scrollbar region, while hovering the scroll container, and during/just after
>    active scrolling (any wheel/drag/keyboard scroll updates the timer). Stay
>    visible for a few seconds, then fade. Slick — no flicker, no pop; fade with
>    opacity + small delay logic, no layout shift (overlay gutters).
> 3. App-wide, centralized: ONE shared implementation so ALL thumbs behave
>    identically — vertical AND horizontal — across every surface. Enumerate the
>    surfaces, migrate any one-off scrollbar styling to the shared mechanism, note
>    any that can't use it (with reasons). Include the new markdown-table scroll
>    wrapper (recently added) and board columns.
> 4. Cross-platform slickness: thin, theme-aware thumbs that look right on Windows
>    and Linux as well as macOS; document platform quirks and how they're handled;
>    verify at least via the dev rig on macOS plus a documented Linux/Windows
>    validation approach; do not claim Unity where unverified — state what was and
>    wasn't observed.
> 5. Accessibility: focus/keyboard paths shouldn't leave users unable to see where
>    they are; decide and document the focus behaviour.
> 6. No scroll-performance regression.

Author: designer subagent (local-operator-ui, lopdev team). Audit head:
`origin/main` = **`a298bfb120`** (`git rev-parse --short origin/main`). Every code
cite below was re-read at that ref with `git show a298bfb120:<path>`; the
surfaces marked *(audit list)* carry the scout pass's line numbers and were not
re-read.

Status: **design direction, implementation not included.** The coder implements
against this document; `src/` and `scripts/` are untouched by it — the only tree
it moves is `docs/`.

Read with: `docs/branding.md` (§ 5 radii and motion), the architect memo
(`/Users/damian/.local-operator/sessions/4a54a098893b/scratchpad/scrollbar-architect-memo.md`,
probe-backed, cited throughout as *the memo*), `docs/agent-driver.md` (frames),
`docs/design/row-states-refinement.md` (the shape this document copies).

**The one-sentence direction.** *Every scrollbar in the app keeps the thumb it
has today — `--color-control`, 8 px, radius 4, transparent track — and gains
exactly one new behaviour: it is invisible at rest and fades in when the reader
scrolls, or moves toward the bar, then fades back out.*

> **AMENDED, 2026-10-06 (issue #845): the thumb is no longer INVISIBLE at rest.**
> The operator's newer ask is a *faded resting state* — "idle stops meaning
> invisible; the thumb dims to a low-alpha resting state and still goes solid on
> hover and during scrolling" — which amends clause 1 of the quoted ask ("they
> must never be permanently stamped on screen") rather than contradicting it: the
> bar is never a full-strength control at rest, and it is never absent either. The
> change is one number in the one shared implementation
> (`global-scrollbar-styles.tsx`'s base `--lo-sb`), so every thumb in the app moves
> together and no surface needs its own copy. Derivation, band, and the rest of
> this issue's work are in § 10 below; every clause of the original ask other than
> "invisible at rest" stands as written.

---

## 1. What is there now, measured

`src/renderer/src/shared/components/common/global-scrollbar-styles.tsx` is the
app's **only** shipped `::-webkit-scrollbar` rule (38 lines, injected from
`src/renderer/src/main.tsx:18` and mounted at `:99`):

```css
*::-webkit-scrollbar            { width: 8px; height: 8px; }        /* :14-16  */
*::-webkit-scrollbar-thumb      { background-color: var(--color-control);
                                  border-radius: 4px; }             /* :17-20  */
*::-webkit-scrollbar-track,
*::-webkit-scrollbar-corner     { background-color: transparent; }   /* :21-24  */
```

Its own comment (`:5-13`) states why the thumb is `border-control`: a scrollbar
thumb is a control the reader has to find and grab, and the previous
mode-switched `rgba(255,255,255,0.1)` measured about 1.1:1 on dark themes —
*"the thumb was there, and it was invisible until you already knew where it
was."* `--color-control` resolves to `var(--lo-border-control)`
(`styles/themes.generated.css:2330`, `localOperatorDark` value `#837c6d`).

**The defect is not the look. It is that the look is on screen at all times.**

### 1.1 The permanent thumb, captured in the app's own build

Command (scratch worktree at `a298bfb120`, built with
`LOCAL_OPERATOR_UI_NO_BYTECODE=true node_modules/.bin/electron-vite build`,
then):

```
node scripts/renderer-driver.mjs --scene palette --out $SCRATCH/frames-before/palette --clean
```

— `ALL CHECKS PASSED`, five frames, *"every capture is a frame the app held
still for, with no toast on it"*, *"no process from this run outlived its
boot"*. The window is `headless` (never shown, unfocusable), so **no pointer has
ever entered the page and nothing has been scrolled since boot** — this is the
resting state.

Measured on `frames-before/palette/palette-browse-dark.png`
(2760×1800 device px at a 1380×900 window → dpr 2), by reading pixels
(`magick … txt:-`, then column/row runs):

| Reading | Value |
| --- | --- |
| Thumb pixels, row `y=700` | `#827c6f` from `x=2002` to `x=2017` → **16 device px = 8 CSS px wide** |
| Thumb run, column `x=2009` | `y=531 … 947` contiguous → **417 device px ≈ 208 CSS px tall** |
| Token it paints | `--color-control` = `#837c6d` (the 1-unit delta is the capture's compositing) |
| State | idle, no pointer in the page, no scroll since boot |

A complete, fully opaque, rounded thumb sits on screen in the resting state.
That is the symptom the operator reported, measured rather than described.

### 1.2 What the census found

- `scrollbar-width` appears in `src/` in exactly one place — `canvas-tabs.tsx:240`
  ("opt-out"), alongside `[&::-webkit-scrollbar]:hidden`. `scrollbar-color`
  appears nowhere. So there is no second scrollbar system to reconcile.
- `scripts/contrast-contract.mjs` has **no row naming a scrollbar or a thumb**
  (`grep -n 'scrollbar\|thumb'` returns nothing), although the thumb is a control
  painted at the 3:1 `border-control` floor — see § 9.2.
- The activity signals the house already uses are listeners, not observers: a
  passive `scroll` on the container (`use-scroll-paging.ts:724-729`), a document
  capture-phase `scroll` (`use-floating-control.ts:230-232`), and the
  scroll-linked CSS precedent in `styles/index.css:368-430`.

### 1.3 Story-level state, honestly

Three stories were rendered from the same head through the repo's Storybook
(`projects-tab--populated`, `chat-sidebar-sections--resting-default`,
`chat-tool-rows--expanded-overflow`, `args=theme:localOperatorDark`, viewport
1280×900 @2x, `document.documentElement.dataset.theme` asserted
`localOperatorDark` for each). A DOM scan of each returned **`n=0` elements with
`scrollHeight > clientHeight+1`** at that viewport: those screens fit, so those
frames show no bar at all. They are evidence about those surfaces' layout, not
about the thumb, and this note does not use them as if they were.

---

## 2. Behaviour spec

**Mechanism is the architect's, not this document's**, and the spec below is
written to it (memo § Recommendation): a registered `@property --lo-sb`
(`<number>`, `inherits: true`, initial `0`) transitioned **on the scroller
element**, with the thumb painting
`color-mix(in srgb, var(--color-control) calc(var(--lo-sb)*100%), transparent)`,
driven by an attribute the module writes directly. Assumptions on the mechanism
are listed in § 9.1; nothing below depends on anything the manager has not
already settled.

### 2.1 The constants (one exported set)

| Constant | Value | Why this value |
| --- | --- | --- |
| `SCROLLBAR_HOLD_MS` | **2200** | "A few seconds". The memo's probes faded out ≈1.3 s after the last event at a 1.2–1.6 s hold and measured R=0 at 1.9 s parked; 2.2 s is the same shape, one step longer, and stays inside the band a reader calls "a few seconds" rather than "a delay I have to wait out". |
| `SCROLLBAR_FADE_IN_MS` | **120** | The contract's duration ramp (`docs/branding.md:693`) is 80/120/180/240 ms and *"nothing in this app animates for longer than 240 ms, and only something entering the screen earns that."* A reveal is a state change on an element already on screen: 120 ms is the second step, and it is deliberately the shorter half so the bar is there when the eye arrives. |
| `SCROLLBAR_FADE_OUT_MS` | **180** | Leaving is slower than arriving (the standard envelope): 180 ms is long enough to read as a fade rather than a flick, and short enough not to smear under a fast scroll. |
| Curve | `cubic-bezier(0.4, 0, 0.6, 1)` | The app's own ease for a value that grows and settles (`styles/index.css:760`, `--animate-pulse-visible`). |

The memo's probes ran a ~650 ms fade. That is a probe setting, not a contract
value, and the contract caps the shipped fade at 240 ms; the numbers above are
this document's decision and are the ones to implement.

### 2.2 The state table

| State | `--lo-sb` | What the reader sees | What set it |
| --- | --- | --- | --- |
| **idle** (after the hold) | 0 | no thumb at all; the bar still occupies its 8 px, so nothing moves | timer expiry |
| **pointer in the container** | 1 for the hold | thumb fades in over 120 ms and leaves when the hold expires — a *stationary* pointer produces no further qualifying event, so § 2.3 governs, not the pointer's presence (design review round 1, D2; the earlier wording promised it "stays while the pointer is inside", which is not what ships) | `pointerover` resolving to a scroller |
| **pointer in the 8 px strip / on the thumb** | 1 for the hold | the same, and while the pointer is **directly on the thumb** the pseudo-element's native `:hover` keeps it painted even after `--lo-sb` reaches 0 (measured on the palette's thumb: 3041 of 3216 pixels in the thumb's own band painted **past the hold**, `--lo-sb` 0 at that moment) | `pointerover` (memo probe 10: the strip's target is the scroller) |
| **active scrolling** (wheel, trackpad momentum, thumb drag, touch, keyboard) | 1, timer re-armed | revealed, and *kept* revealed for the hold after the last event | `scroll` (capture, passive) |
| **keyboard arrival (no scroll)** | 1 for the hold | a `Tab` onto a scroller reveals it for the ordinary hold, cold — nothing needs to have been scrolled or hovered first (§ 3). A focus the browser does not call keyboard-driven (`:focus-visible`) reveals nothing | `focusin` in the module, gated on `:focus-visible` |
| **keyboard scrolling** | 1, timer re-armed | exactly like the wheel, through the same hold | `scroll` |
| **programmatic scroll** (anchor correction, `scrollTo`, a jump) | 1 | revealed — see § 2.4 | `scroll` |
| **reduced motion** | 0 → 1 instantly | no fade either way: the reveal is a step | `styles/index.css:1064-1069` caps `transition-duration` at 0.01 ms |
| **forced colors** | 1 always | the thumb does not fade at all (design call, § 5.3) | `forced-colors` media query |

Two nuances are **accepted, not fixed**, and are recorded here because a reader
will meet them: moving the pointer *within one element* (the scroller's own
gutter → its bar) fires no new `pointerover`, so it does not re-reveal — a
`pointermove` re-arm would put a per-event handler on the scroll path's surface
and the perf lane's constraint is per-event cost (design round 1, U4); and a
press-and-hold on the thumb keeps the *native* pressed thumb painted while
`--lo-sb` falls, which is the same pseudo-element `:hover` measured above and the
reason a drag never loses its handle (UX round 1's held-drag frames; Q5's reading
was of the strip, not of the thumb).

### 2.3 What resets the timer, exactly

1. Every `scroll` whose target resolves to a scroller — wheel, drag, momentum,
   touch, keyboard, and a programmatic jump.
2. Every `pointerover` that walks up to a scroller (the single delegated
   listener; `overflow` computed style is the test, never `scrollHeight`).
3. A `pointerdown` inside a scroller (a drag that has not produced a `scroll`
   yet must not let the bar disappear under the hand).

The hold is re-armed **only when a new qualifying event arrives after the expiry
has passed**; while the attribute is already `active`, the module writes nothing
— a DOM write per event would restart the transition and is the flicker this
spec exists to prevent.

### 2.4 Programmatic scrolls and the no-flicker analysis

- **Re-engaging mid-fade must not restart from zero.** A CSS transition
  interpolates from the property's *current computed value*, so a `--lo-sb`
  that is at 0.7 and is driven back to 1 reverses from 0.7 — no jump to 0, no
  pop. This requires two things of the implementation and both are specified
  here: the module must never *remove and re-add* the attribute to re-reveal
  (that is a restore, not a transition), and it must never fight the transition
  by writing `idle` and `active` in the same task.
- **The attribute must be present in `idle` too.** The transition rule has to
  match before the first `active` lands, so the module writes
  `data-lo-scrollbar="idle"` on first sight of a scroller rather than leaving the
  attribute absent (the memo's forced rule, kept).
- **Programmatic reveals are kept, with one caveat.** Anchor corrections from
  `use-scroll-paging` fire `scroll` like any other move, so a streaming turn can
  blink the bar without the reader touching anything. The design accepts the
  brief reveal *for now* — the memo's recommendation, and the argument for it is
  sound: it shows where the view moved — and specifies the fallback if
  implementation shows a flicker: attribute a `scroll` to the reader only when a
  wheel/pointer/key event was seen within the preceding 400 ms. That predicate
  is **not** shipped blind; it is the remedy if the measured case appears (§ 9.5).
- **No pop at the reveal boundary.** The fade-in's 120 ms plus the 0-alpha start
  means there is never a frame where a 1-alpha thumb appears between two 0-alpha
  frames; the thumb is either absent or ramping.

---

## 3. Focus and accessibility

**Decision: keyboard scrolling reveals through the `scroll` path, and a
**`focusin` reveal in the module** covers the case where a reader has *arrived
at* a scroller without moving it. `:focus-within` is rejected.**

- Keyboard scrolling fires `scroll`, so PageUp/PageDown/arrows/Space reveal the
  bar through the same hold as the wheel (memo S2: PageDown revealed, faded at
  ≈2.0 s). Nothing extra is needed for the common path.
- **The arrival cue is an event, not a rule.** It was reviewed as a
  `:focus-visible` *animation* keyed on the attribute, and review round 1 found
  that shape could not fire where it was needed — on a scroller nothing had
  touched there is no attribute to match (M1/Q1/D1/U1, measured: `animationName:
  none`, `--lo-sb: 0` for a cold Tab) — and that where it did fire it took
  `animation-name` (and reset `animation-timeline`) from the transcript's own
  scroll-linked top fade (U2, 7,645 / 26,279 / 3,286-pixel bands). It is now a
  third door in `scrollbar-activity.ts` (`focusin`), driving the same attribute,
  the same hold and the same transition as the wheel, and the stylesheet carries
  **no `animation` at all** — an assertion in the suite, not a promise.
- `:focus-visible` is still the discriminator, asked once per focus: `Tab` onto
  a scroller reveals it; a click into one does not. A programmatic focus that the
  browser does not classify as keyboard-driven reveals nothing either, which is
  the same rule seen from the other side.
- The reveal is held for the ordinary hold and then falls at 180 ms. There is no
  second, longer fade behind it: with the animation gone, an idle focused
  scroller has nothing left to replay (U3's ≈4050 ms).
- **Measured on the app's own frame** (the scene's keyboard arm, run cold before
  any pointer or wheel touches the palette): `active`, `--lo-sb: 1`, 3193 of 5888
  strip pixels in the thumb's colour with nothing scrolled, `animation-name`
  unchanged across the focus, and back to `idle` / 0 pixels at +2.7 s. The
  arrival there is produced by `focus({ focusVisible: true })`: the palette's list
  is `tabIndex: -1` and a backend-less route has no tabbable scroller, so no real
  `Tab` can land on it in that scene — the shipped path is the same `focusin` +
  `:focus-visible` event pair, and the UX round walked it with real `Tab` presses
  on a live transcript (`active` at +131 ms, `idle` at +2333 ms, fade-out 183 ms).
- **`:focus-within` is rejected** because it is permanent while focus stays
  inside the container — the memo's probe 5 kept matching it at 3 s, i.e. that
  variant never returned to idle. A transcript, a sidebar
  and a board with any focusable content inside would stamp the thumb on screen
  for as long as the reader was typing — the exact failure mode this change
  removes.
- **Focus order does not change.** The scrollbar is not focusable and the thumb
  is not an element; the fade adds no tab stop and no `outline` interaction. The
  focus ring rules (`styles/index.css:1145`, `outline-offset: 2px`) are untouched.
- **Contrast is not weakened by the fade.** The thumb's *colour* is unchanged —
  the fade is alpha on `--color-control`, so at its visible state it is still
  the role the contract floors at 3:1. An invisible thumb is not a contrast
  failure any more than a scrollbar that is not on screen is; what would be a
  failure is a thumb that stays at 20% alpha *while the reader is looking for it*,
  and the state table never produces that.

---

## 4. Platform matrix

| Platform | What is claimed | Basis |
| --- | --- | --- |
| **macOS, Electron 44.3.0 / Chromium 152** | Everything in § 2, and the geometry: the styled classic bar is 8 px in idle, active and mid-transition; `offsetWidth - clientWidth` is identical in all three states. | Memo probes (hidden Electron runs, `capturePage`); this note's own capture (§ 1.1) shows the 8 px classic bar in the shipped build. |
| **Windows** | **UNVERIFIED — described only.** Chromium paints `::-webkit-scrollbar-*` through the same Blink code path on Windows, and *styling the bar's width replaces the platform's overlay/Fluent bar with a classic one* — which is what the app already does today, so the geometry claim is unchanged by this feature. Not run here. | Chromium's own scrollbar-styling documentation; memo's parity argument. No Windows capture exists. |
| **Linux** | **UNVERIFIED — described only.** Same parity argument; GTK/Qt overlay behaviour is not in play once `::-webkit-scrollbar` carries a width. Not run here. | As above. |
| **Windows, forced colors** | Under emulated `forced-colors: active` the thumb measured **R=0 while the layout stayed at 8 px** — i.e. the thumb's colour is dropped by the forced palette. | Memo probe 4 S9. |

**What was NOT observed.** No Windows or Linux run of any kind. No claim in this
document about their pixels is a measurement, and the PR must not say "verified
across platforms".

**Validation approach, in the order it should be done:**

1. **Engine parity, documented** (this table) — an argument, not evidence.
2. **A CI probe on `ubuntu-latest`** (`.github/workflows/ci.yml:71` runs the
   Linux job) added *after* the feature: boot the built app headless as
   `renderer-driver.mjs` does, assert the bar's layout width is 8 px in the idle
   and active states and that a thumb pixel exists at alpha 1 while active. That
   is a real Linux reading for one surface, and it is the cheapest honest one.
   (Not built here: the parent's disk directive for this session forbade new
   rigs, and a CI job is a separate change.)
3. **A manual Windows checklist** on a signed build: thumb visible on a hover
   reveal, invisible after the hold, 8 px in both states, no overlay "floating
   bar" — recorded on the PR as a manual pass, never as CI.
4. **Forced colors**: the design call in § 5.3 removes the fade there, so the
   probe's R=0 datum becomes the reason the thumb is simply always opaque for
   those users.

---

## 5. Behaviour that interacts with the contract

### 5.1 The thumb is faded through its colour, not through `opacity`

`docs/branding.md`/`AGENTS.md` carry the controls rule *"Disabled changes colour,
never opacity."* Two reasons this is satisfied, and both matter:

- **The rule is about disabled controls** — it exists so a disabled control is
  not pushed below its contrast floor by a blanket alpha. A scrollbar's activity
  fade is not a disabled state; the thumb is either usable (opaque, alpha 1) or
  not on screen at all.
- **Mechanically we fade the colour, not the element.** `opacity` on
  `::-webkit-scrollbar-thumb` would drag the pseudo's other paints with it and is
  a whole-element alpha; `color-mix(… transparent)` changes the thumb's own
  colour. Use the colour-mix form. (It is also the form the memo validated;
  `opacity` on a pseudo-element was not.)

### 5.2 The gutter geometry does not move

8 px in every state — idle, active, mid-transition (memo probe 1 `GEOM after
fade-in identical: true`, probe 4 S7). The three `scrollbar-gutter` usages keep
their meaning: `canonical-transcript.tsx:3746`
(`stable both-edges`), `chat-sidebar.tsx:8202` (`stable`), `aside-panel.tsx:722`
(`stable`), `picker-host.tsx:1428` (audit list). `composer-highlight.tsx`'s
runtime correction of the textarea's own gutter (`:25-27`, `:198`, `:222`) reads
that gutter's width and is unaffected by a paint change.

### 5.3 Forced colors (design call)

Under `forced-colors: active` the fade is suppressed: `--lo-sb: 1` always, so the
bar is a solid system-coloured thumb. The platform is overriding our colour
anyway (memo probe 4 S9: R=0), and a high-contrast user is the last reader who
should have to discover a bar by moving the pointer.

### 5.4 The masks keep painting over the bar

The transcript's top dissolve mask paints the element's whole output, scrollbar
included (`styles/index.css:316-347` documents this). A fade does not change it,
but the implementation must not try to fade the *track* separately in the region
the mask covers: two overlapping soft edges on an 8 px bar reads as a smudge.

---

## 6. Surfaces — what was centralized

**One mechanism, and nothing to migrate.** Today there is exactly one shipped
scrollbar rule (§ 1), so every scroller in the app already inherits it; this
change alters that one rule's paint and adds one module. The table below is the
inventory that claim rests on.

### 6.1 Inherits the shared mechanism (no per-surface work)

| Surface | Cite at `a298bfb120` |
| --- | --- |
| Canonical transcript (vertical, reversed axis, `scrollbar-gutter: stable both-edges`) | `chat/canonical/canonical-transcript.tsx:3746`, `:3749`; section scroller `:1344` |
| Sidebar conversation list (`stable`) | `chat/components/chat-sidebar.tsx:8202` |
| Tool-detail sections (both axes) | `chat/components/trace/tool-detail.tsx:112` (`SECTION_MAX`), `:361`, `:389` |
| Output / log / error blocks (both axes) | `chat/components/message-item/output-block.tsx:25`, `log-block.tsx:24`, `error-block.tsx:121`, `code-block.tsx:145` |
| Right aside panel (`stable`) | `chat/components/aside-panel.tsx:722` |
| Run panel, child reader | `chat/components/run-details/run-panel.tsx:1010`; `run-child-reader.tsx:270,286,318,333` |
| Composer textarea + attachments | `shared/components/composer/message-input.tsx:6737,6905/6910,7013` |
| At-picker, picker panel body | `chat/components/at-picker.tsx:864`; `chat/pickers/picker-host.tsx:1316`, `:1425` |
| Command palette | `command-palette/components/command-palette.tsx:876` |
| Thread search overlay | `chat/canonical/thread-search-overlay.tsx:391` |
| Canvas wysiwyg editor | `chat/components/canvas/wysiwyg-markdown-editor.tsx:2047` |
| Spreadsheet preview chrome (grid internals unconfirmed, § 9.6) | `chat/components/canvas/spreadsheet-preview.tsx:1048` |
| Freshness bar region | `chat/components/canvas/document-freshness-bar.tsx:134`, `:165` |
| Markdown fenced code / display math | `chat/components/markdown.css:125`, `:322` |
| **Markdown tables in chat and project detail** — `div.lo-md-table-scroll`, `overflow-x: auto`, `overscroll-behavior-x: contain`, shared by both markdown component maps | landed on `main` in #712 and is in this branch as of `ace2ffcb7f`; **inherits by default, no migration** |
| Two pinned project columns + the board's both-axis scroller | `projects/components/project-board.tsx:609`, `:757` |
| Project list / timeline / detail | `project-list.tsx:145`, `project-timeline.tsx:195`, `project-detail.tsx:304,307` (audit list) |
| Agents sidebar / pages / settings | `agents/components/agents-sidebar.tsx:501`, `agents-page.tsx:503,578`, `agent-settings.tsx:66` |
| Agent hub + categories sidebar | `agent-hub/agent-hub-page.tsx:903`, `agent-hub/components/agent-categories-sidebar.tsx:115` |
| Settings nav + content (scroll-spy) | `settings/components/settings-page.tsx:919`, `:932` |
| Schedules page + form dialog | `schedules/components/schedules-page.tsx:316`, `schedule-form-dialog.tsx:263` |
| Browser tab strip (horizontal) + overflow menu; approvals dock | `browser/components/browser-tab-strip.tsx:896`, `:1790`; `browser-approvals-dock.tsx:186` |
| Console pane header strip | `console/components/console-pane.tsx:659` |
| Mesh card, mesh list | `mesh/mesh-card.tsx:317`, `mesh-list.tsx:173` |
| Onboarding dialog + tour step | `onboarding/components/onboarding-dialog.tsx:229`, `onboarding/onboarding-tour.css:18` |
| Dialogs, popovers and pickers that scroll | `shared/components/common/base-dialog.tsx:187`, `update-notification.tsx:594,665`, `autocomplete-field.tsx:398`, `categories-input-chips.tsx:252`, `searchable-select.tsx:741` |
| Long tail *(audit list — line cites from the scout pass, not re-read at this head)*: chat header menu `:478`, chat options sidebar `:144`, directory indicator `:1196`, sidebar popover `:7930`, skill picker `:347`, slash commands `:1262`, ask options `:214`, diff block `:136`, destination pickers `:1779,1784,1882`, canvas variables viewer `:371,795`, canvas files list `:840`, canvas goals `:96`, inline edit `:863`, connect-provider dialog `:42`, project form dialog `:607`, agents detail parts `:135`, config composer `:75`, error boundary `:59`, projects page `:236` | as listed |

### 6.2 Deliberate opt-outs — keep, and why

| Surface | Today | Decision |
| --- | --- | --- |
| Checkpoint rail | `checkpoint-rail.tsx:629` scrolls, `:638` hides its scrollbar | **Keep hidden.** The rail's marks *are* the affordance and it is a 28 px gutter; a fading 8 px bar inside it would be a second, competing cue in a control that is 28 px wide. |
| Canvas tab strip | `canvas-tabs.tsx:236` scrolls, `:240` `[scrollbar-width:none] [&::-webkit-scrollbar]:hidden` + an edge mask | **Keep hidden.** A 32 px strip would lose 8 px of tab to the bar, and the mask already says "there is more"; the strip's own comment (`:237`) records the measurement. |

Both keep working because they hide the bar entirely: the memo's warning that
`scrollbar-width`/`scrollbar-color` *override* `::-webkit-scrollbar` styling does
not bite where the bar is hidden anyway (memo § A, `t7/t8/t11`).

### 6.3 Structural exceptions — the mechanism cannot reach them

| Surface | Why not | Consequence |
| --- | --- | --- |
| xterm terminal (`@xterm/xterm` 6.0.0) | The scrollbar is the vendored terminal's own: `node_modules/@xterm/xterm/css/xterm.css:93-103` (`.xterm-viewport { overflow-y: scroll; background-color: #000 }`) and its own scheme further down; a class-scoped rule beats `*::-webkit-scrollbar`. Which path is live in this app is **unconfirmed**. | Terminal scrollbars keep their own look. Listed on the PR as a known non-goal; if the terminal's bar turns out to be reachable, it is a follow-up, not this change. |
| Browser page (the native `WebContentsView`) | Not renderer CSS at all — `src/main/browser/`. | Out of scope by construction. |
| HTML/PDF previews and any `<iframe>` | Inside a different document. | Out of scope; the preview's host chrome (freshness bar etc.) inherits normally. |
| Mini-view window | A separate HTML entry (`src/renderer/src/mini-view/main.tsx`); mounting `GlobalScrollbarStyles` there is **false** at this head (the component is not referenced in that file), and I did not confirm whether its scroller is styled by `styles/index.css`. | **UNCONFIRMED**; the coder must check whether the mini window mounts the shared style, and if it does not, decide whether this change adds it (a one-line mount) or records the mini window as an exception. |
| CodeMirror canvas code editor | `.cm-scroller` carries CodeMirror's own scrollbar styling from the editor's stylesheet (`@uiw/react-codemirror` `package.json:155`; host element `canvas/code-editor.tsx:476`). | The shared `*::-webkit-scrollbar` may or may not win; **verify at implementation** and record which one painted (§ 9.7). |
| ag-grid spreadsheet grid internals | The preview's own chrome scrolls through the shared rule (`:1048`), the grid's internals are the library's. | Unconfirmed; same treatment as CodeMirror. |
| Radix `ScrollArea` (`shared/components/ui/scroll-area.tsx`) | Story-only today; it draws its own scrollbar by design. | Keep it out of the shared mechanism (a second bar inside a container that already has one). If it ever ships, it inherits this spec's state table rather than the attribute path. |

---

## 7. The rendered material

**What is a capture of a build, and what is a proposal render — stated per
artefact, because nothing here is an AFTER.**

| Artefact | What it is | Where |
| --- | --- | --- |
| `palette-browse-dark.png` | **A real capture** of the shipped build at `a298bfb120` through the repo's own `scripts/renderer-driver.mjs` (`--scene palette`, headless, window never shown). It carries § 1.1's measurements: the idle thumb, 8 px, opaque, at rest. This is the note's BEFORE. | `…/scratchpad/frames-before/palette/palette-browse-dark.png` (also `palette-rail-dark.png`, `palette-rail-light.png`, `palette-query-dark.png`, `palette-dismissed-dark.png` from the same run) |
| `projects-tab--populated-idle.png`, `chat-sidebar-sections--resting-default-idle.png`, `chat-tool-rows--expanded-overflow-idle.png` | **Real captures** of the head's Storybook (`iframe.html`, `theme:localOperatorDark` asserted). At 1280×900 those screens do not overflow (DOM scan `n=0`), so no bar appears — recorded for what they are (§ 1.3). | `…/scratchpad/frames-before/storybook/` |
| `a-transcript.html`, `b-sidebar-board.html`, `c-horizontal-and-optouts.html` + `proposal.css` | **Proposal renders**: standalone HTML/CSS built for this note, carrying the settled mechanism (registered `@property`, `color-mix` thumb, attribute-driven state) and frozen states (`data-still`) so a still can hold a state. Not a build of the app. | `…/scratchpad/proposal/` |
| `a-transcript.png` | **A capture of the proposal render above** through the app's browser tab, viewport-height. It shows the four reveal tiles with their captions. **Its caveat is load-bearing:** the tiles' own engine-painted bar did not appear in this capture (the macOS host served overlay scrollbars where the app's Electron renderer serves the styled classic bar), so the still carries layout and labels, **not** the bar's paint. The HTML must be opened to see the bar; the only still in this note where a bar is *measured* is the app capture in § 1.1. | `…/scratchpad/proposal/a-transcript.png` |
| — | An **AFTER** does not exist and cannot: implementation is not in this change. The first AFTER is the coder's implementation capture, and it must show the thumb at alpha 1 in the active state (see § 9.3). | — |

The proof-of-the-mechanism material lives in the architect's memo (hidden
Electron/Chromium 152 probes: the pseudo-element transition does not animate, the
registered-property form does; geometry constant; hover cost; listener
inventory). This document does not restate those numbers as its own.

---

## 8. Constraints the implementation inherits

1. **The thumb's role does not change.** `var(--color-control)` stays the paint;
   the theme switch must keep repainting the scrollbar with no React involvement
   (the reason the component takes no theme and never re-renders —
   `global-scrollbar-styles.tsx:5-13`).
2. **Nothing layout-affecting.** Paint only. No width, no margin, no gutter
   change; `scrollbar-gutter` usages keep their reservation (§ 5.2).
3. **Two listeners for the whole app** (document `scroll` capture+passive,
   document `pointerover` capture+passive), no per-container registration, no
   `ResizeObserver`, no rAF, and **no layout reads in handlers** (`overflow` from
   computed style only) — the memo's measured cost is ~0.3 ms of scripting over
   300 wheel events, ~310 recalc-style events in both builds, and LayoutCount 0
   in both.
4. **The module is plain DOM, installed once** next to `<GlobalScrollbarStyles/>`
   (`main.tsx:99`), returning an uninstall function; no React state, no
   re-render.
5. **Reduced motion is already handled** by the blanket
   `transition-duration: 0.01ms !important` (`styles/index.css:1064-1069`) — the
   cap, not a cancellation, so the resting state is the *visible* one only while
   active and the hidden one at rest; verify both directions in the reduced-motion
   pass.
6. **The `data-lo-scrollbar` write is an attribute write on a live DOM node** —
   which is exactly what the wysiwyg editor's undo manager watches (§ 9.8).

---

## 9. Open questions, and where I disagree with the brief

1. **Mechanism assumptions I inherited rather than measured.** The behaviour
   spec is written mechanism-agnostically, but three of its claims are the
   memo's, not mine: that the pseudo-element form does not animate, that the
   registered-property form does, and that geometry is constant. If the manager
   changes the mechanism, § 2's *states and timings* survive and § 5.1's
   colour-vs-opacity argument must be re-argued.
2. **The contract's scrollbar radius is 2 px; the code paints 4 px.**
   `docs/branding.md:673` — *"2px is for bars too small to carry 6: the progress
   track, the scrollbar thumb, the checkbox"* — while
   `global-scrollbar-styles.tsx:19` ships `border-radius: 4px`. The operator
   said the look is kept, so this change keeps 4 px and the contract line should
   be corrected by whoever owns it. Flagging it rather than silently picking a
   side.
3. **The thumb has no row in the contrast contract.**
   `scripts/contrast-contract.mjs` names no scrollbar (`grep -n
   'scrollbar\|thumb'` → nothing) although the thumb is a control at the 3:1
   `border-control` floor. Proposed follow-up: a row asserting the thumb's role
   against the four grounds, so a future palette cannot ship an invisible bar —
   which is the defect this whole change is about.
4. **My standalone render did not paint the thumb** (§ 7): in the app's browser
   tab the tiles' bar never appeared, while the same CSS mechanism was measured
   painting in Electron 44/Chromium 152 by the memo's probes and the app's own
   build paints its 8 px bar (§ 1.1). I could not resolve that host difference
   within this session's disk-bounded capture budget, so I am recording it as an
   observation rather than a finding. **Implementation must confirm the paint**:
   the first AFTER capture has to show the thumb at alpha 1 in the active state
   and at alpha 0 in the idle state, on at least one vertical surface and one
   horizontal.
5. **A streaming transcript may blink the bar** if `use-scroll-paging`'s anchor
   corrections count as activity (memo risk 2). The remedy is specified in
   § 2.4 and is not shipped unless the measured case appears.
6. **The spreadsheet grid internals and the CodeMirror `.cm-scroller`** are
   unconfirmed (§ 6.3): the coder should record, per surface, which rule painted,
   and whether the shared mechanism reached it.
7. **`transition-colors` vs `transition: --lo-sb`** — *resolved in review round 1:
   the census is empty and is now an assertion.* A scroller carrying its own
   `transition-property` utility replaces the fade with a pop (memo probe 6's
   `tw` case). The memo's grep found no same-line `overflow-auto` + `transition`
   in the renderer, but that grep is not exhaustive — a census belongs in the
   implementation, and any hit is fixed by naming `--lo-sb` in that element's
   transition list.
8. **The wysiwyg `contentEditable` subtree.** `undo-manager.ts:465-471` treats
   attribute changes other than `data-highlight` as undoable content, so an
   attribute write inside a contenteditable scroller could add undo states. The
   editor's own scroll container is an ancestor
   (`wysiwyg-markdown-editor.tsx:2047`), but whether the contenteditable element
   can itself be the scroller is unverified. The coder resolves it (exclude
   `contenteditable` subtrees, or have the mutation handler ignore the new
   attribute) and the resolution goes in the PR body.
9. **Timing constants are a decision, not a measurement.** 2200/120/180 ms and
   the curve in § 2.1 are mine; if the operator watches the first build and
   calls the hold short or the fade slow, they are one exported constant each and
   the only thing that moves is that line.
10. **The markdown tables' wrapper — resolved, it is on `main`.** `div.lo-md-table-scroll`
    landed in #712 (`0db7dcb416`, an ancestor of `main`) and is in this branch as
    of `ace2ffcb7f`, where `d9f06c0349` extended the transition census to the
    cascading sheets precisely because that wrapper is a scroller declared in
    `markdown.css` rather than by a class list. It inherits the mechanism with no
    migration, and its own rule declares no transition (the census's assertion).

---

### 9.1 What review round 1 settled, and what it left standing

- **The no-overflow scroller (Q7).** The module marks any element whose computed
  `overflow` is `auto`/`scroll`, whether or not it currently overflows — the
  alternative is `scrollHeight > clientHeight`, a layout read inside a handler
  that fires for every element the pointer crosses, which is exactly what the
  mechanism is built to avoid. A marked element with nothing to scroll paints
  nothing (its bar has no length), so the cost is one inert attribute; the claim
  that such an element "receives no attribute" was wrong and is corrected here
  and in the evidence README.
- **The `<pre>` that swallows a hover (U5, deferred).** Every code block in the
  transcript is an `overflow-x: auto` element that usually does not overflow, and
  it is the *innermost* computed-overflow element under the pointer, so hovering
  code does not reveal the transcript's own bar (a wheel still does: the `scroll`
  event lands on the log). Skipping it needs the same `scrollWidth`/`scrollHeight`
  read Q7 above rejects, so it is deferred and recorded rather than half-fixed.
  `div.lo-md-table-scroll` is a **second instance of the same accepted swallow** —
  a table narrower than its pane scrolls nothing, resolves as the innermost
  scroller under the pointer, and takes the hover from the transcript until the
  reader wheels or moves off it (measured in round 2: the wrapper `active`, the
  log `idle`; a wheel over it reveals the log normally). With tables now ordinary
  in agent transcripts this is the more common shape of the two; it inherits the
  same deferral for the same reason.
- **The thumb under the pointer (D3, measured).** The design's "solid under the
  cursor" holds past the hold: with the pointer parked on the thumb and the state
  at `idle`/`--lo-sb: 0`, 3041 of 3216 pixels in the thumb's own band are still
  the thumb's colour (the scene's thumb arm, three frames: rest 0, arrival 3041,
  past-hold 3041). A reader reaching for the thumb does not lose it.
- **The palette's own scrim (D5, pre-existing).** The palette's bottom
  `from-elevated to-transparent` overlay paints over the last ~24 px of the
  revealed thumb. It predates this change, the idle state hides nothing, and it
  is left as it is — recorded so the next reader does not read it as a fade bug.
- **Radius and the contrast contract (D6, deferred).** `docs/branding.md:673`
  still says 2 px where the code paints 4 (the operator kept the look), and
  `scripts/contrast-contract.mjs` still has no scrollbar row (§ 9.3). Both are
  changes to documents and gates this PR does not own; they are `deferred —` in
  the PR thread rather than silently half-done here.
- **The undo manager's second lock.** The scope guard is structural (§ 9.8), and
  in addition `undo-manager.ts` now ignores `data-lo-scrollbar` the way it
  already ignored `data-highlight` — the guard prevents the write, this makes the
  write harmless if a future shape defeats the guard. The editor root carries
  `data-undo-scope`, which is what the guard walks up to find.

## 10. Amendment, 2026-10-06 (issue #845): a resting floor, and the sidebar's edges

This is not a second design direction; it is the implementation of the amendment
recorded at the top, plus the second half of the same issue. Both halves go
through the shared mechanism rather than through a surface-local patch.

### 10.1 The resting floor, and how the number was chosen

Idle used to mean `--lo-sb: 0` — the thumb painted at full transparency, so the
bar was there and invisible until the reader already knew where it was. The base
rule now resets to **`SCROLLBAR_RESTING_FLOOR = 0.45`**
(`shared/lib/scrollbar-activity.ts`), the fraction of `--color-control` an idle
thumb keeps. `--lo-sb` stays the only thing the fade moves, so the reader who
scrolls or reaches for the bar still gets the solid role (`[data-lo-scrollbar
="active"]` pins 1; `::-webkit-scrollbar-thumb:hover` paints the solid colour),
and forced-colors still pins 1 with `transition: none`.

**The value is measured, not picked.** Compositing the control over every ground
a scroller can sit on (`surface`, `sunken`, `elevated`, `canvas`) for all 59
palettes, and taking the ratio the file's own contrast work uses:

| α over `--color-control` | worst palette/ground | best palette/ground |
| --- | --- | --- |
| 0.40 | 1.47:1 (`catppuccinLatte`/`sunken`) | 2.04:1 |
| **0.45** | **1.55:1** (`rosePineDawn`/`sunken`, the light extreme) | **2.24:1** (`catppuccinMacchiato`/`sunken`, the dark extreme) |
| 0.50 | 1.64:1 | 2.49:1 |
| 0.55 | 1.73:1 | 2.72:1 |

The two brand palettes sit inside that band at 0.45: `localOperatorDark`
1.73–1.86, `localOperatorLight` 1.59–1.71 across the four grounds. **The band is
the criterion, and it is why 0.45 rather than its neighbours:** at or above
1.55:1 the thumb READS on a real panel, and below 2.5:1 — and therefore below the
3:1 non-text floor on every palette — it can never be mistaken for a
full-strength control. 0.40 misses the first half (1.47) and 0.55 the second
(2.72). Nothing here is a claim about a WCAG floor: the resting thumb is
deliberately sub-3:1, which is the *point* of an amendment whose whole ask is that
rest is quiet.

**No `CONTROLS` row, and the reason is structural rather than an omission.**
`scripts/contrast-contract.mjs`'s `CONTROLS` table asserts a control's edge as
"fill OR border clears 3:1 against the ground". The resting thumb clears neither
— it is the composite of the two, at 1.55:1 at worst — so a row there would
either fail by construction or have to be a different assertion wearing a control
row's name, which is the "green output about a component nobody listed" failure
the table's own note forbids. The claim instead is pinned where it can be
honestly made: the value and its two untouched neighbours are asserted in
`scripts/scrollbar-activity.test.mjs` (the floor, the `active` state reaching 1,
and the hover rule staying solid), and the derivation above is the record the
test's failure message points at.

### 10.2 The sidebar list's edge cues

The list scroller (`chat-sidebar.tsx`, `data-sidebar-region="scroller"`) gains a
top and a bottom cue that appear only while content is clipped at that edge. It
is the transcript's technique, not a second one (`styles/index.css`): a registered
`<length>` per edge, one `mask-image` the element always carries, and
`animation-timeline: scroll(self)` driving each length over its own 24 px. A
length of `0px` is a hard edge, so the declared rest state is *no cue at all*,
which is what a list shorter than its pane keeps. The two animations are declared
in longhand (`animation-name` / `-timeline` / `-range` lists) — the shorthand
resets `animation-timeline`, which is the regression § 5.4's sibling note in
`global-scrollbar-styles.tsx` records — and the scrollbar sheet stays
animation-free.

**The mask paints the bar too**, exactly as § 5.4 says it does for the
transcript: the thumb's own top and bottom bands soften inside those 24 px. It is
accepted here for the transcript's reason and one more — the cue is at its
*weakest* exactly where the thumb sits at the track's extremes, so the bar a
reader is reaching for is never the thing being faded. Nothing fades the track
separately.

**The unsupported branch is silence, not a permanent fade.** The transcript keeps
its top fade always on where scroll timelines are missing, because that
element's top edge is scrolled-away content almost by definition. A sidebar list
is not: a permanent cue would dim the first row of every *short* list and the
last row of every list that fits. So there the declared `0px` lengths stand and
the element simply carries no cue — Chromium is what Electron ships, so the
guarded half is the real one.

### 10.3 The sweep, and what it did not change

The report's own ask is that an "all/anywhere" claim be swept rather than
asserted, so here is the audit, bounded to the bar the report set — right-side
panels, palette lists, and any scroller under a fixed header.

| Surface | Disposition |
| --- | --- |
| Sidebar conversation list | **Cued.** The report's case: a fixed search/filter row sits directly above the scroller, so a row cut at the top edge reads as the list's first row. |
| Canonical transcript | Already carries it (§ 1); untouched. |
| Command palette / picker bodies (`picker-host.tsx`) | **Deferred, with the reason.** The body already spends `mask-image` on a JS-conditional bottom fade (`bodyHasMoreBelow`) that has its own evidence; the scroll-linked cue is a different mechanism writing the *same* property, so applying it here means replacing that one, not adding to it. One mismatch away from being the same defect — recorded rather than half-done. |
| Right-side panels (`aside-panel.tsx`, `run-details/run-panel.tsx`) | **Deferred, with the reason.** Same defect class (a scroller directly under the pane's header) and the same one-attribute fix, but this PR's rendered evidence covers the sidebar; a change to two panes nobody photographed is not evidence-backed, and the mechanism is shared, so it is one attribute each when a surface brings frames. |
| Scrollers under a sticky band (`project-list.tsx`, `project-board.tsx`, `project-timeline.tsx`, `team-section-header.tsx`) | **Exempt — already solved, differently.** These pin an OPAQUE band over the rows, so a row scrolls fully under it and is hidden rather than cut; a fade would be a second answer to a question they have already answered. |
| Bounded blocks (tool-detail sections, output/log/error/code blocks, md tables) | **Exempt.** They are not lists of interchangeable rows under a header; a block that clips its own last line states its own overflow, and the transcript's log already carries the cue one level up. |

Nothing in this section changes a threshold, a duration or a state: the cue is a
paint, and the floor is one number in the shared rule.

---

## Appendix: the surface list, in one line for the PR body

Sidebar list · transcript · tool-detail sections · output/log/error/code blocks ·
checkpoint rail (opt-out) · aside panel · run panel · child reader · composer
textarea and attachments · at-picker · picker panel and its tables · command
palette · thread search · canvas wysiwyg · CodeMirror host · spreadsheet chrome ·
freshness bar · markdown code and math · **markdown tables (in flight)** ·
project board and its columns · project list/timeline/detail · agents
sidebar/pages/settings · agent hub · settings nav/content · schedules · browser
tab strip · browser approvals dock · console header strip · mesh card · mesh
list · onboarding dialog and tour · dialogs, popovers and select menus ·
mini-view (**unconfirmed**) — with xterm, the browser page, iframes and the Radix
`ScrollArea` named as structural exceptions, and the checkpoint rail and canvas
tab strip named as deliberate opt-outs.
