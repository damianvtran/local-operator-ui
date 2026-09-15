# The settings version row at 620px, where the grid reflows

The set next door is one 980x320 crop sized to the section, and it is the right
instrument for the row's own layout: at the app's shipped 1380x800 the section
sits on ~95% empty ground. What it cannot show is a NARROW window, and this is
where the change is most exposed — the row's value now carries `version · address`
(~25 characters) where it used to carry a bare number, and `InfoGrid` is
`repeat(auto-fit, minmax(160px, 1fr))`.

Round 1's D6 asked for exactly this frame and named the string it expected to
wrap first: `Unknown (update required)`, ~135–150px estimated against the 164px
column at the tightest track.

## What produced these frames

The same command as the wide set, which matches both:

```
node scripts/capture-evidence.mjs http://localhost:<port> \
  --only=settings-app-updates-and-info \
  --themes=localOperatorDark,localOperatorLight --allow-backend
```

`app-updates-and-info-narrow.stories.tsx` is a second story file rather than a
second capture of the first, because the rig derives a frame's path from the story
id: one id is one viewport. It is the same component, the same bridge stub and the
same snapshots; only the viewport differs.

## The readback

| story | at 620px |
| --- | --- |
| `attached` | `0.54.47 · 127.0.0.1:7341` — **one line, no wrap**; the grid reflows to three tracks and the five rows take two grid rows |
| `no-version` | `Version unknown` — one line (this replaced `Unknown (update required)`, the string round 1 predicted would wrap) |
| `degraded` | value one line, `Not answering` on its own line beneath it, aligned with its siblings' values |

Measured rather than eyeballed: `magick <frame> -trim -format '%wx%h%O' info:`
on the attached frame reports the content as `600x228+8+8` inside the 620x360
viewport (the `+8+8` is the story's own `p-4` padding), and the row's values sit on
one text line each. `Not answering` in `degraded` is a deliberate third line, not
a wrap.

## What these frames do not prove

- **Not the shipped window.** 620x360 is narrower than the app's smallest shipped
  window; it is the width at which the grid's tightest track is exercised. A
  window between 620 and 980 is not photographed, and the frames cannot say where
  between the two a value would start to wrap — only that at 620 it does not.
- **Not a reflow-under-scroll check.** Nothing here scrolls.
- **The degraded frame is not a comparison against the narrow attached frame in
  the same palette** — it is, and that is the point — but the *wide* degraded frame
  in the set next door is the one round 1's D4 finding was filed against.
