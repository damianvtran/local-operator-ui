# The action row under the turn-closing answer

Issue #695, and the design memo's (a)–(h) rulings. The reporter's habit —
"copy response" under the reply, ChatGPT-shaped — met a surface that had no
control there at all: every per-message action lived in a hover-only toolbar at
the turn's top-right (`components/message-item/message-controls.tsx`, reachable
only from two story files and superseded here), and the desktop UI ships no
`/copy` slash command, so a reader who missed it had no second route.

This set is the change's own evidence, and its pair under
[`../chat-canonical-message-actions-before/`](../chat-canonical-message-actions-before/)
is half the claim: a frame of the row alone cannot show that the reader used to
have nothing on that line. **The row is discoverable because it is ON SCREEN at
rest**, so every state below is photographed with no pointer in the frame unless
the state IS the pointer.

## What is in it

| directory | state | what it is for |
|---|---|---|
| `rest/` | a settled answer, no pointer | the discoverability claim itself |
| `hover-answer-no-corner-control/` | the pointer parked on the answer | the superseded pattern's own region, with `expectPresent: '[data-lo-answer-actions]'` and `expectGone: '[data-lo-link-toolbar]'` asserted |
| `hover-copy/` | the pointer on Copy | the hover step: `accent-wash` ground, `accent` ink |
| `focus-copy/` | Tab-reached Copy, real presses | the focus ring, and the "Copy" tooltip |
| `copied/` | Copy pressed | the tick and the `Copied` name, asserted by `expectAttribute` |
| `short-answer/` | a one-line answer | the row must not read as a second sentence |
| `refused/` | a refusal | the row is present; the danger ink stays on the prose |
| `truncated/` | a partly-received answer | the caption above, the row below |
| `streaming/` | a settled turn beside an in-flight one | the row on the settled answer, and NONE on the in-flight turn's rows |
| `multi-answer/` | two settled answers in one turn | exactly one row, on the closing answer |
| `bar-suppressed/` | a turn folded into its bar | the actions still on the line, the bar keeping its numbers and stamp |
| `narrow/` | 420px, `isSmallView` | one line, buttons intact, no wrap, focus reachable |

Six themes, chosen by the memo's logic rather than by taste: `localOperatorLight`
and `localOperatorDark` (the brand), `sage` and `catppuccinMacchiato` (the two
smallest ground steps in the fleet — ΔE00 2.05 and 2.08 against the contract's
4.0 floor for a findable surface, where a wash that vanishes matters most),
`obsidian` (the lowest canvas, L\* 12) and `radient` (ΔE00 6.76, the widest step,
which must **not** move). The other 53 palettes are covered by
`pnpm check-themes`, which reads all of them.

## The measured rail (the memo's Q1)

A still cannot settle an edge claim, so these numbers come from the rendered DOM:
`scripts/chat-alignment-geometry.mjs` gained this set's two entries and an
`actions`/`line` measurement, and the command is re-runnable.

```sh
node scripts/chat-alignment-geometry.mjs http://127.0.0.1:6077 --json
```

| story | prose.left | content.left (gutter) | toolbar.left | first button | railDelta | line box | line height | meta span | stamp.left |
|---|---|---|---|---|---|---|---|---|---|
| `chat-canonical-message-actions--rest` | 107 | 107 (0px) | 107 | 107 | **0** | 107→917 | 28 | 17.4 | 794.7 |
| `chat-canonical-message-actions--bar-suppressed` | 107 | 107 (0px) | 107 | 107 | **0** | 107→917 | 28 | — | — |

**Q1, answered and closed.** The shipped head paints NO agent glyph and no gutter:
`content.gutterPx` is **0** for both states, `MessageContainer` is `relative
w-full` for an agent row (its own header states D11 — the 40px gutter and the
avatar are deleted, and `message-avatar.tsx` has no importer), and the row is a
SIBLING of the answer's content box inside that container, so toolbar.left and
the prose's left edge are the same 107px by construction rather than by a second
measurement. The comment on the foot-line region that named a `pl-10` gutter —
the stale claim the memo's D1 flagged — is corrected in this change rather than
left standing beside a frame that contradicts it. **The answer and the ledger
share the rail; the caption follows the actions on the same line when there is
one.**

Two buttons, `size-7` (`icon-sm`) each with a 4px gap: the toolbar measures
60×28 and its first button 28×28.

## The accepted cost, restated honestly

The closing line is **28px** tall where the `text-meta` line under an answer was
**17.4px** — the caption's own line box, measured on the same DOM — so a finished
turn grows by **+10.6px**, not the ~+20px the memo estimated. The `mt-1` (4px)
above it is unchanged and the answer itself never moves, because the line is
`mt-1` on the flex column rather than a reserved strip.

**And on a bar'd turn it is a line that was not there before**: when a run folds
into its bar the closing line is otherwise suppressed (`closingLineSuppressed`),
so those turns gain the actions' 28px line plus its 4px margin. That is the state
`bar-suppressed/` photographs; it is called out here rather than averaged into
the 10.6px above.

## One thing this set cannot show, stated rather than implied

The memo's sketch puts the actions on the same line as `Worked for 1m 12s · 8
actions`. In the shipped product that composition is rare, and the frames say so
honestly: the caption spans are gated on `foot.actions > 0` (a turn with no tool
rows has no numbers to state — `rest/` and `short-answer/` are exactly that
turn), and a turn WITH tool rows folds its run into the bar, which takes the
numbers and the stamp and suppresses the caption (`bar-suppressed/`). What the
frames show is the two shapes the app actually paints: **actions + stamp** on a
turn that does not fold, and **actions alone** on a turn that does. The design
round should judge the row against those, not against the sketch.

## How they were taken

```sh
node scripts/capture-evidence.mjs http://127.0.0.1:6077 \
  --only=chat-canonical-message-actions-- \
  --themes=localOperatorLight,localOperatorDark,sage,catppuccinMacchiato,obsidian,radient \
  --allow-backend --theme-settle-ms=180000
```

Storybook 8.6.12 on the shipped `.storybook/main.ts` (which sets
`reactDocgen: "react-docgen"`; the stale paragraph in `capture-evidence.mjs`'s
header that told a capturer to override it is corrected in this change), headless
Chrome as the rig always runs it. The entries are narrowed with `--only=` and a
trailing `--` so the pre-change set beside them (`chat-canonical-message-actions-
before--…`, whose ids also contain the prefix) is never touched by this run.

`--allow-backend` because the operator's live daemon answers on :1111 and must not
be stopped for a capture, and every story here is a static fixture
(`frontend={null} gate={null}`) that never contacts it. `--theme-settle-ms`
because this host is loaded and the guard's 10s default does not fit it. The
hover, focus and press entries are real input through the input pipeline —
`hover` moves a pointer, `tabTo` presses real Tabs until the Copy button holds
focus, `press` is a real press — because a class that faked either state would
photograph the story.

## What this set is NOT

Component-level frames from Storybook, not the whole app: no sidebar and no
composer are in them. It carries **no frame of the dead component** — the memo
rules that out, and the superseded top-right hover pattern is named in prose in
`hover-answer-no-corner-control/`'s own entry rather than photographed. These
frames contain no data from any machine.
