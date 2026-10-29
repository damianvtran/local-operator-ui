# Owner audit — the four states, light and dark

Frames of the shipped components, captured from the Storybook stories in
`src/renderer/src/features/team-bridge/team-bridge-owner-audit.stories.tsx`
(`Team Bridge/Owner audit`), not from a mock-up.

- Viewport: **1280 × 720 CSS px** (captured at 2× DPR; the PNGs are 2560 × 1440).
  Measured, not assumed: `body` reports `rect 0,0 1280x720`.
- Themes: `localOperatorLight` and `localOperatorDark`, applied by the preview's
  own `ThemeFrame` decorator through `?args=theme:<id>` — the same seam
  `scripts/capture-evidence.mjs` uses.
- Source: `storybook-static` built from the head of this branch and served over
  HTTP/1.1. A Python `http.server` was tried first and rejected: it answers
  HTTP/1.0 and closes each connection, which drops enough of Storybook's parallel
  chunk fetches to fail the preview module ("Failed to fetch dynamically imported
  module"). That was a serving defect, not a rendering one — with the same build
  over HTTP/1.1 every state renders.
- Nothing here talks to a hub: the audit views are props-driven, and the fixtures
  in the story are the route shapes from `local-operator`'s
  `docs/team-bridge-owner-audit.md`.

| State | What it shows |
| --- | --- |
| `populated-*` | The ordinary window: admitted text open, a `rejected` body collapsed behind "Show message text", a `not_screened` row whose body the hub did not send ("Message text unavailable."), and the chief of staff's own message open with its "Sent by your chief of staff" chip. The header carries the read-only promise, the membership state and the disclosure line with its viewer line. |
| `empty-*` | No audited conversations in this organization — and therefore **no panel**: the slot only opens one for a row the reader selects. |
| `loading-*` | The list is still being read. |
| `read-failed-*` | The read was refused or failed. A refusal renders as an error with a retry, never as an empty list: the routes answer `conversation_not_found` for a non-owner, an out-of-window conversation and an unknown id alike, so "nothing to show" would be a claim the client cannot make. |
