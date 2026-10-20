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
