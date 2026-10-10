# The media tile's fill

The condensed strip's tile is BORDERLESS AT REST (the operator asked for the
ring to go), so the tile's own extent is its fill - and the shared `sunken` well
could not carry it. Measured across the 59 palettes, the well's step off the
canvas runs below the file's findability floor (ΔE00 4.0) on 56 of them,
bottoming at 2.00 (`iceberg`, `neonNoir`) - which is the tile a page-toned
picture had: the fixture's own canvas IS the page's tone (1.001:1 measured in
`localOperatorDark`), and a letterboxed portrait's mats measured ~1.05-1.06:1
against it. This set is the fill role's own evidence, and its pair under
[`../chat-media-slot-fill-before/`](../chat-media-slot-fill-before/) is the
claim: a frame of the repaired fill alone cannot show that the tile used to sit
at a step a reader cannot find.

**Which themes, and why these five.** Chosen from the audit's extremes rather
than taste: `iceberg` and `neonNoir` carry the fleet's smallest shared-well
steps (2.00 ΔE00 each, the two worst of the 59), `localOperatorLight` and
`localOperatorDark` are the brand pair the loss was measured on, and `ayuMirage`
already clears the floor at rest, so the change does NOT move it - the pair's
control, whose two frames are **byte-identical** across the halves (SHA-256
`91c8fd6667e6072ee2cc924603513fbf0f93ed969c29b2ce76cabef8400a7d02`).

| theme | well before | ΔE00 before | fill after | ΔE00 after |
|---|---|---|---|---|
| `iceberg` | `#E0E1E6` | 2.00 | `#d8d9e0` | 4.04 |
| `neonNoir` | `#1F2124` | 2.00 | `#1b1c1d` | 4.09 |
| `localOperatorLight` | `#ece6d8` | 2.26 | `#e7e1cf` | 4.24 |
| `localOperatorDark` | `#1d1b19` | 2.07 | `#191717` | 4.02 |
| `ayuMirage` | `#191D27` | 4.01 | `#191D27` | 4.01 |

The two worst cases named in the code's own trade are both in the frame: a
picture whose own canvas is the page's tone (the `lightCanvas`/`darkCanvas`
fixtures) and the letterboxed portrait (the `tall` fixture), beside an ordinary
control. The full 59-theme table lives in the pull request's body, and the
executable half is `MEDIA_SURFACE_DELTA_E` in `scripts/contrast-contract.mjs`
(asserted per palette, with the ≥ 2.5 `L*` half; `scripts/media-surface-floors.test.mjs`
proves each bound fires).

**These are palette-space numbers, and the stills are not the instrument.**
Every figure in this file is re-derived from the palettes and
`themes.generated.css` - the same values `pnpm check-themes` reads. The frames
are the pair's evidence of the CHANGE, not of the step: at these step sizes a
still-read ΔE00 lands away from its declared figure, so re-derive from the
palettes, not from the pixels, or a passing tree can read as sub-floor.

**Framed coverage, stated.** Five of the 59 palettes are photographed here, by
the selection logic above; the other 54 are computed, not read from stills (the
per-palette floor is asserted for every one of them). If the set is ever
extended, `localOperatorDark` - the palette the 1.001:1 reading was taken on -
is the still with the most to say.

**How they were taken.**

```sh
node scripts/capture-evidence.mjs http://localhost:6043 \
  --only=chat-media-slot-fill \
  --themes=iceberg,neonNoir,localOperatorLight,localOperatorDark,ayuMirage \
  --allow-backend --theme-settle-ms=180000
```

Storybook driving the `chat-media-slot-fill--rest` story at its own 1280x200
frame, headless Chrome as the rig always runs it. `--allow-backend` because the
operator's live daemon answers on :1111 and must not be stopped for a capture,
and this story is a static fixture (`scope={null}`) that never contacts the
backend, so the guard's concern - surfaces that render a server's replies - does
not apply; the rig's own theme and paint guards still ran over every frame.
`--theme-settle-ms` because this host is loaded: the guard's default 10 s does
not fit it.

**What this set is NOT.** Component-level frames from Storybook, not the whole
app: no sidebar and no composer are in them. The claim is the tile's fill
against the canvas it is drawn on, and the pair is read at that scope; the
`chat-shell` set is where whole-app frames live. These frames contain no data
from any machine. The set does not re-shoot the older strip frames of
`chat-trace-fold` - those keep their own moment, and this set is the pair the
fill is read against.
