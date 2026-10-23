# 1Password CLI-access icon: before and after

Native captures of 1Password's own **"1Password Access Requested"** dialog
(1Password 8.12.40, macOS 27.0.0, 2026-10-23). Each was taken with
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
neither was LaunchServices caching: the same registered bundle changed from
blurred to sharp when only the chunk order changed (see the controlled pair).

## Frames

| File | What it is |
|---|---|
| `before-dialog.png` | The operator's dialog, attributed to `/Applications/Local Operator.app`, before the fix. Icon slot 128 x 128; edge variance **112.5**. |
| `after-dialog.png` | The same dialog after the fix, from a bundle named `Local Operator` carrying the exact `icon.icns` bytes the `--dir` build ships (sha256 `cc61a0dd...`). Icon slot 128 x 128; edge variance **2218.8** (19.7x). |
| `controlled-current-icns.png` | Control A: a probe bundle named `Probe-lop-probe-current` with the pre-fix `icon.icns`. Blurred. |
| `controlled-reordered-icns.png` | Control B: the same bundle and the **same bytes** with the chunks reordered 1024-first. Sharp. Only the order differs. |

Matching the rendered badge against each ICNS entry (LANCZOS round-trip, MSE
after compositing on the dialog's ground):

- Before: **16 px entry, MSE 150**; next-closest 24 px at 479.8.
- After: 1024 px entry, MSE 137.6 (128/256/512 entries are within 3 points, as
  expected for one artwork downscaled from the same master).

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
