# Public teams library — the live hub, in the real app

Four frames of the Agent hub's Teams view driven in the **built application**
(not Storybook) against the **live hub**, plus the one reading the frames cannot
carry: a real pull's own output.

They exist because the story set next door
(`docs/evidence/agent-hub-page/`) is a stubbed transport: its rows are the live
catalogue's, but its requests are answered by the story's own bridge. These four
are the same surface with `https://api.radienthq.com` answering.

| frame | what it is |
| --- | --- |
**Re-taken in review round 3, on a clean tree at head `ca870bc08`** — the same
head the manifest names. The four frames below are from that run: the refusal
sentence now names THIS MACHINE as the actor (QA round 2, Q1), so the round-2
frames, taken on a dirty tree, are superseded rather than kept.

| `01-public-scope-teams-tab-visible.png` | the public scope, first paint: the `Agents | Teams` strip is on screen before anything is scrolled. **The strip predates this change** (the base's own `agent-hub-page/teams-public-scope` frames carry it) — what this PR changes is the view's CONTENT, the notice giving way to the catalogue. This instance is signed out, so the Agents tab shows no count and the grid is empty; the count is in the story set's frames |
| `02-public-catalogue-nine-teams.png` | the catalogue, populated from `GET /v1/teams`: the **nine teams the public hub serves**, their authors, managers, rosters and the client-side search over them |
| `03-team-brief-open.png` | one team's brief, opened: the `GET /v1/teams/<id>` read (`support-desk`'s live collaboration brief, whose first paragraph is the crew's own) |
| `04-pull-pressed.png` | the Pull control pressed with the brief OPEN: the refusal renders in the card's header, beside the button — **"The team could not be pulled: this machine has no Radient sign-in for the hub. Sign in on the settings page, then pull again."** The actor is this machine, not the hub: the 401 is the local server's own credential check, taken before any hub call (QA round 2, Q1). This is the frame design round 1, D2 and agent review round 1, M1 asked for — the round-1 version of it showed no failure at all |

## How they were taken

```sh
# the built tree, headless (no window, no focus), its own scratch profile so the
# operator's running app keeps the single-instance lock and is never disturbed
pnpm build:npm
pnpm app:headless --remote-debugging-port=9341 --user-data-dir=<scratch>/lo-profile
# one CDP client against the renderer target, one page reload per run, real
# pointer presses (a synthetic `element.click()` does not activate a Radix tab)
node <scratch>/hub-live.mjs 9341 <out>
```

The rig is a scratch file, not a repository one: it drives `Runtime.evaluate` for
reads and `Input.dispatchMouseEvent` for presses, and it captures with
`Page.captureScreenshot`. It never showed or focused a window, and every process
it started was reaped by exact pid.

## What this set does NOT show

- **Not a successful UI pull.** The public reads are ANONYMOUS, so they answer
  this instance; the PULL is not anonymous — it goes through the local server,
  which needs a paired daemon, and this scratch-profile instance could not attach
  to the operator's (the daemon refuses a bearer it did not issue: `HTTP 401` on
  its desktop plane, in this run's own app log). Frame 04 is therefore the
  refusal treatment painting correctly — WITH its remedy sentence, which is the
  copy QA round 1, Q2 found missing — rather than an outage, and rather than the
  empty card the round-1 frame showed (the failure used to render below the open
  brief; it now renders beside the control that produced it). The HUB-failure arms
  are the story set's own frames (`teams-public-unavailable` for an answered 503
  and `teams-public-unreachable` for a `fetch` that never completed), captured
  after QA round 2, Q3 found only the first arm pictured.
- **The pull's success is the CLI's**, which talks to the paired daemon over the
  same local-server route the button's `team.pull` operation calls:

  ```sh
  $ lop teams pull support-desk
  Successfully pulled team 'support-desk' (ID: 10e73ee3-d540-4e65-829a-a472c8f82d7f) from the public hub
  ```

  Stored: the local team `support-desk`, id `10e73ee3-d540-4e65-829a-a472c8f82d7f`,
  in the operator's own registry (`lop teams list` names it). The button's own
  half — that a press calls the mutation with this document's hub id and no
  tenant — is pinned by `scripts/agent-hub-public-teams.test.mjs`'s mount and by
  `scripts/agent-hub-org-sharing.test.mjs`.
- **Not every theme.** One frame per state, in the theme the app was showing
  (`localOperatorDark`). The story set next door carries the twelve-theme sweep.
- **Not the app's own chrome** in the narrow sense: these are the real shell, but
  the sidebar's "Account unavailable / Reconnect Radient" is this instance's
  signed-out state, which is exactly the public library's expected state.
