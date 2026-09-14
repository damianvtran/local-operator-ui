# The settings server-version row, in the five states discovery can leave it in

The reported defect was the row this set photographs. Settings' "Server version"
printed `Unavailable` (or named a *different* install than the one serving) while
a daemon was up and answering, and the mechanism was that the renderer decided
liveness itself: it fetched `/health` from the packaged app's `file://` document,
so a CORS or allowlist decision on the daemon's side became "the server is down",
and whichever of the machine's daemons the probe happened to reach was the one
the number described.

The change makes MAIN the source of the signal. Main sends no Origin, holds the
bearer, and is the only process that knows whether the daemon it attached to is
still that daemon, so the row is filled from `window.api.backend.getStatus()` and
kept fresh from `onStatusChange`. The pre-bridge `/health` probe survives only as
the fallback for a host with no bridge at all (Storybook, a plain browser dev
server).

## What produced these frames

**Storybook on the branch's own tree, driven by `scripts/capture-evidence.mjs`.**
The five states cannot be asked for on demand in the live app: `detached` needs a
real daemon to exit, `degraded` needs two probes to fail on a live one, and
`connecting` exists only between mount and the first probe. A fixture is therefore
the only instrument that reaches all five in one sitting, and
`app-updates-section.stories.tsx` exists to be that fixture — it stubs
`window.api.backend` with a snapshot and restores it on unmount, and the stories
are in the sweep's `STORIES` list so the surface is reviewed by every future pass
rather than only by this one.

```
node node_modules/storybook/bin/index.cjs dev -p 6031 --ci --quiet
node scripts/capture-evidence.mjs http://localhost:6031 \
  --only=settings-app-updates-and-info \
  --themes=localOperatorDark,localOperatorLight --allow-backend
```

`--allow-backend` is stated rather than implied: the operator's machine has
daemons running, nothing in this run talks to one (every story replaces the
bridge), and `capture-evidence.mjs` otherwise refuses to run at all while an
origin answers. Two consecutive runs of that command produced frames that are
**byte-identical** — the md5s quoted below are from the second run and match the
first, ten for ten, which is what makes a re-take comparable rather than merely
similar.

Sized to the section rather than to a window: 980x320, in which the content
occupies `948x184+8+8` (`magick -trim`). At the app's shipped 1380x800 the section
would sit on ~95% empty ground — inside `check-evidence`'s 98.5% uniformity
ceiling, but in the band its two nearest legitimate frames occupy, and a frame
that is mostly page says nothing about the row it exists for.

## The readback

| state | `Server version` prints | source of the string |
| --- | --- | --- |
| `attached-to-discovered-daemon` | `0.54.47` | main's snapshot, `state: attached` |
| `degraded-daemon` | `0.54.47` | main's snapshot, `state: degraded`, 2 failed probes |
| `detached-daemon` | `Unavailable` | main's snapshot, `state: detached` |
| `before-first-probe` | `Loading...` | main's snapshot, `state: connecting` |
| `no-bridge` | `Unavailable` | the fallback probe's catch branch — no `window.api.backend` at all |

Only THREE distinct pictures exist among the ten frames, and the two identities
are the claims rather than a defect:

- `degraded-daemon` is byte-identical to `attached-to-discovered-daemon`: the pair
  shares `7738c3e245421a87341a222741f99afe` dark and
  `d3d018930e85894785fb6a68fe13cea4` light. That identity IS "a degraded daemon does not blank the row": two missed
  probes move the connection's state, not the number, and the row is deliberately
  not given a degraded marker of its own (`isServerReachable` keeps every query
  enabled for `degraded`).
- `detached-daemon` is byte-identical to `no-bridge`
  (`8eb57fa5f757820a89d3b819176b3d0c` dark / `a3c8dfd5b44901ff383222f0d74c0529`
  light). Both reach `Unavailable`, from two different paths — a `detached`
  snapshot, and the fallback probe failing. The pre-change app could not tell
  those two apart either, which is the reported confusion stated as a picture.
- `before-first-probe` has its own bytes in both palettes
  (`676afff19376e7c723fc22153ba3c0ef` dark, `e8cf63c4426331ca6a10ee6c21cfb6f3`
  light).

The other values in the frame — `1.0.0` for the application version, `darwin
(x64)`, Node and Electron — come from the Storybook preview's own `systemInfo`
stub and are not evidence about anything this change touches.

## What these frames do not prove

- **Not a live daemon, and not the packaged app.** The bridge is a stub, so the
  frames cannot show that main's discovery found the right daemon; they show what
  the row prints for each snapshot main can produce. The runtime half is
  `scripts/daemon-discovery-evidence.mjs`, which drives the shipped modules
  against real `lop serve` daemons and prints what it found.
- **Not the exact reported failure.** The interesting case is a *healthy* daemon
  refusing a browser-origin request, and no frame here photographs that: nothing
  was listening on the fallback's configured origin (port 1111) when this set was
  taken, so `no-bridge` shows the fallback's refusal branch reached by a refused
  connection. A still cannot show the difference between "the probe failed" and
  "the daemon is down" — that difference is the one the change removes from the
  renderer's decision, and it is pinned by `scripts/daemon-health-state.test.mjs`
  and by main's side of the IPC, not by a picture.
- **Not the `onStatusChange` push.** A still cannot show a row that updates while
  a window stays open; the story deliberately pushes nothing
  (`onStatusChange: () => () => {}`) so the frame is a function of the snapshot
  rather than of when it was taken.

## Re-taking the set

The command above is the whole procedure; the frames land in this directory, and
the manifest is updated by the capturer's narrowed-run path (`frames` and
`surfaces` grow by ten and five, `partialCapture` records the run). Delete this
directory before re-running if the capture is meant to be counted as a new
surface: a frame that already exists is not an addition, and the manifest's
arithmetic distinguishes the two by exactly that.
