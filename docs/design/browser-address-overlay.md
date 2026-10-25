# Address suggestions above the native page — bounded proposal

Status: **proposal only; not implementation authorization**. Prepared 2026-10-20
for LOH-19 / LOH-13 against UI base `c9bbfe25f06a95a31ddaa6aeaa278ae4e5b8c07f`.
Accepting or merging this document does not authorize an overlay implementation;
LOH-19 / LOH-13 must explicitly accept the implementation direction first.
The address-list width/inset fix is a separate change, not an overlay phase.

## Decision requested

**Keep (c), the documented in-flow limitation, for the current product.** It is
the smallest safe change and preserves the existing input, IME and accessible
combobox. Do not replace normal typing with (b), whole-page suppression.

If the product requirement becomes “the live page stays visible and its native
rectangle never moves when suggestions open,” pursue **(a), one window-owned
child `WebContentsView`**, only after an accepted, bounded feasibility spike.
Prefer it to a separate `BrowserWindow`. A list-only child is not a drop-in
replacement: DOM focus and `aria-activedescendant` currently join the input and
options in one document. The spike must prove a coherent accessible editing
surface (potentially moving input **and** list into that child for the edit), or
reject the approach. Do not ship a split combobox with assumed accessibility.

## What the code actually does

All UI `file:line` references below refer to the pinned base, not a future head.
The requested policy path resolves to
`src/renderer/src/shared/browser-view-policy.ts`, not `src/shared/`.
`docs/BROWSER.md` is in the **local-operator harness repository**, not this UI
repository; its introduction (lines 3–23) describes host selection and pinned
`ui:` handles, and site scopes (lines 30–47) describe the permission boundary.
It was consulted at harness commit `24dbccbb784bd1c9b690ce4601f489791ceacb09`;
it does not establish desktop compositor order.

The layering conclusion is derived independently of the URL-bar comment:

1. Main creates a sandboxed, no-preload page `WebContentsView` and adds it to
   `window.contentView`, not to the React document
   (`src/main/browser/index.ts:1231–1266`). It is a separate native surface.
2. `TabRegistry.applyLayout` assigns the active page its native bounds and
   visibility; inactive pages receive the background viewport
   (`src/main/browser/registry.ts:611–620`). CSS does not own those bounds.
3. `BrowserSurface` measures the content element, reports its rounded rectangle,
   watches resize, and clears it on unmount
   (`src/renderer/src/features/browser/components/browser-surface.tsx:339–362`;
   rounding is at `browser-surface.tsx:124–136`). The URL bar precedes the content element
   (`browser-surface.tsx:689`, `:832`). The alternatives occupy normal flow
   (`browser-url-bar.tsx:1265–1318`), so opening them reduces/moves page space.
4. Electron's `View.addChildView` contract explicitly supports native child
   ordering: re-adding a child makes it topmost. This exists in the installed
   Electron declarations as well as the public API. Thus there is a native
   layer-order mechanism, but it is **not** a renderer CSS stacking mechanism.

Consequently, a portal, fixed positioning, larger `z-index`, CSS top layer or
`<dialog>` in the existing renderer cannot, by itself, cover the overlapping
native page. Changing the page's native placement/visibility or providing a
native surface above it is necessary. The comment at
`browser-url-bar.tsx:1265–1273` and policy at
`src/renderer/src/shared/browser-view-policy.ts:22–29` agree with this derivation;
they are corroboration, not the sole evidence. This is specific to this view
composition, not a claim that DOM can never appear above any Electron content.

Electron references (consulted 2026-10-20):
[View ordering and bounds](https://www.electronjs.org/docs/latest/api/view),
[WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view).
These are current API references, not a version-pinned native behavior test.
`package.json:133` pins optional Electron to 44.3.0; `build.electronVersion`
also pins 44.3.0. Local `electron.d.ts` confirms the ordering API exists.

## Options and trade-offs

| Option | Native page / layout | Cost and principal trade-off | Disposition |
| --- | --- | --- | --- |
| **(a) Child `WebContentsView`** attached above page, bounded to address editor/list | Page remains presented at unchanged rect; native child paints over covered area | High: another renderer plus re-homing the renderer address editor (ranking, undo, IME, suffix acceptance, Escape/Tab), narrow IPC, native hit testing and accessible-tree work; fits parent window clipping and lifetime | Preferred candidate **only if true overlay is accepted and spike passes** |
| **(a2) Owned `BrowserWindow`** for the list | Independent native window can cover parent content | Higher: activation, parent-relative screen coordinates, monitor scaling, Spaces/fullscreen, minimize and task switching; non-focusable window is not automatically an accessible combobox | Reject unless child-view limits are demonstrated and this alternative is separately accepted |
| **(b) Suppress page; use existing renderer popup** | Native page hidden, DOM list can paint over its former area; page bounds need not change | Low/medium: keeps input/options together and reuses visibility policy, but page disappears on routine typing; not Chrome-style live overlay | Mechanically viable, unacceptable default for address editing |
| **(c) In-flow list with bounded width/inset correction** | List consumes chrome height; active page moves/shrinks and can reflow | Lowest: same DOM semantics, existing bounds pipeline; retains visible page but cannot promise no shift | **Recommend current product; width/inset work stays separate** |

Suppression is already a ref-counted registry
(`src/renderer/src/shared/browser-view-policy.ts:100–118`), observed by
`browser-surface.tsx:365–373` and sent through existing visibility IPC
(`src/main/browser/ipc.ts:339–345`). Host clears native page focus ownership
when hidden (`src/main/browser/host.ts:1696–1703`). The surface paints a paused
placeholder (`browser-surface.tsx:960–977`). Hiding is not closing, freezing
JavaScript, revoking a grant, or suspending agent work. It can remain appropriate
for explicit dialogs, but blanking the page for each address edit is a different
product behavior. A screenshot of the page behind the list would be stale,
not a live-page overlay, and adds capture/privacy costs.

Other paths do not remove the fundamental trade-off:

- **Native menu/popup:** can appear above the page without a custom web renderer,
  but a menu's keyboard ownership, selection semantics and platform theme do not
  automatically implement an editable combobox, inline completion or IME.
  Suitable for discrete commands, not an equivalent address experience. It is
  still a second native presentation surface, not a CSS solution.
- **Page-side injected list:** would paint in the page, but exposes private
  history to an untrusted origin, can be restyled/covered/spoofed, changes page
  layout/focus and fails on protected documents. Reject; preserve no-preload
  page isolation (`src/main/browser/index.ts:1231–1249`).
- **Move the whole existing chrome renderer above pages:** may allow its DOM to
  paint over them, but the renderer covers the window and intercepts page hits.
  Transparency does not prove input pass-through. Solving native clipping/hit
  regions is a broad compositor rewrite, not a bounded suggestion fix.
- **Carve out/move the page rect:** exposes DOM, but crops or resizes the page;
  it is option (c)'s trade-off in another form. Capturing/streaming the whole page
  into DOM would replace direct native input, IME, accessibility and rendering;
  explicitly out of scope.

## Conditional child-view design constraints

These are requirements for a future accepted spike, **not new code to land now**.

### Creation and first paint

Lazy-create at the first address-focus intent in a window, not at app startup or
per keystroke. Keep at most one hidden child reusable for that window; no eager
fleet-wide pre-warm. Until its local document, theme, fonts, measured bounds and
initial editor state acknowledge readiness, keep the existing renderer editor
and in-flow results usable. Switch only at a safe edit boundary, never during
composition; a slow or failed child stays on (c) for that edit. This policy
requires proof of draft, undo and selection continuity, not just copied text.

**No blank first-paint frame is acceptable.** Show only after readiness; capture
both the first shown and settled native-composite frames. A blank/unthemed child,
missing first key, reset undo stack or moved IME candidate anchor fails the spike.
If a hidden ready child cannot satisfy that gate on a platform, keep (c); do not
solve it by leaving a visible pre-warm window or raising the app.

### Ownership, bounds and lifetime

One coordinator per owning desktop window, at most one active address overlay;
identify the requesting surface, active tab and edit generation. The registry
currently owns one active tab and one content rect, not simultaneous independent
page views (`registry.ts:592–620`). Policy tracks multiple mounted rect sources
(`browser-view-policy.ts:133–150`), so do not infer multi-pane presentation from
that registry. Route/pane overlap must have one explicit edit owner; supporting
multiple independently presented native pages is a separate architecture change.

Measure address anchor in the same parent-relative DIP coordinate system as the
page. Main validates finite bounded geometry and clamps to the owning pane and
window; do not trust arbitrary renderer-supplied screen rectangles. Cap list
height and scroll inside it. Page bounds must remain identical while
opening/navigating/dismissing suggestions. Recompute on pane/window resize,
zoom/monitor scale changes and movement; dismiss if no valid space/owner exists.
Set bounds before show; ensure the overlay is topmost even after another page
is created. Do not put it under the page view and rely on descendant z-order.

Use a tight **opaque rectangular hit region**, not a full-window transparent
surface. Rounded/shadow margins must not silently eat page clicks: Electron's
View documentation warns that rounded cutouts still capture clicks. Clicking a
row cannot click the page underneath. Clicking outside dismisses without
navigation and must have a defined single-delivery rule; do not synthesize a
second page click. DOM outside-click listeners cannot observe clicks in another
WebContents; observe main/page focus or a narrowly scoped native input event,
and test scrollbar/non-focus-changing clicks explicitly. No global input hook.
Other app dialogs/menus take priority: dismiss the address child before the
existing suppression policy hides pages; the child must not outlive a dialog.

Hide first on owner loss, tab switch/close, pane unmount, window blur/minimize,
shutdown, renderer failure or stale edit generation. Release IPC listeners and
geometry subscriptions and explicitly close overlay webContents, then detach.
The existing `releaseView` does explicit close plus detach precisely because
removing a WebContentsView does not release its renderer
(`src/main/browser/index.ts:1640–1662`; registry removal at `registry.ts:729–737`).
Keep this separate from tab registration: the trusted overlay is not a browsable
agent tab, does not get a capability, and must never enter session persistence.

### Input, IME and accessibility

Current behavior is concrete: row mousedown prevents blur and click commits
(`browser-url-bar.tsx:236–263`); blur dismisses without navigation (`:677–687`);
composition bypasses suggestion keys (`:653–665`, `:689–690`); Escape dismisses
without discarding an accepted suffix (`:746–758`); Tab moves focus without
committing an unaccepted suffix (`:802–810`). Preserve these intent rules.

A separate list cannot use the main document's `aria-activedescendant` to name
an option in its own DOM. Keeping invisible semantic options in the main DOM
would retain an ID target but risks duplicate/contradictory accessible trees;
that is an experiment, not an accepted solution. Prefer to evaluate a single
accessible input+list document in the child. This expands the scope beyond a
list-only paint fix: prove draft/selection transfer, focus restoration to the
original input, IME candidate-window anchoring and no first-key loss before
choosing it. Never transfer an in-progress composition between WebContents.
If this cannot be demonstrated, stay with (c), not an inaccessible fallback.

The child, when editing, owns text entry, arrows, Enter, Escape, Tab and
composition. Main owns lifecycle and dismissal. Page shortcuts cannot run for
the same key, and chrome shortcuts must still run exactly once. Existing native
ownership predicates require a visible focused owning window and presented
page (`src/main/browser/browser-chord.ts:8–78`); native view focus is tracked
because the focused-WebContents getter alone is insufficient
(`src/main/browser/index.ts:1275–1283`). Extend ownership explicitly for a new
editor, not by pretending it is a page. Never activate/raise a hidden window.
Escape should first defer to IME composition; otherwise dismiss and restore
editing focus. Window deactivation dismisses without refocusing the window.

Test combobox expanded state, accessible name, selected option, result/status
announcements, empty/error states, keyboard-only operation, VoiceOver and
Windows screen reader navigation. No assumption that two native accessibility
trees form one combobox. A separate BrowserWindow has the same issue plus an
OS window-focus boundary.

### Trust, permission and theme boundaries

Existing browser IPC accepts **only** the owning window's main renderer/frame
and trusted desktop URL (`src/main/browser/ipc.ts:132–147`). A new child does not
pass that guard and must not be added indiscriminately to all browser channels.
Provide a narrow main-mediated protocol: open/update/close with owner and edit
generation; sanitized candidate IDs/text; selection/dismiss messages. Main
rejects stale/cross-window/unknown candidate commits. Reuse existing canonical
HTTP(S) target validation and expected-tab navigation, not raw DOM URLs.

Trusted local packaged content only; dedicated ephemeral session (not the
persistent browsing partition), sandbox/context isolation, no Node, a minimal
preload bridge, no arbitrary navigation/popups/permissions. Send only the
already-scoped suggestion projection, not cookies, page DOM, tab capabilities or
full unfiltered history. Untrusted pages cannot request or message this surface.
No change to approval scopes, origin policy, ownership, grants, browser-tool wire
protocol or host-selection/handle rules. Option (a) needs **new desktop IPC and
renderer entry/lifecycle**, not a new external browser protocol. Options (b)/(c)
can reuse current IPC; no new wire methods are justified.

Reuse role tokens/theme source from `docs/branding.md:37–70`, localization and
direction; propagate theme changes before showing. Verify opaque fill, selected
row non-color cue, visible focus, truncation, text contrast >=4.5:1 and control/
focus boundaries >=3:1 across supported themes and forced/high-contrast modes.
A second renderer does not inherit current CSS variables automatically.

## Proof and acceptance gates

### What is established here

Source inspection establishes separate native placement, current focus/IME
handlers, visibility plumbing and sender guards. A targeted Node assertion on
this worktree checked both Electron pins, native parent attachment, registry
bounds/visibility calls, local topmost-order API documentation, and IPC
owner/main-frame guards. Actual final output:

```text
PASS: Electron 44.3.0; native parent/order API; registry bounds/visibility; IPC owner/main-frame guard
SOURCE CONTRACT ONLY: no rendered paint, native focus, IME or screen-reader result
```

The initial probe assumed Electron lived in devDependencies, then dependencies;
both failed before the remaining assertions. Reading `package.json:131–134`
established optionalDependencies; the corrected check above passed. These were
probe setup corrections, not runtime failures or native evidence.

This session has **no browser or console tool**. No app/native window was
launched, no rendered frame inspected, no physical key/IME/screen reader tested.
The host is macOS arm64; Windows and Linux behavior are unproved. Source and API support
are not a successful native overlay prototype. This docs-only PR changes no
behavior and requires scope/document validation, not a fake runtime PASS.

### Future accepted feasibility spike (bounded; stop on first failed preflight)

1. Confirm compiled source/runtime 44.3.0 and an isolated profile; strip inherited
   `CMUX_*`, use synthetic IDs, no live session or browser profile. Reuse repo
   dependencies and documented window-mode/capture teardown. No extra browser
   stack, global hooks or background visible app.
2. **Native-composite capture preflight, before overlay dispatch:** use Electron
   `desktopCapturer.getSources({ types: ["window"], thumbnailSize: ... })` for the
   owning app window, matching its source ID to `BrowserWindow.getMediaSourceId()`;
   never select by title or capture the whole desktop. This is the proposed
   capture channel, not `webContents.capturePage()` or CDP screenshots: those
   photograph a renderer document and are **non-proof for sibling native
   WebContentsView ordering/occlusion** (`docs/agent-driver.md:249–252`).
   On macOS first query `systemPreferences.getMediaAccessStatus("screen")`:
   require an already-granted Screen Recording/TCC result before enumerating
   capture sources. Denied/not-determined/restricted means BLOCKED; do not provoke
   a permission prompt or substitute a DOM screenshot. This proposal requests no
   permission and has not run that preflight.

   A future accepted spike must run one self-contained command: launch the real
   app `inactive` with an isolated profile; identify its exact source; capture
   before/open/first-shown/settled/dismiss thumbnails at sufficient resolution;
   record source ID, dimensions, runtime revision and native bounds; reap its
   exact process group before returning. This follows `AGENTS.md:1418–1427`'s
   native-compositor exception while retaining `:1402–1404`'s ban on ad-hoc macOS
   `screencapture`; no focus stealing or persistent visible window is authorized.
   Preflight must distinguish a uniquely marked synthetic page child from its
   parent DOM, then a differently marked native overlay above that child in the
   same captured image. Decode and inspect the frames: missing child markers,
   zero/blank thumbnails, wrong-source or occluded-window results fail admission.
   Save native hit-target receipts too; pixels alone do not prove click delivery.
   Include a DOM-portal negative control which fails to cover the page. Only
   after this channel proves both native planes may it supply overlay evidence;
   unsupported/blocked capture stops the spike rather than weakening its gate.
3. Prove the **input+list accessibility/focus choice** before generalizing IPC:
   type, arrow/Enter, mouse commit, Escape, Tab, outside click/scrollbar, blur,
   IME composition/cancel/commit. Record native focus owner, event count and
   navigation destination. VoiceOver on macOS and NVDA or equivalent on Windows
   are release gates, not source-level checks.
4. Exercise route and pane handover, smallest pane, resize while open, tab create/
   switch/close, nested dialog suppression, themes, RTL, scale/monitor changes,
   fullscreen, minimize/restore. On macOS include Spaces and menu accelerator
   delivery; on Windows include DPI changes, task switching and high contrast.
   Linux is outside this initial macOS/Windows feasibility spike: X11 versus
   Wayland/portal capture, focus and compositor behavior cannot be established on
   this macOS host. Linux retains (c), with no overlay rollout there. Before Linux
   enablement require separate X11 and Wayland cells for native-composite capture
   admission/portal permission, keyboard/IME, Orca, scaling, outside-click delivery
   and teardown; absence of a cell is BLOCKED, not platform parity.
5. Inject child crash, late IPC, stale tab/edit, invalid geometry and denied
   origin/permission requests. Repeat open/close and shutdown: verify no remaining
   child webContents/listeners and no growth in retained surface count.

Acceptance for a true overlay: the live page stays visible at unchanged native
bounds; no opening/settling layout jump; row clicks navigate exactly once and
never through to the page; outside dismissal never commits; keyboard, IME and
screen readers preserve edit intent; focus never raises another window; stale
or foreign requests fail closed; all lifetime/failure cases clean up. Require
real rendered evidence plus independent code, QA, design and UX rounds on the
implementation. macOS-only proof cannot satisfy Windows or future Linux cells.

Failure/rollback: hide and close a failed child, invalidate its edit generation,
restore ordinary in-flow suggestions without losing typed text or navigating.
A future implementation must retain that existing path as a reversible fallback;
do not hide the page as an automatic substitute. Watch rollout for page-rect
drift, dropped/duplicate keys, inaccessible results, eaten clicks, window
activation and renderer leaks. Missing platform/AX/native-composite proof means
hold overlay rollout on that platform, not claim cross-platform success. No
implementation, feature flag, release, new permission or compositor rewrite is
included in this proposal.

## S3 outcome (2026-10-21): the input/focus/IME handoff stays in the parent

S3 accepted **(a) is not warranted yet; the parent keeps the editing surface**
and made that decision provable rather than merely argued. The parent still owns
the `combobox` role, the draft, the undo stack, the IME composition ref, Escape/
Tab/Enter, the blur dismissal and the chord ownership (`browser-chord.ts` needs a
visible **and focused** window, which a child surface cannot give it). The child
is visual-only: `before-input-event` prevents and counts every key,
`before-mouse-event` prevents everything except `mouseMove`, and the document is
`aria-hidden` with no focusable nodes.

**Measured on the built app (`--s3`, headless, this repository's matrix).** The
S2 rows were re-run as the regression surface on the same head; every one still
passes. The S3 rows:

- **F1 — focus owner stays the parent** through 20 hide/raise cycles: parent
  `document.hasFocus()` true, `activeElement` is the real URL input, an injected
  `blur` counter stayed 0, the child emitted 0 focus events, `isFocused` false,
  and `webContents.getFocusedWebContents()` was never the child. **Focus is
  EMULATED** (`Emulation.setFocusEmulationEnabled`); this says nothing about
  macOS first-responder.
- **F2 — synthetic child mouse/keys** move neither focus nor selection; the key
  is counted as blocked and the row click commits exactly once. SYNTHETIC input,
  not native hit routing.
- **I1 — IME composition reaches the parent in order** (`compositionstart`,
  ≥2 `compositionupdate`, `compositionend:日本`) and the mirror is hidden for the
  whole composition, returning once a matching query is typed again. This is
  Chromium's own CDP IME pipeline, **not** the macOS input method.
- **AX1 — the accessible surface is the parent**: Chromium's AX tree has a
  `combobox` (`expanded`, `controls`) and a `listbox` with one `option` per
  mirror row, while the child target's tree is entirely ignored. Chromium AX,
  **not VoiceOver**.
- K3/M1 are derived from the S2 K1/K2 and C1/C2 receipts in the same run rather
  than re-measured, so one run cannot report two answers for one event.

**BLOCKED, not claimed:** the real macOS IME (candidate window, marked text), the
composite pixel order, real hit routing and first-responder behaviour
(`V-FOCUS-CLICK`, the row that would reopen (a) if a real mouse-down blurred the
parent input before mouse-up), VoiceOver/NVDA (`AX2`), Windows/Linux (`W1`), and
anything on a packaged build. Those need an operator attending
`--s3-visible`; the headless matrix marks them BLOCKED rather than passing them,
and the visible command's rows stay BLOCKED whenever nobody answers its prompts.

One containment note for reviewers: the visible arm is a probe, not a feature.
It is off by default, refused in `normal`, `headless` and a packaged build, capped
at 120 s and launcher-bound. S3 adds no user-reachable path, no product flag, no
IPC surface and no new document; the composite-pixel gap from S2 is **not**
closed until an operator runs that command once.

## S4b amendment — the overlay is product chrome on darwin (2026-10-21)

**This section supersedes the "proposal only" status above for the darwin
product path.** S4b (`feat/browser-chrome-s4b`, UI base `08d8cb452a`) ships the
same window-owned child as PRODUCT chrome: an ordinary darwin launch arms it
(`[address-overlay] product chrome armed (darwin)`), with no user env var and no
probe gate. The S1–S3 env-gated probe arms remain probe-only and are unchanged.

What ships, and what it replaces:

- **No address bar or suggestion dock at rest.** The old unconditional URL row
  and the 104 px dock are gone; the page begins at the tab strip's bottom edge.
- **A popout field row over the strip.** Cmd+L, the strip's address trigger, a
  printable key or the page menu raise a 37 px row at the strip's width; the
  native list child sits below it. The page's rectangle and scroll do not move.
- **The page menu.** Back/Forward/Reload/Home, Find, Print, Zoom reset,
  Downloads and Approvals moved into one menu (`browser-page-menu.tsx`) that
  suppresses the native page while its panel is open — a panel anchored in the
  strip paints into the content rect, where a native view wins. **A suppression
  is not a dismissal:** the controller keys the popout's dismissal on the tab
  and rectangle (`layoutContentKeyOf`), never on presentation, and hides the
  child's paint without dropping its shown state, so the menu can be opened from
  the raised row and closed without lowering it.
- **Tier 1** (the child cannot load): the field works, the page does not move,
  and the row says "Address suggestions are unavailable." in a visible hint
  (the placeholder only ever showed on an empty field). Main pushes the health
  change (`onHealthChange` → chrome state), so a failure that lands while the
  row is already raised reaches the renderer. **Tier 2** (two raises whose input
  cannot take focus within 300 ms): the field moves into the flow for the rest
  of the surface's life; every raise path is gated on that fallback
  (`planAddressRaise`) and the strip is only made inert for a row that is
  actually painted.
- **i18n.** The page menu carries its own key
  (`ui.browser.browser_url_bar.page_menu`) in all eight catalogues; it no longer
  borrows the settings glass-material segment label.
- **Trigger.** The at-rest address trigger is a bordered pill in a right-anchored
  cluster (it used to follow the last tab and read as a third tab), its host is
  elided at the leading subdomain labels instead of the registrable domain, and
  a loopback origin gets a neutral glyph instead of a permanent warning padlock
  (the classification stays `not-secure`; only the glyph is neutral).

Measured evidence for this amendment lives in
`docs/evidence/browser-chrome-s4b/` (`matrix.md`, `facts.json`, `events.jsonl`),
with the frames each run's scratchpad keeps. **Still not claimed:** native
composite pixels, native hit routing, a focused-window page-focus dismissal,
real macOS IME, VoiceOver, and Windows/Linux. Those rows are BLOCKED, not passed,
exactly as in S3.

## S5 amendment (2026-10-22) — the popout is gone; the row is permanent

This section SUPERSEDES every "popout", "raise/lower" and "Tier 2" statement
above. The S4b amendment remains as the record of what was measured then; the
product no longer behaves that way.

- **One address row, in flow, 37px.** Tab strip (tabs + `+`) → address row →
  page, with 0px between both seams. The row is `Back · Forward · Reload↔Stop ·
  Home · [site mark | URL field] · Approvals · ⋯`, and it is the only address
  input in the window. Measured target at 1380×900: strip y=32 h=37, row y=69
  h=37, page y=106 h=794.
- **Deleted:** the 28px strip trigger, the strip's trailing cluster and hairline,
  the popout wrapper, `addressFallback`/Tier 2 and its 300ms focus-health effect,
  `planAddressRaise`/`model/address-raise.ts`, `model/floating-chrome.ts`, the
  strip's `inert`/`invisible` state, and the start page's own field and Go
  button. `AddressController.close()` is gone with them: nothing is raised, so
  nothing is lowered. A raise is a nonce the always-mounted row applies (focus,
  then seed or select-all).
- **Suggestions** are the same native child, anchored to the ROW's x/width with
  its top at the row's bottom (which is the page's top). Main's bounds math did
  not change. The child never pauses the page: it is a native sibling above a
  live view (`address-suggestions-native` is `never` in the kind table), because
  pausing would blank the page the list floats over.
- **Overflow** carries only what has no row control: Find, Print, Reset zoom
  (only when ≠100%), Open downloads folder (only when known), Approvals — plus
  Forward/Home ONLY when a narrow pane has folded them out of the row.
- **Site mark:** the field's own register, exact per kind. The trigger's loopback
  exception is gone (LOH-13 ruling 6), so an `http://127.0.0.1:5173` page shows
  the same open padlock as any plain-http origin; there is no neutral globe.
- **Start page:** brand mark, wordmark and the two sentences only. The row is
  focused when the start state becomes current and is seeded from `refusedUrl`
  after a refusal. Known limitation (unchanged in kind): the native child refuses
  projections while the start page hides the view, so typing in the row there
  shows no list.
- **Overlay policy:** overlay kinds are a table in
  `src/renderer/src/shared/browser-view-policy.ts` (dialog/sheet/palette/
  onboarding/lightbox pause modal; menu/popover/select/context-menu/notice-card
  pause only on a measured intersection; tooltip/hover-card/toast never pause;
  the browser's own state pages are `own-state`). The shared `Tooltip` no longer
  imports the policy. Placement is the tooltip channel: the conversation flyout
  opens below its row inside the sidebar, the panel rail drops its tooltip in
  favour of its `aria-label`, and hub marks open upward. `data-suppressed-by`
  therefore cannot name a tooltip, and a test enforces the sweep.

Evidence for S5 is the native probe (`scripts/browser-chrome-s4b-probe.mjs`, S5
rows) plus the design/QA rounds' frames; the S4b numbers above are history, not a
claim about this build.
