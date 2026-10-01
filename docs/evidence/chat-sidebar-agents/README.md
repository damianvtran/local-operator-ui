# The chat sidebar's Agents section — the roster's navigation, and the built-ins shortcut

Two features share this section and this directory. The AGENTS-OFFER DISMISS
pass built the grouping, the empty state and the install action for packaged
profiles (`profiles.list` includes them beside the user's own, so a fresh
install listed six built-ins under a heading that read "Agents"). The ROSTER
NAVIGATION pass (issue #663) then gave the section its own filter, per-agent
pins and use-ordered rows, and the band its `Open agent…` jump. Every frame in
this directory was re-taken whole by the later pass, so the set shows both
features in every state it carries.

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
| `long-roster` | twelve agents past the eight-row cap: the section's own filter field (drawn because the section is cap-bound), rows ordered by use — builder, release-captain, bug-intake, docs-writer, scout, then the never-used in roster order — and a `Show 4 more` foot |
| `roster-filtered` | the roster filter with four matches (`er`): ALL of them drawn — including `patch-reviewer`, a row the cap would have hidden — and no foot, because the cap is bypassed while filtering |
| `roster-no-match` | the same field answering nothing: `No agents match`, with `Create agent` still reachable below |
| `pinned-first` | the pin pressed on `ledger-auditor` (never used, drawn mid-list): the row lifts above the most recently used agent, pin filled and the focus ring the press left — the gesture itself |
| `pinned-at-rest` | the same pin after the play blurs the control: the mark a reader lives with, nothing pointing at the row |
| `truncating-name` | one agent named long enough to reach the row's edge at 360px, made the most recent so its row leads the cap — the case the pin's reserved 24px slot narrows the name column for |

The play-driven frames — `installing`, `installing-mid-run`, `install-summary` and
`offer-dismissed` — are driven by their stories' own `play` functions: a real click
on the action (`offer-dismissed` presses the dismiss control instead), then a wait
for the state under test, so they are pictures of the component reacting rather
than of a prop that fakes a state. The navigation frames join that shape:
`pinned-first` and `pinned-at-rest` CLICK the pin (the second then blurs it),
`roster-filtered` and `roster-no-match` TYPE into the field, and `long-roster` and
`truncating-name` wait for the roster their fixtures seed.

**Every frame in this directory is from the ROSTER-NAVIGATION REMEDIATION PASS
on head `9216759e7d`** — issue #663's round-1 remediation, the raised theme
budget the host's load requires (`--theme-settle-ms=180000`), all fourteen
stories, twelve themes each, taken in one narrowed run
(`--only=chat-sidebar-agents --allow-backend`) at that head. The set gained six
stories — the roster's four navigation states from the feature's first push,
plus `pinned-at-rest` and `truncating-name` from the design lane's request (D3:
the mark without focus or pointer, and a name that can actually reach the row's
edge now that the pin's slot is reserved on every agent row) — and the eight
carried stories were re-taken whole, because the section itself changed: every
agent row now reserves the pin's 24px slot, the section draws its filter field
at the cap, the band carries its fourth control, and the empty sentence counts
what draws. **All 168 frames were rewritten by this run** (`git diff` names each
one; the 96 carried agents frames plus the manifest are the modified set), and
the twelve frames under `../chat-sidebar-view-menu/band-open-agent-hover/` are
the same pass's capture of the band's `Open agent…` hover and tooltip — the one
state the first round registered but could not take. The pass this replaced, and
the passes before it, are the paragraphs below.

**The fold onto `origin/main` = `e0abc82495` re-took the whole set to measure
itself**, because the hub-updates train changed `chat-sidebar.tsx` under this
branch: every frame was re-rendered at the folded head `c306629ec` — 168 agents
frames plus the band's 12 — and **all 180 came back byte-identical**. That is
the measurement, not an assumption: `git diff` over this directory after the run
names only `manifest.json`, so nothing the train draws touches any state this
set carries, and the frames remain pictures of the tree they ship in.

**The second fold (`origin/main` = `443ad13c70`, the composer skill-selector
train) re-stamped, not re-captured**, and the reason is checkable in one
grep: the fold's 73 files contain no sidebar or roster file at all — the
deltas are the composer, the skill contract and pickers, settings, the pairing
hooks and the desktop contract — so no frame this set carries could have moved,
and the pair plus the swept count are re-derived at the folded tip instead.

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
- **Not the roster's rules.** The frames show the filter, the ordering and the
  pin's states as pixels; the rules themselves — the case-insensitive match, the
  recency join over session bindings, the pinned/never-used partition, the pin's
  round trip and its parse — are held by
  `scripts/chat-sidebar-agents.test.mjs` and the view suite, which drive the
  shipped pure modules rather than a rendering of them. And not the pin's
  persistence across a restart: the stories state the view before mount
  (`ViewFixture`), so a frame is a state, not a stored preference.

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
