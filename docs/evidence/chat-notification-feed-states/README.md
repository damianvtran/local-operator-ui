# The states a click can paint — cached rows, a skeleton, and a conversation that is gone

The desktop app's click path paints a conversation before the backend answers:
from this window's own memory (a **cached paint**), as a **skeleton** when it has
never shown it, or as a **named state** when the machine does not have it. Each
one is judged by looking at it, which is why they are committed here rather than
described: whether a caption reads as "behind" or as "broken", whether a
skeleton is visible at all against its own ground, and whether the composer
below a dead conversation says something true are all judgements no assertion
makes.

These frames come from the repo's own Storybook capture path
(`scripts/capture-evidence.mjs`), so they render the production
`CanonicalTranscript` and the production `MessageInput` — not a fixture drawn to
look like them. Every frame in this set was re-taken at
**`3c474c120`** (see `manifest.json`'s `head`, `srcTree`, `scriptsTree` and
`capturedAt`, which this pass re-stamped), in three palettes: the two brand
themes plus `obsidian`, which is where the loading state was worst.

```sh
npx storybook dev -p 6317 --no-open
node scripts/capture-evidence.mjs http://localhost:6317 \
  --only=chat-notification-feed-states --themes=localOperatorDark,localOperatorLight,obsidian --allow-backend
node scripts/capture-evidence.mjs http://localhost:6317 \
  --only=chat-composer-states --themes=localOperatorDark,localOperatorLight,obsidian --allow-backend
```

## What each frame proves, with the numbers

The readings below were taken from the live DOM of the same stories in the same
headless Chromium the capture uses (1280x600 / 720x260 / 900x160, DPR 1).

| frames | what it proves | measured |
| --- | --- | --- |
| `cached-paint/{localOperatorDark,localOperatorLight,obsidian}` | a cached paint is rows at full `ink` plus one caption — no dimming, no scrim, no opacity | scroll box `clientHeight` 527 / `scrollHeight` 527 (`scrollTop` 0), caption rect top 0 / bottom 33.4 — the caption is in the pane, and the frame fits, which is why it cannot show the defect below |
| `cached-paint-overflow/*` | **the caption is on screen when the transcript is TALLER than the pane**, which is the ordinary case: the cache is only written for a conversation this pane has already painted | `clientHeight` 527, `scrollHeight` **2570**, `scrollTop` 0, content box top **-1994.5** / bottom 544, **37 rows**, caption rect top **0** / bottom 33.4, `color: rgb(145,139,125)` (`--lo-ink-dim`), `font-size: 12px`. Before the fix the caption was the content's first child and measured **top -2028** in a 560px pane |
| `reconciled/*` | the same rows once the owner's snapshot lands: the caption is gone and nothing moved | caption absent; content bottom unchanged at 544 |
| `loading-first-open/*` | a first-ever open is a skeleton, never the empty-conversation claim | three `aria-hidden` bars (`elevated`), label `Loading conversation…` at 12px `rgb(143,143,151)` (`--lo-ink-dim`); on `obsidian` the bars are `rgb(39,39,42)` = `#27272A` = `elevated`, against a `canvas` of `#09090B` (was `sunken` `#030307`, ΔE00 1.23 — a black pane with one sentence) |
| `conversation-gone/*` | the state with nothing cached: what happened, what it means, and the way out | `This conversation is no longer on this machine.` — read out of the DOM, not the source |
| `conversation-gone-with-paint/*` | the same state reached **the way a click reaches it**, with this window's cached rows seeded — the half the empty-rows frame cannot cover | DOM reads: `saysGone` true, `saysStartOfConversation` **false**, `hasTimestamp` **false**. Both gates are the fix: the history slot and the footer timestamp used to render over the seeded rows, painting "Start of conversation" and an orphaned date under a statement that the conversation does not exist |
| `the-two-misses/*` | "this may be behind" and "this is gone" side by side, so the two are judged for whether they read apart | 760x200 |
| `cached-paint-narrow/*` | the same caption at 420x600, the narrow end of the supported range | 420x600 |
| `chat-composer-states--idle` | the ordinary composer, for comparison | `placeholder` `Ask me for help`, `disabled` false, placeholder colour `rgb(145,139,125)` = `#918B7D` = `--lo-ink-dim`, `opacity: 1` |
| `chat-composer-states--busy` | a turn in flight keeps a truthful placeholder (`Agent is busy`) and still accepts typing — it steers | `disabled` false |
| `chat-composer-states--conversation-gone` | the composer under a conversation this machine does not have | `placeholder` `This conversation is gone`, `disabled` **true**, placeholder colour **`rgb(95,90,78)`** = `#5F5A4E` = `--lo-ink-disabled`, `opacity: 1`. The colour step is the point: disabled changes colour, never opacity, and before this pass the only signal was `cursor: not-allowed` after the user had typed |

Two defects in this set were found by *looking* at frames rather than by a test,
and both are in the table above: the three rowless states rendered as blank
(`h-0 overflow-hidden`, 99.92% one colour) and a cached paint claimed "Start of
conversation" through the exhausted-history slot.

## What this set does NOT contain, and why

Nothing below is implied by the frames above; each is stated so that a reviewer
can see the edge of the evidence.

- **Consecutive frames of the live click flow** (first frame vs settled). The
  design asked for these to prove the wrong-conversation flash is gone. They
  need a second instance of the built app driven through the click entry against
  a backend that advertises `desktop_feed` — and the operator's live backend
  does not (the backend half is a separate, unmerged PR), so every path these
  frames would show stays capability-gated off against it. The faithful driver
  is this change's own viewer endpoint, dialled with `resume_session` (design
  §9.3), which is a harness this session did not build. What the pair would have
  shown about the PAINT half is above instead: `cached-paint` and `reconciled`
  are the same conversation in the two states, captured at the same viewport in
  the same pass.
- **The click→first-row p50/p95 over ≥20 runs.** The marks are in the tree
  (`lop:open:requested` at the click, `lop:open:first-row` at the first painted
  row, the measure between them) and the stale-mark defect that would have made
  the numbers wrong is fixed — see `canonical-transcript.tsx`, the requested mark
  is now consumed once and refused when older than a minute. Reporting numbers
  needs the same live harness as the frames above.
- **The macOS banner itself.** macOS exposes no API to screenshot its own
  notification, so the banner frames in this repository are captured by hand
  (`scripts/notification-evidence.mjs` prints what it sent, and the operator
  screenshots while it is on screen). Unchanged by this pass.
- **The sidebar's disconnected line.** No story renders the sidebar's rows, so
  this needs a live-app capture of the kind `docs/evidence/chat-title` uses. It
  also needs a state that is deliberately hard to stage: the feed disconnected
  while the catalogue still answers (a backend that is fully down suppresses the
  line by design, because the `role="alert"` above it already says so).
