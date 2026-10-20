# RTL direction: rendered proof

Frames and numbers for the desktop RTL slice (`ui-rtl-direction`). Urdu is the
programme's RTL locale; the document root takes `dir`/`lang` from
`i18n/languages.json`, so the whole shell mirrors without per-surface flips.
The installed backend's language enum does not yet offer `ur` as a Settings
choice (a separate backend change), so this proof drives the locale at the
capabilities boundary, the same way the application reads it.

## Method

- Built the desktop app from this branch (`pnpm build`).
- Launched it through the repository's own renderer driver in `inactive` window
  mode with a scratch `HOME`, config dir and Electron profile, at
  `--window-size=1380x900`.
- Backend: a real isolated `lop serve` 0.82.3 on `127.0.0.1:8125` (hosting/model
  `test`/`mock-model`), fronted by an in-process proxy on `:8123` that rewrites
  only `result.language` in `GET /v1/capabilities` (`en` <-> `ur`) and streams
  every other byte, including the SSE feed. A fabricated serve record names the
  proxy address with the real daemon's pid/instance identity so discovery
  admits it.
- **A real canonical session is seeded in both locales**: `POST
  /v1/desktop/sessions`, then the session's own `rename` command to `RTL QA`.
  The chat frames therefore show the session row, not an empty stub.
- Both locales use the **same theme** (`localOperatorLight`), set through the
  app's own dev-driver `setTheme` verb.
- Pixels are `webContents.capturePage()` in the main process - the app
  photographing its own window. No OS screen capture and no second browser
  engine.
- Geometry is `getBoundingClientRect()` read from the live renderer. CSS
  viewport is 1380x900; frames are 2760x1800 device pixels (DPR 2).
- The first-run wizard was dismissed before measurement; the chat route is
  `/chat` and the settings route is `/settings`.
- **LTR control:** built `origin/main` at `491047154e` in a separate worktree
  with the same symlinked `node_modules`, and captured English with the same
  rig, the same seeded session and the same theme. `en-chat.png` and
  `en-settings.png` are **byte-identical** to `en-chat-control.png` and
  `en-settings-control.png`: 0 differing pixels each across 2760x1800
  (ImageChops difference bbox null; sha256 matches are in `measurements.json`).

## Numbers

| Region | English (ltr) | Urdu (rtl) |
| --- | --- | --- |
| `html dir` / `lang` | `ltr` / `en` | `rtl` / `ur` |
| computed `direction` (html, body) | `ltr` | `rtl` |
| sidebar column | x=0, w=260 | x=1120, w=260 |
| panel rail | x=1336, w=44 | x=0, w=44 |
| main content | x=260, w=1076 | x=44, w=1076 |
| main + rail | x=260, w=1120 | x=0, w=1120 |
| settings subnav | x=260, w=220 | x=900, w=220 |
| settings content | x=480, w=900 | x=0, w=900 |
| seeded row `RTL QA` | x=12, title x=54..202 | x=1140, title x=1178..1326 |
| row text rect | x=54..100, `text-align: start` | x=1280..1326, `text-align: start` |

Every RTL box is the English box mirrored around a 1380px viewport:
`1120 = 1380 - 260`, `900 = 1380 - 220 - 260`. The session row keeps the same
inline-start and inline-end gaps in both directions (42px / 38px), and its
text ends at the row's inline-end edge (1326 of row edge 1368 in RTL).

## Frames

- `en-chat.png`, `en-settings.png` - the English baseline, seeded session,
  light theme.
- `ur-chat.png`, `ur-settings.png` - mirrored shell, translated copy,
  right-to-left text alignment, the `RTL QA` session row, settings gutter dot
  on the inline-start edge. Same light theme as the baseline.
- The composer's English fallback label (`Working directory:`) is wrapped in
  `<bdi dir="auto">`: the Latin run keeps its own LTR base direction inside the
  RTL row, so the colon stays attached to the phrase in both locales. In the
  Urdu frame it reads `~ Working directory:`; in English, `Working directory: ~`.
- `en-chat-control.png`, `en-settings-control.png` - the `origin/main`
  `491047154e` control pair.

`measurements.json` carries the full per-run readings, capture hashes and the
control comparison.

## Scope notes

- Converted: global rail, shell columns and lane, resize handles, sheet edge,
  settings subnav, the settings content rows and shared editors used by that
  frame (`editable-field`, `searchable-select`, `slider-setting`), and the
  session list (`chat-sidebar.tsx`).
- Not converted in this slice (still use physical utilities where direction
  matters): dialogs, toasts, update cards, the library filter sheet, and the
  chat options sheet. They are listed in the pull request body rather than
  half-converted here.
- Untranslated English fallback strings inside RTL copy keep `dir="auto"`
  nowhere; a missing Urdu key can render with the punctuation order of the
  source string. That is an i18n coverage gap, not a layout one.
