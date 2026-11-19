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
| `thread-pane-rest-dark.webp`, `thread-pane-rest-light.webp` | The thread pane (`surface` ground, compact rows, a 360px column) at rest, card ground `sunken`: the plate is a visible well in both themes. |
| `thread-pane-hover-dark.webp`, `thread-pane-hover-light.webp` | The first row hovered: the row ground becomes `elevated` and the card's `sunken` plate is deeper still (measured below). |
| `timeline-rest-dark.webp`, `timeline-rest-light.webp` | The conversation timeline at rest: the row is `canvas`, so the card steps one ground down from it. |
| `timeline-hover-dark.webp`, `timeline-hover-light.webp` | The same row hovered: the row becomes `surface`, and the card keeps its edge instead of dissolving into it (this is the state the `surface` card measured ΔE00 0.00 in). |
| `inert-links-dark.webp`, `inert-links-light.webp` | The links a message refuses to make destinations (`README.md`, `./notes/plan.md`, `example.com/login`, `//status.example.com/42`, `#section`): drawn as monospace plain text, no card, and core is never asked. The one eligible link beside them still draws its card. |

## The card's edge, measured (D1)

The card is `bg-sunken` (design round 1 chose the token; `Card variant="plain"`
would paint `surface`). Ground step between the card's plate and the ground beside
it, sampled from the committed frames (device pixels, DPR 2), ΔE00:

| State | Theme | Card | Ground beside it | ΔE00 |
| --- | --- | --- | --- | --- |
| thread pane, rest | LO dark | `#171512` (`sunken`) | `#26221c` (`surface`) | 4.73 |
| thread pane, rest | LO light | `#ece6d8` (`sunken`) | `#f7f5ee` (`surface`) | 4.43 |
| thread pane, row hovered | LO dark | `#171512` (`sunken`) | `#2f2a1f` (`elevated`) | 8.20 |
| thread pane, row hovered | LO light | `#ece6d8` (`sunken`) | `#fefdfa` (`elevated`) | 6.85 |
| timeline, rest | LO dark | `#171512` (`sunken`) | `#1d1b17` (`canvas`) | 2.06 |
| timeline, rest | LO light | `#ece6d8` (`sunken`) | `#f2ede3` (`canvas`) | 2.26 |
| timeline, row hovered | LO dark | `#171512` (`sunken`) | `#26221c` (`surface`) | 4.73 |
| timeline, row hovered | LO light | `#ece6d8` (`sunken`) | `#f7f5ee` (`surface`) | 4.43 |

The two states the shipped `surface` card measured **0.00** in (thread pane at
rest, hovered timeline row) are now 4.43/4.73 and 4.43/4.73. The computed
`background-color` of the card root equals `--lo-sunken` exactly in both themes
(`rgb(236, 230, 216)` / `rgb(23, 21, 18)`), so the token — not a coincidence of
pixels — is what put it there.


## How they were captured

The harness `browser` tool (the operator's browser, one tab, stepped by hand)
against a Storybook booted through `scripts/with-storybook.mjs`, opened through
the manager URL (`?path=/story/...&full=1`), theme `localOperatorDark`, DPR 2.5,
downscaled to 1280px wide. The Storybook process group was reaped by its exact
pgid afterwards.

**Round 1 remediation frames (2026-11-06, D1/D3).** The same tool against one
`scripts/with-storybook.mjs` server on port 6041, opened through the story
`iframe.html?id=…&args=theme:<id>` (`THEME_IDS` in `.storybook/preview.tsx`:
`localOperatorDark`, `localOperatorLight`), DPR 2, then cropped to the story's own
box and saved 1280px wide. A row's hover state is a real pointer: `action=hover`
on the row's body text, then a screenshot of that same frame, and the plate's
ground colour was re-read from computed style in both themes to prove the token
resolved (`--lo-sunken`, not the `plain` variant's `--lo-surface`). Every frame
is the same story set, so a reviewer re-opens the URL in the table and sees the
state that was captured.
