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
and the chip's edge pure green, and reads, per frame, where the marker's ink sits inside the chip box, against the
same measure at rest. A `getBoundingClientRect` probe cannot see this: the main thread's own view of both boxes agrees
in every frame.

The field holds ONE line of ink (the marker, with blank lines around it), so the red glyphs inside the chip box's
columns can only be the marker at any displacement. The first version of the rig used repeating filler prose, so a
shift was only defined modulo the 17px line pitch and was folded into 0-17 px; it could not report a lag of 17 px or
more and could not tell a chip that trails from one that leads (QA round 1, Q1). The lag is now SIGNED and UNFOLDED:
positive when the chip trails the text, negative when it leads it, `maxTrailPx` / `maxLeadPx` are reported
separately, and `travelPx` is the chip's own travel for scale. `before-lag.json` was taken with the folded metric (on
`origin/main`, which no longer exists as a build here) and is kept as the original claim, not re-derived; the
`after-*` files are re-taken with the new metric on this head.

    node scripts/with-storybook.mjs -- node docs/pr-evidence/credential-chip-polish/rig/lag.mjs <label> <outdir>

| build | gesture speed | frames with a chip (moved) | median lag | max trail / max lead |
|---|---|---|---|---|
| before (`origin/main`), folded metric, original claim | 240 px/s | 25 | 3 px | 5 px (folded) |
| before (`origin/main`), folded metric, original claim | 480 px/s | 14 | 10 px | 16 px (folded) |
| after (this head) | 240 px/s | 24 (19) | 0 px | 0 / 0 px, 0 non-zero frames |
| after (this head) | 480 px/s | 15 (12) | 0 px | 0 / 0 px, 0 non-zero frames |
| after, scroll timeline switched off (negative control, `FALLBACK=1`) | 240 px/s | 25 (21) | 4 px | 8 / 0 px, 21 non-zero frames |
| after, scroll timeline switched off (negative control, `FALLBACK=1`) | 480 px/s | 15 (11) | 7 px | 10 / 0 px, 12 non-zero frames |

The negative control (the listener-driven path, which is what the old build did) trails by up to 10 px and never
leads, which is what a one-frame-late repaint does; the compositor-driven build is exactly 0 in every frame.
