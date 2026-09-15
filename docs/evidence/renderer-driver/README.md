# Live proof: the built app's renderer, driven by an agent, captured by the app

Two frames of the **built** app's renderer, produced by
`node scripts/renderer-driver.mjs --scene states --out <dir>` — the supported
harness documented in `docs/agent-driver.md`. They are here because the harness's
first real use is exactly this shape: a visual change needs a before/after pair
of one screen, taken from the app the operator runs.

Both frames are `webContents.capturePage()` output from an armed, `headless`
launch: 2760x1736 pixels at devicePixelRatio 2 for a **1380x868** CSS viewport
(a 1380x900 window on macOS), on **Electron 44.3.0** — the version this branch
pins (`package.json` `optionalDependencies.electron`, which
`build.electronVersion` moves with, and the version `pnpm install
--frozen-lockfile` gives). The run reached no backend — its scratch `.env` points
the app at a port verified dead, which is why every frame here is safe to publish.

```
Electron 44.3.0
e68f3f6a94b00f289d919d02c507588dfa79fc62b8b38b070ba158fe351902ee  chat-dark.png    88656 B
e980ca494703fe44506a6384def29b27341f2cf996ec6a211e9d4efaf082fb50  chat-light.png   88323 B
```

Those hashes are worth comparing against a run of your own, **on the same
Electron version** — the version is printed by the run itself
(`electron 44.3.0 …`), asserted against the branch's pin before anything boots
(`[PASS] the harness is driving the Electron this branch pins`), and named here
because a hash without its runtime is not a checkable claim: 35.5.1 renders the
same window as a 1380x**872** viewport, so a 35.x capture cannot match these
bytes. An earlier revision of this pair was exactly that mistake — 35.x frames
with a README that told a reader on 44.3.0 to compare hashes against them — and
the run now fails rather than capturing on a runtime the branch does not pin,
which is why a worktree inheriting a stale shared `node_modules` cannot quietly
reproduce the defect.

On the pinned install the pair is byte-stable: two consecutive `--scene states`
runs produced identical bytes for **both** frames. That is not left to
`capturePage()` behaving itself — the harness asserts it, and each half of the
assertion has a defect behind it from an earlier round:

- **The frame must be one the app is holding.** The theme verb waits out the
  rail's `transition-colors duration-fast` (120ms) and now requires three
  consecutive frames with no running `CSSTransition`; the scene then captures
  twice, 150ms apart, and commits the second capture only if the two are
  byte-identical. Measured before this: two runs on the pinned install differed
  in `chat-light.png` with the rail's active pill at `srgb(122,133,124)` — 46% of
  the way from the dark `srgb(26,40,30)` to the settled `srgb(233,241,233)` — in
  a run whose verb had answered `timedOut: false` after 175ms.
- **The frame must have no transient banner on it.** A run has no backend, so the
  app raises its own error toast (`List agents request failed: 503`) on a clock
  that has nothing to do with the scene. Measured: two runs differed in the
  bottom-right corner by 2.1 % of pixels, one with that toast up. The scene waits
  for the app's toasts to clear and discards any capture with one on it, so these
  frames are a state a user reaches and not a screenshot of whatever happened to
  be animating.

The light half was worse than either of those before this round: it was captured
one `nextFrame()` after the theme action, so it caught the rail's transition
mid-flight and varied run to run (80963 B, 80225 B, 80995 B on three runs, the
whole difference inside the rail's active item). What is committed here is the
palette the app settles into, which `--scene states` also asserts by writing the
pair and checking that the two files on disk DIFFER — the check that would have
caught the earlier accident where `chat-light.png` was a byte copy of
`chat-dark.png`.

## What each frame shows

| frame | what it is |
| --- | --- |
| `chat-dark.png` | `/chat` in the default `localOperatorDark` palette, from a fresh scratch profile: the rail, the offline banner, and the chat list's own backend-error row with its `Retry`. |
| `chat-light.png` | The same screen, the same size, in `localOperatorLight` — the other half of the pair. The change was made through the app's own theme action (the one the settings picker and the `/theme` picker call), not by editing the DOM. |

The pair is the evidence the harness exists to produce: one screen, two renders,
and nothing else different between them that a reviewer has to explain away.

## The run's own output

The scene asserts as it goes and prints each check. From the run these frames
came from (`node scripts/renderer-driver.mjs --scene states --out <dir>`, 22
checks, all passing):

```
[PASS] the harness is driving the Electron this branch pins
        installed 44.3.0 …, pinned 44.3.0
[PASS] the app's logs went to this run's scratch tree, not the operator's
        [2026-09-15 03:00:50.479] [info]  Log path: …/lo-renderer-driver-…/logs
[PASS] the renderer reports this run's frames directory
[PASS] the renderer sees the built app, not a bare Vite page
[PASS] window mode is headless
[PASS] the window is never shown            visible=false focused=false minimized=false
[PASS] the window never has focus
[PASS] the requested window size is the size that exists      1380x900
[PASS] the content area is smaller than the window by the platform's chrome only
        window {"width":1380,"height":900} content {"width":1380,"height":868}
[PASS] the theme change settled before the frame
        163ms
[PASS] the theme action changed the app's own theme state     localOperatorDark -> localOperatorLight
[PASS] the before/after pair is the same screen at the same size
[PASS] the before/after pair is two different renders, not one frame twice
        chat-dark.png 88656B e68f3f6a94b00f28… vs chat-light.png 88323B e980ca494703fe44…
[PASS] the pressed control received the point (hit test)      button "Agent hub"
[PASS] pressing the rail's Agent hub button navigated the app
[PASS] pressing the rail's Chat button navigated back, and the theme survived
[PASS] every capture is a frame the app held still for, with no toast on it
        chat-dark: held still after 2 capture(s), toast-free true | chat-light: held still after 2 capture(s), toast-free true
[PASS] every capture wrote a PNG of the requested size
[PASS] no process from this run outlived its boot
        0 processes matching lo-renderer-driver-…
ALL CHECKS PASSED
```

## What these frames do NOT show

The four limits a reader should know before quoting them:

- **Focus-dependent rendering is absent.** A `headless` window is never shown and
  cannot be focused, so nothing here is evidence about `:focus`/`:focus-visible`
  rings, carets, or anything gated on `document.hasFocus()`.
- **The embedded browser's page is not in these frames at all** — it is a native
  `WebContentsView`, and a renderer capture does not include it. A browser-chrome
  review needs the page captured separately through the browser host's own
  `screenshot` RPC, and a single composed image has to be labelled as composed.
- **The run is not network-isolated.** It reaches no backend, but the app's own
  telemetry still leaves the machine during a run (`us.i.posthog.com`); the
  harness's isolation covers the operator's state — profile, config dir, log
  directory, backend URL — and not egress. `docs/agent-driver.md` states this
  where a reader will look for it.
- **Transient toasts are excluded by construction**, so these frames say nothing
  about toast styling or placement: the scene waits for the app's toasts to clear
  and discards a capture that has one, precisely because `List agents request
  failed: 503` appears on its own timing in a run with no backend. A review of a
  toast needs a scene that captures it deliberately.

These are live-app frames rather than Storybook captures, so the Storybook sweep
(`pnpm check-evidence`, which walks `.webp` under this root) does not cover them:
the same position as the repository's other committed live-app PNG sets.
