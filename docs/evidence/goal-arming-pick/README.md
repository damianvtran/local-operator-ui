# Goal arming — the pick, the two gestures, and the copy that names them

PR #209 turns the `/goal` arming from something a **word in a draft** did into
something the user **chooses** in the slash popup. Round 1 of review found
defects in that change (reviewer F1-F7, UX U1-U6, design D1-D5, QA Q1-Q6). The
remediation head fixes them; the frames in `*/<theme>.webp` are what the fixed
surfaces render at that head, and `round1/` keeps the frames the four rounds
produced so a reader can see the defect rather than take this file's word for it.

## `*/<theme>.webp` — the fixed surfaces, at the remediation head

Every frame is the real `MessageInput`, its real slash popup, the real planner
(`planSlashSubmission` / `planSlashArming`), the real keyboard contract
(`slashKeyIntent`) and the real dispatch contract, rendered in the repository's
own Storybook preview with exactly one stand-in: `window.api.desktop`, mocked
with the REAL command catalogue dumped from the core runtime's
`command_catalogue()` (38 rows; `/goal` = `session.goal`), because a Storybook
page has no backend. `window.electron` and `window.api.backend` are stubbed for
the same reason (see the harness), so a frame is a function of this tree rather
than of whichever backend happens to be listening on the machine. Drafts are
written and keys dispatched as real DOM events on the real textarea; the goal row
is clicked as a real pointer click. The witness rows above the composer (`box`,
`note`, `sent`, `dispatched`, `rect`) are the harness's own reading of the state
that produced the frame.

| frame | state | what it settles |
| --- | --- | --- |
| `popup-goal/localOperatorDark.webp` | popup open on the `/goal` row over `I approve spend /goal`, no arrow pressed | review F2 / QA Q5 / UX U2 / design D1: the row's own two lines read `Enter sends this draft as prose; arrow to /goal to stage it.` / `Click stages /goal.` — the two gestures this row actually performs, where they used to read `Enter completes the command.` / `Click runs /goal.` |
| `popup-goal-by-hand/localOperatorDark.webp` | the same draft after `ArrowDown` | the same footer once the row has been chosen by hand: `Enter stages /goal; the next Enter runs it.` |
| `popup-loop/localOperatorDark.webp` | the popup on the `/loop` row (control, caret on the word) | the completing row is unchanged, which is what makes the arming's line a statement about *this* row rather than a general one |
| `plain-enter-prose/localOperatorDark.webp` | `I approve spend /goal`, Enter with the popup OPEN | UX U1 / design D2, the operator's report: `sent` is the draft, verbatim and in its own order, no note, nothing staged — the arming is not a key that happened to be pressed |
| `plain-enter-prose-light/localOperatorLight.webp` | the same state, light theme | the same claim on the second palette |
| `tab-no-arm/localOperatorDark.webp` | the same draft, Tab with the popup open | UX U3: Tab does not arm and does not rewrite the sentence — the box still holds exactly what was typed |
| `pick-arms-click/localOperatorDark.webp` | the goal row CLICKED | the pointer gesture: the line is hoisted to the front, staged, and the note says what the next Enter will do |
| `pick-arms-hand/localOperatorDark.webp` | `ArrowDown` then Enter | the keyboard gesture the gate admits: the same staged line, reached by a choice the user made |
| `pick-arms-multiline/localOperatorDark.webp` | review F1 / QA Q4's draft (`Please fix the flaky test and` / `then run the release.` / `/goal`) clicked | the staged line is ONE line, so the next Enter is the whole-draft form that runs: the goal is set and the text sent, rather than the literal `/goal …` reaching the model |
| `pick-arms-nosession/localOperatorDark.webp` | the same pick on a pane with NO conversation | UX U5 / design D5: the note says what the pane can do (`Needs an open conversation; start one first.`) instead of promising a goal it will refuse one keystroke later |
| `composer-armed/localOperatorDark.webp` | the composer box after a pick | design N1: compared against… |
| `composer-hand-typed/localOperatorDark.webp` | the composer box holding `/goal I approve spend` typed by hand | …this one: the two are **byte-identical** (0 of 1,592,832 pixels differ, 1952x272 at the box's own rect), so the armed state stays indistinguishable from the whole-draft form it lands the user in — no badge, no restyle |

`composer-armed` and `composer-hand-typed` are crops of a full frame at the
rect the harness reports for the composer box (`rect` above), so the pair
compares the box alone: the note row beneath it belongs to the arming and would
otherwise be the only difference.

## `round1/*.png` — the reviewed head, kept as the "before"

The frames the four review rounds produced in their own scratch rigs at the head
they reviewed. They are PNGs of two different rigs (design's CDP rig, QA's
Storybook harness) at the reviewed head `055772394`, which this branch's rebase
rewrote, so they carry no `capturedAtHead` citation — the head is named here
instead, and in the PR's round-1 comments. PNGs are not `.webp`, so they enter
neither the sweep's arithmetic nor the theme-ground predicate; they are declared
as `pngArtifacts` on the manifest entry.

| frame | round | what it shows |
| --- | --- | --- |
| `round1/design-popup-goal.png` | design D1 | the falsified footer — `Enter completes the command.` / `Click runs /goal.` — on the row whose Enter hoists and stages |
| `round1/design-popup-loop.png` | design D1 | the control row, where that same sentence is honest |
| `round1/design-pick-arms.png` | design D2 (and UX U1) | the pick's receipt as it read before remediation: `Armed /goal I approve spend. …` |
| `round1/design-pick-arms-composer.png` | design N1 | the composer box after a pick, before remediation |
| `round1/design-hand-typed-composer.png` | design N1 | the same box typed by hand — the 0-of-94,528-pixel pair the design round measured |
| `round1/qa-popup-goal-row.png` | QA Q5 | the live popup's two lines, from QA's Storybook harness |
| `round1/qa-armed.png` | QA D2 | the armed state reached by Enter (before the gate) |
| `round1/qa-click-armed.png` | QA D4 | the armed state reached by a click |
| `round1/qa-base-staged.png` | QA D6 | the BASE behaviour (`64c3283cb`): the operator's gesture moved his sentence and sent nothing |
| `round1/qa-head-prose-sent.png` | QA D7 | the head behaviour this PR exists for: the same draft sent as prose |

## How to regenerate the `*/<theme>.webp` frames

In a scratch worktree of this branch (`git worktree add --detach /tmp/ev209 HEAD`,
with `node_modules` from a checkout of the same tree):

1. copy `harness/ev209-goal-arming.stories.tsx` into
   `src/renderer/src/features/chat/components/` (untracked: the repository's own
   `.storybook` config picks it up) and replace the `COMMANDS` placeholder with
   the catalogue the desktop app receives — a `commands.list` dump, e.g. from a
   core checkout's
   `local_operator.server.utils.desktop_commands.command_catalogue()`;
2. `pnpm exec storybook dev -p 6021 --no-open`, then open
   `http://localhost:6021/iframe.html?id=ev209-goal-arming--composer&viewMode=story`
   (append `&args=theme:localOperatorLight` for the light frame) in the harness
   browser tool and let the story settle — the first load compiles it;
3. drive the labelled controls (`data-ev-action`) and screenshot after each:
   `type-sentence` → `popup-goal`; `arrowdown` → `popup-goal-by-hand`; `enter`
   → `pick-arms-hand`; `escape`, `type-sentence`, `click-goal` →
   `pick-arms-click`; `escape`, `type-multiline`, `click-goal` →
   `pick-arms-multiline`; `escape`, `type-sentence`, `enter` →
   `plain-enter-prose`; `escape`, `type-sentence`, `tab` → `tab-no-arm`;
   `escape`, `type-loop-token` → `popup-loop`; `escape`, `type-whole` →
   `composer-hand-typed`; `escape`, `type-sentence`, `click-goal` →
   `composer-armed`; `toggle-session`, `escape`, `type-sentence`, `click-goal` →
   `pick-arms-nosession`;
4. crop the two composer frames to the `rect` the page reports times
   `window.devicePixelRatio` (the harness viewport is 1280x720 at DPR 2, so the
   frames are 2560x1440 and the crop is `rect × 2`), and write every frame out as
   **lossless** WebP in a directory named for the state, with the file named for
   the theme — `check-evidence.mjs` reads the theme off the file name and checks
   the frame's dominant colour against that theme's ground.

`round1/` is not regenerable: those rigs are scratch and the copy they render no
longer exists in the tree. The design round's own rig recipe is in its round-1
comment; the QA rig is in QA's.
