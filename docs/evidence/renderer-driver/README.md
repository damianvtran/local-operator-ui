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
43a626a818d55456d1d87c133e35f6ac66b597d242ae8d1a64e5daf76b35340b  chat-dark.png    93231 B
bd7c93e17ed1ef163cc5711b949618b850caec2df1142a0336b341cc2e50cc6e  chat-light.png   92986 B
```

**This pair was RE-TAKEN, because the pair it replaced had gone stale.** The
frames first committed here were captured before `#177` (the browser tab) merged,
and that PR changed this very screen: the rail gained a `Browser` item between
`Schedules` and `Settings`, and the connectivity banner's sentence was rewritten.
Measured against the old pair at the merged head, `magick compare -metric AE`
reports **126,564 differing pixels** (2.64% of the frame) in `chat-dark.png` and
126,576 in `chat-light.png` — a rail entry and a banner sentence, not a rendering
wobble. A caption that still called those frames "the merged tree" would have been
wrong, so they were re-captured with the documented command at the merge that
brought `#177` in, and re-hashed above, rather than left standing.

Those hashes are worth comparing against a run of your own, **on the same
Electron version** — the version is printed by the run itself
(`electron 44.3.0 …`), asserted against the branch's pin before anything boots
(`[PASS] the harness is driving the Electron this branch pins`), and named here
because a hash without its runtime is not a checkable claim: 35.5.1 renders the
same window as a 1380x**872** viewport, so a 35.x capture cannot match these
bytes. An earlier revision of this pair was exactly that mistake — 35.x frames
with a README that told a reader on 44.3.0 to compare hashes against them — and
the run now **refuses before its first boot** on a runtime the branch does not
pin: `[refusing] this tree is not on the pinned runtime …`, exit 1, nothing
booted and no frame written. A worktree inheriting a stale shared `node_modules`
therefore cannot populate a frames directory at all, rather than populating one
it later disowns with an exit code.

### Which of these two hashes is checkable, and which is one of two

`chat-dark.png` is byte-stable: twelve `--scene states` runs taken while this pair
was being re-cut — six on the pre-hardening build and six on the shipped one, at
load averages of 96-124 — produced the same 93231 bytes every time.
`chat-light.png` is **not**, and the earlier sentence here ("two consecutive runs
produced identical bytes for both frames") generalised a two-run observation into
a claim a twelve-run measurement falsifies. Across those twelve runs the light
frame came out in two byte-forms: 92986 B (eight runs) and 92980 B (four), which
differ in **12 pixels** (`magick compare -metric AE`, 2.5e-6 of the frame)
confined to the rounded edges of the sidebar's search field and one glyph edge.
Both forms are the same screen in the same palette from the same build; neither is
a mid-transition frame, which is what the guards below are for — and neither is
root-caused here, so quote the dark hash if you want a claim that holds, and treat
the light one as one of two forms until somebody explains the twelve pixels.

The in-run guarantee is separate from that cross-run question, and this is what
the harness actually asserts, each half with a defect behind it from an earlier
round:

The harness does not leave that to `capturePage()` behaving itself — it asserts the
in-run half of it, and each half of the assertion has a defect behind it from an
earlier round:

- **The frame must be one the app is holding.** The theme verb waits out the
  rail's `transition-colors duration-fast` (120ms) and now requires three
  consecutive frames with no running `CSSTransition`; the scene then captures
  twice, 150ms apart, and commits the second capture only if the two are
  byte-identical. Measured before this: two runs on the pinned install differed
  in `chat-light.png` with the rail's active pill at `srgb(122,133,124)` — 46% of
  the way from the dark `srgb(26,40,30)` to the settled `srgb(233,241,233)` — in
  a run whose verb had answered `timedOut: false` after 175ms.

  **A settle that does not finish says which element did not settle.** The wait is
a count of frames, so its cost is a frame interval rather than a duration, and the
bound it gives up at was widened from 1000ms to 3000ms on that reasoning — ~20x the
150-167ms a settle actually took across twelve runs on this machine at load
averages of 96-124, and 25x the app's own longest transition. What it must not do
is give up silently, so the answer carries every transition still running, with its
target and that property's computed value at that instant. Fault-injected (bound set
to 1ms) to prove the text is reachable, the FAIL then reads:

  ```
  [FAIL] the theme change settled before the frame
          17ms — TIMED OUT: this frame is mid-transition and is not evidence.
          Still running when the bound expired: color on button "Retry" = rgb(123, 117, 106)
          | background-color on button "Retry" = rgb(165, 162, 156) | border-bottom-color on
          button "Retry" = rgb(132, 126, 111) | … | background-color on div "" = rgb(132, 126, 111)
  1 CHECK(S) FAILED
  ```

  Before that change the same FAIL said only `— TIMED OUT: this frame is
mid-transition and is not evidence`, which names no element and leaves a reader
unable to tell a never-ending animation from a busy machine. Seventeen transitions
were running 17ms into a theme change, which is the shape of the measurement that
set the bound.
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
[PASS] the scratch backend port is dead        127.0.0.1:55118 listening=false
[PASS] the armed launch said so on stdout
        [dev-driver] ARMED; frames are written to …
[PASS] the app's logs went to this run's scratch tree, not the operator's
        [2026-09-15 09:44:32.435] [info]  Log path: …/lo-renderer-driver-20303/logs
[PASS] the app holds no connection to the renderer's built API URL (http://127.0.0.1:1111)
        no connection
[PASS] the renderer reports this run's frames directory
[PASS] the renderer sees the built app, not a bare Vite page
        … LocalOperator/0.24.0 Chrome/152.0.7977.78 Electron/44.3.0 Safari/537.36
[PASS] window mode is headless
[PASS] the window is never shown            visible=false focused=false minimized=false
[PASS] the window never has focus
[PASS] the requested window size is the size that exists      1380x900
[PASS] the content area is smaller than the window by the platform's chrome only
        window {"width":1380,"height":900} content {"width":1380,"height":868}
[PASS] the theme change settled before the frame
        166ms
[PASS] the theme action changed the app's own theme state     localOperatorDark -> localOperatorLight
[PASS] the before/after pair is the same screen at the same size
[PASS] the before/after pair is two different renders, not one frame twice
        chat-dark.png 93231B 43a626a818d55456… vs chat-light.png 92986B bd7c93e17ed1ef16…
[PASS] the pressed control received the point (hit test)      button "Agent hub"
[PASS] pressing the rail's Agent hub button navigated the app
[PASS] pressing the rail's Chat button navigated back, and the theme survived
        {"route":"/chat","theme":"localOperatorLight",…}
[PASS] every capture is a frame the app held still for, with no toast on it
        chat-dark: held still after 2 capture(s), toast-free true, waited 8ms for toasts | chat-light: held still after 2 capture(s), toast-free true, waited 8ms for toasts | chat-light-returned: held still after 3 capture(s), toast-free true, waited 18ms for toasts
[PASS] every capture wrote a PNG of the requested size
        chat-dark: 2760x1736, 93231B | chat-light: 2760x1736, 92986B | chat-light-returned: 2760x1736, 92986B
[PASS] no process from this run outlived its boot
        0 processes matching lo-renderer-driver-20303
ALL CHECKS PASSED
```

The third capture in that line is the un-committed `chat-light-returned`, and it is
worth reading the toast wait as the one figure there that MOVES: 8ms and 18ms in
this run, and **4213ms** in an earlier one where the app's own
`List agents request failed: 503` toast arrived before that frame and the scene
waited it out instead of committing it (bound: 15s). That is why the frame is not
committed here — it is a state the scene reached, not a state it claims.

## What these frames do NOT show

The five limits a reader should know before quoting them:

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
- **`chat-light.png` is one of two byte-forms, not the bytes.** Twelve runs gave
  the light frame as 92986 B eight times and 92980 B four times, differing in 12
  pixels of edge antialiasing on the sidebar's search field; `chat-dark.png` was
  identical in all twelve. A reader comparing the light hash against a run should
  expect either form until somebody explains the twelve pixels — the subsection
  above carries the measurement.
- **Transient toasts are excluded by construction**, so these frames say nothing
  about toast styling or placement: the scene waits for the app's toasts to clear
  and discards a capture that has one, precisely because `List agents request
  failed: 503` appears on its own timing in a run with no backend. A review of a
  toast needs a scene that captures it deliberately.

These are live-app frames rather than Storybook captures, so the Storybook sweep
(`pnpm check-evidence`, which walks `.webp` under this root) does not cover them:
the same position as the repository's other committed live-app PNG sets.
