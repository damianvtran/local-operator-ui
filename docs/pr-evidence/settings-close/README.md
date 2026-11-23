# PR evidence: closing the Settings page (close button, Esc, gear toggle)

Before/after of the desktop Settings route. `before-*` is the base tree,
`origin/main` at `58aabaed9a`; `after-*` is this branch (`feat/settings-close`).
Every frame is the built app, launched headless and photographed by its own
`webContents.capturePage()` through `scripts/renderer-driver.mjs --scene
settings-close`, against an isolated daemon this run owned.

## What the pair shows

| Frame | Claim |
|---|---|
| `before-dark` / `after-dark` | `/settings` has no way out but the sidebar; the close control is pinned 16px inside the content column's top inline-end corner, level with the `h1` |
| `before-light` / `after-light` | the same in `localOperatorLight` |
| `before-narrow-900-dark` / `after-narrow-900-dark` | at 900 CSS px the rail is its 48px icon column and the control keeps its 16px inset |
| `before-rtl-ur-dark` / `after-rtl-ur-dark` | with the app in Urdu the document is RTL and the control mirrors to the inline-end = the LEFT edge, still 16px in |
| `esc-recorder-armed-dark`, `esc-recorder-after-dark` | Esc on an armed shortcut recorder cancels the capture and leaves the page: the field's own capture cue clears, the chord and the layout do not move, and the page stays open |
| `esc-page-closed-dark` | the next Esc, once focus has left the field, closes Settings and lands back on `/chat` |

## How it was produced

```bash
# 1. An isolated daemon (Home/Config both under this run's rig root), port 18923.
HOME=$RIG/home LOCAL_OPERATOR_CONFIG_DIR=$RIG/config lop serve --port 18923

# 2. The renderer, built against that daemon. The OAuth client ids are RIG DUMMIES:
#    the build refuses an empty VITE_GOOGLE_CLIENT_ID/SECRET and
#    VITE_MICROSOFT_CLIENT_ID/TENANT_ID, and no sign-in path is exercised.
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:18923 \
VITE_RADIENT_SERVER_BASE_URL=https://api.radienthq.com \
VITE_DISABLE_BACKEND_MANAGER=true VITE_PUBLIC_POSTHOG_KEY= \
VITE_GOOGLE_CLIENT_ID=rig-unused VITE_GOOGLE_CLIENT_SECRET=rig-unused \
VITE_MICROSOFT_CLIENT_ID=rig-unused VITE_MICROSOFT_TENANT_ID=common \
LOCAL_OPERATOR_UI_TELEMETRY=off LOCAL_OPERATOR_UI_NO_BYTECODE=true \
  ./node_modules/.bin/electron-vite build

# 3. The scene, with the daemon's own desktop token (from its serve record).
LOCAL_OPERATOR_DESKTOP_TOKEN=<token from $RIG/config/run/serve/<pid>.json> \
node scripts/renderer-driver.mjs --scene settings-close \
  --backend http://127.0.0.1:18923 --backend-records $RIG/config/run/serve \
  --seed-onboarding-complete --out <frames>
```

The `after` run exits 0 with 39 `[PASS]` lines and no `[FAIL]`. The `before`
run exits 1 by design: its failures are the readings of a control that does not
exist there ("the gear opened Settings" included, because the scene waits for
`[data-settings-close]`), and the frames it still wrote are the base surface.

## What the scene measures, per theme

Read from the DOM at 1380 x 900 CSS px (`--window-size` default):

- the control is `32 x 32` with a `16 x 16` glyph, `aria-label="Close
  settings"`, `aria-keyshortcuts="Escape"`;
- `contentColumn.right - button.right == 16`, and the button's vertical centre
  is within 2px of the `h1`'s (measured `h1` box `64 .. 97.6`, button `64 .. 96`);
- at 900 CSS px: `window.innerWidth == 900`, the same 16px inset, still level;
- in Urdu: `document.documentElement.dir == "rtl"` and
  `button.left - column.left == 16`.

## Limits, stated rather than implied

- **The recorder pair differs in exactly one box, and the README says which.**
  Measured on the committed files: every differing pixel lies in the recorder's
  own field, `(644,446)-(860,486)` of the 1380x900 frame — the capture cue's
  border clearing when Esc cancels. Nothing else on the page moved, the chord
  reads the same in both, and the page stays open. (An earlier run of this scene
  produced two byte-identical files; this pair is the later one, and the claim
  follows the bytes, not the other way round.)
- **The RTL frame is a real locale switch, not a mirrored mock.** The daemon
  this run owned offers `ur` in the picker (the `settings-language` scene's note
  that it does not was measured on an older daemon), so the scene arrows to the
  Urdu option and commits it with Enter. It then switches back to English, so a
  re-run starts where this one did.
- **No OS-focus claim.** The launch is `headless`; the scene asserts the window
  was never shown. It cannot show what a real pointer or IME does to the control.
- The daemon is disposable, its Home/Config under the run's rig root, and the
  frame set contains only the surfaces named above.
