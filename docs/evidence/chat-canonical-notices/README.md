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

**The local workaround the early passes needed is GONE, and this is now stated in
both directions.** Storybook could not build the preview at this branch's first
base at all: the TypeScript 7 toolchain removed the JS compiler API, and
`react-docgen-typescript` 2.2.2 reads it (`Cannot read properties of undefined
(reading 'React')`), so the build failed before any story rendered — with these
changes reverted too. The frames captured before main landed `6a952c469`
(`build(storybook): use the JSX docgen, which the TypeScript 7 move left
working`) were therefore taken with `typescript.reactDocgen: false` set in
`.storybook/main.ts` **in the working tree only**, and the file is committed
unchanged in every commit. Main's fix removed the need for it: the frames in this
set are re-derived at the head from the tracked config, with the tree clean, and
the manifest's `dirtyWorkingTree` is `false` for that pass. So the field and this
paragraph no longer contradict each other (round 3's D9): the earlier passes were
dirty, the pass that wrote the stamp was not, and the manifest's note says which
is which.

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

## Round 3: the guard the first remediation added, and the notice's repeat

Round 2's UX stream found two MAJORs in the guard round 1 introduced, and the
code reviewer found the same root cause independently: the guard asked
`window.getSelection()` on a plain `onClick`, which is page-global. `select-none`
chrome never clears a selection, so the state that suppressed the click was
preserved by the suppression itself — with any live selection the row swallowed
every click on its chrome **and** every keypress, for as long as the selection
lived. The comment above it claimed the keyboard was unaffected, which was false.

**Every line of the required behaviour was then exercised with real dispatched
gestures** — `Input.dispatchMouseEvent` press/move/release and
`Input.dispatchKeyEvent`, never `element.click()`, which is what produced the
first version's wrong claim — and all of it passes:

```
PASS  5 plain click on the label toggles
PASS  1 drag does not toggle the row
PASS  1 the selection survives the mouseup
PASS  3 click on the gutter with a selection live toggles
PASS  3 and again to collapse
PASS  4 Enter toggles with a selection live
PASS  4 Space toggles with a selection live
PASS  4 the selection survived the keys
PASS  4 Escape clears the selection
PASS  2 double-click leaves the row as it found it
PASS  2 double-click selects a word
PASS  2 double-click on an OPEN row leaves it open
PASS  6 the click did not toggle the row
PASS  6 the selection it cleared is gone
PASS  7 no tool-row summary keeps text selectable, so the guard cannot fire there
PASS  7 a click on a tool row's label with a selection live still toggles
MATRIX: all rows pass
```

Two of those rows are the ones the first attempt got wrong in opposite
directions: a double-click used to end with one net toggle, and `Enter` did
nothing at all while a selection lived. The trace the probe records with the
verdict is Chrome's own. Quoted from `matrix-round2.txt`, for the closed row:
`mousedown:1, mouseup:1, click:1, mousedown:2, mouseup:2, click:2, dblclick:2`;
and for the open row, whose first press was followed by a second one before the
multi-click began: `mousedown:1, mouseup:1, click:1, mousedown:1, mouseup:1,
click:1, mousedown:2, mouseup:2, click:2, dblclick:2`. The `mouseup`'s `detail`
is not guaranteed by Chrome and differs between runs — the round-3 review read
`mouseup:1` in the same row — which is why the revert keys on the **press**
(`mousedown` with `detail > 1`), the event that decides what gesture this is.

**The frame deltas this round are measured, not eyeballed.** The two incident
surfaces were re-captured and differ from the previous head's frames per THEME
— the earlier version of this paragraph mixed one theme's count with the
other's, and quoted the date stamp's own ink box rather than the extent of the
change. Measured with `magick compare -metric AE` against the frames at the
round-2 head, and reproduced at this head:

| surface | theme | pixels | changed-pixel box |
| --- | --- | --- | --- |
| 1280 | `localOperatorDark` | 891 | `74x18+1030+706` |
| 1280 | `localOperatorLight` | 748 | `73x18+1031+707` |
| 560 | `localOperatorDark` | 937 | `65x17+463+1119` |
| 560 | `localOperatorLight` | 807 | `64x25+464+1119` |

Every one of those boxes is the transcript's own date stamp (`56x13` and `56x15`
are the stamp's ink, not the extent of change: the box is larger because the
changed stamp text at the two viewports is wider than the glyphs that moved).
Nothing on a row moved. The notice surface changed by **85,554 pixels**, which is
the fix: the long single-line notice now paints as a static line instead of a row
that repeated itself behind its own chevron.

**What moved where, in one list**

- the guard is scoped to the gesture (a press on text the summary keeps
  selectable), the keyboard path is not gated at all (`detail === 0` is the
  click Enter and Space synthesise), and `Escape` now clears a selection this
  trigger owns — the only keyboard exit a reader with a selection had, and one a
  focused button does not get from the browser;
- the notice row and its disclosure **partition** the text, and a notice whose
  opening line is the whole of it paints through the static branch rather than
  growing a chevron that reveals the same bytes; both detail bodies gain
  `break-words`, because `pre-wrap` alone leaves `overflow-wrap: normal` and an
  unbreakable run measured `scrollWidth` 2773 in an 840px box;
- a relayed row joins a heading to its outcome (`background job 'design849'
  failed: [Errno 28] …`, 37 of the store's 39 job results) and a one-shot wake
  states its goal rather than its arming line, which carries no cadence (202 of
  the store's 967 wake rows at the head that rewrote them: 766 keep an arming
  line that does state one);
- the wake-arming clause is stripped only from a wake row, so a hub message that
  quotes the phrase keeps its own words;
- the first-sentence scan requires a capital after the terminator and rejects a
  leading `digits.`, so `approx.`, `e.g.` and `1.` no longer split a headline —
  without a table of abbreviations to keep in step with English;
- the provider the incident names is selectable like the message beside it, and
  `summaryAlign` no longer restates the default `items-center`, so the tool rows'
  TRIGGER carries the class string it had before this branch (round 2's Q4 — the
  row as a whole still differs from base by one reordered class on the chevron
  `mark` span, which predates this branch: round 3's Q13).

**The honest gap this register still has.** There are no persisted `notice`
records in the store to replay (type counts over the operator's transcripts:
message 108,140, custom 3,326, prune 846, compaction 30), so the notice surface's
long path has a fixture and a frame behind it rather than a store-wide replay.
The designer recorded that in round 2 and it is unchanged by this fix.

## Round 4: the revert, the text marker, and the two wake shapes

Round 3's review found no blocker or major in the pixels and one MAJOR in the
merge state (`docs/evidence/manifest.json`, resolved by rebasing and letting
main's own repair of that field stand). What it found in the code is here.

- **The multi-click take-back is reachable, and the residual is gone (R12).**
  The handler that could not fire is deleted rather than left documenting a bug
  it did not fix. Chrome dispatches the second press as a `mousedown` with
  `detail` 2 even when the release lands outside the trigger, and `dblclick`
  fires only when the whole gesture stays inside, so the revert moved to the
  press. The case the reviewer named — a double-click whose second release misses
  the trigger, leaving the row toggled — is covered by construction.
- **The guard's discriminator is no longer `user-select` (U17, and the reason it
  was wrong).** The question is "is this part of the summary something a reader
  can select and copy?", and a computed style answered a different one: `text`
  for the narration and `none` for the label beside it. That is how a drag across
  a row copied everything except the label that says what the row IS. `TraceLine`
  now marks its text surfaces (`data-text-surface`) and selects them all, label
  included; the guard reads the marker. Making the label selectable is therefore
  safe — it cannot re-open U7, because suppression no longer keys on the select
  behaviour at all.
- **A wake keeps its own preamble (D8) and its goal loses its bullet (U15).**
  The rule fires on the ARMING line only, which is the one predicate between the
  two shapes: a payload whose own preamble opens it keeps the preamble, because
  that is more informative than the generated line below it. The goal it quotes
  then has a leading list marker stripped, which is markup rather than words.
  Store-wide: **0** headlines lead with a bullet, from 79.
- **A relayed row whose joined headline is its whole payload discloses nothing
  (U16).** Same rule the notice register took in round 2: 4 of the store's 39
  job results were re-reading themselves behind their own chevron. Measured over
  the store with the shipped reducer: `selfRepeat` is now 0 on every custom type.
- **The three literals this branch's rules added are module constants (Q9),** so
  `pnpm lint`'s warnings for `transcript-reducer.ts` are back to the pre-branch
  count of 1.

**Corrected from round 3's reports, because the numbers did not reproduce.** The
per-theme frame deltas and changed-pixel boxes above (R14); the event trace and
the fact that its `mouseup` detail varies run to run (R15); "194 declared" and
"121 of 955 wake rows", which are 205 and 202 of 967 at this head (U18, Q10);
and the tool-row claim, which is true of the trigger rather than of the row
(Q13). **`pnpm test:desktop` at this head is `tests 752, pass 748, fail 4`**: the
three uv/pip install-layout tests plus `submit-latency.test.mjs`'s
`M1/M2/M3: the warm removes the engage from the send…`, which fails at the
pre-branch base too (Q12). **Deferred with reasons:** D10 (the joined job headline
repeats the derived label's word "job" — copy is the design stream's lane and it
recorded the nit as not asked for in this round) and R16 (the sentence scan still
cannot separate `Step one: 1. Do the thing.` or `Dr. Smith` from a sentence end;
0 of the store's statements carry either shape, so hardening it further would be
built for a producer that does not exist).

## What these frames do not prove

- **Two themes, not twelve.** The committed set is a narrowed capture
  (`manifest.json`'s `partialCapture`): `localOperatorDark` and
  `localOperatorLight`, at 1280 and (for the narrow claim) 560. The twelve-theme
  sweep was not re-run — it would rewrite 400+ frames nobody is reviewing. It can
  be re-run at this head since main fixed the docgen build (`6a952c469`); it is a
  choice not to, and the design round rendered five palettes from its own probe
  and cleared contrast at token level for the other seven.
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
