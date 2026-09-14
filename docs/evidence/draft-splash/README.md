# The composer band on a New chat, before and after

The operator's report: "the skeleton loader seems to be stuck on new chats …
instead of showing the normal splash composer visuals". On a fresh **New chat**
the band rendered the hydration skeleton and its `Loading conversation…` line
permanently, in place of `What can I help you with today?` and the suggestion
chips.

The cause was one read. The composer was gated on
`!canonical.view.hydrated` (`chat-content.tsx`), and a New chat is a staged
**draft**: `chat-page.tsx` calls `useCanonicalSessionStream(undefined, false)`,
the hook's effect returns before subscribing (`if (!sessionId || !enabled)
return`), and no page can ever be applied to a pane that has no session. So
`hydrated` stayed `false` for as long as the pane was open, and the band was told
"still loading" forever — the one state in which it may show neither the greeting
nor a transcript (design D22).

## What produced these frames

**The shipped `ChatPage`, in a browser, against a real backend — driven by this
repository's OWN capture instrument over raw CDP.** Not Storybook, and not the
app's Electron window.

- `scripts/draft-splash-evidence.vite.mjs` serves
  `scripts/draft-splash-evidence.html`, which mounts the shipped `ChatPage`
  under a minimal shell (`QueryClientProvider`, the app's own `ThemeProvider`,
  `MemoryRouter`) plus the three `window.api` / `window.electron` shims the app
  needs to mount in a browser at all (all three sites are byte-identical on
  `origin/main`; none is on the path under test). The config carries
  `desktopProxyPlugin()` — the same plugin `electron.vite.config.js` registers —
  so the shipped `desktopRequest` takes its same-origin `/__desktop` branch
  (`desktop-api.ts:62-82`), a path the product already ships for browser
  development rather than a harness fork of it.
- Behind that proxy is a real `local-operator serve` with a throwaway
  `LOCAL_OPERATOR_CONFIG_DIR`, `hosting: test` / `model_name: mock`, on its own
  port and with its own `LOCAL_OPERATOR_DESKTOP_TOKEN`, so no tokens are spent
  and the operator's config and sessions are never touched. The token and the
  backend URL are read by the Vite process and never reach the page.
- `scripts/draft-splash-capture.mjs` drives a **private headless Chrome over raw
  CDP** (a temp `--user-data-dir`, `--headless=new`, the already-installed Chrome
  binary, the built-in WebSocket): the mechanism `scripts/capture-evidence.mjs`
  and `scripts/diff-body-evidence.mjs` already use for this repository's
  committed evidence. Nothing is downloaded, no browser-automation dependency is
  added, and no login is involved — the page is a localhost harness talking to a
  throwaway backend.

**Why this instrument and not the browser tool.** The operator's own browser
bridge was unavailable at capture time: `lop browser status` reported
`extension connected: no` (`paired, not connected` for both installs — the
extension's service worker asleep with its Chrome having run since 07:21), the
cmux socket at `~/.local/state/cmux/cmux.sock` did not exist, so the `browser`
tool had no backend at all, and `lop browser drive` refuses with "open its
browser". The standing rule that a page is driven in the operator's OWN browser
exists because a throwaway browser cannot hold a real login; a localhost harness
page against a throwaway backend holds none, which is why the repository's own
existing capture mechanism was used rather than a second browser stack. It is
disclosed here, in each `readback-*.json` (`instrument`) and in the manifest's
`source` so no reader mistakes these frames for frames of the live app window.

**Two worktrees at once, one backend each.** `--label=after` is the branch head;
`--label=before` is a worktree at `ef40c81e2` (`origin/main` at capture time)
with the same harness files copied in, and `--label=after` is the branch head.
The backend is **restarted with a fresh
config dir between the two runs**, because the capture's own send step creates a
session and a catalogue that still held it would show up in the second tree's
sidebar — the pair is meant to differ by the change alone, and now does. Each run
took the frames at the app's default window size: `DEFAULT_WINDOW_WIDTH/HEIGHT`
= 1380x900 (`src/main/window-mode.ts`), whose CSS viewport is 1380x872 once the
macOS title bar is taken off.

The harness publishes its own readback in `#probe` (`window.__draftSplashMarker`
for the echo check, `window.__draftSplashChipList` parsed from the product), and
the driver reads it three times per state: at the settled draft, at the click of
Send, and immediately after the flip's shutter. That readback is what the frames
are checked against — the run FAILS rather than publishing when an error surface
is on screen, when the draft state was never entered, when the band disagrees
with what the label says it should show, or when the admitted send never painted
a row.

## Before / after

| Frame | What it shows |
| --- | --- |
| [before-draft-1380x872-frame1.png](before-draft-1380x872-frame1.png), [-frame2.png](before-draft-1380x872-frame2.png) | The defect: a New chat settled with the hydration skeleton above the composer, no greeting and no chips. `readback-before.json` reads `greeting 0, skeleton 1, chips 0`, band height 768px. The two frames differ by 7,165 pixels inside the skeleton's own row — its shimmer moving — which is why the pair is here rather than one still. |
| [before-draft-band.png](before-draft-band.png) | The same band, clipped to its own box, for the close read. |
| [after-draft-1380x872-frame1.png](after-draft-1380x872-frame1.png), [-frame2.png](after-draft-1380x872-frame2.png) | The claim: the same state on the fixed tree — `What can I help you with today?`, the composer, and **7 suggestion chips** drawn from `DEFAULT_MESSAGE_SUGGESTIONS` (25 entries in `chat-content.tsx`; `message-input.tsx` samples `MAX_SUGGESTIONS = 7` of them at random, so the labels differ run to run and only the count and the membership are stable — both are asserted). `readback-after.json` reads `greeting 1, skeleton 0, chips 7`. These two consecutive frames are byte-identical in this run; when they differ, it is the caret blink at the composer's placeholder (17 pixels in a single `1x17` column, in an earlier pass), and nothing else in the frame moves. |
| [after-draft-band.png](after-draft-band.png) | The same band, clipped. |
| [before-send-after-flip.png](before-send-after-flip.png), [after-send-after-flip.png](after-send-after-flip.png) | The state just after the identity flip, read back immediately after the shutter: a real session whose page is owed. `bandAtFlipShot` caught `greeting 1, skeleton 0, chips 7` on both trees in this run — the post-flip state of an empty authoritative page, which both trees reach — so this pair carries nothing on its own and is kept as the record of what the shutter landed on. Whether the echo has painted by then is a race the frame does not claim to have won; the readback says which state it caught. |
| [after-send-first-painted.png](after-send-first-painted.png) | The first frame in which the admitted send is painted in the transcript, read from the harness's per-frame trace: the message is a row and the band shows no greeting, no skeleton and no chips. |
| [after-send-settled-frame1.png](after-send-settled-frame1.png), [-frame2.png](after-send-settled-frame2.png) | The settled conversation, two consecutive frames (byte-identical: nothing is still moving). |

## The numbers

From `readback-before.json` / `readback-after.json`, written by the same runs as
the frames beside them.

| Quantity | before | after |
| --- | --- | --- |
| band box (x, y, w, h) | 280, 104, 1100, 768 | 280, 104, 1100, 768 |
| settled band reading | greeting 0, skeleton 1, chips 0 | greeting 1, skeleton 0, chips 7 |
| draft frame1 vs frame2 | 7,165 px inside the skeleton's row (its shimmer) | identical md5 in this run |
| traced frames / frames with the echo painted | 39 / 13 | 38 / 18 |
| traced frames with a claim AND the echo painted | 0 | 0 |
| band reading when Send was clicked | greeting 0, skeleton 1, chips 0 | greeting 1, skeleton 0, chips 7 |

Two quantities move between runs and are reported per run rather than pinned.
The trace length is the harness's own mutation-driven sampling (43/17 in one
earlier pass, 39/13 here), and the fixed tree's two consecutive settled frames
differ only when the composer's caret blink happens to be in the first of them
(0 px in this run, 17 px in a `1x17` column in one earlier pass). The before
tree's pair always moves — the skeleton's shimmer, 7,165 px here and 7,148 px in
an earlier pass — which is the reason the pair is captured at all: a single
still could not show that the skeleton is animating rather than painted once.

**The pair differs only inside the band.** Measured with ImageMagick `compare`
over the two settled frames: 136,070 differing pixels, all of them inside the
band's own box — the sidebar region `280x872+0+0` and the pane's header region
`1100x104+280+0` are **identical (0 differing pixels)** — and the differing
pixels' bounding box is `908x286+376+343`, inside the band (`280,104 1100x768`).
The band box itself is identical on both trees, so the fix moves the band's
content and not the layout: nothing above or below it moved, and the column's
geometry is unchanged. (That zero is worth having rather than assuming: the
first pass of this set had the two runs' sidebars differing by 15,619 pixels of
hover wash, because the driver's own click left the pointer on a row. The driver
now parks the pointer on neutral ground before every shutter.)

**The admission flip, measured frame by frame rather than from stills.** The
harness records one reading per animation frame for as long as mutations keep
arriving, and the driver asserts the property over those frames: no traced frame
may carry the echo AND the greeting, the skeleton or the chips at once. 0 frames
did, in either tree, while 13 frames carried the echo on the before tree and 18
on the after tree — so the property was exercised rather than vacuously true.
Two of the one-frame states this rules out are worth naming, because neither is
visible in a pair of stills: a greeting painted over the row the user just sent,
and a skeleton painted over it. The trace also shows what the fix keeps honest in
the other direction: once the pane IS a real session with no page yet it waits,
as design D7 requires — which is why the band reading at the click of Send
(`bandAtSendClick`) is the one the fix moves, and the reading after the echo
paints is clean on both trees.

## What these frames do not prove

- **No Electron IPC hop and not the packaged build.** There is no main process
  here; `desktopRequest` reaches the backend by its `/__desktop` branch instead
  of `ipcRenderer`. The transport module, the store and the components are
  byte-identical either way — what differs is which of two shipped branches
  carries the bytes. This is a Vite dev server rendering the shipped components.
- **Not captured from the operator's browser or from the app window.** See the
  instrument note above: the frames come from a private headless Chrome driven
  over CDP. Nothing here is a picture of the live app's own window, and nothing
  here exercised a real login.
- **One theme and one window size** (`localOperatorDark`, 1380x872 CSS). The
  light palettes and other sizes are not photographed; the band's classes are
  theme-independent and the small-view branch (`isSmallView`) is untouched by the
  change, but that is an argument rather than a frame.
- **The `isSmallView` behaviour is unchanged by construction, not by frame.**
  Both branches of the band are gated on `!isSmallView` and the change only
  alters which of them is taken when there IS no session.
- **No paint timing.** These are stills plus a DOM-read trace; the trace's clock
  is the harness's own `performance.now()`, not a compositor timeline.

## Re-capturing

The two trees are served at once and photographed side by side:

```sh
ROOT=$(mktemp -d /tmp/lo-draft-splash-XXXXXX)
PORT=8111
TOKEN=$(openssl rand -hex 32)
printf 'version: 0.0.0\nvalues:\n  hosting: test\n  model_name: mock\n' > "$ROOT/config.yml"
# Scrub inherited cmux vars: an inherited CMUX_WORKSPACE_ID has renamed real
# workspaces before.
for n in $(env | sed -n 's/^\(CMUX_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "$n"; done
HOME="$ROOT" LOCAL_OPERATOR_CONFIG_DIR="$ROOT" \
LOCAL_OPERATOR_DESKTOP_TOKEN="$TOKEN" \
  <path-to-a-warm-backend>/.venv/bin/local-operator serve --host 127.0.0.1 --port "$PORT" &

# BEFORE - a worktree at the merge-base, with the harness files copied in
cd <before-worktree>
cp <branch>/scripts/draft-splash-evidence.{html,css,tsx,vite.mjs} scripts/
cp <branch>/scripts/draft-splash-capture.mjs scripts/
LO_DRAFT_SPLASH_PORT=5212 LOCAL_OPERATOR_DESKTOP_TOKEN="$TOKEN" \
LOCAL_OPERATOR_DESKTOP_BACKEND_URL="http://127.0.0.1:$PORT" \
  node scripts/draft-splash-capture.mjs --label=before

# restart the backend on a fresh config dir, then:
# AFTER - the branch worktree, port 5210
LO_DRAFT_SPLASH_PORT=5210 ... node scripts/draft-splash-capture.mjs --label=after
```

Ports are `LO_DRAFT_SPLASH_PORT` (5204 in the config's default, 5210/5212 for
this set, so two trees can run at once and neither collides with the sibling
harnesses on 5199-5203 or with another session's). The driver starts and stops
its own Vite server, launches its own Chrome, and writes the frames and readbacks
into this directory; it fails loudly instead of publishing a degraded run.

## Where this set is declared

`draft-splash` is a declared `supplementary` set in
`docs/evidence/manifest.json`, at **0 frames** — which is the honest count for
its `.webp`-only tally (`check-evidence.mjs`'s `frames()` counts `.webp`; the
frames here are PNG, as `chat-shell`'s and `chat-shell-empty-centre`'s are).
It is declared rather than omitted because an undeclared directory is invisible
to `scripts/check-evidence.mjs`: the moment a `.webp` lands here without this
entry being updated, `onDisk !== set.frames` and the gate names this set.
Declaring it also puts the instrument and the reason on the record, which is what
the note above is for.
