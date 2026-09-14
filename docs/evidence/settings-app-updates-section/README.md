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

Two states of the same press, each in `localOperatorDark` and
`localOperatorLight`:

- `server-update-offered/` is that one press, in the state the report describes:
  the app channel fires its own "nothing newer" event and the server channel
  carries the offer. This is the AFTER side — the offer stands, the
  notification's own "a new server update is available" line is up, and
  **nothing affirms** that the installation is current.
- `all-current/` is the same press when the whole check positively proved BOTH
  channels current — the only state that earns a sentence. The verdict carries
  `UP_TO_DATE_AFFIRMATION`, so this frame holds the green "The application and
  server are up to date" snackbar and no offer panel at all. It is here because
  that copy is new with this branch: the two hand-rolled button stories that
  used to depict a "latest version" alert were driven by a channel's own
  `onUpdateNotAvailable`, which is a state the shipped button can no longer
  produce from any event.

The same story, captured on a scratch worktree at the pre-fix commit these frames
were paired against (`ef40c81e2`, this branch's base before it was rebased onto
`142e86904`), is the report itself, and lives in
`docs/evidence/update-check-affirmation-before/` — the panel with "You are up to
date" over it. The story contains no part of the fix, so the pair is one script
on two trees rather than two scripts. There is no before half for the
affirmation: the sentence does not exist before the fix, which is why
`all-current/` is the one state here photographed on this tree alone.

## What produced these frames

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
written in the same pass — four frames across two themes at `48d9803cf`. The run
re-stamps the manifest itself (`head`, `srcTree` and `scriptsTree` from the tree,
`frames` and `surfaces` from the disk and the capturer's own list), which is why
no count in `docs/evidence/manifest.json` is hand-edited after it.

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
