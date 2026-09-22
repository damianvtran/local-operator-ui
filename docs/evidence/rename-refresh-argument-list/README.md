# `/rename`'s `--refresh` argument list, executed

Two runs of one driver over one Storybook story, on two trees: the surface the
operator reported broken and the surface with the fix. Both defects in the
report are **behavioural**, so neither could be answered by reading the source —
one is "the row is not offered", the other is "the click does not run it", and
both end in the same `onPick` one boolean away.

Each case types a word into the production composer (`MessageInput`, story
`chat-message-input--slash-enter`) and then either reads the list or plays ONE
gesture. Every frame carries the composer's own record of what it dispatched
(`ran`, rendered by the story's `[data-slash-dispatched]` line — the story
answers `onSlashCommand` with the dispatcher's own outcome rather than mounting
a picker, which is what makes "did it RUN" observable without a screenshot's
word for it).

## Why the before half needed its own fixture

`message-input.stories.tsx`'s command registry is a SUBSET of the real one, and
on `origin/main` it carries no `/rename` row AT ALL — so a frame of `/rename ref`
taken from an unmodified base would show nothing simply because the command does
not exist in the fixture, which is a different fact from "the command exists and
its argument list is empty". The base run therefore applies **the story fixture
alone** (the `/rename` row, and nothing else) via
`git apply` of that file's diff, so the two trees differ in exactly the change
under test and in no other way. The line is drawn there because a fixture is a
statement about what the registry LOOKS LIKE, not about what the app does with
it: the defect is the missing argument list, and the base must be able to
express the command to be able to fail for the right reason.

## What each frame is

| case | gesture | on `origin/main` + fixture | on this branch |
| --- | --- | --- | --- |
| `rename-suggests-on-dash` | type `/rename -` | list **closed** | row `--refresh · Re-read the conversation and name it again · resumes auto-naming`, Enter: *Enter runs /rename --refresh.* |
| `rename-suggests-on-double-dash` | type `/rename --` | list **closed** | same row |
| `rename-suggests-on-r` | type `/rename r` | list **closed** | same row (subsequence match) |
| `rename-suggests-on-ref` | type `/rename ref` | list **closed** | same row |
| `rename-suggests-on-bare-word` | type `/rename refresh` | list **closed** | same row — the bare word is found through the row's `refresh` ALIAS and displayed as `--refresh` |
| `rename-empty-space-offers-nothing` | type `/rename ` | list closed | unchanged — **the naming form stays reachable** |
| `rename-click-runs-the-refresh` | click the `--refresh` row after `/rename ref` | `ran: none`, draft kept (`/rename ref`) — the report's second half | `draft: ""`, `ran: /rename --refresh` |
| `rename-bare-enter-opens-the-form` | Enter after `/rename ` | `ran: /rename`, `draft: ""` | unchanged |
| `rename-titled-enter-keeps-the-title` | Enter after `/rename quarterly review` | `ran: /rename quarterly review` | unchanged |

The five suggestion rows are the operator's first defect: on the base the list
never opens for a dash, the dashes, `r`, `ref` or the bare word, so there is
nothing to choose from. On the branch every one of those spellings offers the
one row, and the row goes on teaching the flag spelling — `refresh` matching the
row through its alias while the row DISPLAYS `--refresh` is `matchChoices`'s own
rule (score against name and aliases, display `name`), pinned in
`scripts/slash-rank.test.mjs`.

The click row is the second defect, and the frames are the whole of the
difference: the base leaves the draft in the composer and runs nothing, the
branch empties the composer and dispatches `rename --refresh`.

The three no-regression rows are on BOTH sides deliberately, because they are
the behaviour that must not change and the base is where "unchanged" is
established rather than asserted. `rename-empty-space-offers-nothing` is the
load-bearing one: `/rename ` + Enter has always opened the naming form, and a
flag list that opened on the empty query would complete the word to `--refresh`
and make that form unreachable by the gesture that opens it. The empty-query arm
of `slashRunAllowed` and `showsUnmatchedList` are the two halves of that rule.

## The driver's verdicts are the executable form of the table

`node scripts/slash-enter-proof.mjs` exits non-zero when a gesture does not do
what the rule requires, so:

- on the branch: **18/18** gestures behave as required;
- on the base (with the fixture applied): **12/18** — exactly the six cases the
  change is about fail, and the twelve the change does not touch pass, which is
  the no-regression half stated as a check rather than a claim.

`result-before.json` and `result-after.json` carry, per case, the typed word, the
gesture, the before and after DOM state, the expectation, the verdict and the
frame paths.

## Reproducing it

```sh
# 1. The story's own surface, at the app's default window.
pnpm storybook --no-open --ci --port 6006

# 2. The gestures, recorded as frames plus a machine-readable log.
node scripts/slash-enter-proof.mjs http://localhost:6006 docs/evidence/rename-refresh-argument-list

# 3. The before half: a worktree at origin/main with the story fixture and the
#    driver copied into it (see "Why the before half needed its own fixture").
cd <origin-main-worktree>
git apply <the message-input.stories.tsx fixture diff>
pnpm storybook --no-open --ci --port 6007
node scripts/slash-enter-proof.mjs http://localhost:6007 <before-out-dir>
```
