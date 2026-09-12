# The `write` / `edit` diff body — the law

What the expanded `write` and `edit` rows show, why each rule exists, and which
implementation it rejects. This is the app-side companion to the terminal's own
behaviour, and it is written down because two of these rules are places where
the obvious implementation is WRONG in a way a screenshot cannot show.

Source of truth, in order:

| What | Where |
| --- | --- |
| The body's ink, strip and cap | `local_operator/tui/widgets/tool_card.py:2178-2225` (`_append_diff_body`) |
| The body-selection order it sits in | `tool_card.py:1909-1956` (`_build_content`), case 2 |
| The line cap itself | `tool_card.py:276` (`EXPAND_MAX_LINES = 40`) |
| The counters beside it | `tool_card.py:626-650` (`_diff_counts`) |
| The payload's producer | `local_operator/tools/builtin.py:4825-4895` (`_line_delta`, `_DIFF_DETAILS_CAP_LINES`, `_diff_details`) |
| The approved port spec | `docs/evidence/tui-parity/tool-row-spec.md` § 5 and § 8 |
| The browser port that already shipped on the phone | `local_operator/mobile/web/src/components/tool-row.tsx:41-76, 95-96`; `mobile/projection.py:267-288` |

This side:

| Piece | File |
| --- | --- |
| Normalisation, strip, classification, cap | `src/renderer/src/features/chat/components/trace/tool-row-model.ts:315-515` |
| The presentational body | `src/renderer/src/features/chat/components/trace/diff-block.tsx` |
| The args-drop rule | `src/renderer/src/features/chat/canonical/canonical-transcript.tsx:258-292` |
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

Two wire shapes arrive at the same field, and both are accepted
(`diffFromDetails`, `tool-row-model.ts:354`): a durable row round-trips through
pydantic so a list stays a list, while the mobile fold
(`mobile/projection.py:285`) and any pre-joined producer put a **string** there.
An `Array.isArray`-only extraction drops that row's body while the counters beside
it still say `+42`.

## 2. The args-drop rule

The terminal's body selection (`_build_content`, `tool_card.py:1909-1956`) is a
ladder, and the relevant rung is case 2: a settled `write`/`edit` with a diff
expands to the **diff alone** — not the arguments, not the output line. Its own
comment gives the reason: a `write`'s arguments are the whole new file content,
so they are "the same change stated twice", and the readable form was buried
under the unreadable one.

The port keeps that rule and guards it on the **tool and the payload**
(`isDiffBodyTool(record.toolName) && record.diff`, `canonical-transcript.tsx:274`)
rather than on the call's state, which is how the mobile port guards it too.
The two cannot disagree in practice — a failed or interrupted `write` returns
before it has a diff — and naming the payload is what lets a row that reported
**no change** keep its arguments, which is the honest shape for it.

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

## 4. Ink by the LEADING character, and only the marker

| Leading character | Kind | Marker ink (role) |
| --- | --- | --- |
| `@` | hunk header | `text-ink-muted` (the terminal's `tool.diff.hunk`) |
| `+` | added | `text-success` (`tool.diff.added`) |
| `-` | removed | `text-danger` (`tool.diff.removed`) |
| anything else (a space, `…`, an empty line) | context | `text-ink-dim` (`tool.diff.context`) |

Only the FIRST character is consulted, and only the marker is tinted: the text
of every line rides the ordinary body ink. That is the law
`_append_diff_body`'s docstring states — "only the leading marker character is
coloured here; the text rides the card's default so a coloured line never reads
as a wall of tint" — and it is why a `-` line's prose stays at full contrast
instead of receding into the danger ink the way a status message would.

Roles only, no hex and no opacity: `success` and `danger` as text on a `sunken`
ground are asserted on all twelve palettes by `scripts/contrast-contract.mjs`
(`AS_TEXT` against `canvas`/`surface`/`sunken`), so the pair this body introduces
is measured rather than new.

The three markers are distinguishable **with no colour at all** — `@`, `+`, `-`
are different characters — which is the same rule the outcome glyphs follow.

## 5. Cap and overflow marker

`DIFF_EXPAND_MAX_LINES = 40`, the terminal's shared expanded-body cap
(`tool_card.py:276`), applied **after** the header strip — the terminal counts
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
the 12px padding on each side — `max-h-[740px]`, `diff-block.tsx:119`. A shorter
ceiling hides the marker that makes the cap honest, which is not hypothetical:
at 720px the capped body clipped it by 17px and the frame said "40 lines" with
nothing saying there were more. The scroll region that remains is for a WRAPPED
body — a 560px column turns 40 lines into 80 rows — which is the case it was
always for.

## 6. Failure modes this handles

| Shape | Behaviour | Why |
| --- | --- | --- |
| `diff` absent (nothing changed) | `null`; the row keeps its arguments | "this call reported no change" is a real statement, not a missing one |
| `diff: []`, `diff: ""`, `diff: [1, 2]` | `null`, same as absent | all-malformed is not a diff |
| `diff: [1, "+a", null]` | `["+a"]` — non-strings dropped | `String({})` is `"[object Object]"`, a line no producer wrote |
| `diff: "+a\n-b"` (pre-joined string) | `["+a", "-b"]` | the mobile fold's shape |
| a replayed frame with `details` stripped | the previous array, **by reference** | the live-event budget strips `details` when a row exceeds its share (`_bound_live_result_in_place`, `session/frontend_state.py`), and an absent diff is not a claim that nothing changed |
| a replayed page carrying the same diff | the previous array, **by reference** | `shallowEqual` compares by `!==`; a rebuilt array would re-render the row and its body on every polled delta |
| a `write`/`edit` row with no `details` at all (a transcript predating the field) | args JSON, as before | unchanged fallback |

## 7. What is deliberately NOT ported from the terminal

- **Cell arithmetic.** The terminal measures in cells and truncates each line
  (`truncate_cells`); the app wraps (`whitespace-pre-wrap`) inside a sunken well
  and never truncates a diff line. Cutting a diff mid-file-path loses the fact
  the line carries; a browser has the room to wrap.
- **The full-line tint.** The python loop appends each line with its kind's ink,
  so on a terminal a `+` line is green END TO END. The port tints the marker
  only, per the docstring's stated law and per the port instruction. This is the
  one place the app deliberately renders differently from the terminal's actual
  code rather than from its stated intent — flagged for the design round rather
  than silently resolved.
- **Tab width.** The terminal counts a tab as one cell. The browser renders it
  at the `<pre>` default (8 columns), exactly as the app's other machine-voice
  blocks (`output-block`, the args block) already do. No `tab-size` is invented
  here; if the app ever picks one, this body inherits it with them.
- **The inert-activation notice and auto-open.** `⟨no output⟩` and
  `open_on_settle` for bang-mode rows are row behaviours this app has not
  ported; the body is reached by clicking the row, which is what the frames
  exercise.
