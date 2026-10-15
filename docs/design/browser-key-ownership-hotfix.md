# Browser key ownership: BODY and pane header hotfix

## First wrong boundary

Correct browser R/T input reached the standalone browser document's BODY, but
`useBrowserChords` listened and reported ownership only inside BrowserSurface;
therefore no browser reload/new-tab IPC ran. BrowserPane's existing header is
outside that same root and had the same source-level gap.

This is a logical chrome ownership repair, not a new key classifier, page
preload, permission, browser-tool action or URL policy. The native tab-menu replacement is a separate, unshipped lane. This candidate
retains the released DOM tab menu, suppression policy, IPC and tab ordering
byte-for-byte. It makes no native-menu repair or paint claim.

## Actual old47 evidence and limits

The parent executed one **no-recompile** hidden baseline from release-source
`2461cfa3f3beaa1124727a9de93dfe01c4381b0d`, src
`4ce1f33a53a55b6d9a3202ae6d3be03681fd1158` on 2026-10-15. Its whole result was
**rc75, pressure2 abort, PARTIAL**, not a clean gate. All 170 compiled controls
were retained unchanged. The first pressure2 warning was epoch-ms
`1792094445084`; the second was over five seconds later.

Valid observations before the first warning:

| Case | Actual observation | What it establishes |
| --- | --- | --- |
| Strip R, epoch-ms 1792094438499 | browser-reload IPC, selected `/one` HTTP count +1, `/two` unchanged | Existing inside-root DOM route works once |
| Strip/address/toolbar T | Exactly one new tab per accepted press, address focused | Preserve the existing success door |
| BODY R/T, 1792094442746 / 1792094443269 | Correct meta keydown on BODY, document focus true, root containment and logical flag false; no browser IPC/HTTP/new tab | Actual Electron/CDP renderer failure before warning |
| Sibling header control | Correct key outside root, same no-op | Synthetic sibling only, NOT native proof of actual BrowserPane |

The raw source is the parent's `stage-a-results.json` under the task scratch run
`urgent-stage-a-ready-runs/run-20261015-160029-4ae46f90`; the derived observation
receipt records its SHA and warning cutoff. Post-warning/menu-dismissal rows are
partial observations, not a successful cell. DOM and browser IPC were observed;
**no native before-input events were captured**. Page-target CDP had neither
captured input events nor effects: delivery is unproven, not a reproduced page
bug. No physical OS chord, OS accelerator or native-popup paint success is
claimed. The DOM menu hid the native view but the page heartbeat continued
(141→167, same generation6): the page's JavaScript was not observed paused.

## Ownership decision

The existing surface ref, `browser-route` view tag, BrowserPane ancestor marker
and shared browser-view suppression policy are sufficient; BrowserPane does not
need another wrapper, focus trap or privileged bridge.

- A single document-level bubble listener selects **one** visible connected
  browser owner. A pane owns its own header and surface, not chat controls.
- BODY belongs to a browser only for the sole visible standalone `browser-route`
  on `#/browser`. Two ambiguous surfaces, chat BODY, outside controls/editables,
  hidden/inert surfaces and any registered blocking overlay do not claim it.
- Active-element ownership and event-target ownership must agree. Existing child
  `defaultPrevented` decisions win; there is no clock/debounce suppression.
- Main has one logical-focus boolean, so reports are derived from all current
  roots and deduplicated per document. Mounting, hiding or disposing B must not
  publish false over the still-focused A. Main-origin invocations are delivered
  only to their selected owner, never broadcast into two scopes.
- Page-origin main output remains trusted only through the existing main page
  guard. With no DOM owner, only a sole visible root containing the projected
  active tab may receive it. Ambiguity refuses rather than inventing a scope.
- The existing serial command queue, projected active-tab cursor, last-tab
  replacement, user new-tab/session rules and address-ready focus behavior are
  retained. Removed-node caret parking cannot steal focus for an outside chat
  node. No changes to agent authority, nonce ownership, sandbox, RPC or CSP.

## Native and menu eligibility

Logical ownership is not native foreground focus. Both main's chrome input door
and the app-menu door use the same predicate: logical browser owner, visible
chrome, non-destroyed window, actual Electron `isVisible()` and `isFocused()`.
Read native visibility/focus only after the destruction check. Hidden/headless,
inactive or overlay-covered chrome cannot become authorized by a renderer flag.

OS window blur clears only `ignoreMenuShortcuts`, not logical DOM ownership.
This avoids an asynchronous renderer-report gap on reactivation; actual native
facts refuse all commands while inactive. Renderer blur has no reset listener;
its focusout logic recomputes the active element instead of treating a null
relatedTarget as departure. Real focus into chat/outside input clears ownership.
Renderer navigation/crash, window destruction and host generation teardown still
clear stale main ownership. Window-focus observation does not show, activate,
raise, or override any focus guard.

The actual page native input path is unchanged. Normal visible/focused physical
input and native menu paint remain for independent real-path validation. The separate native tab-menu positive path refuses a hidden rig by design;
a stub popup or forced focus flag would not count as OS proof.

## Source regression plan and current disposition

The new real-hook JSDOM regressions failed against the pre-fix hook (BODY focus
false, missing pane-header reload, two handlers for one main invocation). They
exercise actual hook callbacks with synthetic DOM events, not Electron/OS input.
Coverage includes selected reload, distinct rapid new tabs/address readiness,
inside-root success, pane header, outside input/chat, wrong modifiers, IME,
repeat, modal/hidden/inert conditions, ambiguous roots, A + hidden B lifecycle,
loading/error and blur/actual ownership transitions. A finite native-fact matrix
checks both router doors; existing app-menu foreign-window/target tests remain neighbors. Native-menu
controller/IPC tests from the separate lane are deliberately excluded.

No new fixed chord means no keymap migration or catalogue change. Existing
look/theme/geometry and agent browser contracts remain unchanged. Source checks
are light/bounded; **no postfix app compilation/native pass is claimed**. The
old47 controls and exact pre-RT source pair remain separate for a future freshly
admitted postfix comparison. No feature PR, merge, install or release is justified
by this source-only result.

## RT-only extraction and source compatibility

Actual fetched `origin/main` is `2461cfa3f3beaa1124727a9de93dfe01c4381b0d`.
The combined `104c1661dd` branch and its native-menu predecessor `1f7bde582d`
remain unchanged. Only `1f7..104`'s three RT production hunks and two RT test files
are carried here. The hook and main eligibility predicate remain byte-identical;
the same main initialization hunk applies without menu-controller imports.
The only additional dependency is a read-only registry visibility getter over
existing `visible && contentRect !== null`: an empty browser has no active page
but still owns New tab. Its body is identical to the earlier accessor; its why
comment is RT-specific. No shared-order extraction, native-menu channels,
controller, label handling, layout, copy, key classifier, dependency or version
change is included. Existing view tags and pane markers need no entry-file edit.

The prior 39-test count included 14 separate native-menu cases and is NOT an
RT-only claim. RT-only counts are recorded by the candidate's actual logs, with
an added real-registry/setter test and BODY direct-neighbor command-family test.
All source events/callbacks remain JSDOM/unit evidence, not OS input proof.
On this RT-only base, the six StageA ownership tests failed before production
extraction (source RED). Final source results are **15 renderer + 12 main/registry/
registration = 27 PASS**, Node/App no-emit typechecks PASS, targeted lint rc0.
Each serial command stayed within20s/512MiB; exact durations/commands are retained
in the task scratch receipt. Existing localStorage/Radix test diagnostics and six
pre-existing regex lint advisories are not claimed absent. The new neighbor test
was corrected to existing page-control verbs `in/out/reset`; its bare find-row
placeholder proves the `open` callback, not the real component's separate mount
focus effect. No production behavior was changed to accommodate those fixtures.

## Bounded postfix native QA plan — NOT executed

The owner must obtain fresh normal resource admission before one future compile
and isolated hidden cell. Pin this candidate's actual source/tree, verify exact
shared-lock compatibility and compiled port1/backend-off + synthetic OAuth
bindings, preflight all reached driver/RPC/IPC verbs, then admit once. No build
or application runs are authorized by this document while pressure2 is held.

Use only the existing approved carrier/devdriver. Keep **two baseline fixture
tabs maximum**, plus **one temporary T tab**, or **two simultaneous temporary
tabs for the rapid pair** (maximum four native WebContents, not nine). Maintain
an explicit set of IDs created in THIS owned isolated app. After each T/reopen
observation, record ID/owner/session/selection/address-ready, close only the
tracked temporary IDs, and restore the selected baseline ID before the next
case. Before/after tab-ID snapshots must equal baseline outside the current
case. Never use a global close-all or touch user/foreign tabs. Fewer temporary
views is resource hygiene, not a claim that prior views caused global pressure2.

| Inherited door / context | Discriminating side effect or negative | Cleanup / scope |
| --- | --- | --- |
| BODY R and Shift+R, both selected baseline IDs | Exact corresponding HTTP reload +1, other baseline unchanged, outer app navigation0 | Restore original selected baseline |
| BODY T, then rapid T pair | Exactly1 / exactly2 distinct user IDs, expected scope, no inherited authority; selected new ID and address ready | Close tracked temporary IDs immediately, restore baseline |
| Existing strip/address/toolbar R/T | Same counts as BODY; no doubled DOM/main/menu handling | Same temporary-ID discipline |
| L | Current selected URL fully selected, not another tab's draft | Return to baseline BODY without navigation |
| F | Find row opens, input gets focus; existing real query/count/Escape path remains scoped | Close find row, clear fixture query; do not rerun unrelated a2 matrix |
| W / Shift+T | Close only the owned temporary user tab, reopen existing user-only stack without authority, address ready | Observe and close reopened tracked ID; never close baseline/foreign tabs |
| Zoom +/=, -, 0 | Actual selected page factor/percentage changes and resets; other baseline factor unchanged | Reset selected factor to100%; app zoom unchanged |
| Digits1..9 | Derive expected selection from the actual two-tab scoped order; test both existing positions, last-tab9 and out-of-range3..8 behavior | No extra native tabs just to populate digits |
| Ctrl+Tab / reverse | Exact next/previous selection in the existing rendered order | Restore baseline selection |
| Brackets | Selected fixture history changes in the intended direction; no app navigation | Return fixture to known baseline URL |
| Chat/outside editable, hidden/inert, real registered modal, ambiguous roots | No browser action, tab/HTTP/zoom stable; existing app behavior retained | Source proves unavailable real-pane cases only; label any synthetic sibling |
| Loading/error and ownership transitions | Selected-target semantics preserved; new T is user-owned, no agent-origin grant | Observe null authority as a boolean, never print a capability |

Actual CDP key delivery must be labelled at its observed layer. Preserve the
pre-fix distinction: main renderer DOM/IPC/HTTP was observed; page-target input
was not. A future own fixture may capture trusted page DOM key traces to resolve
that delivery question, but no page-native bug or physical OS-key proof follows
from zero events. The actual pane header may still be offline-unavailable; its
existing-marker source proof is not a fabricated native counterpart. No window
show/raise/focus, `isFocused` replacement, native-popup stub, live session or new
backend bootstrap is part of this plan. Stop the cell on a rig failure; retain
incremental rows and apply the exact owned PID/group/FD cleanup contract.
