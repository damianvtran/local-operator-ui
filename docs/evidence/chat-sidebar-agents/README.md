# The chat sidebar's Agents section — the built-ins shortcut

`profiles.list` includes the packaged profiles beside the user's own, so a fresh
install listed six built-ins under a heading that reads "Agents": the section
said "agents you have" while showing agents the user had never installed, and
nothing told the two apart. The change is a grouping, an empty state and an
action, and all three are renderings — which is what these frames are for.

## What produced these frames

Storybook, from this branch:
`node scripts/capture-evidence.mjs http://localhost:<port>
--only=chat-sidebar-agents --allow-backend`, twelve themes per story, `420x760`
per story (the sidebar's own 360px column inside a little ground, because the
section is three rows and an action and a 1280px frame of it would be a picture
of the app's empty right-hand side).

| story | what it is |
| --- | --- |
| `empty-with-shortcut` | no agents of the user's own, six built-ins waiting |
| `empty-without-shortcut` | the same empty section on a server with no packaged profiles — the shortcut is absent, not broken |
| `installed-with-builtins` | three agents of the user's own, three built-ins still available |
| `all-installed` | nothing left to offer: no line, no action |
| `installing` | the batch in flight, determinate — the moment the action is pressed |
| `installing-mid-run` | the same batch four installs in: three answered and the fourth held open, so the bar has a FILL and reports the step the sentence reports |
| `install-summary` | the end of a mixed batch: one already present, one name the user already holds; the skip is one count-led sentence and `Done` is a 28px control that takes focus |

The last three are driven by their stories' own `play` functions — a real click on
the action, then a wait for the state under test — so they are pictures of the
component reacting rather than of a prop that fakes a state.

**Every frame in this directory is from the remediation pass on head
`83d25dd39`** — all seven stories, twelve themes each, taken in one narrowed run
(`--only=chat-sidebar-agents`) at that head. The pause on this surface is closed:
`installing-mid-run` has its twelve frames here rather than none, and the other
six states are re-shot against the meter, summary and copy changes in
`add709df1`, so they are evidence for those changes rather than the previous
round's captures.

What this set still cannot show is a *draw* of the bar's transition: every frame
is a shutter on a state, so the fill is a reading of where the batch got to
(1 of 6 in `installing`, 4 of 6 in `installing-mid-run`), not a picture of it
moving.

## What these frames do NOT prove

- **Not that the local backend answers any of this.** The catalogue and install
  responses are stubbed at `window.api.desktop.request`, shaped from
  `server/routes/desktop_profiles.py` (`profiles.list`, `profiles.install` and
  its `NameTakenError` → 409 branch).
- **Not that a real install copies a seed.** The per-name outcomes are fixtures;
  the counting and reporting rules they drive are held by
  `scripts/install-builtin-batch.test.mjs`, which runs the shipped batch module
  against a scripted installer.
- **Not `already_installed`.** That field is additive, and a backend older than
  it omits it — read as "installed", which is the honest reading of a response
  that does not distinguish and never a failure the user would chase.
- **Not the rest of the sidebar.** These frames carry the section inside the real
  `ChatSidebar`, so the rows above and below it are real too, but the claims here
  are about the Agents section alone.
- **Not a live batch's timing.** The per-name answers are fixtures; the counting,
  the skip rule and the sentence the user reads are held by
  `scripts/install-builtin-batch.test.mjs`, which runs the shipped batch module
  against a scripted installer.

## The two meters, and why the frames decide

The progress bar is the one element on this surface whose defect could only be
found by looking: the track it defaults to (`sunken` on `surface`) measures
1.11-1.26:1 across the twelve palettes, so the bar rendered as a hairline-faint
rule with no perceivable container — measured on the round-1 frames at 1.15:1 in
`localOperatorLight`, ~1.3:1 dark and ~1.4:1 neon, against the app's own section
hairline at 1.33:1 in the same frame. It now carries the `border-control`
boundary the palette contract guarantees is above 3:1 on every ground, the same
treatment the quota bar in `usage-view.tsx` uses and for the same reason; the
class is pinned in `scripts/contrast-contract.mjs`, which is what makes the edit
that drops it fail a gate rather than a frame review.

`installing-mid-run` exists because the set could not previously answer the
question the bar raises: with only the starting frame, a bar that never moves is
indistinguishable from a bar that is not drawn. Its frames are in this directory
now, and the pair decides it: the bar holds a longer fill four installs in than
it does at the press, and the sentence under it reports the same step.
