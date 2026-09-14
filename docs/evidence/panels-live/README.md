# `panels-live` — the in-app (real-path) frames

> Round-3 update: the ten original PNGs below are preserved unchanged and now
> have lossless `<state>/localOperatorDark.webp` companions (decoded pixels
> verified identical). They retain their original native-app provenance; this
> is format conversion, not a new capture. The eleventh WebP,
> `wire-environment/localOperatorDark.webp`, is separate browser-tool evidence
> of production InfoPanel over actual isolated backend HTTP, showing null skills
> and approval mode as labelled unknowns. It is NOT native Electron/preload or
> slash-dispatch evidence. See `../panels-remediation/README.md` for its runner,
> exact boundary, and corrected provenance. The historical rig below describes
> the earlier pass only; all new page work used the browser tool.

**This set is what a story fixture cannot prove**: that the shipped app opens
these panels at all — the slash command is offered, the destination row exists,
the op is reachable, and the panel draws the WIRE shape rather than a fixture.
Ten frames, captured from inside the running app on this branch: a picker frame
and a panel frame for each of the five commands.

## The rig, and the traps that cost time

1. An **isolated** backend, never the operator's store:

   ```sh
   LOCAL_OPERATOR_CONFIG_DIR=<scratch>/config LOCAL_OPERATOR_HOME=<scratch>/home \
   LOCAL_OPERATOR_DESKTOP_TOKEN=<random, in a 0600 file> \
   <backend-worktree>/.venv/bin/local-operator serve --host 127.0.0.1 --port 8080 \
     --hosting test --model mock-model
   ```

   8080 rather than a spare port because the renderer's CSP names only `1111` and
   `8080`: anywhere else the fetch is refused by policy with no request sent, and
   the offline banner paints across the frame.

2. The **built** app in headless mode, isolated profile, bearer in the app's own
   environment (MAIN reads it at startup — baked into the bundle only, the
   desktop transport talks past it):

   ```sh
   LOCAL_OPERATOR_UI_WINDOW_MODE=headless LOCAL_OPERATOR_DESKTOP_TOKEN=<same> \
   VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080 \
   ./node_modules/.bin/electron . --remote-debugging-port=9462 \
     --user-data-dir=<scratch>/user-data --window-size=1380x900
   ```

3. Over raw CDP: seed `onboarding-storage` (modal + tour complete) and
   `ui-preferences-storage` (theme) BEFORE the first app script, reload, start a
   conversation and send one turn, so an owner is attached and the composer
   carries a real `sessionId`. **`canonical-sessions-storage` is kept** — removing
   it was why an earlier attempt could not bind anything.
4. Type the command into the composer and press Enter **twice**: the first Enter
   accepts the row into the textarea, the second dispatches it. A key event must
   be the `rawKeyDown` + `char` + `keyUp` triplet, or the composer's keydown
   handler ignores it.

## What these frames show, and what they do not

- `/info`'s region is named **"Host info region"**, `/analytics` "Analytics
  region", `/session` "Session diagnostics region", `/context` "Context estimate
  region", `/failovers` "Failover chains region" — read off the live DOM, which
  is the a11y contract (QA round 1, Q4) verified in the shipped app rather than
  in a story.
- `/failovers` reads the unknown spelling for both model rows in this run
  (`Selected` and `Serving` are the same unknown; the owner sent no model), and
  `/context` renders the owner's own refusal text because this isolated backend
  had no provider configured for that command — both are real states, stated
  rather than staged.
- **Not captured: a scrolled `/session`.** Sections 6-9 (Timings, Tool calls,
  Recent requests, Scope) only exist once the ledger has rows for the session,
  and this rig's session recorded none, so the panel fits its box and there is
  nothing below the fold to scroll to. Reaching those sections in the app needs a
  session whose turns recorded usage, which the mock provider does not do.
