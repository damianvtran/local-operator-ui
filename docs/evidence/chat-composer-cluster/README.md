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

RE-SHOT A THIRD TIME, for the SESSIONLESS `$` delta (spec §2–§3 of the v2 lane):
the composer's skills read no longer addresses a session — it travels with the
composer's own folder, so a draft pane answers before any conversation exists —
and the list gained the four no-rows states (durable / transient / empty /
miss) plus the `$` token ink. The set is TWENTY-TWO cases across BOTH themes
now: every case was driven twice (`COMPOSER_PROOF_THEME=localOperatorDark` and
`localOperatorLight`), and the light twin of every row is committed beside its
dark frame as `<stem>-after-light.png`. All 22 pass in both themes
(`result.json`, `result-light.json`). Two fidelity changes ride with the
re-shoot and are why the pre-existing after halves were retaken too: the
harness now passes the composer's `cwd` (the real pages always do — the
WORKING-DIRECTORY CHIP is visible in these frames and was absent from the
earlier story), and the desk bridge learned scenario knobs (`skillFixture`,
`pane`) that the driver sets per case through the story's args. The BEFORE
halves stay the disabled-gates run from the original lane — they document the
reported defects on that tree, and nothing in this delta changes what they
show.

RE-SHOT A FOURTH TIME, for the round-1 remediation (review/design/UX/QA rounds on this
PR): the design round's two additive states plus the loading arm. The set is
TWENTY-FIVE cases now, every frame re-taken at this head in both themes (25/25
each side). The three new cases: `skill-narrow-composer` — the durable sentence
is the longest line the composer paints, photographed at the app's 800px floor
(this one frame is 800x900 and its `result.json` entry carries the per-case
`viewport`); `skill-many-scroll` — nine rows against the six-row region,
scrolled by one real wheel event, the landing proven by a `scrollTop > 0`
readback; `skill-loading-line` — the state that used to open NOTHING, read and
shot inside the fixture's 900ms `slow` window.

FOLDED ONTO A MOVED `origin/main` AFTER THE SHOOT, AND NOT RE-CAPTURED: the
fold's one composer change is the optional `deviceHold` node (`{deviceHold}`
renders nothing when no move store is mounted, which the story never has), so
the photographed band is the same DOM; the manifest's stamp pair was re-derived
at the folded tip instead.

AND FOLDED AGAIN AFTER THE FOURTH SHOOT, the same way and for the same reason:
current `origin/main` brings #621 (mesh canvas) and #717 (turn-answer rail),
neither of which touches the composer cluster the frames photograph — the
round-1 fold is the one these frames' stamps describe.

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

### The v2 rows — sessionless `$` on both panes

These are the rows the sessionless delta adds. `pane:draft` is the harness
without a session status (`paneHasSession={false}`), i.e. the New-chat pane the
first message is written on; the default rows run on the session pane. The
scenario each frame ran under is recorded in its `result.json` entry
(`state.scenario`), so a frame's fixture is readable rather than inferred.

| case | gesture / scenario | the claim the reading pins |
| --- | --- | --- |
| `skill-list-bare-leading` | draft pane, type `$` | THE v2 HEADLINE: the whole catalogue opens with NO session — 3 rows (`research`, `release-notes`, `secret-ritual`), and the bare token is uninked |
| `skill-list-leading-fuzzy` | type `$res` | leading ≥3 chars runs the full fuzzy matcher (TUI parity): 2 rows (`research` + `release-notes`'s subsequence) |
| `skill-list-leading-single` | type `$resea` | one more character narrows to 1 row (`research`); `$rese` would still match `release-notes` |
| `skill-highlight-resolved` | type `$research fix this` | the resolved run paints (`data-slash-run="skill"` on `$research`) with a request behind it |
| `skill-highlight-paints-through` | type `$research`, list open | a RESOLVED token paints THROUGH the open list (the v2 ink rule) |
| `skill-highlight-inert` | type `$zzz`, read, Escape, read | nothing paints while the miss list owns the token; the dim run (`skill-unknown`) arrives after Escape closes it |
| `skill-highlight-money-guards` | `costs$5 …`, then `echo $PATH` | zero `$` runs in both: a glued `$5` is not a token, an inline `$PATH` is not leading |
| `skill-highlight-slash-claim` | `/model $5` | a `$` inside a recognised command's argument paints no skill run |
| `skill-notice-durable` | `skillFixture:old-backend`, type `$` | the update-the-backend sentence in the list shell — and ZERO `skills.list` calls on the wire (`state.skillListCalls = 0`) |
| `skill-notice-transient` | `skillFixture:broken`, type `$` | "Skills aren't available right now." (a 503 from the bridge) |
| `skill-notice-empty` | `skillFixture:empty`, session pane, type `$` | "No skills found — see /skills" (the pointer can be followed here) |
| `skill-notice-empty-draft` | `skillFixture:empty`, draft pane, type `$` | "No skills found." — the pointer clause is dropped where `/skills` would be refused |
| `skill-draft-first-send` | draft pane, `$research fix this` + Enter | the first-message expansion fires: `[data-sent]` starts with the invocation header and carries `invocation="$research fix this"` — the send the session gate used to forbid |
| `skill-narrow-composer` | `skillFixture:old-backend`, type `$`, **800x900** | the durable sentence (the longest line the composer paints) wraps sanely at the app's narrow floor; `skills.list` calls stay 0 |
| `skill-many-scroll` | draft pane, `skillFixture:many`, type `$`, wheel 144px | nine rows against the six-row region, and the region really scrolled (`extra.scrolled > 0` — the readback, not the picture) |
| `skill-loading-line` | draft pane, `skillFixture:slow`, type `$` | the loading arm: `Loading…` in the shell while the sessionless read is in flight (the fixture holds it 900ms so the window is photographable) |

The v2 rows are AFTER-ONLY, and that is a statement about the fixture rather
than an omission: the before state of each is a fact of the old tree (the
silent draft — #690's F-1 finding; no ink anywhere; no notices), but the base
tree's story cannot RENDER the scenarios (no scenario args, no draft pane), so
a "before" shot of `skillFixture:empty` would photograph the wrong fixture.
What a before frame here would show instead is recorded in the table above and
in the lane's `bare-dollar-probe/` evidence.

The multiline case records the walk it expects: after the first ArrowUp the
reader can see `draft: "one\ntwo"` with the caret at `3` (line 1) and the draft
intact — the second ArrowUp is the one that swapped it on the base half and does
nothing on this branch.

## The base half is that lane's tree with three gates disabled

`disabled-gates/result.json` is that run's own record. The tree it ran from is
THAT branch's head with exactly three one-line reversals — each fix's arm gated
off at its own gate, so the keystrokes the cases play are the same ones a user
plays. The before halves are kept as the run that documents the three reported
defects; the after halves were re-taken later (see the re-shoot note above).

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
COMPOSER_PROOF_THEME=localOperatorDark node scripts/composer-cluster-proof.mjs http://127.0.0.1:6018 "$OUT_DARK"
COMPOSER_PROOF_THEME=localOperatorLight node scripts/composer-cluster-proof.mjs http://127.0.0.1:6018 "$OUT_LIGHT"
```

`COMPOSER_PROOF_ONLY=<substring>` narrows a rerun to the cases whose name
contains it (e.g. `COMPOSER_PROOF_ONLY=skill-notice`); the subset still writes
a complete `result.json` of what ran. Committed frames are the run's PNGs
renamed `<stem>-after.png` (dark) and `<stem>-after-light.png` (light) — the
stem is the shipped case name from the tables above, which trims the driver's
longer names where the original set did.

The story is `chat-message-input--composer-cluster`; the palette is whichever
`COMPOSER_PROOF_THEME` names, seeded into the preview's persisted preferences
AND passed as the story's `theme` argument, so the store and the arg agree from
the first paint. One PNG per case per theme, 1380x900 at DPR 1 — except
`skill-narrow-composer`, shot at 800x900 (the app's floor; its record entry
carries the size) — captured from the browser driving the story, the same shape
the slash-enter set's harness uses.

## What the frames do not show

- `skills.list` is the story's fixture desk bridge standing in for the desktop
  transport. The expansion's parity with `local_operator/skills/invoke.py` is
  the module's own port (`skill-invocation.ts`) and its tests' claim; the frame
  shows the payload that reached `onSendMessage`, not the backend's disk read.
- Reachability of hidden skills is pinned by the HARNESS's own tests —
  `local_operator/tests/unit/tui/test_skill_invocation.py::test_hidden_skill_is_invocable_by_name`
  and `tests/unit/skills/test_invoke.py::test_hidden_skills_are_invocable` — not
  by one of these gestures: `skills.list` carries `{name, description}`, so the
  hidden flag never reaches the renderer and no UI-side pin could assert it.
  What this set shows is that the list renders every row the op answers.
- The transcript's "expanded payload" row for a sent `$skill` is deliberately
  not part of this change (see the PR's notes).
- The `theme-qualified` frame cannot show the theme APPLYING: the story's
  `theme:` argument pins the palette, so `document.documentElement.dataset.theme`
  stays put and the frame's visible half is the receipt. The applied half is the
  store write (`themeName: "dracula"`), read by the driver and the live QA pass —
  the unchanged pixels are the story's pin, not a defect (`theme-inline.test.mjs`
  pins the same seam as code).
