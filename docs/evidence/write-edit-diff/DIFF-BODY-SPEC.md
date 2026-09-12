# The `write` / `edit` diff body — the law

What the expanded `write` and `edit` rows show, why each rule exists, and which
implementation it rejects. This is the app-side companion to the terminal's own
behaviour, and it is written down because two of these rules are places where
the obvious implementation is WRONG in a way a screenshot cannot show.

Source of truth, in order:

| What | Where |
| --- | --- |
| The body's ink | `local_operator/tui/widgets/tool_card.py:2208-2220` — the loop inside `_append_diff_body` (`:2178-2225`). **The loop is the authority, not the docstring**: the docstring says "only the leading marker character is coloured here", and `:2220` appends the whole line under the kind's style. |
| The strip and the cap it shares with the loop | the same `_append_diff_body` (`:2178-2225`) |
| The body-selection order it sits in | `tool_card.py:1909-1951` (`_build_content`), case 2 at `:1928-1939` |
| The line cap itself | `tool_card.py:276` (`EXPAND_MAX_LINES = 40`) |
| The counters beside it | `tool_card.py:626-642` (`_diff_counts`) |
| The payload's producer | `local_operator/tools/builtin.py:4825-4888` (`_line_delta`, `_DIFF_DETAILS_CAP_LINES`, `_diff_details`) |
| The approved port spec | `docs/evidence/tui-parity/tool-row-spec.md` § 5 and § 8 |
| The browser port that already shipped on the phone | `local_operator/mobile/web/src/components/tool-row.tsx:41-76, 95-96`; `mobile/projection.py:267-288` |

This side:

| Piece | File |
| --- | --- |
| Normalisation, strip, classification, cap | `src/renderer/src/features/chat/components/trace/tool-row-model.ts:311-554` |
| The presentational body | `src/renderer/src/features/chat/components/trace/diff-block.tsx` |
| The args-drop rule | `src/renderer/src/features/chat/canonical/canonical-transcript.tsx:260-296` (the rule itself is `isDiffBodyRow`, `tool-row-model.ts:352`) |
| Getting `details.diff` off the wire | `src/renderer/src/features/chat/canonical/transcript-reducer.ts:122-146, 597-610, 1078-1090` |

## 1. The payload

`write` and `edit` funnel their before/after states through one function
(`_diff_details`, `tools/builtin.py:4866`) so the `+N/-N` pill and the body can
never disagree about what happened. Every such tool RESULT carries:

```
details = { path, added, removed, diff? }
```

- `added` / `removed` are positive ints; when `_line_delta` is zero the whole
  `diff` key is **omitted** — `{path, added: 0, removed: 0}` and nothing else.
- `diff` is `difflib.unified_diff(before.splitlines(), after.splitlines(),
  lineterm="", n=2)`: `@@` hunks, `+`/`-` lines, context lines prefixed with a
  space, and a **nameless** `---`/`+++` header pair as lines 0 and 1.
- It is capped at `_DIFF_DETAILS_CAP_LINES = 200` with a literal `…` appended as
  the **last element** when it truncated.

Nothing on this side recomputes a diff. The payload is the producer's bytes.

The field is a LIST of strings, and every real one measured is: 9,501
`details.diff` values across the 1,166 stored transcripts this machine held on
2026-09-12 are lists of strings — no strings, no non-string members, no empty
lists, and none on an `is_error` row. Those totals are a DATED SNAPSHOT of a live
store rather than a fixed property: the store grows as sessions run, so the shape
is the claim and the counts are only its provenance. A durable row
round-trips through pydantic, so a list stays a list; the mobile fold copies each
key through untouched (`mobile/projection.py:284-288`), so it stays a list there
too. `diffFromDetails` (`tool-row-model.ts`) also TOLERATES a pre-joined string,
and that branch is defensive tolerance at a boundary typed `unknown`, not a shape
any producer sends — the phone's `diff?: string | string[]` type is its own
normaliser's tolerance, not evidence about the wire. An earlier version of this
document credited the fold with putting a string there; that claim was measured
false and is gone. An `Array.isArray`-only extraction would drop a row's body
while the counters beside it still said `+42`, which is why the tolerance stays.

## 2. The args-drop rule, and its success gate

The terminal's body selection (`_build_content`, `tool_card.py:1909-1951`) is a
ladder, and the relevant rung is case 2 (`:1928-1939`): a settled, SUCCESSFUL
`write`/`edit` with a diff expands to the **diff alone** — not the arguments, not
the output line. Its own comment gives the reason: a `write`'s arguments are the
whole new file content, so they are "the same change stated twice", and the
readable form was buried under the unreadable one.

The port keeps that rung and all THREE of its conditions in one testable place —
`isDiffBodyRow(row: {toolName, diff, isError})`, `tool-row-model.ts`, called from
`canonical-transcript.tsx` — the tool (`write`/`edit`), a payload, and
`!row.isError`. The third is the terminal's `self._state == "success"` and it is
not decoration: on a failure the arguments are the only account of what was
attempted and the error only makes sense beside them, so a row carrying both a
diff and an error paints the arguments AND the error rather than a diff alone. No
producer does that today — every error exit returns before `_diff_details`, and
all 9,501 real `details.diff` rows measured are successful `write`/`edit` results
— so the
guard is pinned by assertion (`scripts/tool-row.test.mjs`, which fails if
`!row.isError` is dropped) rather than by a frame that would have to depict a
payload the wire does not produce.

A row with **no** diff keeps its arguments, which is the honest shape for a call
that reported nothing changed (`_diff_details` omits `diff` entirely when
`_line_delta` is zero) and for a transcript predating `details` on the wire.

Every other case is unchanged behaviour: the args JSON when there is no diff,
the output block, the error block.

## 3. The header strip is POSITIONAL

Lines 0 and 1 are dropped **only when they are exactly** `---` and `+++` after
trailing-whitespace removal (`stripDiffHeader`, `tool-row-model.ts:420`). The
producer emits them nameless — empty filenames, and with `lineterm=""` no line
terminator, so each line is the separator plus a trailing space — and the path
already heads the summary row.

**Never a pattern filter over the body.** A removed content line can itself
begin `--` — a SQL or Lua comment, say — and renders as `--- …` inside the
body. A filter (`line.startsWith("---")`) deletes that real removal, silently,
and the diff then reports a change the reader cannot see. This is asserted:
`scripts/tool-row.test.mjs`, "the file-header pair is stripped POSITIONALLY,
never by pattern", which fails against a filter implementation.

## 4. Ink: the WHOLE line, by its leading character

| Leading character | Kind | Line ink (role) |
| --- | --- | --- |
| `@` | hunk header | `text-ink-muted` (the terminal's `tool.diff.hunk`) |
| `+` | added | `text-success` (`tool.diff.added`) |
| `-` | removed | `text-danger` (`tool.diff.removed`) |
| anything else (a space, `…`, an empty line) | context | `text-ink-dim` (`tool.diff.context`) |

Only the FIRST character of a line is consulted, and every character of that line
then takes the kind's ink: one span per line, no marker/rest split, so a `+` line
is green END TO END, a `-` line red end to end, an `@@` header muted in full and
a context line dim in full.

**The authority is the loop, not the docstring.** `_append_diff_body` appends each
line whole — `row.append(truncate_cells(line, line_width), style=ink)`,
`tool_card.py:2220`, inside the loop at `:2208-2220` — and nothing in the function
splits a marker off the text. Its docstring, two screens up, promises the opposite
("only the leading marker character is coloured here; the text rides the card's
default"), and the first round of this port followed the docstring. Dumped off the
real card (`ToolCard("t","edit",…).mark_done(…, details={…})`, `toggle_expanded()`,
`_build_content(80)`), the spans settle it:

```
103-112  #ef8078  '-old line'    <- one run, NINE cells
115-124  #57c785  '+new line'    <- one run, NINE cells
```

Nine cells for a nine-character line is a whole-line run. The phone port that
already shipped sides with the loop (`mobile/web/src/components/tool-row.tsx:52-63`
puts `text-success`/`text-danger` on the whole-line span), and so does the ask
this body exists to answer — "the same git diff visual as the TUI", "green for
additions, red for removals": 40 green rows read as 40 additions at a glance,
where 40 rows of ordinary text with 40 small green glyphs in them do not.

Whole-line ink also fixes what a marker-only body could not: a WRAPPED
continuation inherits its line's ink, so the tail of an addition reads as part of
the addition instead of starting at column 0 in body ink, in the same column as
the markers.

**Measured on all twelve palettes** — WCAG ratio of the role ink on `sunken`, the
well's ground:

| ink on `sunken` | tightest palettes | widest palette | floor |
| --- | --- | --- | --- |
| `success` | **4.58** (sage), 4.59 (localOperatorLight), 4.82 (iceberg) | 15.37 (neon) | 4.5 |
| `danger` | **4.73** (sage), 4.86 (iceberg), 4.90 (localOperatorLight) | 8.52 (obsidian) | 4.5 |
| `ink-dim` (context) | 4.65 (localOperatorLight), 4.67 (sage) | 7.87 (radient) | 4.5 |

Both semantic pairs are ALREADY asserted by the contract this repo enforces:
`scripts/contrast-contract.mjs` lists `accent success warning danger info` in
`AS_TEXT` and asserts them against `canvas`, `surface` and **`sunken`**. So a
wholly green line is a measured pair rather than a new unasserted one, and
`pnpm check-themes` re-proves it on all twelve on every run (1910 assertions, 0
pinned exceptions).

**A role wash was considered and rejected.** `success` on `success-wash` bottoms
out at 4.66:1 and `danger` on `danger-wash` at 4.62:1 — the same floor as plain
role ink — while it puts a second ground inside a well whose whole point is being
`sunken`: un-washed `@@` and context rows would then sit on a different ground
from washed `+`/`-` rows, striping the body, and it hands a status meaning to a
ground role `docs/branding.md` § 2 reserves for a callout's fill.

Roles only, no hex and no opacity, and the three kinds are distinguishable **with
no colour at all** — `@`, `+`, `-` are different characters — which is the same
rule the outcome glyphs follow.

## 5. Cap and overflow marker

`DIFF_EXPAND_MAX_LINES = 40` (`tool-row-model.ts`), the terminal's shared
expanded-body cap (`EXPAND_MAX_LINES`, `tool_card.py:276`), applied **after** the
header strip — the terminal counts
the stripped list, and capping first would announce two lines more than it hid.
The overflow line is spelled exactly as the terminal spells it:

```
… 4 more diff lines        … 1 more diff line
```

Singular and plural, because "… 1 more diff lines" is the kind of copy a reader
notices instead of the number.

The producer's own trailing `…` (on a diff truncated at 200) is ORDINARY
CONTENT: it is line 201, it classifies as context, and it is counted and hidden
like any other line. A body that special-cased it would under-count the hidden
lines by one on every capped payload. Both the count and the passthrough are
asserted in `scripts/tool-row.test.mjs`.

The body's height ceiling is **derived from the cap** rather than picked: 40
lines plus the marker row at `text-mono-sm`'s 0.75rem/1.45 is 41 × 17.4px, plus
the 12px padding on each side — `max-h-[740px]`, `diff-block.tsx`. A shorter
ceiling hides the marker that makes the cap honest, which is not hypothetical: at
720px the capped body clipped it by 17px and the frame said "40 lines" with
nothing saying there were more. Measured at the cap with unwrapped rows: 737px of
content in a 737px clip, no scroll, marker inside.

**And the marker is PINNED to the well's foot, because that derivation only holds
for UNWRAPPED rows.** A wrapped body is the shape that actually reaches the cap:
40 long lines at a 560px column are 80 rows — 1415px of content in a 738px client
box, measured in the live DOM — so a marker left in the flow begins 648.6px BELOW
the clip at rest, and the reader saw a well that looked complete while rows were
hidden. The pin lifts that row by a different quantity, 677px, which is also this
body's `maxScroll` (`scrollHeight - clientHeight`, 1415 - 738); the two coincide
only because the well's 12px bottom padding is the pin's own `bottom: -12px`
offset, and the pinned box top lands 709.61px inside the well. That
is the same defect class as the 720px ceiling. `sticky -bottom-3 pb-3 -mb-3` in
`diff-block.tsx` holds it at the foot at every scroll position; the `pb-3` gives
the pinned row the well's own bottom padding as background so nothing shows
through underneath it, and `-mb-3` cancels that padding in the FLOW, which is
load-bearing rather than cosmetic: without it the unwrapped at-cap body goes to
749px of content in a 738px clip — a scroll region at the exact height where
there is supposed to be none.

## 6. Failure modes this handles

| Shape | Behaviour | Why |
| --- | --- | --- |
| `diff` absent (nothing changed) | `null`; the row keeps its arguments | "this call reported no change" is a real statement, not a missing one |
| `diff: []`, `diff: ""`, `diff: [1, 2]` | `null`, same as absent | all-malformed is not a diff |
| `diff: [1, "+a", null]` | `["+a"]` — non-strings dropped | `String({})` is `"[object Object]"`, a line no producer wrote |
| `diff: "+a\n-b"` (pre-joined string) | `["+a", "-b"]` | tolerated at an untyped boundary, not a shape any producer emits — see § 1 |
| a replayed frame with `details` stripped | the previous array, **by reference** | the live-event budget strips `details` when a row exceeds its share (`_bound_live_result_in_place`, `session/frontend_state.py`), and an absent diff is not a claim that nothing changed |
| a replayed page carrying the same diff | the previous array, **by reference** | `shallowEqual` compares by `!==`; a rebuilt array would re-render the row and its body on every polled delta |
| a `write`/`edit` row with no `details` at all (a transcript predating the field) | args JSON, as before | unchanged fallback |

## 7. What is deliberately NOT ported from the terminal

- **Cell arithmetic.** The terminal measures in cells and truncates each line
  (`truncate_cells`); the app wraps (`whitespace-pre-wrap`) inside a sunken well
  and never truncates a diff line. Cutting a diff mid-file-path loses the fact
  the line carries; a browser has the room to wrap.
- **Tab width.** Three different answers, measured, and none of them two. The
  terminal's own arithmetic counts a tab as ZERO cells (`rich.cells.cell_len("\t")
  == 0`) while it paints an 8-column stop; this browser advances a tab by
  21.6094px against a 7.2031px space — exactly 3.0000 columns — because
  Tailwind v4's preflight sets `tab-size: 4` on `html, :host`, not the `<pre>`
  default of 8; and the app's other machine-voice blocks (`output-block`, the args
  block) inherit that same 4. No `tab-size` is invented here; if the app ever
  picks one, this body inherits it with them. The frames show the resulting
  alignment; they do not argue it is right.
- **The inert-activation notice and auto-open.** `⟨no output⟩` and
  `open_on_settle` for bang-mode rows are row behaviours this app has not
  ported; the body is reached by clicking the row, which is what the frames
  exercise.
