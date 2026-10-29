# 1Password CLI-access icon: before and after

Native captures of 1Password's own **"1Password Access Requested"** dialog
(1Password 8.12.40, macOS 27.0.1 / Darwin 27.0.0, 2026-10-23). Each was taken with
`screencapture -x -l <windowid>` from a pty hosted by Local Operator, because
Screen Recording is granted to the app and not to the agent's shell.

## What was wrong

The dialog draws the requesting bundle's icon at **128 x 128 px**. 1Password
reads that icon itself: `Contents/Info.plist` -> `CFBundleIconFile` ->
`Contents/Resources/<name>` -> an ICNS parser in its `index.node`. That parser
draws the **first chunk in the file**, whatever size it is.

`build/icon.icns` was written ascending, so its first chunk was `icp4` (16 x 16).
The dialog showed a smooth 8x enlargement of that 16 px image. The bundle did
carry every size through 1024 px - `iconutil` expands it to 16, 32, 48, 128,
256, 512 and 512@2x - so a missing HD asset was never the explanation, and
neither was LaunchServices caching: two otherwise identical probe bundles, whose
icon bytes differ **only in chunk order**, changed from blurred to sharp (see the
controlled pair). The two probes carry different bundle names because each name
is a fresh identity to 1Password; the icon file is the same bytes reordered.

## Frames

| File | What it is |
|---|---|
| `before-dialog.png` | The operator's dialog, attributed to `/Applications/Local Operator.app`, before the fix. Icon slot 128 x 128; edge variance **112.5**. |
| `after-dialog.png` | The same dialog after the fix, from a bundle named `Local Operator` carrying the exact `icon.icns` bytes the `--dir` build ships (sha256 `cc61a0dd...`). Icon slot 128 x 128; edge variance **2218.8** (19.7x). |
| `controlled-current-icns.png` | Control A: a probe bundle named `Probe-lop-probe-current` with the pre-fix `icon.icns`. Blurred. |
| `controlled-reordered-icns.png` | Control B: an otherwise identical probe bundle and the **same bytes** with the chunks reordered 1024-first. Sharp. Only the order differs. |

**Edge variance** here is the variance of the 128 x 128 icon crop's luma after
Pillow's `FIND_EDGES` 3 x 3 kernel (`ImageFilter.FIND_EDGES`, Pillow 12). It is
a relative indicator between these two crops, not an absolute sharpness unit:
a different kernel (Laplacian, Sobel) gives different absolute values and both
orders of magnitude still separate the pair. The discriminating measurement is
the per-entry match below.

Matching the rendered badge against each candidate image (LANCZOS round-trip
to 128 x 128, MSE after compositing on the dialog's ground). The crop is the
icon slot at **(312,218)-(440,346)** in the 1024 x 874 capture; the compositing
background for the icon's transparent corners is **RGB(46,46,46)**. (The flat
dialog panel beside the slot is **RGB(72,71,71)**; the same ranking holds at that
ground, and the after badge sits at 3.3 MSE there. 46 is quoted because it is the
value the listed absolute numbers reproduce.) The candidates are
the seven ICNS entries plus 24/48/96 px resamples of the 1024 master:

- Before: **16 px entry, MSE 150.0**; then 24 = 479.8, 32 = 803.7, 48 = 1,171.7,
  64 = 1,284.0, 96 = 1,498.0, 128 = 1,681.1.
- After: 1024 px entry, MSE 137.6; 512 = 138.1, 256 = 140.1, 128 = 138.8 (all
  within 3 points, as expected for one artwork downscaled from the same master).

The controlled frames' icon crops are **pixel-identical** to `before-dialog.png`
and `after-dialog.png` respectively. That is the point of the pair: a probe
bundle and the real bundle carrying the same icon bytes render identically, so
the probe is a valid stand-in for the real bundle. The pair isolates the chunk
order; it is not a second, independent rendering of the artwork.

## How the captures were triggered

`op` signed out (`op signout --all`), then the bundle under test launched with
`open -a`, so macOS makes it the responsible app for the `op` child. The dialog
belongs to 1Password; the window id was resolved from
`CGWindowListCopyWindowInfo` and captured only while it existed.

The after capture uses a probe bundle rather than the installed signed bundle:
replacing `/Applications/Local Operator.app` in place would invalidate the
operator's signature and replace the running app. The icon path under test is
the same one the before capture proved for the real bundle, and the after bundle
carries the built app's `Contents/Resources/icon.icns` byte-for-byte.

## The fix

- Write ICNS chunks largest-first, so the first chunk is `ic10` (1024).
- Name `build.mac.icon` explicitly.
- Stamp every nested helper bundle with `CFBundleIconFile` and a copy of the
  app's icns in `afterPack`, before signing.
- Keep the dev runtime's Dock icon on the 1024 px master.
- Pin the order, the explicit config and the helper stamping in
  `scripts/icon-identity.test.mjs`.
