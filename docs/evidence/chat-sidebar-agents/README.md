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
| `offer-dismissed` | the same user after dismissing the offer: the block is gone, and the section is its heading, the create row the press put the caret on, and nothing else |
| `empty-without-shortcut` | the same empty section on a server with no packaged profiles — the shortcut is absent, not broken |
| `installed-with-builtins` | three agents of the user's own, three built-ins still available |
| `all-installed` | nothing left to offer: no line, no action |
| `installing` | the batch in flight, determinate — the moment the action is pressed |
| `installing-mid-run` | the same batch four installs in: three answered and the fourth held open, so the bar has a FILL and reports the step the sentence reports |
| `install-summary` | the end of a mixed batch: one already present, one name the user already holds; the skip is one count-led sentence and `Done` is a 28px control that takes focus |

The play-driven frames — `installing`, `installing-mid-run`, `install-summary` and
`offer-dismissed` — are driven by their stories' own `play` functions: a real click
on the action (`offer-dismissed` presses the dismiss control instead), then a wait
for the state under test, so they are pictures of the component reacting rather
than of a prop that fakes a state.

**Every frame in this directory is from the AGENTS-OFFER DISMISS PASS on head
`aa216acd8e`** — the fold onto `origin/main` = `160faa5f9f` (#614, Aida's
missed-messages badge) — all eight stories, twelve themes each, taken in one
narrowed run (`--only=chat-sidebar-agents --allow-backend
--theme-settle-ms=180000`, the raised theme budget this host's load required; the
10 s default failed on the first story's cold compile) at that head. The set
gained `offer-dismissed` and the other seven stories were re-taken whole, because
the surface had moved twice since the frames it carried: this change puts the
dismiss control on the empty state, and main's own sidebar redesign (the view
band, `e2f97f8c53`'s lane) had replaced the chrome every story renders inside.
**The 84 carried frames all moved, and the chrome is the reason they moved**:
`installing`'s before/after pairs carry the same box content — same line, same
sentence, same meter, same rows — and differ only in the sidebar around them, so
the redesign, not this change, is credited for the frames this change does not
touch. These frames replace the re-take on head `742448248` (the fold onto
`c69f78b92`), which the paragraphs below this one describe.

**The byte diff is a measurement in three parts**: all 84 carried frames were
rewritten by this run and `git diff` names each one (no frame is a leftover
nobody re-took); `offer-dismissed` arrives as twelve new files; and the move's
shape is a size DROP of roughly 2-4 KB per frame (`installing/localOperatorDark`
14936 -> 11404) because the redesigned sidebar paints less furniture — the
frame got smaller, not emptier, and the box's own states are unchanged inside it.

**The re-capture came back byte-identical in all 84 frames**, and that is a
measurement rather than a claim that the set was left alone: every file in this
directory was rewritten by that run (its mtime is the run's, `git diff` against
the committed frames is empty for each of them). The reason is the shape of
#313's change — the bulk-read control renders on rows carrying an unacknowledged
completion, and none of these stories' fixture rows carries one, so the sidebar's
Agents section paints the same pixels on both trees. Recorded here because a
reader diffing this directory sees no frame move and would otherwise have to
guess whether the fold was checked or assumed.

**Round 3's remediation re-rendered the whole set again, at the commit carrying
the fix (`c1dfcc27f`), and this directory still carries no new bytes.** The
change it answers is structural rather than visual: the batch's completion
summary was being unmounted by the refresh the batch itself triggers (QA round
1, Q1), so the section now renders ONE `InstallBuiltinAgents` across both of its
states — the empty state's padded box in one case, `display: contents` in the
other — and the question this set had to answer is whether removing and adding a
box moves a pixel. 82 of the 84 frames came back byte-identical on that run. The
two that did not are `installing-mid-run` frames, and that state's composite is
simply not deterministic across runs: its twelve frames are byte-identical to
the committed ones on a run of the PRE-fix tree and on two of three runs of the
fixed one, and the runs that differ disagree about WHICH themes (`monokai` and
`tokyoNight` once, `dune`, `obsidian` and `sage` on another) — a per-run
rasterisation of a panel composited while an install is held open, not a
property of the change. The committed frames are that state's settled sample, so
they are kept rather than churned, and the two runs that agreed with them are
the reason "no frame moved" here is a measurement again rather than luck.

**The batch's announcement and its focus are read from the page, not from these
stills.** UX round 2's U10 and U11 were both about what happens BETWEEN frames:
the progress sentence and the summary were two live regions each inserted already
holding their text — the shape assistive technology is least reliable about — and
focus sat on `document.body` for the whole 3.7s run and again after `Done`. Both
are now one region, mounted with the section (`sr-only` and empty when idle) and
written into at each step and at the end, which is also the focus target while
the batch runs. Measured on the rendered page: focus on
`install-builtins-live` mid-run with the region reading "Installing 4 of 6 —
architect…", on `Done` when the batch settles, and back on "Install all built-in
agents" once the summary is dismissed. A frame cannot show a focus move or an
announcement; what the stills here show is the state each reading was taken in.

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
- **Not the post-install list.** The fixture's `profiles.list` never changes, so
  `installing-mid-run` reads "No agents yet" over three answered installs and
  `install-summary` ends over the same empty list. That is a fixture artefact
  rather than a state a user can reach (design round 2, D6 named it): the real
  section gains rows as its invalidated read returns, and that is the live app's
  surface, not a story's.
- **Not the dismissal's storage or its re-arm.** A still cannot show that the
  dismissal survives a restart or that a catalogue gaining a built-in brings the
  offer back: `scripts/agents-offer-dismiss.test.mjs` mounts the shipped sidebar
  six ways and holds the signature, the busy gate, the press's focus handoff and
  the re-arm; these frames show the states a press moves between. The focus ring
  `offer-dismissed` carries is that handoff already made, not the move itself.
- **Not a focus move or an announcement.** These are stills. Where focus lands at
  each transition, and that the region is a persistent one written into, was read
  off the rendered page (above); the frames show the states those readings were
  taken in.

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
