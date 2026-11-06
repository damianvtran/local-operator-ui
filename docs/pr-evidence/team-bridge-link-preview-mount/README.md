# Team Bridge link-preview cards, mounted in the message list (2026-11-06)

Frames for the PR that mounts the link-preview card (#1722) beneath a Team
Bridge message. Every frame is the story set
`Team Bridge/Link preview in a message`
(`src/renderer/src/features/team-bridge/link-preview/team-bridge-message-link-previews.stories.tsx`):
the shipped `TeamBridgeMessageList`, index assignment and card-or-plain-text
decision, with only core's answers scripted through
`window.api.desktop.linkPreview`. They are **Storybook frames, not frames of the
built app**: the Team Bridge page needs a signed-in account, and an agent-driven
run of the built app uses a scratch profile with none.

| Frame | What it shows |
| --- | --- |
| `no-links.webp` | A message with no links: the row as it was before cards existed, no extra margin. |
| `one-link-rest.webp` | One link: the link text stays in the body and one card sits under it (picture, favicon, site, title, description). |
| `one-link-focus.webp` | The same card after keyboard Tab focus: the card draws the two-tone ring. |
| `focus-ring-corner-zoom.webp` | Nearest-neighbour zoom of the focused card's top-left corner, DPR 2.5: 4 device px of accent (the 2 CSS px outline, pixel-snapped), then 2 device px of `surface` (the 1 CSS px line), then the picture (#1722 design round 2, D3). Pixel ladder across the left edge at picture height: `(37,34,29)` x6, `(103,198,116)` x4, `(37,34,29)` x2, picture `(231,236,244)`. |
| `three-links.webp` | Three links, three cards in link order (zoomed out to fit the frame). |
| `more-than-three.webp` | Four links: three cards; the fourth link stays plain text and is never asked about. |
| `previews-off.webp` | `web_fetch.enabled` off (`disabled` for both links): plain links, no card, no margin. |
| `mixed-refusals.webp` | A private address (index 0), a resolved page (1), a non-retryable error (2) and a fourth link past the cap: only index 1 draws a card. |
| `thread-pane.webp` | The thread pane: `surface` ground, compact rows, a 360px column. |

## How they were captured

The harness `browser` tool (the operator's browser, one tab, stepped by hand)
against a Storybook booted through `scripts/with-storybook.mjs`, opened through
the manager URL (`?path=/story/...&full=1`), theme `localOperatorDark`, DPR 2.5,
downscaled to 1280px wide. The Storybook process group was reaped by its exact
pgid afterwards.
