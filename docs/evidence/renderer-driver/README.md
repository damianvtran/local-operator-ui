# Live proof: the built app's renderer, driven by an agent, captured by the app

Two frames of the **built** app's renderer, produced by
`node scripts/renderer-driver.mjs --scene states --out <dir>` — the supported
harness documented in `docs/agent-driver.md`. They are here because the harness's
first real use is exactly this shape: a visual change needs a before/after pair
of one screen, taken from the app the operator runs.

Both frames are `webContents.capturePage()` output from an armed, `headless`
launch: 2760x1744 pixels at devicePixelRatio 2 for a 1380x872 CSS viewport
(a 1380x900 window on macOS). The run reached no backend — its scratch `.env`
points the app at a port verified dead, which is why every frame here is safe to
publish.

## What each frame shows

| frame | what it is |
| --- | --- |
| `chat-dark.png` | `/chat` in the default `localOperatorDark` palette, from a fresh scratch profile: the rail, the offline banner, and the chat list's own backend-error row with its `Retry`. |
| `chat-light.png` | The same screen, the same size, in `localOperatorLight` — the other half of the pair. The change was made through the app's own theme action (the one the settings picker and the `/theme` picker call), not by editing the DOM. |

The pair is the evidence the harness exists to produce: one screen, two renders,
and nothing else different between them that a reviewer has to explain away.

## The run's own output

The scene asserts as it goes and prints each check. From the run these frames
came from:

```
[PASS] the renderer reports this run's frames directory
[PASS] the renderer sees the built app, not a bare Vite page
[PASS] window mode is headless
[PASS] the window is never shown            visible=false focused=false minimized=false
[PASS] the window never has focus
[PASS] the requested window size is the size that exists      1380x900
[PASS] the content area is smaller than the window by the platform's chrome only
[PASS] the theme action changed the app's own theme state     localOperatorDark -> localOperatorLight
[PASS] the before/after pair is the same screen at the same size
[PASS] the pressed control received the point (hit test)      button "Agent hub"
[PASS] pressing the rail's Agent hub button navigated the app
[PASS] pressing the rail's Chat button navigated back, and the theme survived
[PASS] every capture wrote a PNG of the requested size
ALL CHECKS PASSED
```

## What these frames do NOT show

The two limits a reader should know before quoting them, both stated in full in
`docs/agent-driver.md`:

- **Focus-dependent rendering is absent.** A `headless` window is never shown and
  cannot be focused, so nothing here is evidence about `:focus`/`:focus-visible`
  rings, carets, or anything gated on `document.hasFocus()`.
- **The embedded browser's page is not in these frames at all** — it is a native
  `WebContentsView`, and a renderer capture does not include it. A browser-chrome
  review needs the page captured separately through the browser host's own
  `screenshot` RPC, and a single composed image has to be labelled as composed.

These are live-app frames rather than Storybook captures, so the Storybook sweep
(`pnpm check-evidence`, which walks `.webp` under this root) does not cover them:
the same position as the repository's other committed live-app PNG sets.
