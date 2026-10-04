# The ask card's recommendation, its row mark, and its full text

Rendered evidence for PR #826 (`feat(chat): the ask card's recommendation, its
row mark, and its full text`, branch `feat/ask-card-1004-signals`) — the last of
the design note's three reports on the queued-ask card, after the drawer's
container (#820) and the fleet scope (#825).

Six frames, one per state, all shot in `localOperatorDark`. Each frame sits at
`<state>/localOperatorDark.png`, so the sweep judges it as a picture of that
theme's ground — a `.png` whose stem IS a palette id is judged in any container
(`scripts/check-evidence.mjs`'s `frames()`), which is why the container is the
one the rig shot and the NAME is what carries the claim.

## Provenance — read this before citing a frame

**Every frame here was shot at `d5a083bf93a`**, the branch head carrying
`fix(chat): read the ask card's recommendation from the wire's own index`, on the
wire's real shape.

These frames REPLACE the superseded set the PR's first round cited (its
`frames-1004-impl/after/` half), which was shot from a fixture carrying
`recommended: true` on an OPTION. **That shape is not on the wire.** The core's `AskOption` is `{label, description}` with
`extra="forbid"`, and the recommendation is `AskQuestion.recommended` — an
integer index the validator normalises to `0` and hoists, which `asks/queue.py`'s
`_question_shape` writes beside `options`. So the earlier frames evidenced a
payload no producer sends, and the drawer half they appeared to prove was inert
on every install (agent review round 1, R1-1). Every frame here is shot from a
fixture that carries the question-level index — the same shape the operator's own
ask ledgers carry.

The container is kept exactly as shot (PNG, byte-identical to the re-shot set):
the gate judges a frame by its NAME and derives the containers it walks, so a
re-encode would transform the artefact without changing what it is judged as.

| frame | story | what it settles |
| --- | --- | --- |
| `recommended-selected/` | `chat-asks-queued-asks--recommended-selected` | the drawer now draws the mark at all (it drew nothing before), keyed on `question.recommended`. Label bolded + `▸ Recommended` beside it |
| `recommended-passed-over/` | `chat-asks-queued-asks--recommended-passed-over` | the deciding state: `production` selected, `staging` still bolded and badged |
| `full-text-at-width/` | `chat-asks-queued-asks--full-text-at-width` | 452-char question, 65-char label, 320-char description at the family's 560px cap |
| `full-text-at-floor/` | `chat-asks-queued-asks--full-text-at-floor` | the same card at the 400px floor |
| `session-row-asks/` | `chat-session-status--asks-outstanding` | the session row mark: accent glyph + count digits |
| `dock-recommended/` | `chat-ask-options--options` | the dock card, unchanged in behaviour and re-shot against the shared badge |

## The two findings these frames carry

**U1 (design/UX, MINOR) — the badge detached from its label on a long label.**
`full-text-at-width` / `full-text-at-floor` show the fix: the label is now a
`min-w-0` flex item in a `nowrap` row, so it wraps INSIDE its own box and the
badge keeps its place on the label's first line. Measured by the rig (CSS px,
from the numbers the capture printed):

- 560px: badge `y=234`, label box `y=231` (two lines, 43.4px tall) — the badge
  is on the label's FIRST line.
- 400px: badge `y=294`, label box `y=291` (three lines, 65.1px tall).

Before, with `flex-wrap`, the badge became a flex line of its own 17px directly
above the description (design round 1's measurement) and read as a lead-in line
of the description. It can no longer do that at either width.

**D1 (design, MINOR) — a contrast floor.** The row mark is now two inks: the
14px glyph keeps `text-accent` (a graphic, 3:1 floor, 4.24:1 at worst on
`row-selected`) and the 12px count digits take `text-ink-muted` (5.53:1 at worst
over every ground the row can sit on). `session-row-asks/` shows the mark; the
pair is asserted by the `session row ask mark` row in
`scripts/contrast-contract.mjs`.

## Rig

A scratch rig in the session that made the change, not `scripts/capture-evidence.mjs`
(the session's rig is not committed here; what this set is checked by is the gate):
one Storybook dev server and ONE private headless Chrome
(`--headless=new --use-mock-keychain`, session-unique profile) launched through
the repo's own `scripts/chrome-keychain.mjs`, driven over raw CDP, one frame per
state in `localOperatorDark`. Both processes were reaped by exact pid and the
profile swept (`chrome reaped: 0 left`). The set is declared in
`docs/evidence/manifest.json`'s `supplementary` list because a sweep cannot
produce these frames — they are states of a card the sweep's own story list does
not carry (see the PR's "Not addressed" §2).
