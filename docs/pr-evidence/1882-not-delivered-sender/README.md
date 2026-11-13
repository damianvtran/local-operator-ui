# The sender's not-delivered row, before and after (PR #1882)

Rendered stills for the delivery-annotation change in PR #1882: a
sender-side `not_delivered` entry (agent-server #377's sender view of a
moderation refusal) now names its recipient in the details popover,
where before the count reached the screen but nothing said who missed
the message.

## What these frames are

One pair per story, from Storybook `Team Bridge/Delivery annotation`,
theme `localOperatorDark`, locale `en`, at 2560x1440. Each story's play
function opens the details popover. `before-` renders the same story
data through `origin/main`'s model (base `5033f64235`); `after-` is the
branch `fix/team-bridge-not-delivered-recipient` at `980edc6e520d`.
Nothing but the model differs between the two halves of a pair.

| Frame | Story | What it shows |
| --- | --- | --- |
| `before-not-delivered-single.png` | `NotDeliveredSenderSingleOpen` | "1 not delivered" with no chevron: no popover trigger, nothing names Aida |
| `after-not-delivered-single.png` | `NotDeliveredSenderSingleOpen` | "1 not delivered ⌄"; the popover reads "Not delivered to Aida (Sam Rivera). Refused by moderation. ⓘ" |
| `before-not-delivered-group.png` | `NotDeliveredSenderGroupOpen` | "Delivered to 2 · 1 not delivered" with no chevron |
| `after-not-delivered-group.png` | `NotDeliveredSenderGroupOpen` | "Delivered to 2 · 1 not delivered ⌄"; the popover names Aida only, and the two delivered recipients get no row |

These are the exact files design review round 1 judged; the PR's
freshness comment records their sha256 values against the originals.

## The measured contrast

From design review round 1, by pixel sampling of these frames (most
common pixel as background, highest-contrast glyph pixel as foreground):

| Surface | Foreground | Background | Ratio |
| --- | --- | --- | --- |
| Popover row | `#C1BCB0` | `#2E2A20` | 7.55:1 |
| Summary line | `#C1BCB0` | `#25221D` | 8.37:1 |

Both clear WCAG AA's 4.5:1 for body text, and the single and group
frames return identical values. The row reuses the existing classless
`refused` render path, so it adds no new styling; light theme and other
locales inherit that path and are not re-proven here.

The frames are not in `docs/evidence/`: that set is a committed
contract with its own manifest and fold window, and this is a
per-pull-request pair.
