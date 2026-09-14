# Session incidents, and the harness's other statements, on their own rows

The operator's report:

> Can you make sure errors actually display their message instead of just
> "Session incident" that you need to expand to see in local-operator-ui

946 rows in his own transcripts are `session_incident` custom messages — 639 of
them an MCP authorization that expired — and every one of them painted as the
single literal string `session incident`, in the info ink, with the whole
message behind the disclosure chevron. Why a turn died was therefore a click
away, or invisible.

## What produced these frames

Storybook, driving the **production components**: the story renders
`CanonicalTranscript`, and its rows are built by the **production
`applyHistoryPage` reducer** from persisted payloads quoted verbatim out of
`~/.local-operator/sessions/…/transcript.jsonl` — one per category the
classifier emits (`mcp`, `auth`, `rate-limit`, `context-length`, `provider`,
`network`, `unknown`, `cut-off`), the three harness statements
(`session_model_switch`, `session_mcp_recovery`, `session_credential`), a
`raw`-less row for the fallback path, and a relayed `hub_message` as the bulky
control. They are the same records the app paints, so the frame judges what the
row is GIVEN as well as what it paints.

Captured over raw CDP by `scripts/capture-evidence.mjs` (private headless
Chrome on a fresh user-data-dir, killed on exit), narrowed the sanctioned way:

```
node scripts/capture-evidence.mjs http://localhost:6044 \
  --only=session-incidents --themes=localOperatorDark,localOperatorLight \
  --allow-backend
```

**`--allow-backend` is honest here and load-bearing for the claim's scope:**
another agent's backend was listening on the configured port during the run.
Nothing in this story calls out — its records are fixtures and its
`onLoadOlder` is a stub — so no frame is a function of that backend.

**One local workaround, uncommitted and disclosed.** Storybook cannot build the
preview at this head at all: `main`'s TypeScript 7 toolchain removed the JS
compiler API, and `react-docgen-typescript` 2.2.2 reads it
(`Cannot read properties of undefined (reading 'React')`), so the build fails
before any story renders — with these changes reverted too. The frames were
therefore taken with `typescript.reactDocgen: false` set in
`.storybook/main.ts` **in the working tree only**; the file is committed
unchanged. Docgen generates props tables for docs blocks, not story renders, and
`export const Story`/`Meta` types are the same either way — but this is a
difference between the tree that took these frames and the tree under review, so
it is stated rather than left for a reader to find. The proper fix (pin the
docgen path, or upgrade past the TS 7 API removal) is a repository toolchain
change, not this change's business.

## The pair

| Directory | Tree | What it shows |
| --- | --- | --- |
| [`session-incidents`](session-incidents/) | this change | The fixed rows: danger glyph and category label, the provider the incident names, the vendor's message in place and wrapping, the harness's advice behind the disclosure. |
| [`session-incidents-narrow`](session-incidents-narrow/) | this change | The same 17 rows at 560, where a row wraps hardest — the width the wrapped-mark defect was measured at. |
| [`notice-lengths`](notice-lengths/) | this change | The notice register's own length cases, including the bulky one that used to render as the literal word "Notice". |
| [`../session-incident-rows-before`](../session-incident-rows-before/) | unmodified `origin/main` (`73977340a`) | The defect, from the same story and the same payloads: ten rows reading `session incident`, the info ink, no message anywhere but behind the chevrons. |

The pair is same-viewport (1280x700), same story, same themes, and the only
difference between the two runs is the two renderer files — the story and its
fixtures sat unchanged in both. `before` is declared `supplementary` because a
sweep cannot produce it: it needs a tree that no longer exists in the
repository.

## What to look for

- **The message is the row.** `mcp`, `cut-off`, `rate-limit`, `auth`,
  `network`, `provider` and `unknown` each carry the vendor's own error text
  inline, wrapping rather than truncating. The `context-length` row is the wrap
  case: 217 characters of raw error, in two lines, tail readable.
- **Kind is carried twice, never by colour alone.** The failure is a
  `circle-alert` glyph plus its category label in the danger ink; a statement is
  the `message-square-text` glyph in the ledger's dim ink.
- **The disclosure is for the supporting half.** The opened row shows what the
  harness tells the MODEL — the suggested action and the "this is why the
  previous turn ended" sentence — which is the reason the incident exists and is
  not what a reader needs in order to know what happened.
- **The `unknown` row without a hint discloses nothing** and is a static line
  with a reserved chevron gutter, not a hole.
- **A relayed payload is not reduced to its type name either.** The
  `hub message` row states the first line that says something — stepping over
  the envelope tag both relays open with — and keeps its 1.5 kB body behind the
  disclosure.
- **One rail, one pitch.** Every row's text starts at the same x, and the rows
  sit on the ledger pitch, so a run does not go ragged where one appears.

## Measured, not eyeballed

Read out of the live DOM in the same story, in `localOperatorDark`:

| | before (`73977340a`) | after |
| --- | --- | --- |
| incident row text | `session incident` | `mcp: MCP server 'notion': MCP authorization failed; run /mcp reauth notion — authorization expired` |
| row height, one-line incident | 26px | 22px |
| row height, wrapped incident | 26px (one line: the message was not painted) | 43px (the message, wrapped in place) |
| label ink | `rgb(145, 139, 125)` (dim) | `rgb(239, 128, 120)` (danger) |
| glyph | `message-square-text`, ink-dim | `circle-alert`, danger ink |
| statement row text | `session model switch` | `session model switch: You are now running as openrouter/deepseek/deepseek-v4.1-flash (was anthropic/claude-opus-5). …` |
| text rail (every row) | x=250 | x=250 |

The pitch moved from 26px to 22px because the rows now take the ledger's dense
height instead of the comfortable one — the same 22px a run of tool rows
measures with its hairline, which is what "not ragged" means here.

The reducer was also replayed over **every persisted incident in the store**,
955 rows across the operator's `~/.local-operator/sessions`, through the shipped
`applyHistoryPage`:

```
persistedRows 955   records 950
level=error 950     category parsed 950     headline non-empty 950
headline !== "session incident" 950
categories: mcp 639, cut-off 172, rate-limit 58, unknown 50, provider 24,
            network 5, auth 1, context-length 1
```

That is the broader claim one screenful cannot make: not that this fixture
renders, but that every row of this shape in the operator's own store now says
what happened.

## Round 2: what the review rounds changed here

The four round-1 reports are on the PR. The frames above are the round-2 set; what
moved in them, and what did not:

- **The wrapped row's marks (design D1).** A 14px mark was vertically centred over
  the whole wrapped block, so a multi-line row carried its kind on line 2 — or, at
  420px, nowhere on line 1 at all. `Disclosure` gained one mode
  (`summaryAlign: "firstLine"`) and the offset it applies is exported
  (`FIRST_LINE_MARK`) so the row's glyph and the trigger's chevron take the same
  number. Measured in the DOM at 1280: every row's chevron and glyph sit 3.0px
  above the first line's box centre, wrapped rows included
  (`context-length` cy 185.8 with `rate-limit` cy 252.8), where the before-frame
  put the chevron *between* the two lines. `session-incidents-narrow` is the same
  claim at the width it was measured wrong.
- **The tool rows did not move.** All 32 registered `chat-tool-rows` frames were
  re-captured through the same command. 21 came back byte-identical; the 11 that
  differ differ **only** in bands this rig cannot make deterministic, and that is
  measured rather than assumed: a second capture of `working-labels` at the *same*
  tree differs from the first by 5,986 pixels in the same `292x148+32+32` box (the
  working line's animated spinner), and `states` differs from its committed frame
  by 399 pixels in an `18x29` box that is the running row's live clock reading
  `16s` where the committed frame reads `13s`. Those 11 frames were left at their
  committed bytes rather than carry capture noise; the pass's own
  `refreshedFrames` counts them as written.
- **The provider is back on the row (design D2).** `anthropic/claude-opus-5`
  rides the ledger's machine-voice object column, so the row reads
  `mcp: anthropic/claude-opus-5 MCP server 'notion': …`. Measured over the store,
  789 of 968 incident rows name a provider; the rest are the no-provider
  `cut-off` shape, which states that by omission.
- **The message is selectable again (UX U1).** The trigger is `select-none`, so
  the narration span opts back in and the primitive ignores a click that ended a
  selection. Exercised against the real component over CDP: selecting the row's
  message yields 82 characters, a click while that selection is live leaves
  `aria-expanded` at `false`, the selection survives, and the next click with no
  selection opens the row.
- **A relay states its message, not the envelope's manners (UX U3 / design D3 /
  review R1).** The channel's three fixed instruction lines are matched and
  skipped, and so is the wake-arming clause. Over the store: 0 of 4,389
  `hub_message` and 0 of 4,424 `peer_message` headlines are boilerplate now, where
  411 hub rows opened with the same sentence; 0 of 951 wake rows lead with the
  cancellation call; and the 34 empty relays state their envelope
  (`<subagent-message label='…' job='…'>`) instead of a closing tag.
- **A statement states its fact, not its instruction (UX U2).** The three
  statement types split at the first sentence, so a model switch reads
  `You are now running as X (was Y).` on the row and the agent-directed tail is
  behind the chevron. Measured: all 227 real model-switch rows carried that tail
  inline before.
- **A long notice states its own first line (design D5).** The `notice` branch
  used to paint the literal word "Notice" for anything over 400 characters or one
  line; `notice-lengths` is the frame that judges it, and the `notice` row's pitch
  and wrap are otherwise unchanged.
- **Not changed, and why (design D4).** The finding asked for `ml-5` on the
  detail paragraph. Measured in the live DOM at 1280, the disclosure's content box
  already sits at x250 — the same edge as a tool row's args block (x250) — and
  the paragraph shares it; `ml-5` moved it to x270, off the edge it already had.
  Reverted, with the numbers in the PR thread.

The reducer rules above are pinned by tests (`scripts/transcript-reducer.test.mjs`,
47 tests) and measured store-wide through the shipped `applyHistoryPage` over
every persisted custom row in `~/.local-operator/sessions`: 10,997 records, 0 with
an empty headline, 0 whose headline is its type name.

## What these frames do not prove

- **Two themes, not twelve.** The committed set is a narrowed capture
  (`manifest.json`'s `partialCapture`): `localOperatorDark` and
  `localOperatorLight`, at 1280 and (for the narrow claim) 560. The twelve-theme
  sweep was not re-run — it would rewrite 400+ frames nobody is reviewing, and it
  cannot be re-run at all at this head while the Storybook docgen build is broken
  (above). The design round rendered five palettes from its own probe and cleared
  contrast at token level for the other seven.
- **Not the live app.** The rows, the reducer and the transcript are the shipped
  ones, but the frames are not a screenshot of the Electron app against a live
  session; the story is the pinning surface and the reducer probe above is the
  breadth. A live-app pass is worth having and is what the next full sweep
  provides.
- **The expansion is one row, clicked, not a keyboard walk.** The story opens
  the mcp row through its own trigger (`data-capture-pending` holds the shutter
  until it is open); keyboard reachability of the trigger is the
  `Disclosure` primitive's, unchanged by this work.

## Re-capturing

The three story ids are registered in `scripts/capture-evidence.mjs`'s `STORIES`
(`chat-canonical-notices--session-incidents` 1280x800,
`--session-incidents-narrow` 560x1220 and `--notice-lengths` 1280x340), so the
next full sweep covers them in all twelve themes:

```
pnpm storybook                                  # :6006
node scripts/capture-evidence.mjs http://localhost:6006 --only=session-incidents
node scripts/capture-evidence.mjs http://localhost:6006 --only=notice-lengths
```

The `before` frames cannot be re-derived from this tree; they live in
`../session-incident-rows-before/` and are declared as a supplementary set for
that reason.
