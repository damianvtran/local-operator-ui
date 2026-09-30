# The composer cluster, executed

Three operator reports about the composer, and one driver run twice over the
same story — the production `MessageInput` over the file's fixture desk bridge —
so each pair is two frames of the SAME keystrokes on two trees.

RE-SHOT ON THE FOLDED HEAD: main's #683 (the shared-composer lift) moved the
component to `shared/components/composer/` mid-lane, so both halves were shot
again on the folded tree, the base half from the same trio of disabled gates.
The readings are the pair's two `result.json`s and are unchanged from the
pre-fold shoot; eight of the sixteen frames' bytes moved (sub-pixel raster
noise), and the states they show are identical — the lift changed nothing these
three surfaces photograph.

The reports:

- **#673** — ArrowUp in a box holding a draft swapped the draft for a history
  entry. The first-line gate was the trigger, so *any* caret on line 1 took the
  recall branch whatever the box held.
- **#664** — `$skill` was prose on the desktop: no list, and Enter sent the
  literal text instead of the skill's expansion.
- **#676** — `/theme dracula` applied the theme and then re-presented the whole
  theme table under the applied receipt: the double-selection UI.

## What each frame is

Every case types into the real composer and plays real key events (raw CDP
`Input.dispatchKeyEvent`, the technique `chat-slash-enter-gestures`' README
describes), then reads the box, the list, the send the composer dispatched
(story record: `[data-sent]`) and the dialog that mounted.

| case | gesture | the base half (arms disabled) | this branch |
| --- | --- | --- | --- |
| `history-empty-recalls` | ArrowUp on an **empty** box, then ArrowDown | `draft: "run the migration again please"`, then ArrowDown returns to `""` | unchanged |
| `history-draft-single-line` | type `draft`, Home, ArrowUp | `draft: "run the migration again please"` — the draft is **gone** | `draft: "draft"` |
| `history-draft-multiline` | type `one\ntwo`, ArrowUp (moves to line 1), ArrowUp | `draft: "run the migration again please"` — the draft is **gone** | `draft: "one\ntwo"` |
| `skill-list-open` | type `fix this $res` | no list, `rows: 0` | list **Skills**, the `research` row, selected |
| `skill-accepted` | click the `$research` row | nothing to click; `draft: "fix this $res"` | `draft: "$research fix this "` — token to the front, prose kept as its request |
| `skill-send-expanded` | accept the row, then Enter | `[data-sent]: "fix this $res"` — the literal text | the expansion: header, `<skill name="research" invocation="$research fix this">`, the body, the request last |
| `theme-qualified` | `/theme dracula` + Enter | the confirmation receipt **over the full 59-row grid** | the confirmation: `Theme: Dracula`, **no grid** |
| `theme-bare` | `/theme` + Enter | the grid | unchanged — the modal keeps the table for a bare `/theme` |

The multiline case records the walk it expects: after the first ArrowUp the
reader can see `draft: "one\ntwo"` with the caret at `3` (line 1) and the draft
intact — the second ArrowUp is the one that swapped it on the base half and does
nothing on this branch.

## The base half is this tree with three gates disabled

`disabled-gates/result.json` is that run's own record. The tree it ran from is
this branch's head with exactly three one-line reversals — each fix's arm gated
off at its own gate, so the keystrokes the cases play are the same ones a user
plays:

- `use-message-input.ts` — the recall arm's engagement test replaced by the base
  tree's own `isCursorAtFirstLine()` gate.
- `message-input.tsx` — the `$` list's query `enabled: false` (the base tree has
  no list), and the submit's parse call returning `null` (the base tree sends
  prose).
- `destination-pickers.tsx` — the theme options passed unconditionally (the base
  tree always re-presents the table).

Everything else — the story, the driver, the composer — is byte-identical
between the two runs; the driver's own case descriptions and the verdicts in
each `result.json` are the run's account of itself (`6` failures of `8` on the
base half: the rows above that differ; the two unchanged cases pass on both).

## Recipe

```sh
./node_modules/.bin/storybook dev -p 6018 --host 127.0.0.1 --no-open --disable-telemetry
node scripts/composer-cluster-proof.mjs http://127.0.0.1:6018 "$OUT"
```

The story is `chat-message-input--composer-cluster` (dark palette default). One
PNG per case, 1380x900 at DPR 1, captured from the browser driving the story —
the same shape the slash-enter set's harness uses.

## What the frames do not show

- `skills.list` is the story's fixture desk bridge standing in for the desktop
  transport. The expansion's parity with `local_operator/skills/invoke.py` is
  the module's own port (`skill-invocation.ts`) and its tests' claim; the frame
  shows the payload that reached `onSendMessage`, not the backend's disk read.
- The hidden-skills case (`secret-ritual` is in the fixture's vocabulary) is
  exercised by the unit tests, not by one of these eight gestures.
- The transcript's "expanded payload" row for a sent `$skill` is deliberately
  not part of this change (see the PR's notes).
