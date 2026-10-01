# The composer cluster, executed

Three operator reports about the composer, and one driver run twice over the
same story — the production `MessageInput` over the file's fixture desk bridge —
so each pair is two frames of the SAME keystrokes on two trees.

RE-SHOT TWICE. First on the folded head (main's #683 lift moved the component
to `shared/components/composer/` mid-lane) — readings unchanged, sub-pixel
raster noise only. Then again on the round-1 REMEDIATED head: the review round
moved the list's ellipsis path, its region height and its no-match state, so
both halves were driven once more on the remediated sources, and the set is
NINE cases now (the `skill-list-empty` pair is new — the empty state is a
round-1 fix). The list's affected frames changed contentually; the remaining
frames moved by sub-pixel raster noise only. Verdicts: 9/9 on this branch
against 7 failures of 9 on the base half, every reading in the pair's two
`result.json`s.

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
| `skill-list-empty` | type `$zzz` | no listbox at all — the silent unmount (design round 1, D3) | list **Skills**, `rows: 0`, and the miss stated: `No skills match.` |
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
each `result.json` are the run's account of itself (`7` failures of `9` on the
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
- Reachability of hidden skills is pinned by the HARNESS's own tests —
  `local_operator/tests/unit/tui/test_skill_invocation.py::test_hidden_skill_is_invocable_by_name`
  and `tests/unit/skills/test_invoke.py::test_hidden_skills_are_invocable` — not
  by one of these nine gestures: `skills.list` carries `{name, description}`, so
  the hidden flag never reaches the renderer and no UI-side pin could assert
  it. What this set shows is that the list renders every row the op answers.
- The transcript's "expanded payload" row for a sent `$skill` is deliberately
  not part of this change (see the PR's notes).
- The `theme-qualified` frame cannot show the theme APPLYING: the story's
  `theme:` argument pins the palette, so `document.documentElement.dataset.theme`
  stays put and the frame's visible half is the receipt. The applied half is the
  store write (`themeName: "dracula"`), read by the driver and the live QA pass —
  the unchanged pixels are the story's pin, not a defect (`theme-inline.test.mjs`
  pins the same seam as code).
