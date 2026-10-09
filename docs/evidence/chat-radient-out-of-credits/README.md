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

At 420 wide the unreadable state's buttons wrap onto their own lines (y 247 / 283
/ 319, x=64) and nothing overflows (box 316 wide, overflow 0).

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
