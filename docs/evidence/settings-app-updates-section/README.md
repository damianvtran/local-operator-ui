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

`server-update-offered/` is that one press, in the state the report describes:
the app channel fires its own "nothing newer" event and the server channel
carries the offer. This is the AFTER side — the offer stands, the notification's
own "a new server update is available" line is up, and **nothing affirms** that
the installation is current.

The same story, captured on a scratch worktree at the pre-fix commit the branch
is cut from (`ef40c81e2`), is the report itself, and lives in
`docs/evidence/update-check-affirmation-before/` — the panel with "You are up to
date" over it. The story contains no part of the fix, so the pair is one script
on two trees rather than two scripts.

## What produced these frames

`CheckForUpdatesButton` refuses to check at all when `import.meta.env.DEV` is
true ("Updates are not checked in development mode. This feature is only
available in production builds."), which is the right thing for the product and
the wrong thing to photograph — so these frames come from a **production
Storybook build**, not the dev server:

```sh
pnpm build-storybook
python3 -m http.server 6034 --directory storybook-static
node scripts/capture-evidence.mjs http://localhost:6034 \
  --only=settings-app-updates-section \
  --themes=localOperatorDark,localOperatorLight --allow-backend
```

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

## What the frame shows, and what it does not

The two fixed panels are the app's own: the offer is `UpdateNotification`'s
(the component `app.tsx` mounts beside the shell) and the snackbar line is the
same component's informational message about the server release. The affirmation
below it is what this branch removes, and the only way to see it is the before
set. The section's version rows are the story's fixtures, not a live read.
