# credential chip: visual polish and compositor-synced scroll

Stills are PNG only. `before-*` is `origin/main` (a813a921ab7), `after-*` is this branch, same stories, same
viewport (1024x300, or 440 where named), same themes: `localOperatorDark`, `localOperatorLight` and `everforest`
(the low-contrast one).

- `transcript-live`, `transcript-not-stored`, `transcript-narrow-440`: Chat/Canonical credential citation stories.
- `composer-live` (with its clear control), `composer-not-stored`, `composer-small-440`, `composer-scrolled`:
  Chat/Message input credential-pill stories.
- `after-localOperatorDark-composer-zoom4x`: the composer chip at 4x (shows the corner cover over the marker's
  brackets). `after-*-wrapped-run`: a marker that wraps, which keeps the wash and draws no chip.
- `before-lag.json`, `after-lag.json`, `after-fallback-lag.json`: per-frame scroll-lag measurements (below).

## How the scroll lag is measured

`rig/lag.mjs` drives the `credential-pill-scrolled` story in a private headless Chrome over CDP (mock keychain, scratch
profile), wheel-scrolls the textarea with `Input.synthesizeScrollGesture` (a compositor-driven gesture, not a
`scrollTop` write), records the real presented frames with `Page.startScreencast`, paints the field's glyphs pure red
and the chip's edge pure green, and reads, per frame, how far the text sits from the chip box (a cross-correlation of
the red row profile against the at-rest frame; lines repeat every 17px, so the value is folded into 0-17).
A `getBoundingClientRect` probe cannot see this: the main thread's own view of both boxes agrees in every frame.

    node scripts/with-storybook.mjs -- node docs/pr-evidence/credential-chip-polish/rig/lag.mjs <label> <outdir>

| build | gesture speed | frames with a chip | median lag | max lag |
|---|---|---|---|---|
| before (`origin/main`) | 240 px/s | 25 | 3 px | 5 px |
| before (`origin/main`) | 480 px/s | 14 | 10 px | 16 px |
| after | 240 px/s | 26 | 0 px | 0 px |
| after | 480 px/s | 16 | 0 px | 0 px |
| after, scroll timeline switched off (negative control, `FALLBACK=1`) | 240 / 480 px/s | 24 / 14 | 1 / 3 px | 4 / 6 px |
