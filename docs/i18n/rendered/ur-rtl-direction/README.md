# RTL direction: rendered proof

Frames and numbers for the desktop RTL slice (`ui-rtl-direction`). Urdu is the
shipped RTL locale; the document root takes `dir`/`lang` from
`i18n/languages.json`, so the whole shell mirrors without per-surface flips.

## Method

- Built the desktop app from this branch (`pnpm build:npm`).
- Launched it through the repository's own renderer driver in `headless` window
  mode, with a scratch `HOME`, config dir and Electron profile, and a stub
  backend whose `/v1/capabilities` answer names the locale under test
  (`language: "en"` / `"ur"`, `features.i18n: 1`).
- Pixels are `webContents.capturePage()` in the main process — the app
  photographing its own hidden window. No OS screen capture and no second
  browser engine.
- Geometry is `getBoundingClientRect()` read from the live renderer. CSS
  viewport is 1380x900; frames are 2760x1800 device pixels (DPR 2).
- The first-run wizard was marked complete in the scratch profile, so the shell
  is unobstructed. The chat route is `/chat`; the settings route is `/settings`.
- **LTR control:** rebuilt `origin/main` at `787f8c6e7e` without this slice in a
  separate worktree and captured English the same way. `en-chat.png` and
  `en-settings.png` are pixel-identical to the committed controls
  (`en-chat-control.png`, `en-settings-control.png`): 0 differing pixels across
  2760x1800 (ImageChops difference bbox null), so the claim is re-runnable.

## Numbers

| Region | English (ltr) | Urdu (rtl) |
| --- | --- | --- |
| `html dir` / `lang` | `ltr` / `en` | `rtl` / `ur` |
| computed `direction` (html, body) | `ltr` | `rtl` |
| global rail | x=0, w=260 | x=1120, w=260 |
| main content | x=260, w=1120 | x=0, w=1120 |
| settings subnav | x=260, w=220 | x=900, w=220 |
| settings content | x=480, w=900 | x=0, w=900 |

Every RTL box is the English box mirrored around a 1380px viewport:
`1120 = 1380 - 260`, `900 = 1380 - 220 - 260`.

## Frames

- `en-chat.png`, `en-settings.png` — the English baseline.
- `ur-chat.png`, `ur-settings.png` — mirrored shell, translated copy, right-to-left
  text alignment, settings gutter dot on the inline-start edge.

`measurements.json` carries the full per-run readings, including capture sizes.

## Scope notes

- Converted: global rail, shell columns and lane, resize handles, sheet edge,
  settings subnav and the settings content rows.
- Not converted in this slice (still use physical utilities where direction
  matters): dialogs, toasts, update cards, the library filter sheet, the chat
  options sheet, and the form primitives shared with non-shell surfaces. They
  are listed in the pull request body rather than half-converted here.
- Untranslated English fallback strings inside RTL copy keep `dir="auto"`
  nowhere; a missing Urdu key can render with the punctuation order of the
  source string. That is an i18n coverage gap, not a layout one.
