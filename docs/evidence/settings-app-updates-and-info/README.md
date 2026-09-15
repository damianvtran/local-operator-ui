# The settings server-version row, in every state discovery can leave it in

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
The states cannot be asked for on demand in the live app: `detached` needs a real
daemon to exit, `degraded` needs two probes to fail on a live one, `wedged` needs
a daemon whose heartbeat stopped while its process lives, and `connecting` exists
only between mount and the first probe. A fixture is therefore the only
instrument that reaches all of them in one sitting, and
`app-updates-and-info.stories.tsx` exists to be that fixture — it stubs
`window.api.backend` with a snapshot and restores it on unmount, and the stories
are in the sweep's `STORIES` list so the surface is reviewed by every future pass
rather than only by this one.

```
node node_modules/storybook/bin/index.cjs dev -p <port> --ci --quiet
node scripts/capture-evidence.mjs http://localhost:<port> \
  --only=settings-app-updates-and-info \
  --themes=localOperatorDark,localOperatorLight --allow-backend
```

`--allow-backend` is stated rather than implied: the operator's machine has
daemons running, nothing in this run talks to one (every story replaces the
bridge), and `capture-evidence.mjs` otherwise refuses to run at all while an
origin answers.

`--only=settings-app-updates-and-info` matches this surface AND
`settings-app-updates-and-info-narrow`, so the wide and narrow frames in one run
came from the same command.

Sized to the section rather than to a window: 980x320, in which the content
occupies `948x192+8+8` (`magick <frame> -trim -format '%wx%h%O' info:`; 184
before this round, 192 now that the row's value carries the daemon's address and
`degraded` carries its state word on a third line). At the app's shipped 1380x800 the section
would sit on ~95% empty ground — inside `check-evidence`'s 98.5% uniformity
ceiling, but in the band its two nearest legitimate frames occupy, and a frame
that is mostly page says nothing about the row it exists for. The narrow surface
next door is 620x360 and is the frame that proves the grid reflows.

## The readback

| state | `Server version` prints | source of the string |
| --- | --- | --- |
| `attached-to-discovered-daemon` | `0.54.47 · 127.0.0.1:7341` | main's snapshot, `state: attached` |
| `owned-daemon` | `0.54.47 · 127.0.0.1:7341` | the daemon THIS APP started — the state the first review round's MAJOR finding was about |
| `replaced-daemon` | `0.54.47 · 127.0.0.1:55001` | a successor this app started for a daemon it owned |
| `degraded-daemon` | `0.54.47 · 127.0.0.1:7341` + `Not answering` | main's snapshot, `state: degraded`, 2 failed probes |
| `attached-without-version` | `Version unknown` | a live connection whose daemon publishes no version |
| `wedged-daemon` | `Not attached` | a daemon that is running and that this app did not attach to |
| `detached-daemon` | `Not connected` | main's snapshot, `state: detached` |
| `before-first-probe` | `Loading...` | main's snapshot, `state: connecting` |
| `no-bridge` | `Unavailable` | the fallback probe's catch branch — no `window.api.backend` at all |

Two of these strings are new in this round and one of them is now *only* the
fallback's: `detached` said `Unavailable` before, which is the same word a host
with no bridge to ask prints — one string, two facts (lost server / this host
cannot ask anyone). `Unavailable` is now reserved for the second, and
`Unknown (update required)` is gone entirely: a serve record may simply omit
`version`, so that string asserted a remedy nothing had established, and
recommending an update is the update control's job rather than this row's.

## What the frames show, measured

Ten stories, two palettes. Five of the ten are new in this round (the four states
above plus the hover), and the value of every row changed, so the whole set was
re-taken rather than patched.

- `degraded-daemon` is no longer byte-identical to `attached-to-discovered-daemon`
  (`c30ba64a…` vs `b02ac7e0…` dark, `ade8b74a…` vs `2f4c3eca…` light). Round 1's
  D4 finding: two of three probes had failed and no surface said so. The state is
  now visible twice — the value steps to `text-ink-muted` and a third line reads
  `Not answering`.
- `owned-daemon` IS byte-identical to `attached-to-discovered-daemon`
  (`b02ac7e0…` dark, `2f4c3eca…` light), and that identity is the claim rather
  than a defect: the row prints a version and an address where the round-1 MAJOR
  finding had it printing `Unknown (update required)` for a backend the app had
  started seconds ago. `owned` is not a thing this row renders — it is a thing
  main now reports, and `scripts/daemon-discovery-evidence.mjs` is where a real
  spawn is shown reaching it.
- `detached-daemon` is no longer byte-identical to `no-bridge`
  (`f2bb1006…` vs `8eb57fa5…` dark). It prints `Not connected`; `no-bridge` still
  prints `Unavailable`, and those bytes are unchanged (`8eb57fa5…` / `a3c8dfd5…`)
  from every earlier pass — which is also why the baseline set's identity claim
  below had to be corrected rather than carried.
- `before-first-probe` keeps its own bytes in both palettes
  (`676afff1…` dark, `e8cf63c4…` light).
- `value-hover` is the same frame as `attached-to-discovered-daemon` with the
  pointer on the value (`de57134a…` dark, `b1caacc5…` light): it shows the
  tooltip that carries main's own sentence — `Connected to the daemon on
  http://127.0.0.1:7341 (pid 4242, v0.54.47).` That is D1's attribution half, and
  it needs the rig's `hoverSettleMs`: a tooltip opens on the shared
  `TooltipProvider`'s 400 ms delay, so a frame taken on the next paint would have
  been the unopened state under a name that claims the tooltip.

The other values in the frame — `1.0.0` for the application version, `darwin
(x64)`, Node and Electron — come from the Storybook preview's own `systemInfo`
stub and are not evidence about anything this change touches.

**Reproducible, and it took a fix to be.** Two consecutive runs at this head
produce all 26 frames byte for byte (the md5s above are from the last one). That
was NOT true of the first capture: `degraded-daemon` came back with two different
hashes on two runs of the same tree. The cause was the rig, not the row — a
`{ hover }` entry moves the real pointer for its own frame and nothing moved it
back, so the next story loaded with the pointer already inside the row's value,
where a tooltip opens after 400 ms. `capture-evidence.mjs` now parks the pointer
at the bottom-right of the requested viewport before every navigation (commit
`f44da7f73`), and this paragraph is the measurement of that fix. It is also why
`value-hover` can be taken at all: the same pointer, aimed deliberately, is what
opens the tooltip that frame exists for.

## The pair, and what it measures

`docs/evidence/settings-app-updates-and-info-baseline/` is the SAME five states,
the same two palettes and the same viewport, photographed on a detached worktree
of unmodified `origin/main` at `a8f6bc4b9` with only the stories file and the
`shared/backend-status.ts` type module copied in — the component in those frames
is `main`'s own `AppUpdatesSection`, the one that decided liveness with its own
`/health` fetch. Its declaration in the manifest carries the full recipe.

The measurement is arithmetic rather than visual, which is why it is worth
stating exactly:

- **All ten baseline frames are byte-identical** —
  `8eb57fa5f757820a89d3b819176b3d0c` dark, `a3c8dfd5b44901ff383222f0d74c0529`
  light. Before this change the row printed the same bytes for a serving daemon,
  a degraded one, a detached one, a not-yet-probed one, and a host with no bridge
  at all.
- **Those bytes are this set's `no-bridge` frames** and nothing else
  (`8eb57fa5…` / `a3c8dfd5…`, unchanged since the first pass). The baseline is a
  capture of a tree where the fallback probe was the only probe, so its
  `Unavailable` is the fallback's own answer — which is why that string is still
  reachable here and why `detached`, which used to share it byte for byte, does
  not any more.
- Before this change the row could not distinguish a live server from no server,
  because the number it printed came from a probe the renderer made itself and
  never from the daemon main was attached to. After it, the same five states
  produce the strings in the readback table above, and `degraded` no longer looks
  like `attached`.

## What these frames do not prove

- **Not a live daemon, and not the packaged app.** The bridge is a stub, so the
  frames cannot show that main's discovery found the right daemon; they show what
  the row prints for each snapshot main can produce. The runtime half is
  `scripts/daemon-discovery-evidence.mjs`, which drives the shipped modules
  against real `lop serve` daemons — including the fixed-port spawn this round
  fixed — and prints what it found.
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
- **Not the Retry.** The banner's Retry now asks main to re-discover over IPC
  (`backend.reconnect()`), and a settings still has no control of its own. The
  verb's own evidence is that it exists and returns a snapshot; the click is not
  photographed in this set.

## Re-taking the set

The command above is the whole procedure; the frames land in this directory, and
the manifest is updated by the capturer's narrowed-run path. Delete this
directory before re-running if the capture is meant to be counted as a new
surface: a frame that already exists is not an addition, and the manifest's
arithmetic distinguishes the two by exactly that.
