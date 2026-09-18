# The publish dialog: what is published, and what each refusal asks for

Two defects and one gap are what these frames answer, all three from the agent-hub
contract (§0.2 D-1, §6.2, §6.3):

- **D-1 — the consent copy described a leak that stopped happening.** The dialog
  told the author the upload "will include: Agent configuration and settings /
  Conversation history / Execution history / Learnings and memory / Current plan
  (if any)". `export_agent_archive` had been stripping all four
  (`_EXPORT_SKIP_NAMES`, `local_operator/agents.py`), so the one string a user
  reads before publishing something publicly was false — and false in the
  alarming direction, which is the direction that makes a cautious user stop
  using the feature and a careless one ignore the dialog.
- **D-2 — every failure was one prose sentence.** A duplicate name, a reserved
  built-in name, a moderation rejection, a review outage and an oversized
  document all arrived as `Error uploading agent to Radient: <repr>` and were
  rendered as one toast, so the user could not tell "change the name" from "this
  was refused" from "try again in a minute".
- **§6.3 — nothing was checked before submitting.** A name the built-ins reserve,
  a name somebody else already holds, an instruction body over the cap: all of it
  cost a round trip and a moderation review to discover.

## What produced these frames

Storybook built from this tree, through the repo's own capturer, one narrowed
(append-mode) pass per surface, all twelve themes, on port 6041:

```
node scripts/capture-evidence.mjs http://localhost:6041 --only=agents-publish-dialog
node scripts/capture-evidence.mjs http://localhost:6041 --only=agents-pull-outcomes
```

The dialogs are driven by the SHIPPED component (`upload-agent-dialog.tsx`)
against a stubbed desktop transport that speaks the app's own `/__desktop`
envelope: `{status, body}` where `body` is either the CRUD payload or the
refusal `{detail: {code, message, details}}` the local backend returns. The
refusal frames are not rendered from a prop — six of the ten are reached by
PRESSING the consent box and Publish, and each `play` holds the shutter
(`capturePending`) until the state's own text is on screen.

NO BACKEND IS INVOLVED, and that is the stronger form the older note here
described the weaker one. This worktree's `.env` points
`VITE_LOCAL_OPERATOR_API_URL` at a dead port on purpose, so the run needs no
`--allow-backend` — that flag states that a live backend is running and no
captured surface talks to it, and here there is nothing to talk to. Every frame
is a function of this tree: the stub answers `/__desktop` (including the
connectivity probe's `/health`, which is what lets the dialog read the
instruction body at all), and nothing else is reachable.

## The frames

| Frame | What it is |
|---|---|
| `default/` | The consent copy as corrected: the instruction set, its parts, and the sentence that says nothing else leaves the machine. Name free, submit enabled once the box is ticked. |
| `pre-validation-blocked/` | Every locally-checkable rule broken at once — a name ending in a period, an empty description, an empty instruction body. Submit is disabled and the list says why, above it, with the route to the fields this dialog has no control for. |
| `name-taken/` | A name another account holds, after submitting: "That name is taken", with the single next step (choose another name). |
| `name-taken-by-you/` | The SAME code with `owned_by_caller`: a different headline and a different next step ("update the existing listing"). The pair is the case one prose toast could not carry. |
| `name-claim-in-flight/` | The same family's third case: a name another publication holds for a few seconds. Warning register, "Try again", and deliberately **not** worded as taken — abandoning a name that is free a moment later is the wrong move. |
| `reserved-builtin/` | A built-in's name, caught BEFORE submitting, from the built-in rows `profiles.list` already returns — no round trip, and it works with no credential. |
| `reserved-builtin-refusal/` | The same refusal from the hub instead, for a machine whose built-in list is older than the hub's manifest: the sentence names the name being published and the built-in that reserves it. |
| `moderation-rejected/` | A content decision: the reviewer's sentence, the category line, and "Edit the instructions" — and deliberately no retry. |
| `moderation-unavailable/` | A dependency failure: warning register, "Try again", and the sentence that says NOTHING was published. |
| `published/` | The receipt, repeating what left the machine, titled by the outcome it reports. |
| `update-listing/` | The republish affordance, which needs the hub listing id the app now remembers (`published-listings-store`). |

## What these frames do NOT prove

- **Nothing about the hub.** Every refusal here is a fixture of the shape the
  local backend produces, and the end-to-end run in the pull request is what
  shows the real backend producing it (a real 409 `name_taken`, a real 409
  `name_reserved_builtin`, a real 422 `moderation_rejected`). A frame cannot
  prove a status code.
- **Nothing about the copy matching what the backend strips.** "Nothing else
  leaves this machine" is a claim about `_EXPORT_SKIP_NAMES` and the document
  builder, evidenced by the archive listing in the pull request (an exported
  agent archive is two files: `agent.yml` and `system_prompt.md`), not by pixels.
- **Nothing about `payload_too_large` or `invalid_instruction_set` from the hub.**
  Those have frames only in the unit suite (`scripts/agents-publication.test.mjs`),
  because a document that passes the local caps cannot exceed the hub's byte
  bound, and the local validator refuses the rest first.
- **Nothing about keyboard ORDER or the live region.** A result state moves focus to
  its own result region — a container, not a control — which is visible in these
  frames as the absence of any ring beside the action row (`styles/index.css`
  sanctions `outline-none` for exactly that case, and the alternative, focusing
  the action, was measured not to be reproducible). Which control a Tab press
  then reaches, Escape, the `role="alert"` announcement and the polite live
  region on the success panel are asserted by the code and by the tests, not
  measurable in a still.
- **Not a base/head pair.** These are one tree's frames of states that did not
  have frames before; the "before" is the string this dialog used to show, quoted
  above, not a photograph of it. `docs/evidence/manifest.json`'s
  `dirtyWorkingTree` records whether the tree was clean when they were taken.
