# Desktop never-keyed literal backlog — measured 2026-11-09 at `8c9a47c78b7`

Measured by running the repository's own gate, not by estimate. The invocation and its
output, the gate's line unwrapped and character-for-character as it prints it:

```
node scripts/i18n/check-strings.mjs --allowance-base origin/main
check-strings.mjs: ok — 1628 file(s) scanned, 0 literal(s) at or below the baseline; 111 literal(s) in the data shapes, all listed in i18n/literal-allowance.json (shrink-only)
```

Run on a clean `git worktree` at `origin/main` (`8c9a47c78b7`), so the growth comparison
against the base actually ran — in an export without `.git` that check skips itself and
prints a line saying so.

Every date in this document is UTC. The repository's commit dates are local, so
`8c9a47c78b7` (authored 2026-11-08 19:41 -0500) is `2026-11-09` in UTC — the date this
census, and its title, carry.

## The three numbers, and why there are three

| measure | count | what it means |
| --- | --- | --- |
| JSX text and copy attributes at or above the baseline | **0** | the original ratchet is fully cleared (`i18n/baseline.json` holds 0 files, 0 ceilings) |
| data-shape literals listed in the allowance | **111 findings / 106 ids / 39 files** | object-literal copy properties and JSX child expressions; shrink-only |
| templates the ratchet deliberately does NOT list | **234** in 108 files (169 of them hold two alphabetic words) [^1] | `const`/`return`/array position, outside the allowance by design; new ones are blocked by `check-added-strings.mjs` |

[^1]: The 234 / 108 / 169 figures are not emitted by any command — they are quoted from
the scanner's own `KNOWN BOUNDARIES` prose (`scripts/i18n/check-strings.mjs:74-88`),
which states them for this head. The other two rows come from the gate run above.

The 111/106 gap is not an inconsistency: the allowance stores ids as a per-file **set**
(`literalAllowanceFindings` builds `new Set()`), while the headline counts findings, so a
literal that appears twice in one file counts twice and lists once.

## Before and after

| date | measure | count |
| --- | --- | --- |
| 2026-11-08, allowance created by #1767 | data-shape ids | 120 ids across 40 files |
| 2026-11-09, this measurement | data-shape ids | **106 ids across 39 files** |
| 2026-10-22, earlier checkout `72f94df2697e85734b08d97c1335414ab1ac7c5b` | JSX/attribute ceilings | 102 files / 601 ceilings |
| 2026-11-09, this measurement | JSX/attribute ceilings | **0 files / 0 ceilings** |

Both directions are gate-enforced: a new data-shape literal fails unless listed, and a
listed id that disappears fails too, so the allowance can only shrink through review.

## What this census cannot see

The gate states its own blind spots in `scripts/i18n/check-strings.mjs`, under
`KNOWN BOUNDARIES` (`:59-95`), and this census inherits them instead of widening them. The
reason reduces to one constant — `DATA_SHAPE_ROOT = "src/renderer/"` (`:310`): the
data-shape pass is scoped to that prefix, so anything outside it is not a surface this
gate can count.

- **Object literals under `src/main/` and `src/shared/` are invisible** (`:60-67`) —
  protocol validation text, IPC errors, log lines. A main-process dialog or notification
  string is caught by nothing in this file.
- **`src/shared/backend-status.ts` is the sharpest case.** Its `title`/`detail` prose IS
  rendered in the renderer, but the file sits outside the scanned surface: `:349` ships
  "Not connected to a Local Operator server." as copy the gate never sees. Widening the
  surface to catch it is a measured decision, not a patch.
- **A prop outside `COPY_ATTRIBUTES` is invisible** (`:89-90`). Adding a prose prop to a
  component is a reason to add its name there.
- **Prose passed through a helper is counted at the helper, not the attribute**
  (`:91-93`): `label={describe(x)}` puts its strings inside `describe`, which is an
  object-literal or helper site.
- **Main-process strings are not counted at all** (`:94-95`) — native dialogs and OS
  notifications sit outside the renderer toast paths this file walks.
- The template gap (`const`/`return`/array position, **234** at this head) is the same
  kind of stated gap; it is described under "The three numbers" above (`:74-88`).

So the "backlog" in this document's title means **this gate's** backlog: the copy it can
count, on the surface it can count. English that renders in the main process, or reaches a
component through an unlisted prop or a helper, is not among these 106 ids and is not
claimed to be.

## The list

106 ids across 39 files, grouped by file. Shape vocabulary:
`jsx-child-expression` ×65, `object-literal:cancel` ×1, `object-literal:description` ×4, `object-literal:detail` ×4, `object-literal:label` ×13, `object-literal:message` ×9, `object-literal:text` ×9, `object-literal:title` ×1.

### `src/renderer/src/features/agents/components/upload-agent-dialog.tsx` — 16

- `jsx-child-expression` — "${…}" is in ${…}'s shared agents as an instruction set. Its members can read and install it; nobody outside the organization can.
- `jsx-child-expression` — Listing updated
- `jsx-child-expression` — Nothing else leaves this machine: no conversation, no execution history, no memory or learnings, no plan, and no machine-specific configuration. ${…}'s members can read and install what you publish; nobody outside it can.
- `jsx-child-expression` — Nothing else leaves this machine: no conversation, no execution history, no memory or learnings, no plan, and no machine-specific configuration. Anyone can read and install what you publish.
- `jsx-child-expression` — Organization
- `jsx-child-expression` — Public hub publications are readable by anyone. An organization's agents are readable by its members only.
- `jsx-child-expression` — Publish
- `jsx-child-expression` — Published to ${…}
- `jsx-child-expression` — Published to the hub
- `jsx-child-expression` — Publishing…
- `jsx-child-expression` — Sharing agents inside an organization is part of the Team plan. An owner of ${…} can activate it in the Radient console.
- `jsx-child-expression` — The hub reserves "${…}" for one of its built-in agents.
- `jsx-child-expression` — The hub reserves this name for one of its built-in agents.
- `jsx-child-expression` — Update listing
- `jsx-child-expression` — You are about to publish this agent's instruction set into ${…}, where only its members can read and install it. What is published is what describes the agent:
- `jsx-child-expression` — You are about to publish this agent's instruction set to the public Agent Hub. What is published is what describes the agent:

### `src/renderer/src/features/chat/canonical/canonical-transcript.tsx` — 8

- `jsx-child-expression` — Earlier text of this answer is not on screen
- `jsx-child-expression` — Interrupted
- `jsx-child-expression` — No answer given
- `jsx-child-expression` — Not run
- `jsx-child-expression` — Part of this answer may be missing
- `jsx-child-expression` — Worked
- `jsx-child-expression` — Worked for ${…}
- `jsx-child-expression` — · Job ${…}

### `src/renderer/src/features/agents/components/agents-page.tsx` — 7

- `jsx-child-expression` — Connecting to the backend
- `jsx-child-expression` — Loading what this backend can do…
- `jsx-child-expression` — New
- `jsx-child-expression` — Reusable agents need a newer backend
- `jsx-child-expression` — The backend could not be reached
- `jsx-child-expression` — Update the backend to manage reusable agents and teams. Saved chats are unchanged.
- `jsx-child-expression` — Updated

### `src/renderer/src/features/aida/aida-control.ts` — 6

- `object-literal:text` — ${…} will say hello once an AI account is connected. Connect one from the chat to start.
- `object-literal:text` — ${…}'s conversation could not be opened, so you are in a new chat instead. ${…}
- `object-literal:text` — Aida is active.
- `object-literal:text` — Aida is paused.
- `object-literal:text` — Aida is paused. She will not check in until you resume her.
- `object-literal:text` — Aida is resumed. She will check in on her usual schedule.

### `src/renderer/src/features/chat/components/run-details/run-child-reader.tsx` — 6

- `jsx-child-expression` — Result
- `jsx-child-expression` — Result preview
- `jsx-child-expression` — Show ${…} more lines
- `jsx-child-expression` — Show less
- `jsx-child-expression` — This is a shortened copy. This subagent's conversation is not available here.
- `jsx-child-expression` — This subagent's conversation is not available here.

### `src/renderer/src/features/chat/components/run-details/mcp-auth-dialog.tsx` — 5

- `jsx-child-expression` — Sign-in ${…}.
- `jsx-child-expression` — Waiting for backend sign-in status…
- `object-literal:message` — Could not determine this server's sign-in method. Check its connection and MCP setup, then retry.
- `object-literal:message` — This server does not use OAuth and declares no secret references. Add explicit ${NAME} references to its MCP environment or headers, then retry.
- `object-literal:message` — Update the backend for secure MCP key entry. OAuth and the server list remain available.

### `src/renderer/src/features/chat/approval-words.ts` — 4

- `object-literal:description` — Refuse the action; the turn continues.
- `object-literal:description` — Run the action and continue the turn.
- `object-literal:label` — Approve
- `object-literal:label` — Deny

### `src/renderer/src/features/chat/components/run-details/mcp-failure.ts` — 4

- `object-literal:cancel` — The cancellation could not be confirmed
- `object-literal:message` — ${…} because this conversation's session is not running. Trying again restarts it and repeats this request.
- `object-literal:message` — ${…}: a sign-in is already running for this conversation, and only one can run at a time. Wait for it to finish, or cancel it from the server's row.
- `object-literal:message` — ${…}: the server refused it without giving a reason, and nothing was changed.

### `src/renderer/src/recording-encoder/main.ts` — 4

- `object-literal:detail` — only a software H.264 encoder is available, and it is not used above 1920x1080 (${…}x${…})
- `object-literal:detail` — the H.264 encoder does not accept ${…}x${…}
- `object-literal:detail` — this engine cannot encode H.264
- `object-literal:detail` — this engine has no WebCodecs VideoEncoder

### `src/renderer/src/features/agents/components/team-detail.tsx` — 3

- `jsx-child-expression` — Agent
- `jsx-child-expression` — Team
- `jsx-child-expression` — · Includes a team

### `src/renderer/src/features/chat/canonical/transcript-reducer.ts` — 3

- `object-literal:text` — Compaction did not run${…}${…}
- `object-literal:text` — Interrupted
- `object-literal:text` — Stopped with an error

### `src/renderer/src/features/chat/components/run-details/job-cancel-popover.tsx` — 3

- `jsx-child-expression` — Cancel
- `jsx-child-expression` — Cancelling…
- `jsx-child-expression` — The runtime asks the provider to stop “${…}”. The row says “Cancelled” only when the job settles.

### `src/renderer/src/features/chat/components/trace/tool-detail.tsx` — 3

- `jsx-child-expression` — Error
- `jsx-child-expression` — Interrupted
- `jsx-child-expression` — Output

### `src/renderer/src/features/chat/session-status/session-model.ts` — 3

- `object-literal:label` — auto
- `object-literal:label` — reasoning
- `object-literal:label` — unknown

### `src/renderer/src/features/agents/components/agent-detail.tsx` — 2

- `jsx-child-expression` — A copy of ${…}. It is a separate agent: changing it does not change the original.
- `jsx-child-expression` — Reusable instructions shared by agent commands, subagents and teams. Chats stay separate.

### `src/renderer/src/features/chat/canonical/image-group-lightbox.tsx` — 2

- `object-literal:label` — Show image ${…} of ${…}
- `object-literal:title` — Show image ${…} of ${…}

### `src/renderer/src/features/chat/canonical/supplement-file-actions.tsx` — 2

- `jsx-child-expression` — Copied
- `jsx-child-expression` — Copy file path

### `src/renderer/src/features/chat/components/run-details/run-detail-mcp.tsx` — 2

- `jsx-child-expression` — ${…} tools
- `jsx-child-expression` — 1 tool

### `src/renderer/src/features/chat/components/run-details/use-mcp-remedy.ts` — 2

- `object-literal:message` — Saved: ${…}.
- `object-literal:message` — The keys were saved, but this server is not connected. Check the credentials and server setup, then retry.

### `src/renderer/src/features/chat/transcript-display-mode.ts` — 2

- `object-literal:label` — By response
- `object-literal:label` — By turn

### `src/renderer/src/features/agents/config-run/summary.ts` — 1

- `object-literal:description` — description

### `src/renderer/src/features/agents/utils/publication-validation.ts` — 1

- `object-literal:description` — Description

### `src/renderer/src/features/chat/canonical/provider-error-guidance.ts` — 1

- `object-literal:label` — billing

### `src/renderer/src/features/chat/canonical/sound-batch.tsx` — 1

- `jsx-child-expression` — Cost not yet known.

### `src/renderer/src/features/chat/canonical/turn-collapse-model.ts` — 1

- `object-literal:label` — ${…} more

### `src/renderer/src/features/chat/chat-sidebar-view.ts` — 1

- `object-literal:label` — Ungrouped

### `src/renderer/src/features/chat/components/credential-chip.tsx` — 1

- `jsx-child-expression` — · ${…} chars

### `src/renderer/src/features/chat/components/message-item/code-block.tsx` — 1

- `jsx-child-expression` — Code

### `src/renderer/src/features/chat/components/message-item/invalid-attachment.tsx` — 1

- `jsx-child-expression` — ${…} is not viewable (file may be incomplete, deleted, or moved)

### `src/renderer/src/features/chat/components/radient-session-issue.tsx` — 1

- `jsx-child-expression` — If signing in does not clear this, run ${…} in a terminal.

### `src/renderer/src/features/chat/components/run-details/run-detail-subagents.tsx` — 1

- `jsx-child-expression` — Show ${…} more

### `src/renderer/src/features/chat/components/trace/agent-reasoning.tsx` — 1

- `jsx-child-expression` — ${…} for ${…}

### `src/renderer/src/features/chat/mark-all-read.ts` — 1

- `object-literal:label` — Mark all ${…} read

### `src/renderer/src/features/chat/utils/link-actions.ts` — 1

- `object-literal:label` — Actions for ${…}

### `src/renderer/src/features/mesh/mesh-canvas.tsx` — 1

- `jsx-child-expression` — untitled

### `src/renderer/src/features/mesh/mesh-card.tsx` — 1

- `jsx-child-expression` — member

### `src/renderer/src/features/providers/sign-in-flow.ts` — 1

- `object-literal:message` — This sign-in is no longer available. Start again.

### `src/renderer/src/features/settings/components/integrations/integration-key-dialog.tsx` — 1

- `jsx-child-expression` — Key

### `src/renderer/src/features/team-bridge/team-bridge-reactions.tsx` — 1

- `jsx-child-expression` — U+${…}

