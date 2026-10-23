# Team Bridge — directory and plan cues evidence

Frames for the Team Bridge directory slice: the conversation rail's **People**
section and the plan/sign-in gate that replaces the page when Team Bridge is
not eligible.

## How they were taken

- Storybook dev server from this worktree (the shipped `.storybook` config,
  theme provider and i18n catalogue), story id family `team-bridge-page--*`.
- `scripts/capture-evidence.mjs` driving a private headless Chromium over CDP:
  eight stories × `localOperatorLight` / `localOperatorDark`, **1280 × 900 CSS
  px** each. The rig's WebP output was converted to PNG and written to the
  ignored frames tree at `docs/evidence-frames/team-bridge-directory/` (frames
  are rig output and are not committed — see `.gitignore` and AGENTS.md). The
  same PNGs are attached to the pull request so a reviewer can see them without
  the frames tree.
- The stories are the pure `TeamBridgePageView` fixtures. No backend is
  contacted: the directory rows, conversation list and eligibility verdict are
  props, which is the same split the component tests exercise.

## Frames

| file | story | state |
| --- | --- | --- |
| `people-{dark,light}.png` | `team-bridge-page--people` | populated roster: self ("You"), Bea (active), Ada (admin, paused), Cy (`none`) and Dee (`disabled`) |
| `people-loading-{dark,light}.png` | `team-bridge-page--people-loading` | directory read in flight, under an unaffected conversation list |
| `people-error-{dark,light}.png` | `team-bridge-page--people-error` | directory refused; the error and its retry sit below the conversations, which stay loaded |
| `people-disabled-{dark,light}.png` | `team-bridge-page--people-disabled` | a roster where the only other person has their bridge off: muted ink, no hover, `aria-disabled` |
| `people-all-organizations-{dark,light}.png` | `team-bridge-page--people-all-organizations` | merged scope: no single roster; the section says to choose an organization |
| `plan-required-{dark,light}.png` | `team-bridge-page--plan-required` | signed-in, ready, surface state A: the Radient Team plan gate |
| `signed-out-{dark,light}.png` | `team-bridge-page--signed-out` | signed out: "Sign in to Radient" |
| `update-required-{dark,light}.png` | `team-bridge-page--update-required` | app too old: its own honest reason |

## What the frames show

- The People section is a 30px-row block under the conversation list with the
  rail's own tokens and no borders. Role text appears only for owner/admin;
  a paused person keeps a quiet "Paused" note and stays openable.
- A person whose bridge is off is still listed — the point is to see who is
  potentially reachable — but their row is muted and inert, with the tooltip
  and the `aria-describedby` cue "Hasn’t turned on Team Bridge yet".
- The plan / sign-in panels are centred, calm, and draw **no controls**: the
  three text ranks are title, one-sentence value, and the server's reason.

## What these frames do not prove

- DM resolution (an existing DM opens; no DM opens the compose flow seeded to
  that person) is driven behaviour and cannot be shown by a still. It is
  covered by `scripts/team-bridge-directory.test.mjs` at the model and rendered
  markup levels.
- The directory and status reads are coded to the frozen op shapes
  (`team_bridge.directory`, `team_bridge.status`) and the companion
  agent-server change; the local backend predating them is why the stories are
  fixtures rather than live captures.
- Hover, disabled-hover absence and the native tooltip are interaction states;
  the `aria-disabled` and `title`/`aria-describedby` markup is asserted in the
  test suite.
- The round-1 remediation's gate-pending hold and surface F read-only state are
  not in this set; both are rendered-state assertions in
  `scripts/team-bridge-directory.test.mjs` rather than stored frames.
