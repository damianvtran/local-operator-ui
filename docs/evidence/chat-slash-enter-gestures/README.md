# The slash popup's Enter gesture, executed

Two runs of one driver over one Storybook story, on two trees: the surface that
was reported broken and the surface that was already working.

The operator's report was that picking a command row in the composer's slash
popup completed the word and needed a **second** Enter before the dialog opened.
The popup has two pick paths — a click on a row and Enter over one — and they are
separate decisions, so the first question the fix had to answer was *which of the
two was broken*. Reading the source answers it only by assertion: both paths end
in the same `onPick`, and the difference is one boolean one frame away.

## What each frame is

Every case types a word into the production composer and then plays ONE gesture,
and each frame carries the composer's own record of what it dispatched (`ran`,
rendered by the story's `[data-slash-dispatched]` line — the story answers
`onSlashCommand` with the dispatcher's own `"consumed"` outcome rather than
mounting a picker).

| case | gesture | on `origin/main` | on this branch |
| --- | --- | --- | --- |
| `enter-runs-analytics` | Enter after `/analytics` | `draft: "/analytics "`, `ran: none` — the reported defect: the word is completed and nothing runs | `draft: ""`, `ran: /analytics` |
| `enter-completes-a-list-command` | Enter after `/model` | `draft: "/model "`, list opens on **Models**, `ran: none` | unchanged |
| `tab-never-runs` | Tab after `/analytics` | `draft: "/analytics "`, `ran: none` | unchanged |
| `ambiguous-enter-grows-the-prefix` | Enter after `/l` | `draft: "/login "`, list **closed** — the highlighted row was completed and run-ready | `draft: "/lo"`, list still open on **Commands**, `ran: none` |
| `ambiguous-enter-keeps-the-written-message` | Enter after `/l hello` | `draft: "/login hello"` — `origin/main` completes to the highlighted row, and carries its own trailing space | `draft: "/lo hello"`, caret after the word |
| `click-runs-analytics` | click on the `/analytics` row after `/ana` | `ran: /analytics` | unchanged |
| `ambiguous-enter-at-bare-slash` | Enter on the popup's first state (`/`) | (derived: no growth path existed, so the word completed to the highlighted row — `/analytics `) | `draft: "/"`, list still up, `ran: none`, line: *Enter needs a row you pick: ↓ then Enter · Tab completes this row.* |
| `ambiguous-enter-at-the-shared-prefix` | Enter after `/lo`, the state `/l` + Enter grows into | (derived: same — `/login `) | `draft: "/lo"`, list still up, `ran: none`, the same line |
| `enter-completes-and-the-next-enter-runs` | Enter after `/clear` | (derived: completes to `/clear `) | `draft: "/clear "`, list closed, `ran: none` — its line (*Enter completes /clear; Enter again runs it.*) is in the frame's BEFORE half |

The last three are UX round 1's remediation (see the section below): they are the
states where Enter is deliberately inert, so what they evidence is the COPY rather
than the outcome, and two of them the round measured as silently dead.

So the pointer arm was **already working** (last row: identical on both trees),
and the keyboard arm was the one that needed two Enters — which is what the fix
is, and what the `origin-main/` frames record rather than assert.

``/lo` in row four is the longest common prefix of the `l` family **as the real
registry has it** — `login`, `logout` and `loop`
(`local_operator/slash_commands.py`) — which cannot be the wrong command by
construction; `origin/main` completed to the highlighted row instead, putting a
run-ready word in the box. Review round 1 (F3) found this fixture carrying only
`login` and `logout`, so the frame showed `log`: a number the real registry
cannot produce, and an ambiguity case easier than the one users meet.

Row five is the case that proves the splice (review round 1, F1): a word with a
written message after it. Note what its two cells say, because the pair is not a
straight before/after of one function: `origin/main` has no extension path at all
(it completes to the highlighted row, and a completion carries its own trailing
space), while the branch's NEW `extensionFor` deleted the separator instead and
produced `/loghello` — measured, not read, and fixed in this round. So the frame
is the regression test for a defect this branch introduced and this branch
closes, and the `origin/main` cell is what that gesture did before the feature
existed.

## The copy half: what the strip says in the states where Enter does nothing

UX round 1 (U1/U2) measured the defect this set now covers: in the popup's first
state and in the state `/l` + Enter grows into, the primary key was inert, and what
the strip said about it was the MATCHER's reason ("these commands share no prefix") rather than what to press. The RULE was not changed — an ambiguous Enter still
narrows where there is somewhere to narrow to, and stays inert rather than
completing to whichever candidate ranked first — so the remedy is the sentence.

The probe reads that sentence back verbatim (`enterNote`, the strip's first
paragraph), so a frame cannot be re-shot carrying copy the key does not honour
while the run still passes. What the real component rendered at this head:

| state | the line, as the component rendered it |
| --- | --- |
| `/` (first state) and `/lo` (the shared prefix) | `Enter needs a row you pick: ↓ then Enter · Tab completes this row.` |
| `/clear`, an unambiguous row that completes and closes the list | `Enter completes /clear; Enter again runs it.` |
| `/analytics`, an unambiguous row that runs | `Enter runs /analytics.` |
| `/model`, an unambiguous row that opens a list | `Enter completes /model.` |
| `/l` (a word that can grow) | `Enter completes to lo.` |

Every clause is checkable against the keys and is checked in
`scripts/slash-contract.test.mjs`, which drives `slashKeyIntent` and `enterFooter`
from the same state and asserts the sentence matches the intent; the destinations'
own answers come from `picker-registry.tsx` through the same helpers the pick
cases read, so a table edit turns the copy red rather than leaving it describing a
table that moved.

## Reproducing it

```sh
# 1. The story's own surface, at the app's default window.
pnpm storybook --no-open --ci --port 6006

# 2. The gestures, recorded as frames plus a machine-readable log.
node scripts/slash-enter-proof.mjs http://localhost:6006 docs/evidence/chat-slash-enter-gestures

# 3. The same driver on the BASE tree, for the before half: a worktree at
#    origin/main with the story file and the driver copied into it.
cd ../panels-cache-picker-before
node scripts/slash-enter-proof.mjs http://localhost:6007 /tmp/slash-enter-before
```

The driver exits non-zero when a gesture does not behave as the rule requires,
so on the base tree it reports **3/5** — the two rows this change is about fail
against the branch's expectations, and the other three pass, which is the
"already working" half stated as an executable check rather than a claim. Its
`result.json` carries, per case, the typed word, the gesture, the before and
after DOM state, the expectation and the verdict.

## The two halves were not captured in the same sitting, and that is stated rather than implied

The BRANCH half is the review-round-1 fixture and the nine cases above: the `l`
family the real registry has (`login`, `logout`, `loop`), so `/l` grows to `lo`,
plus the `ambiguous-enter-keeps-the-written-message` case that the round's F1 was
measured on, and the three copy cases that round 1 of the UX review asked for.

The `origin-main/` half was taken in the same way (same driver, same story file,
a read-only worktree at `origin/main` with only the harness copied in) but EARLIER,
before the fixture gained `loop`. Three consequences, visible in those frames and
stated here rather than left for a reader to reconcile: their `l` family is
`login`/`logout`, so their ambiguous cell reads `log`; they carry five cases
rather than nine; and they predate the gesture strip entirely, so the copy the UX
round measured and this round fixed appears in no frame on that side. Their three
new rows above are DERIVED from the base tree's known behaviour (no growth path
existed there: an ambiguous Enter completed to the highlighted row) rather than
measured, and are marked as such in the table.

Nothing in that half is invalidated by the difference: what it evidences is what
the two gestures DID on `origin/main`, and both of the reported symptoms (Enter on
a panel command completing instead of running; an ambiguous word completing to the
highlighted row) are in those frames. What it cannot do is carry the `/lo` number,
which is a property of the fixture rather than of the old code. Re-shooting that
half needs a second Storybook dev server and a browser, and the machine was under
a load average of ~100 with 4k free pages when this pass finished, so it is
declared here as the one asymmetry in the pair rather than silently re-rendered
from a tree that could not be stood up.

## What this proves, and what it does not

**Proved.** The composer's own decision — over the production `MessageInput`,
with real key events through CDP `Input.dispatchKeyEvent` and a real press and
release for the click — for the four gestures above, on both trees. The registry
and the desktop bridge are fixtures (`message-input.stories.tsx`), because a
Storybook preview has no backend and the popup exists only when one answers for
it: the caps + `commands.list` + `commands.entities` the list needs are answered
from a registry whose names, descriptions and destinations are the real ones
(`local_operator/slash_commands.py`).

**Not proved, and not claimed.** The DIALOG a command opens. That is the
dispatcher's path (`slash-dispatch` → the picker host → `AnalyticsView`), which
this story deliberately does not mount: `onSlashCommand` records the invocation
instead. The end-to-end walk on the built app — `/analytics` + Enter → the panel
on screen — belongs to the independent QA pass, and the frames here would be
misread as covering it if that were not said out loud.

The frames are PNG rather than the sweep's webp because they are produced by a
CDP screenshot rather than by the evidence rig, and `check-evidence` counts only
webp; this set is declared `frames: 0` in `manifest.json` for exactly that
reason, with the provenance below.
