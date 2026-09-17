# The update check that offered an update and said "You are up to date"

The report: Settings → Application updates and info → Check for updates, on
application 0.22.1 against server 0.54.43, with server 0.54.44 published. One
press produced both of these, in the same turn:

- the panel — "Server update available / Server version 0.54.44 is available.
  You are currently using version 0.54.43."
- the success snackbar — "You are up to date"

The operator saw it "a couple times", "when there's an available version on
either the server or the UI", which is the shape of the defect: each channel's
own event was rendered as a sentence about the whole installation, so exactly
one trailing channel produced an offer and an affirmation together.

## The frames

Sixty frames: five states of the same press, each in all twelve themes, every
one at **900x572** - the app's own minimum window (`WINDOW_MIN_HEIGHT = 600` less
the 28px of chrome the renderer does not own).

One height for the whole surface is the point of the round-1 remediation. The
set used to be captured at two: the two states below at 900x460, and the three
states the serving-install change added at 900x620 - chosen because the app-owned
card was 609px tall, so 620 was the one height at which it happened to fit. That
turned the knob on the capture rather than on the card, and it left the baseline
unable to be laid beside the states it has to be told apart from: at 460 the pane
shows four version columns and its button's whole label, where the 620 frames have
the card over them. One height at the supported worst case makes both possible
(design round 1, D1 and D2).

- `server-update-offered/` is the reported press on the arm where the app runs
  the install: the offer stands, the notification's own "a new server update is
  available" line is up, and **nothing affirms** that the installation is
  current.
- `all-current/` is the same press when the whole check positively proved BOTH
  channels current - the only state that earns a sentence. The verdict carries
  `UP_TO_DATE_AFFIRMATION`, so this frame holds the green "The application and
  server are up to date" snackbar and no offer panel at all. It is here because
  that copy is new with this branch: the two hand-rolled button stories that
  used to depict a "latest version" alert were driven by a channel's own
  `onUpdateNotAvailable`, which is a state the shipped button can no longer
  produce from any event.
- `before-the-fix/` is **the operator's own machine, before**: the verdict
  `origin/main` reached for this host's state - the whole check affirmed, while
  the same pane's Server version row printed the older daemon it was talking to.
  The affirmation is the subject, and the skew notice below it is the second
  thing that press produced.
- `server-behind-serving-install/` is the same press on this branch: the offer
  names the SERVING install (0.56.8) against the published release (0.56.11), no
  package-manager command is offered for an install no package manager owns, and
  no affirmation is earned.
- `serving-server-behind-install/` is one step later - the environment has moved
  to the published release and the process serving this app has not - which is
  the state the new `restart-required` status exists for.

### What `before-the-fix/` is, exactly

Its "before" is **the producer's quoted answer, rendered on this branch's
build** - not a capture taken on a pre-fix tree. The story installs a scripted
`window.api.updater` bridge and hands the panel the verdict and the event payload
`origin/main` really produced for this machine's readings (the log lines for
both are on the pull request); the renderer under it is this branch's. That is
why there is no pre-fix worktree anywhere in this set, and why a re-shoot after a
change to the PANEL's own copy moves this frame too: what is pinned here is the
producer's answer, not the renderer's words. The previous version of this file
said the opposite - that `all-current/` was "the one state here photographed on
this tree alone" - because until this change `before-the-fix/` did not exist.

The pair to read it against is `serving-server-behind-install/`: the same notice,
the same Server version row, with the affirmation present in one and absent in
the other. Everything else about those two frames is identical, which is what
makes the removal of the green sentence the only difference in the pixels.

## What produced these frames

THE FRAMES IN THIS SET WERE RE-SHOT for the round-1 remediation round, from one
production Storybook build and one narrowed pass in all twelve themes:

```sh
nice -n 19 pnpm build-storybook                                 # ~3.75 min here
python3 -m http.server 6157 --bind 127.0.0.1 --directory storybook-static
nice -n 19 node scripts/capture-evidence.mjs http://127.0.0.1:6157 \
  --only=settings-app-updates-section --allow-backend
```

`--only` matches all five story ids, so one pass writes the whole surface - sixty
frames - and the run re-stamps `head`, `frames` and the `partialCapture` record
itself. Why a production build rather than the dev server, and why the port is a
private one, are unchanged from the original capture below.

This section records that original capture, not a command to repeat during
recovery. The rebase onto `915928a18` took no new frames; its continuity proof,
reachable capture citations, and read-only review routes are in
[RECOVERY.md](RECOVERY.md). Use the browser tool for any new capture.

`CheckForUpdatesButton` refuses to check at all when `import.meta.env.DEV` is
true ("Updates are not checked in development mode. This feature is only
available in production builds."), which is the right thing for the product and
the wrong thing to photograph — so these frames come from a **production
Storybook build**, not the dev server:

```sh
nice -n 19 pnpm build-storybook           # 3.25 min under this host's load
python3 -m http.server 6034 --directory storybook-static
nice -n 19 node scripts/capture-evidence.mjs http://localhost:6034 \
  --only=settings-app-updates-section \
  --themes=localOperatorDark,localOperatorLight --allow-backend
```

One narrowed run takes both states: `--only` matches the story id prefix, so the
`server-update-offered` frames are refreshed and the `all-current` pair is
written in the same pass — four frames across two themes at `48d9803cf`.

**A narrowed run does NOT re-stamp `srcTree`/`scriptsTree`.** It re-stamps
`head`, `frames` and the `partialCapture` record, and it deliberately leaves the
two tree stamps alone (they describe the tree a FULL sweep came from). So a round
that moves `src/` or `scripts/` — this one does both — has to re-derive them by
hand in the commit that carries the frames, from the tree it ships:
`git rev-parse $(git write-tree):src` and `:scripts` after staging, with
`frames` re-walked from `docs/evidence` and the `countsMean` paragraphs rewritten
from the same walk. The earlier version of this paragraph claimed the run
does that itself, which is true of a full sweep and false of every command in
this file.

Two notes on that command:

- The port is not `capture-evidence.mjs`'s default `6017`, and the static build
  is served from its own port, because several agent sessions run Storybooks on
  this machine at once. Nothing here was taken from another session's server.
- `--allow-backend` because the operator's own Local Operator server was
  listening on 1111 while these were taken. The story answers the health read
  from its own fixture, so no frame contains that server's reply — the section's
  "Server version 0.54.43" is the report's number, written by the story.

The story itself (`app-updates-section.stories.tsx`) is the harness: it installs
a scripted `window.api.updater` bridge that fires each channel's own event and
resolves the verdict a whole check would produce, then finds the section's real
"Check for updates" button and clicks it. It waits for the components'
subscriptions before pressing — they register in passive effects, and a press
from the layout phase fires into an empty registry — and it holds the capture
open until the offer is on screen.

## What the frames show, and what they do not

The panels in `server-update-offered/` are the app's own: the offer is
`UpdateNotification`'s (the component `app.tsx` mounts beside the shell) and the
snackbar line is the same component's informational message about the server
release. The affirmation below it is what this branch removes, and the only way
to see it is the before set. `all-current/` is the opposite end of the same
press: the section's own button carrying the sentence the branch introduces, with
no notification panel on screen, because that check had nothing to offer. In
both, the section's version rows are the story's fixtures, not a live read.

**The card occludes the pane, at every height, and these frames show it.** It is
`fixed top-4 right-4` and 400px wide, so at 900px it paints over the section's
third and fourth version columns and over the label of the section's own "Check
for updates" button. That is not a reflow and not a defect of the states: the
card is out of flow, so no row wraps and no column moves between states, and the
pre-fix frames show the same occlusion. It is recorded here because a reader
comparing `all-current/` (no card) with `server-behind-serving-install/` (card)
should know the difference is the card painting over the pane rather than the
pane having changed.

**The app-owned card is bounded to the window and scrolls internally.** At
900x572 it is 540px tall — capped at `calc(100vh - 2rem)`, which is the same 16px
inset it is pinned by — so its Details block, the copy that names the install the
check judged, runs past the fold and is reached by scrolling the card. Before
this round it was 609px of `overflow-y: visible` with no scroll container
anywhere, so the tail was painted outside a window the app permits and could not
be read or copied at all (design round 1, D1). The frames show the bounded card:
its bottom edge is inside the frame, with the scrollbar the fix introduces.
