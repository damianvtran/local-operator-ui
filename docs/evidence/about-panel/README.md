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
| after | `Local Operator` | `Version 0.27.0 (Electron 44.3.0, unpackaged)` |

Both rows are pixels of the panel window itself, captured from the BUILT app on
this machine: `frames/before-identity.png` is a tree built at `origin/main`
`f19827852` - the base this branch was rebased onto when round 1 shot it, and the
last base whose About path is still Electron's `about` role, which is the fact
the frame is evidence about - and `frames/after-identity.png` is this change's own
code as it stood at `2d6665924`, the remediation round's own head (`fix(menu):
install the app's own menu before the ready handler awaits anything`). That commit
is a pre-fold spelling that only the clone which shot the frames resolves - the
reflog kept it and no ref does - so what it is named FOR is stated as the blobs it
carries: this tree's two frame blobs, and a `src/main/window-mode.ts` blob-identical
to the one the two review rounds read (`141bfbc8d`). Both are durable, because the
reachable spelling of that commit, `f341feef2` in the lineage `main` carries, is
where those frame blobs and that `window-mode.ts` land. The tree that
frame was captured from is not the tree this branch's head carries, because `main`
moved twice underneath it; what is evidence about is unchanged by that:
`configureAboutPanel` and `createApplicationMenu` (the registration and the Darwin
App menu item) extract byte-identical from `src/main/index.ts` on both trees,
`resolveAboutPanelAction` in `src/main/window-mode.ts` with them, and the only
difference in those two files between the capture tree and this head is `main`'s
own folded-in work in `src/main/index.ts` - 87 lines of it, none of them in the
path the frame photographs - plus this follow-up's correction to one comment on
`resolveAboutPanelAction`, which moves no code. The manifest's `about-panel` entry
names that same commit. Neither is a mock and neither is the app photographing
itself: the About panel is AppKit's window, so it is photographed from outside,
window-only, with `screencapture -l` (never the screen) while the app raised it in
`inactive` mode. Both runs are
UNPACKAGED, which is the case that used to read Electron's identity; what a
packaged build's panel reads is under *Residual*.

## What changed

- **The panel's identity is registered** (`configureAboutPanel` in
  `src/main/index.ts`): `applicationName` is the app's own name, the version is
  the app's own version, the parenthesised build string names the desktop host
  and whether the bundle is the shipped one, and `copyright` is read from
  `package.json`'s `build.copyright` - the one place the project states it, and
  the string electron-builder stamps into a packaged bundle. Without this
  registration an unpackaged run says `44.3.0` twice and names Electron. That
  build string is the one variable-length line in a panel whose width is not
  content-driven: both panels are exactly `284pt` wide (568px in these frames,
  which are 2x) although their widest line grew from 220px to 431px, and the
  widest line now IS this one - its ink runs 431 of the panel's 568px, with 67px
  clear on the left and 70px on the right (≈33.5pt / 35pt of slack). That slack is the whole budget a
  longer host string spends, so a three-digit Electron major, or a word longer than
  `unpackaged`, clips before anything else on the panel does. Measured on the
  committed frame rather than assumed, because the string least able to afford
  clipping should not be the first to discover the panel's edge.
- **The action is gated by the launch's resolved window mode**
  (`resolveAboutPanelAction` in `src/main/window-mode.ts`): `headless` logs
  `[about-panel] suppressed by window mode headless: a headless run raises no
  window` and raises nothing; `inactive` and `normal` raise the panel. The menu
  item therefore carries a handler of its own instead of Electron's `about` role,
  whose click is AppKit's `orderFrontStandardAboutPanel:` and cannot be
  intercepted at all.
- **The menu is installed before the ready handler awaits anything.** Until it is
  installed, Electron's DEFAULT application menu is live and its first item is
  `About Electron` carrying that same `about` role - a click no handler of ours is
  in. It used to sit below the backend startup, which is seconds of an
  agent-triggerable panel per launch; it now runs immediately after the smoke-test
  branch, above the launcher watch and every `await`.

## What was measured

Headless behaviour, from the shipped build (full run output quoted below):

```
== windows owned by this app BEFORE the action (the window server's own list; its onscreen flag is its answer per window):
   {"id": 38322, "pid": 72867, "owner": "Electron", "name": "Local Operator", "layer": 0, "onscreen": false, "alpha": 1065353216, "bounds": {"x": 174, "y": 109, "w": 1380, "h": 900}}
== app identity (its own answer): name=Local Operator version=0.27.0 electron=44.3.0 packaged=false
== About menu entries: Local Operator > About Local Operator [role=none] click=function
== active before the action: false; windows: [{"visible":false,"focused":false,"focusable":false,"size":[1380,900]}]
== invoked: Local Operator > About Local Operator via the item's own click handler - called
== active after the action: false; windows: [{"visible":false,"focused":false,"focusable":false,"size":[1380,900]}]
== driver: mode=headless appPid=72867 scratch=/tmp/about-panel/after-headless
== windows owned by this app AFTER the action:
   {"id": 38322, "pid": 72867, "owner": "Electron", "name": "Local Operator", "layer": 0, "onscreen": false, "alpha": 1065353216, "bounds": {"x": 174, "y": 109, "w": 1380, "h": 900}}
== the window server's ON-SCREEN set for this pid: (none)
== the action created no window: nothing reached the screen
== the app's own line about the action:
   00:57:23.025 › [about-panel] suppressed by window mode headless: a headless run raises no window
== this app was the frontmost application in 0 of 33 samples (pid 72867)
== the app's lines about the launch:
   [window-mode] window mode headless: 1380x900, window created and never shown, page throttling off, no Dock tile
   00:57:17.422 › [window-mode] headless run already detached (no launcher to outlive)
   [window-mode] headless run already detached (no launcher to outlive)
   [window-mode] state: visible=false focused=false focusable=false size=1380x900 content=1380x868
   00:57:23.025 › [about-panel] suppressed by window mode headless: a headless run raises no window
== processes left from this run: 0
```

Two facts about that output, because they decide what it is evidence FOR:

- **The invocation is not a menu click.** `harness/drive.mjs` calls the About
  ITEM's own click handler in the app's main process, over the Node inspector the
  rig launches the app with. A real menu click is impossible here for the reason
  the whole change is about: on macOS a menu belongs to the ACTIVE app, so
  driving one means activating the app, which is the interruption these rigs
  exist to avoid. Calling the item's handler is the same code path the menu
  takes, without the activation.
- **"No window" is a read, not an absence.** The census is the window server's
  own answer for that run's pid: the headless run's window is right there in it,
  and the action adds no second one. The rig computes the difference over the
  FULL list rather than the on-screen set, because the on-screen set is empty for
  a background app whenever the display is asleep - measured on this machine, and
  reported separately on its own line - and a difference over it would read "the
  action created nothing" for the wrong reason.

The identity pair, from the same rig in `inactive` mode (the one mode that shows
the panel, and the mode whose promise is that the app is never activated):

```
== windows owned by this app BEFORE the action:
   {"id": 38270, "pid": 53022, "owner": "Electron", "name": "Local Operator", "layer": 0, "onscreen": false, "alpha": 1065353216, "bounds": {"x": 464, "y": 259, "w": 800, "h": 600}}
== app identity (its own answer): name=Local Operator version=0.27.0 electron=44.3.0 packaged=false
== About menu entries: Local Operator > About Local Operator [role=none] click=function
== active before the action: false; windows: [{"visible":true,"focused":false,"focusable":true,"size":[800,600]}]
== invoked: Local Operator > About Local Operator via the item's own click handler - called
== active after the action: false; windows: [{"visible":true,"focused":false,"focusable":true,"size":[800,600]}]
== driver: mode=inactive appPid=53022 scratch=/tmp/about-panel/after-identity
== windows owned by this app AFTER the action:
   {"id": 38271, "pid": 53022, "owner": "Electron", "name": "", "layer": 0, "onscreen": false, "alpha": 1065353216, "bounds": {"x": 722, "y": 211, "w": 284, "h": 191}}
   {"id": 38270, "pid": 53022, "owner": "Electron", "name": "Local Operator", "layer": 0, "onscreen": false, "alpha": 1065353216, "bounds": {"x": 464, "y": 259, "w": 800, "h": 600}}
== the window server's ON-SCREEN set for this pid: (none)
== captured the window this action created (id 38271) to /tmp/about-panel/after-identity/frames/after-identity.png
== this app was the frontmost application in 0 of 30 samples (pid 53022)
== the app's own lines about the launch and this action:
   [window-mode] window mode inactive: 800x600, window shown without activating the app, page throttling off
   00:53:53.541 › [window-mode] window mode inactive is not launcher-bound: a person can close it
   [window-mode] window mode inactive is not launcher-bound: a person can close it
   [window-mode] state: visible=true focused=false focusable=true size=800x600 content=800x568
== processes left from this run: 0
```

`app.isActive()` stays false and the frontmost pid never moves: raising the panel
does not activate the app, which is why `inactive` may raise it and `headless` may
not. The `before` frame was taken the same way against the base tree, with one
difference the rig prints itself: an item that is still Electron's ROLE has no
handler of ours to call, so that run raises the panel through
`app.showAboutPanel()` - the call the role makes. That run's panel is `284x170`;
the one this change makes is `284x191`, the 21pt of the copyright line.

## How to re-derive

`pnpm build` first, and a tree without a `.env` needs four variables exported or
the build dies before compilation with `Error: VITE_GOOGLE_CLIENT_ID is not set`
- `scripts/vite-plugins/replace-backend-config.ts` refuses to build without all
four, and an empty value is refused too. The values are inert placeholders; no
credential is created or read, and no sign-in is claimed:

```bash
export VITE_GOOGLE_CLIENT_ID=evidence-build-only-not-a-credential \
       VITE_GOOGLE_CLIENT_SECRET=evidence-build-only-not-a-credential \
       VITE_MICROSOFT_CLIENT_ID=evidence-build-only-not-a-credential \
       VITE_MICROSOFT_TENANT_ID=evidence-build-only-not-a-credential
pnpm build
```
== windows owned by this app BEFORE the action:
   {"id": 38270, "pid": 53022, "owner": "Electron", "name": "Local Operator", "layer": 0, "onscreen": false, "alpha": 1065353216, "bounds": {"x": 464, "y": 259, "w": 800, "h": 600}}
== app identity (its own answer): name=Local Operator version=0.27.0 electron=44.3.0 packaged=false
== About menu entries: Local Operator > About Local Operator [role=none] click=function
== active before the action: false; windows: [{"visible":true,"focused":false,"focusable":true,"size":[800,600]}]
== invoked: Local Operator > About Local Operator via the item's own click handler - called
== active after the action: false; windows: [{"visible":true,"focused":false,"focusable":true,"size":[800,600]}]
== driver: mode=inactive appPid=53022 scratch=/tmp/about-panel/after-identity
== windows owned by this app AFTER the action:
   {"id": 38271, "pid": 53022, "owner": "Electron", "name": "", "layer": 0, "onscreen": false, "alpha": 1065353216, "bounds": {"x": 722, "y": 211, "w": 284, "h": 191}}
   {"id": 38270, "pid": 53022, "owner": "Electron", "name": "Local Operator", "layer": 0, "onscreen": false, "alpha": 1065353216, "bounds": {"x": 464, "y": 259, "w": 800, "h": 600}}
== the window server's ON-SCREEN set for this pid: (none)
== captured the window this action created (id 38271) to /tmp/about-panel/after-identity/frames/after-identity.png
== this app was the frontmost application in 0 of 30 samples (pid 53022)
== the app's own lines about the launch and this action:
   [window-mode] window mode inactive: 800x600, window shown without activating the app, page throttling off
   00:53:53.541 › [window-mode] window mode inactive is not launcher-bound: a person can close it
   [window-mode] window mode inactive is not launcher-bound: a person can close it
   [window-mode] state: visible=true focused=false focusable=true size=800x600 content=800x568
== processes left from this run: 0
```bash
# The behaviour half. Headless only, nothing on screen, no capture.
bash docs/evidence/about-panel/harness/run.sh . after-headless

# The identity half. THE ONLY RIG HERE THAT SHOWS ANYTHING: one instance, opt-in,
# capture and teardown in the same command, under an EXIT trap.
ABOUT_PANEL_VISIBLE_CAPTURE=1 timeout 100 bash docs/evidence/about-panel/harness/identity.sh . after-identity
```

Run `identity.sh` against a tree built at the base for the `before` frame and
against the branch head for the `after` one; use a label that says which, and give
the base tree no further use - it is deleted once its frame is taken.

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

- **The panel's icon is still Electron's in an unpackaged run, and this change
  could not reach it.** The reviewer's route was `app.dock.setIcon`, which sets
  `NSApplication.applicationIconImage`; measured with that call in place and
  logged (`[app-icon] drawing the app's own icon from
  .../build/icon-1024x1024.png`, the file verified as the app's own art), the
  panel still drew Electron's atom - the icon region of the re-shot frame is
  pixel-identical to the same head WITHOUT the call (RMSE 174/65535 over 170x170
  px, i.e. antialiasing noise, with the frames agreeing everywhere else). So on
  this host an unpackaged process cannot give the About panel an icon: the panel
  is drawn from the launching bundle, which for an unpackaged run is
  Electron.app. That call is not in the change for that reason - an inert call
  that looks like a fix is worse than the paragraph that says so. What was NOT
  measured: whether the Dock TILE would move, which needs a visible run and is
  not what the finding was about.
- **A packaged build's panel is unevidenced.** Both frames are unpackaged runs. A
  packaged build carries the app's own name, version and copyright in its bundle,
  and the three strings this registration sets from them - `applicationName`,
  `applicationVersion` and `copyright` - are the same strings, so those agree with
  the bundle. The BUILD string is the one that does not: `app.isPackaged` IS
  consulted, at the `version:` line of `configureAboutPanel`, and its only job is
  to drop the `, unpackaged` marker, so a shipped panel renders `Version 0.27.0
  (Electron 44.3.0)` - this app's own runtime version and the desktop host, on the
  user-facing surface, rather than a value read out of the bundle. That is
  intended and it is the answer to the review's question about the packaged
  string, recorded here because the code and this paragraph used to disagree about
  it. It is not photographed because a packaged build is not possible on this
  machine tonight - the disk is at 99% and `electron-builder` needs several GB - so
  what a packaged panel reads is an argument from where its values come from, not a
  picture.
- **The copyright line's year is `© 2025`**, straight from
  `package.json`'s `build.copyright`, and it will read that in 2026 until the
  field is bumped. Left alone here: it is the project's own string, and changing
  it is a decision about the project's copyright notice rather than about this
  panel.
