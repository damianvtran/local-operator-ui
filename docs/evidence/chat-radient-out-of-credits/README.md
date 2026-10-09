# The chat row for a Radient run refused for want of credits

A signed-in user with a zero balance gets an HTTP 402 from Radient. The chat used
to render it as a generic rate-limit incident (`rate-limit: radient/auto rate limit
or quota exceeded (HTTP 402): insufficient credits`) with an "Open provider
settings" button, and nothing said that free credits wait behind email
verification or how to top up. The paired "before" set is
[`../chat-radient-out-of-credits-before/`](../chat-radient-out-of-credits-before/).

Eight surfaces, the two brand themes (`localOperatorDark.webp` /
`localOperatorLight.webp`). Every frame is the production `CanonicalTranscript`
rendering the production reducer's incident row, with the guidance reading the
account through the real `useRadientUserQuery` against a stubbed desktop
transport (`radient-credits-guidance.stories.tsx`). All data is synthetic.

| Directory | Account read | What the row says |
| --- | --- | --- |
| `unverified-pending` | signup grant pending | "You haven't verified your email yet. Verify to claim $5 in free credits ..." + "Check your inbox ..." / **Open verification page** |
| `unverified-expired` | signup grant expired | same lead, "The link you were sent has expired. Request a new one ..." / **Request a new link** |
| `unverified-none` | no grant ticket | no amount promised: "Open the verification page to check whether free credits are waiting ..." |
| `verified-bonus-available` | verified, `first_topup.bonus_received: false` | "You're out of credits. Top up in the Radient console." + "Get an extra $10 free on your first top-up of $5 or more." / **Top up in Radient console** |
| `verified-bonus-received` | verified, `bonus_received: true` | top-up line only, no bonus line |
| `verified-older-backend` | verified, no `first_topup` field | top-up link, no bonus line (an absent field is never an offer) |
| `account-unreadable` | signed out / read failed | neutral message, BOTH links worded conditionally, no figure |
| `non-radient-rate-limit` | (not read) | the control: an anthropic 429 renders exactly as before |

## Geometry (1280 wide, localOperatorLight; measured over CDP, not read off the frame)

The row's left rail is x=235; the guidance box and the buttons sit on the
disclosure edge, x=259. No box or scroller overflows horizontally (`scrollWidth -
clientWidth` is 0 for every state).

| State | Row h | Box (w x h) | Buttons (y, h) |
| --- | --- | --- | --- |
| unverified-pending | 150 | 529 x 89 | 206, 28 |
| unverified-expired | 170 | 529 x 108 | 226, 28 |
| unverified-none | 127 | 529 x 65 | 183, 28 |
| verified-bonus-available | 131 | 392 x 69 | 187, 28 |
| verified-bonus-received | 107 | 367 x 46 | 163, 28 |
| verified-older-backend | 107 | 367 x 46 | 163, 28 |
| account-unreadable | 150 | 529 x 89 | 206, 28 (three buttons in one line) |
| non-radient-rate-limit | 54 | none | 110, 28 |

At 420 wide, re-measured with the probe below (`scripts/radient-credits-geometry.mjs`; it reproduced the unreadable state's committed readings - box 316 wide, buttons at x=64, overflow 0): the unreadable state's three buttons wrap onto their own lines (y 247.4 / 283.4 / 319.4, x=64); `unverified-pending` and `unverified-expired` - the longest copy - keep their two buttons ON one line (pending: CTA 64..212.8, ghost 220.8..365 at y 247.4; expired: CTA 64..189.9, ghost 197.9..342.1 at y 286.4). Every box is 316 wide - the narrow column's own measure; the longest copy wraps rather than widening - and nothing overflows (`scrollWidth - clientWidth` is 0 for the box, the action row and the document). Pending's box is 108 tall over 3+1 text lines, expired's 147 over 3+3, unreadable's 108 over 3+1.

## The pre-settle row's insertion shift (design round 1, D1; measured, not read off a frame)

The guidance box renders only after the account read settles, and it is inserted above and before the action row - so a read that lands after the row's first paint displaces the ghost action ("Open Radient account"). That is a number about an edge moving, which neither endpoint's still can show, so it is measured: `node scripts/radient-credits-geometry.mjs <storybook-origin>` wraps the story's stubbed bridge before the page's own scripts run, holds the account read, measures the pre-settle row, lets the read land, and measures again in the same page. At 1280, `localOperatorLight`:

| State | box (w x h) | ghost shift (right, down) |
| --- | --- | --- |
| `unverified-pending` | 529.1 x 88.5 | +156.8, +96.5 |
| `unverified-expired` | 529.1 x 108 | +133.9, +116 |
| `unverified-none` | 529.1 x 65 | +156.8, +73 |
| `verified-bonus-available` | 392.4 x 69 | +174.5, +77 |
| `verified-bonus-received` | 366.8 x 45.5 | +174.5, +53.5 |
| `verified-older-backend` | 366.8 x 45.5 | +174.5, +53.5 |
| `account-unreadable` | 529.1 x 88.5 | +331.3, +96.5 |

Before the read lands the row is boxless and the ghost sits on the actions line at x=259; the right shift is the inserted CTA's own width plus the row's 8px gap (`Open verification page` 148.8, `Request a new link` 125.9, `Top up in Radient console` 166.5; the unreadable arm inserts two, hence 331.3), and the down shift is the box's height plus that gap.

## What to look for

- The headline says what happened ("Out of credits (HTTP 402): insufficient
  credits") under the `billing:` label, never `rate-limit:`.
- The box is the same hairline `surface` register as the settings callout, and it
  is absent while the account read is in flight, so a neutral sentence is never
  replaced a moment later by the real one.
- The account section stays one quiet press away ("Open Radient account").

```
node scripts/capture-evidence.mjs <storybook-origin> \
  --only=chat-radient-out-of-credits-- \
  --themes=localOperatorDark,localOperatorLight --allow-backend
```
