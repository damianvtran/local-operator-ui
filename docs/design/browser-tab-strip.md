# Browser page tabs: compact strip and human management

Scope: slice b, based on `422df121756df2f5e7348e4289a04256661edb9f` (0.34.44). This is the embedded browser's **page-tab** strip, not LOH-1's application-level project/chat tabs. No version bump, print, search provider, history, downloads, lifecycle/recovery or permission work is bundled here.

## Visual decisions and constraints

The existing paper-in-a-well language remains: `sunken` strip, `elevated` active sheet/notch, `border-control`, `ink`/`ink-muted`, six-pixel control radius and 13px dense labels. Those roles, outline focus and colour-step-only hover are the shared visual language with app-level tabs; no LOH-1 files or interactions change.

- Tabs cap at **240 CSS px**, share available width down to **144px**, then scroll horizontally. The old 400px chip-heavy floors and 50%-of-window cap are deliberately superseded, not silently retained beside a second sizing system. One priority chip plus a compact count preserves state without widening the strip; complete loading/error/ownership/request/restored names remain accessible and management retains the detailed states.
- Close and menu targets keep their layout reserve while visually hidden on inactive rows. The active close is visible; hover/focus reveals inactive actions. Inactive actions are outside the Tab sequence; tab roles use roving tabindex. Transparent edges reserve the same geometry before active/drag states.
- New tab uses the toolbar's ghost grammar, with an 8px gap after the bounded strip. It stays **outside** the clipped scroller, reachable during overflow. Both scroll-arrow slots stay mounted while overflowing; only disabled state changes at an edge. The count reserves two-digit room. Active selection/order/viewport changes reveal the active tab, while background metadata alone cannot fight manual scrolling.
- The page mark is no longer a Reload-shaped spinner or an ownership symbol. It is a neutral local Globe when no safe image bytes exist. A distinct arc pulses by opacity only for the active loading tab; background/overflow copies stay static. The redundant address-field spinner is removed. Reduced motion uses the existing global cap; no layout or transform animation is introduced.
- Ownership is separate: existing Agent/Shared chips, with a small Bot fallback when the compact chip budget hides them. Text/accessibility carries meaning rather than colour alone. Failed tabs show the host or keyed `Page failed to load`, not a raw navigation path/query.
- Zero waiting approvals retain the same accessible control and dock, but use a quiet ghost icon instead of a permanently bordered word. Nonzero waiting keeps the established labelled/count treatment. No approval, consent or permission implementation changes.

Current host/preload metadata publishes **no favicon image bytes, audio state or pinned-tab state** (case-insensitive source inventory). This PR deliberately adds no image fetch, CSP relaxation, third-party favicon service or invented media/pinning flags. A future icon pipeline needs main-owned, origin/policy/size-constrained bytes and separate security review. The local fallback is the supported state here.

## One order, no new agent authority

`ChromeTabOrder` is a main-owned, memory-only numeric preference for human chrome. Registry creation order, identity, nonces and agent tab listings are untouched. Before the first explicit reorder, the established session-grouped/default-unattributed-last order is unchanged. A scoped permutation fills only its positions in the full rendered order; main validates against its current registry, rejects duplicate/stale IDs and prunes closed IDs. New records append after a custom order. Nothing new is saved in preferences or a browsing-history store.

The renderer uses `pooledTabs` for actual rows, ordinal navigation and close-to-right, not `groups.flatMap` that would override a manual preference. The All tabs index presents contiguous runs in that same order; grouped summaries remain available for conversation counts.

Pointer drag reorders. The existing registered actions menu also opens from a tab's context gesture and offers Move tab left/right as the **keyboard alternative**. These are menu actions, not new global chords: no classifier, reserved-set, capture or same-map retention change is needed. Standard local ARIA keys are Left/Right/Home/End; Delete closes, with composition/modifier/auto-repeat protection for destructive repeats. Middle-click closes through the established focus-restoration path. Dragging selects the tab; close/menu targets never initiate a drag. Unknown external drops are not allowed to navigate the desktop renderer.

The tab roles link to the host's uniquely identified tabpanel. Focus outlines are inset so clipping cannot erase them; only the non-interactive scroller's temporary close-caret rest-stop suppresses its own ring. No window show/raise/activate helper is added.

## Human-only management and security

Duplicate and Reload operate on an **explicit main-owned record**. Duplicate copies **only the URL** into a fresh **unattributed user** record (`sessionId: null`, `nonce: null`, no handover or copied consent). It performs one initial destination load on that exact record, not an intermediate blank load or an `activate -> await -> navigate whichever tab is now active` race. From a conversation-only pane, a successful duplicate uses the existing All-tabs affordance so the plain user copy remains visible. Background reload does not select another tab. Operational failures resolve a typed outcome through the existing chrome error/toast path, retaining and marking a failed duplicate instead of rejecting an Electron IPC handler. Existing Close/Close others/Close to right/Copy URL capabilities and consent semantics remain in the same registered menu.

The slice's first native cell found a defect in its own implementation: agent conversation attribution was copied even though capability was not. Three discriminating real-host tests fail on source `8fe9b86350` (both agent-owned and handed-over sources retain their session, and a failed load rejects instead of resolving a typed outcome). The corrected factory creates `createUserTab(null, sourceUrl)`; agent requests using either a numeric duplicate ID or a rebound source handle are refused. The original native assertion only waited for a count and then searched by committed URL; it did **not** capture raw state or prove copied native authority. Its subsequent `ERR_FAILED loading about:blank` used `stopLoadingListener` during exact-tree teardown. The corrected cell must record raw state plus a settled outcome before teardown; no cause is claimed from the generic assertion alone.

New `browser-tab-action` and `browser-reorder-tabs` channels use the existing owning-window, main-frame identity and trusted desktop URL authorization **before** primitive validation. Their handlers are included in namespace teardown. No method is added to the agent protocol, no preload is injected into pages, and no page-view geometry, cookie partition, popup handling, origin policy, handover or lifecycle code changes. All tooltips stay in chrome; the registered actions menu continues to suppress the native page while open, rather than pretending DOM can paint over a WebContentsView.

## i18n interaction / convergence handoff

UI#1065 owns the separate existing `ui.browser.json` / `ui.browser.context.json` extraction and was already conflicting with a1/a2. Manager authorized b to proceed first. **Those unmerged catalogues are not edited.** Namespace `ui.browser.chrome` was absent on baseline main; new copy is keyed through the existing adapter/ICU and generated types, with EN and per-key context metadata. These keys are **EN-only fallback**, not a claim of audited locale coverage. There is no second translation API or language preference.

Added keys/string values are exactly the slice-owned `src/i18n/catalogues/en/ui.browser.chrome.json` and its context companion: error title, Move tab left/right, Duplicate tab, Reload tab, Scroll tabs left/right, complete conditional accessible-tab name, invalid order/action, gone-tab, recoverable operation-failure and unsupported duplicate error. The accessible template includes loading, failed, agent-owned/shared, request ordinal and restored phrases; all runtime values are ICU placeholders. Existing New tab, Close, Agent, Shared, Failed, Restored, Copy URL and Approvals labels merely move, restyle or change visibility and are intentionally not pre-emptively re-keyed from #1065. The raw failed-URL title changes to a host or the new generic title. No existing copy key is removed. No global keymap/chord changes.

Non-translatable identifiers: IPC channel/action enum names, numeric tab IDs, `application/x-local-operator-browser-tab`, `data-tour-tag` identifiers, HTML/ARIA role names and canonical KeyboardEvent key names. They are machine tokens, not translation exemptions for English prose.

Exact overlap diffs for the i18n convergence owner:
- `src/renderer/src/features/browser/components/browser-tab-strip.tsx`
- `src/renderer/src/features/browser/components/browser-url-bar.tsx`
- `src/renderer/src/features/browser/components/browser-surface.tsx`
- `src/renderer/src/features/browser/hooks/use-browser-chrome.ts`

## Validation / evidence contract

Source/IPC/model/SSR tests are not native proof. They cover scoped slots, invalid/stale input, exact-record duplicate and authority, actual IPC sender/frame rejection, retained default grouping, actual rendered custom order, complete state names and existing close-focus behavior. Neighbour keymap/window/lane tests run bounded/serial; CI supplies the terminal whole desktop suite and 59-theme contrast gate (a dragged-tab control row is registered).

Native evidence lives in `docs/evidence/browser-tab-strip/`. Its README must name the compiled source/tree and artifact hashes, actual rows, real geometry, light/dark screenshots and remaining gaps. Before frames may be adopted from the committed a2 r1 collection: source `41cec92350` and baseline `422df12175` have **byte-identical full src tree** `a4c4c0d4ea47d2c14b9043fd3ce01feaa51a95fe`; these are historical captures, never relabelled fresh b captures.

One isolated hidden instance, one compile and one native cell; build/runtime port-one binding and no focused-window overrides. Browser chrome `capturePage` excludes the embedded native page. JS listener/drag emission is distinct from Chromium pointer delivery and physical OS input. The actual receipts—not this design intent—decide which surfaces passed. No print or later slice is started; independent code, QA, design and UX rounds remain manager-owned after the PR opens.
