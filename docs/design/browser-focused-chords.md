# Focus-scoped browser commands (a1)

The browser owns keys only while its chrome (including the address field) or its
presented native page owns focus. A conversation pane being open does not make a
composer key a browser key. This is browser UI, not a new agent capability.

## Decision table

`Primary` means Command on macOS, Control elsewhere (never both). Control+Tab is
Control on every platform. Letter matching is case-insensitive; Shift is explicit.

| Key | Chat/app focus | Browser chrome | Address field | Presented driven page |
|---|---|---|---|---|
| Primary+R | Existing app reload/menu | reload / main hook or DOM fallback | same | reload / main view hook |
| Primary+Shift+R | Existing app force reload/menu | hard-reload / same doors | same | hard-reload / main view hook |
| Primary+L | Existing app, no browser command | focus-address / scoped renderer | select address | focus-address / main → renderer |
| Primary+T | Existing app, no browser command | new-tab / scoped renderer | same | new-tab / main → renderer |
| Primary+W | Existing window close/menu | close-tab / scoped renderer | same | close-tab / main → renderer |
| Primary+Shift+T | Existing app, no browser command | reopen-tab / scoped renderer | same | reopen-tab / main → renderer |
| Primary+1…8 | Existing app, no browser command | tab-N / scoped strip ordinal | same | tab-N / main → renderer |
| Primary+9 | Existing app, no browser command | tab-9 / last scoped tab | same | tab-9 / main → renderer |
| Control+Tab / Shift+Tab | Session switcher (`docs/session-switcher.md`) | next-tab / prev-tab | same | main → scoped renderer |
| macOS Command+Shift+] / [ | Existing app, no browser command | next-tab / prev-tab | same | main → scoped renderer |
| Primary+[ / ] | Existing app chat navigation | back / forward page history | same | main view hook page history |
| Primary+F | Existing transcript search | Existing behavior; browser find is a2 | same | no browser binding in a1 |
| App zoom keys | Existing app zoom | Existing app zoom, not page zoom | same | no new page-zoom binding in a1 |

**Focus decides Control+Tab between the two owners.** In one sentence: When
keyboard focus is inside the in-app browser panel - its tab strip, address
bar/popout, start page, or the web page itself - Ctrl+Tab and Ctrl+Shift+Tab
switch browser tabs; everywhere else, the console included, they open the session
switcher, except while Tab is already claimed for a list: the composer's slash
list, or the canvas editor's list item it nests. The same sentence is in
`docs/session-switcher.md`. The predicate is `browserOwnsTabChord(document,
target)` (`features/browser/hooks/use-browser-chords.ts`), which wraps the same
`chordOwner` the browser's DOM door reads, so the two surfaces cannot disagree
about which of them owns the press. The console is why the sentence needed code
as well: its xterm handler consumed Ctrl+Tab as a plain tab, and now hands it
back.

No a1 binding changes app zoom, the historical Actual Size Command+O spelling,
print/palette, transcript search or editable text shortcuts. They are a separate
slice. Browser fixed platform chords are not user-assignable settings: existing
app reserved keys and their app meanings remain intact outside the browser.

## One owner, not a debounce

The shared classifier is used by the real `before-input-event` hook and by the
surface's DOM fallback. The native hook prevents delivery into DOM and menu.
Electron also receives `setIgnoreMenuShortcuts` **per input**: only a claimed
browser key-down suppresses accelerators; a key-up/unrelated key, focus departure,
startup rollback and host stop restore them. It is not a focus-wide disabling of
all menu shortcuts, and no 150ms clock can discard two legitimate fast presses.
Recognized repeated action keys and composing command keys are consumed without
an action so they cannot fall through to the same menu accelerator. Cycling may
repeat. Alt, wrong-platform modifiers and unrelated keys pass through.

The explicit menu entries are intentional aliases of the same command ids, not
independent global browser bindings. A menu click resolves actual focused native
contents or the authorized chrome focus flag; outside the browser it retains the
original app reload/force-reload/window-close action. The actual menu callback
window is checked FIRST: a popup/mini target must retain its own action even if
main chrome has a stale focus flag; a missing target never redirects to main.
Source tests reject the old
unconditional reload/close menu roles. The native evidence enumerates the actual
menu accelerators; aliases must be counted by owner, not as unexplained duplicates.

## Scope, focus and lifetime

The renderer indexes the same grouped, scope-filtered order as the strip. Main
never guesses conversation scope. Commands queue rather than debounce. Closing the
last visible tab opens a fresh user blank in that surface's scope, never closes
the window. Closing records at most ten HTTP(S) URLs of user-owned, non-handed-over
tabs in memory. No capability, nonce, page state or agent URL enters that stack.
Reopen consumes an eligible entry through ordinary user new-tab/navigation paths;
a conversation only reopens its own entries. Host stop discards the stack.

New IPC uses the existing owning-window/main-frame/trusted-URL sender gate and
validates inputs. Browser pages/popups retain no preload, sandboxing, origin gates,
permission default-deny and agent capabilities unchanged. Popup brackets remain
on their own history; this slice adds no other popup keys.

Only `window-raise.ts` may focus native contents. Its helper requires the launch's
normal focus policy AND a window already focused; it never shows, activates or
raises. Headless listener emission can execute commands but cannot bypass that
guard or prove OS focus movement.

## Evidence interpretation

Classifier/renderer tests exercise actual decision/DOM logic. A native test emitting
`before-input-event` on real contents proves the installed listener, not Chromium
or OS delivery. DOM KeyboardEvents prove the fallback door, not menu accelerators.
Literal focused-desktop Command+R/W/T/L and navigation remain **OS fidelity
unverified** without an attended smoke; headless cannot truthfully provide that
proof. Pixel evidence must distinguish app-chrome capture from embedded-page capture.

## Round 1 remediation notes

- **Focus ownership on a keyboard close.** Closing the active tab with focus on
  its own button removes the focused node; Chromium then fires `focusout` with a
  null `relatedTarget`, which used to report "focus left the browser" and let the
  NEXT Cmd+W reach the application menu and close the window. The surface root
  (`tabIndex={-1}`) now takes the caret before the close, and a focused node that
  vanishes while the surface is still mounted re-parks the caret instead of
  reporting a leave. Queued presses wait for the projection so a rapid second
  Cmd+W cannot target the tab that is already gone.
- **The address draft belongs to its tab** (Chrome and Safari behave the same).
- **Reserved chords.** The fixed browser chords that Settings can capture (T, L,
  R, Shift+T, Shift+R, 1 to 9) are in `RESERVED_CHORDS`; Ctrl+Tab and the
  brackets need no row because the chord grammar cannot spell them.
- **Menu label.** The Cmd+W item reads "Close Tab or Window": one accelerator,
  two owners decided by focus that lives in a page view a menu label cannot see.
- **Closed-tab stack** is purged by clear-everything and forget-site, takes its
  entry before awaiting, and navigates the tab it created.
- **Chrome focus** also resets on a main-frame cross-document navigation and on
  renderer process loss.
- **Reopen is a re-navigation, deliberately.** Cmd+Shift+T opens a fresh user
  tab and loads the remembered URL; unlike Chrome it does not restore the tab's
  position or its back/forward history. Remembering history would mean keeping
  page state past the tab's death, which the user-only, URL-only, in-memory
  stack exists to avoid.
- **Silent no-ops are known and deferred (a2).** Cmd+Shift+T with an empty
  stack, Cmd+5 with three tabs, and Cmd+T or Cmd+L while chat has focus do
  nothing and say nothing; so does Cmd+L on a disabled address field. Menu
  entries that enable and disable honestly, and ordinals in tab tooltips, are
  the discoverability work this slice does not take on.
