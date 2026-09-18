# The About panel: the app's own identity, and no panel an agent run can raise

**Claim.** The macOS About panel now describes the app rather than the runtime
hosting it, and a `headless` run cannot put one on the operator's screen at all.

**Before.** The About item was Electron's own `about` role, and an UNPACKAGED
launch - which is how every rig, QA harness and `npx electron .` boots this app,
from `node_modules/electron` - has no bundle of ours for AppKit to read, so the
panel was filled from Electron.app's identity. Opening the app menu's first item
produced, in front of the operator:

| | name | version line |
| --- | --- | --- |
| before | `Electron` | `Version 44.3.0 (44.3.0)` |
| after | `Local Operator` | `Version 0.26.11 (Electron 44.3.0, unpackaged)` |

Both rows are pixels of the panel window itself, captured from the BUILT app on
this machine: `frames/before-identity.png` is `origin/main` at `6f15f71ea`,
`frames/after-identity.png` is the branch head. The second line is a measured run
of the shipped code, not a mock of it - see *How to re-derive* below.

## What changed

- **The panel's identity is registered** (`configureAboutPanel` in
  `src/main/index.ts`): `applicationName` is the app's own name, the version is
  the app's own version, the parenthesised build string names the desktop host
  and whether the bundle is the shipped one, and `copyright` is read from
  `package.json`'s `build.copyright` - the one place the project states it, and
  the string electron-builder stamps into a packaged bundle. Without this
  registration an unpackaged run says `44.3.0` twice and names Electron.
- **The action is gated by the launch's resolved window mode**
  (`resolveAboutPanelAction` in `src/main/window-mode.ts`): `headless` logs
  `[about-panel] suppressed by window mode headless: a headless run raises no
  window` and raises nothing; `inactive` and `normal` raise the panel. The menu
  item therefore carries a handler of its own instead of Electron's `about` role,
  whose click is AppKit's `orderFrontStandardAboutPanel:` and cannot be
  intercepted at all.

## What was measured

Headless behaviour, from the shipped build (full run output quoted below):

```
== windows owned by this app BEFORE the action (window server's list, on screen only):
   (none)
== About menu entries: Local Operator > About Local Operator [role=none] click=function
== invoked: Local Operator > About Local Operator via the item's own click handler - called
== windows owned by this app AFTER the action:
   (none)
== the action created no window: nothing reached the screen
== the app's own line about the action:
   23:39:15.789 › [about-panel] suppressed by window mode headless: a headless run raises no window
== this app was the frontmost application in 0 of 33 samples (pid 62441)
    [window-mode] window mode headless: 1380x900, window created and never shown, page throttling off, no Dock tile
    [window-mode] state: visible=false focused=false focusable=false size=1380x900 content=1380x868
== processes left from this run: 0
```

The census is the window server's own list for that pid with `onscreen: true`, so
"no window" is a read of the window server rather than an absence of evidence:
the headless run's own window exists in that census with `onscreen` false when it
is asked for all windows, and the rig reads the on-screen set precisely so a panel
that appeared would be a new window id in it.

The identity pair, from the same rig in `inactive` mode (the one mode that shows
the panel, and the mode whose promise is that the app is never activated):

```
== app identity (its own answer): name=Local Operator version=0.26.11 electron=44.3.0 packaged=false
== active before the action: false; windows: [{"visible":true,"focused":false,...}]
== invoked: Local Operator > About Local Operator via the item's own click handler - called
== active after the action: false; windows: [{"visible":true,"focused":false,...}]
== windows owned by this app AFTER the action:
   {"id": 37602, "name": "Local Operator", "onscreen": true, "bounds": {"w": 800, "h": 600}}
   {"id": 37603, "name": "", "onscreen": true, "bounds": {"x": 722, "y": 211, "w": 284, "h": 191}}
== captured the window this action created (id 37603) to .../after-identity.png
== this app was the frontmost application in 0 of 31 samples (pid 64761)
== processes left from this run: 0
```

`app.isActive()` stays false and the frontmost pid never moves: raising the panel
does not activate the app, which is why `inactive` may raise it and `headless` may
not. The `before` frame was taken the same way, with one difference the rig prints
itself: an item that is still Electron's ROLE has no handler of ours to call, so
that run raises the panel through `app.showAboutPanel()` - the call the role makes.

## How to re-derive

`pnpm build` first: both rigs drive the BUILT app from the tree named, and the
behaviour rig refuses a tree whose `src/main/index.ts` has no gate, so pointing it
at `origin/main` cannot raise a panel on the operator's desktop by accident.

```bash
# The behaviour half. Headless only, nothing on screen, no capture.
bash docs/evidence/about-panel/harness/run.sh . after-headless

# The identity half. THE ONLY RIG HERE THAT SHOWS ANYTHING: one instance, opt-in,
# capture and teardown in the same command, under an EXIT trap.
ABOUT_PANEL_VISIBLE_CAPTURE=1 timeout 100 bash docs/evidence/about-panel/harness/identity.sh . after-identity
```

Run `identity.sh` against a tree built from `origin/main` for the `before` frame
and against the branch head for the `after` one; use a label that says which.

Both rigs isolate everything (a scratch `HOME`, config dir, `--user-data-dir`, a
cwd outside the tree so its `.env` cannot be read, `VITE_DISABLE_BACKEND_MANAGER`
so no backend is spawned, and the notifications kill switch), refuse a port
somebody else is already listening on, read the frontmost application by pid from
`lsappinfo` (no `System Events`, no Accessibility permission), photograph only the
window id the action created (`screencapture -l`, never the screen), and reap by
`pgrep`-pid until the count is zero - printing that count, because an Electron
left behind is a window left behind on the operator's desktop.

`harness/cg-windows.c` is compiled into the scratch root by `lib.sh` rather than
committed as a binary; it is the window census the frontmost/capture steps are
built on.

## Residual, stated rather than implied

The panel's ICON is still Electron's in an unpackaged run, and this change cannot
reach it: the icon comes from the application bundle's `CFBundleIconFile`, and
`setAboutPanelOptions` has no icon option on macOS. A packaged build shows the
app's own icon, which is what the operator sees in the shipped app.
