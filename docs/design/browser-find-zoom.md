# Browser find and per-tab page zoom (a2)

Base: a1 #1090, fca45feb6d. Frozen browser brief rev3 E6/E7 and a1-9 apply;
manager explicitly excluded print. This adds human chrome intents, not agent
commands. No preload is added to pages, no origin/permission grant changes.

## Focus decision table (fixed, not assignable browser actions)

| Input | Browser chrome/native page owns focus | Chat/app owns focus | Door |
|---|---|---|---|
| Cmd(mac)/Ctrl(other)+F | Open/focus inline find row | Existing transcript/app search unchanged | shared browser classifier, native/router then DOM fallback |
| Enter / Shift+Enter in find input | Next/previous native match | Unchanged text/app meaning | find input only |
| Escape in find input | Close/clear native find, return DOM/page focus | Unchanged | find input + guarded focus-page IPC |
| Cmd/Ctrl + or = | Next page-zoom step | Existing app zoom in | native/menu/DOM focus routing |
| Cmd/Ctrl - | Previous page-zoom step | Existing app zoom out | same |
| Cmd/Ctrl 0 (zero) | Page 100% | App 100% | same |
| Cmd/Ctrl O (letter) | No page-zoom action | Existing canvas file-open meaning | app registry |

Actual Size's historical menu accelerator CmdOrCtrl+O and uppercase-key-only
handler were wrong: resetting zoom conventionally uses zero, not the canvas's
file-open chord. Both menu and app handler now use 0. This is in scope because
page/app zoom arbitration otherwise leaves two different reset promises. Menu
callbacks use their actual window target; OAuth/mini targets do not route to the
main window's browser. The app's older before-input listener routes browser zoom
FIRST through the shared classifier, including rejected repeats/composition;
the later hook sees defaultPrevented and cannot execute it twice. Native zoom executes in main without moving the page caret through chrome. No debounce.
Alt/wrong-platform modifiers, composition and action-repeat negatives remain.

## Find lifetime and native-view geometry

The row is in layout immediately below the toolbar and above browser-content.
It changes the content rect through the existing ResizeObserver; no DOM panel
tries to paint above the native view. New tooltips open above their chrome
controls; native evidence asserts panel/content disjointness. Query has an
accessible name, count is a polite live output, and controls use outline focus
and shared chord captions. There is no animation (reduced motion unchanged).

Main owns native query/result counts for one active PRESENTED document. The input keeps its transient DOM editor value until tab-key remount/close, so asynchronous IPC acknowledgements cannot roll back rapid typing; Enter uses that current draft. Every queued
IPC carries its explicit tab id; stale/hidden targets fail instead of acting on
the new active tab. Native found-in-page events must match the exact record,
document epoch and latest native request id. Switching, closing, hiding or
navigating clears state/listener and native selection; the query/count is never
projected onto another tab. Empty query clears native selection. Enter/next/
previous uses findNext; typing starts a new query. Escape restores a connected
prior DOM target, otherwise uses the existing focus-page IPC guarded by
window-raise.ts. Tab changes never restore an old caret. No window show/raise.

Find is available while a human watches an agent-owned tab. Native find
highlights are rendered overlays (not page DOM mutations), so they COULD appear
in an agent screenshot. Before each agent tab operation, main clears them in
the existing registry serial lane. Human find IPC takes the SAME lane, so it
cannot start a new highlight while capture/read is running. The chrome row is
cleared too; agent protocol gains no find method. Native screenshot/geometry
validation uses the real RPC route after a zoomed user tab is handed over.

## Zoom isolation and retention

Steps: 25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300,
400, 500 percent. Per-tab, memory-only. Electron 44 setZoomMode('isolated') is
installed on every new WebContents before navigation: same-origin tabs do NOT
share zoom, and the persistent cookie/policy partition remains unchanged. The
percentage/reset control appears only when not 100%.

**Limitation (intentional isolation): a human cannot zoom a tab an agent is
driving in this PR.** Agent-owned/handed-over tabs stay at 100%; a zoom chord
shows the non-modal chrome notice “Zoom is off for tabs an agent is driving”.
The tab is reset BEFORE handover mints/transfers its capability. Agent
read/screenshot entry also normalizes to 100%, clears find overlays, and keeps
the existing viewport and screenshot response contract. This avoids races or
coordinate conversions in #797's CSS-pixel/viewport geometry path. Per-origin
persistence, agent-view zoom and print are not addressed.

Existing primary+F was already reserved, so it gets a browser meaning but no
legacy-retention exception. primary+0 was formerly valid/assignable: retain it
dormant in the same map alongside a1's14. The punctuation zoom keys were never
representable by Settings' grammar; reserved rows document them without adding
new assignable syntax or retaining invalid historical strings. Capture still
refuses fixed keys. Existing data survives unrelated saves/migrations; frozen
8057f32 consumer proves downgrade restores raw primary+0. Explicit Reset/Clear/
valid reassignment discards/replaces it; pressing the displayed effective
binding is still a no-op, not Reset. No storage version/schema change.

## Validation plan and fidelity

Targeted source tests cover native-event fences, sender/frame/URL/primitive
negatives, handover ordering, agent read/screenshot state/geometry, keymap
retention and renderer input flow. Mandatory neighbours include panel-rail,
keymap/registry/dispatch, window-mode and existing transcript search, bounded
serially at600s. CI supplies whole-suite automation, not a duplicate local run.

Native cell preflight: exact installed lock fd0310b2, isolated data/HOME, build
and runtime API root127.0.0.1:1, synthetic OAuth, telemetry/notifications off,
absolute carrier/app paths, mock keychain, one hidden instance, machine lease,
free disk >=20GiB, final source/build hashes. Capture both themes for closed,
open, no-match, many-match and 100/150% states. Listener/DOM/native menu calls
are NOT physical OS delivery; headless capturePage excludes native page pixels.
Record page screenshot separately through the real agent protocol. No OS dialog,
no focus guard override, exact-process-group reap. Results live in
`docs/evidence/browser-find-zoom/`, not presumed here before execution.


### Corrected native session contract (round1 remediation)

The initial implementation and its fake-native expectations inverted Electron's
misleading `findNext` option. Independent QA proved on Electron44.3 that it maps
to Chromium `new_session`: TRUE starts an initial/changed/retry query, FALSE
advances an existing query. The missing callbacks were a PRODUCT BUG, not a
proven hidden-window limitation. The earlier inference is withdrawn; original
partial receipts remain historical, not evidence of a runtime limitation.

The corrected test models those native semantics independently of the option's
name, and round1 native validation must record real first/next/previous/wrap events. Initial
opening owns the return target for the session; repeated toolbar/chord focus
preserves it. Escape works from every row control. The neutral fallback now says
“No result reported. Press Enter to search again.” Navigation controls can retry
a timed-out request as a new native session. In narrow panes the controls stay
together and recovery copy yields another row instead of displacing the editor.

Independent QA's pre-remediation5307ms neutral-state observation/menu enumeration
is adopted with provenance. Current-source results and rendered focus/reduced-
motion/narrow/tooltip measurements live in `docs/evidence/browser-find-zoom/r1/`.
Physical OS key delivery and painted native highlights remain separately scoped;
count/ordinal validation must use real native events, not emitted substitutes.
