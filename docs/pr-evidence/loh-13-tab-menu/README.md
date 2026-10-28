# LOH-13 — the tab actions menu is a native menu

**Defect (operator report).** Opening a browser tab's actions menu made the page
disappear behind the "paused" note. The menu was a Radix popout whose panel
crossed into the native `WebContentsView`; painting it required suppressing the
view (S5's measured pause), which put the paused note on screen.

**Fix.** The tab actions are a native Electron `Menu` (`Menu.buildFromTemplate`
+ `menu.popup` in `src/main/browser/ipc.ts`), the same mechanism as the page
context menu. The OS draws it above the view, so nothing suppresses the page.
The strip still owns the item list (order, counts, labels); main validates it,
pops it and answers the selected id, which the strip dispatches through its
existing handlers.

## What was run

Built app, inactive window (visible, never activated), isolated `HOME`, config,
log dir and `--user-data-dir`; every `CMUX_*`/`LOP_*` variable stripped;
telemetry and notifications off:

```
cd ~/local-operator-ui/.worktrees/tab-menu-native
pnpm build
node scripts/browser-tab-menu-native-proof.mjs <out-dir>
```

Actual output (`report.json` beside these frames):

```
PASS the menu is OPEN: the trigger reports aria-expanded, and the run never takes focus: {"expanded":"true","hasFocus":false}
PASS no renderer panel exists for the tab menu: {"domPanel":false}
PASS the page is NOT suppressed while the menu is open: {"suppressedBy":""}
PASS the page's rectangle does not move: {"before":{"x":260,"y":106,"width":920,"height":714},"open":{"x":260,"y":106,"width":920,"height":714}}
PASS the page's own pixels are unchanged while the menu is open: {"pageChanged":0,"channels":[36,58,91]}
PASS window-capture attempt recorded: {"answer":"blocked: could not create image from rect"}
```

The menu was open for the sampled state: the trigger reported
`aria-expanded="true"` while main's `menu.popup` was still pending, and
`document.hasFocus()` stayed `false` throughout (the run never took the
operator's focus). The page's own pixels were byte-identical before and while
the menu was up (0 differing bytes).

## Frames

- `03-before-menu.png` — the composed frame (renderer + page at the rect the app
  reported) before the press.
- `04-menu-open.png` — the same frame while the native menu is open. **The menu
  itself is not in a rendered frame**: it is an OS window outside the
  `WebContents`, and the only capture that could include it is macOS
  `screencapture`, which this host refuses (`could not create image from rect` —
  Screen Recording is not granted to the harness). What the frames show is the
  property the change is about: the page is still painted, in the same place,
  with no paused note, while the menu is open.
- `01-page-before-menu.png`, `02-page-menu-open.png` — the raw page-target
  screenshots the two composed frames were built from.

## Automated checks (same head)

```
node --test scripts/browser-tab-actions-menu.test.mjs scripts/browser-tab-strip-focus.test.mjs
ℹ tests 24  ℹ pass 24  ℹ fail 0
pnpm check-types       # main + renderer, clean
pnpm lint; pnpm lint:scripts   # clean
```

`scripts/browser-tab-menu-turn-proof.mjs` is retired: its subject was the Radix
popout's effect on a running turn, and that popout no longer exists. The
renderer half (no global layer, transcript and Stop untouched) is pinned in
`browser-tab-strip-focus.test.mjs`; the native popup's real-app behavior is the
run above. `browser-chrome-proof.mjs`'s tab-menu rows are documented as stale
for the same reason (it is already marked superseded in part by S4b and is not
in CI).
