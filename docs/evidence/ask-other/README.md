# The asks drawer: the composer no longer answers, and every question ends in `Other`

The operator's request (2026-10-07): *"Currently it's not clear how you're supposed to
respond to other. I think if you type in the composer while the sidebar is open it
responds as 'other'. Remove that. Make it so that sending in the composer while the asks
sidebar is open doesn't respond to the question but just sends normally in the chat, and
then add an input composer 'Other' response option for all questions."*

This reverses design 5.0's R7 amendment (`ask-nonblocking.md` in the core repository),
which the operator himself asked for: while the drawer was open the page's one composer was
the answer box. Two changes ship together because each is the other's replacement - the
composer stops being a door, and the door that was missing is built into the card.

## What the frames carry

Every pair is the SAME step on the SAME rig; the only thing that differs is the tree.
`before/` is `origin/main` (`3b1224b8f84`), `after/` is this branch's head, both served by
their own Vite from their own worktree and `node_modules`, against one isolated daemon each
(real routes, a real `Session`, a real `AskQueue`). Dark is the whole matrix; Light repeats
the card states (a-e), because the new row's ground and focus ring are the thing a palette
could break. 106 frames: 67 Dark (27 before, 40 after) and 39 Light (16 before, 23 after).

| step | what is driven | before (`origin/main`) | after |
| --- | --- | --- | --- |
| a | single-select, an option picked, `Send answer` | three option rows and no way to say anything else; the daemon logs `answered {deploy-target: [Production]}` | the same, plus a trailing `Other  Type your own answer` row; the same `answered` body |
| b | single-select, `Other` pressed empty, then typed, then sent | there is no row to press; the step has to `Decline` | the field opens, focused, two lines tall, `Send answer` DISABLED while it is empty or only spaces; typed text enables it; the daemon logs `answered {region: [ap-southeast-2 (Sydney)]}` |
| c | multi-select, two ticks, then `Other` added | two ticks and nothing beside them | `Other` is a checkbox that is ADDITIVE and goes last; the daemon logs `answered {checks: [Unit tests, Smoke tests, Load tests]}` |
| d | free-text-only question | a bare single-line `<input>` 34px tall, unlabelled (the in-page audit's `input-label` finding) | the multi-line field, 56px, named `Your answer to: <question>`, open with no row; Enter sends |
| e | secret question | masked field | the SAME masked field and NO `Other` row, in both trees |
| f | the main composer, drawer open | placeholder `Answering the agent's question - Esc to collapse`; the 62 typed characters are written into the ask and `answered {rotate: [Before you rotate them: ...]}` is logged; the model is handed `The user answered: rotate ...`; the ask vanishes from the drawer | placeholder `Ask anything. @ adds files, / runs commands`; the same 62 characters go to the chat as a user message; the ask log still ends at `queued`; the ask is still drawn with its options; the model is handed the sentence as plain user text |
| g1 | the legacy BLOCKING ask card | answered with `{PAIRING: [Popup is not open]}` | identical |
| g2 | change before delivery, option to option | `answered Staging`, then `revised Production` | identical; `g2x*` then does the same through the NEW row: `answered Staging`, `revised Canary (5% of traffic)` |
| h | `Other` selected but empty | not reachable | `Send answer` disabled, nothing on the wire |

Step f is read from the daemon, not the page: `run-*.json` carries the ask log
(`asks.jsonl`), the recorded provider call (what the model was handed) and the history route's
entries. In the after run the history carries the user message and the ask log is still open;
that is the proof nothing in the UI marks an ask answered from a chat message. The model in
this rig never calls `ask_withdraw` - that tool is the AGENT's, so whether an ask stays open
after a chat send is the UI's doing here, and it is the only thing the UI could do.

## The numbers behind the frames

At the 1380x900 window the drawer's card is 510px wide (`run-after.json`'s probes):

- Option rows: 29.7px (45.7px where the option carries a description). The `Other` row is
  **29.7px x 510px**, a `role="radio"` (`checkbox` in a multi-select group): the same row
  family, the same mark, ground and focus ring. WCAG 2.5.8's 24px minimum is cleared; the
  44px touch recommendation is an advisory the in-page audit raises for EVERY option row in
  the drawer, `Decline` and `Send answer` included, not for this row alone.
- Adding the row grows the question block by exactly one row: 147.1 -> 176.8px (+29.7);
  `Send answer` moves 269.5 -> 299.1px.
- Pressing `Other` moves nothing above it: the prompt (y 114.4), and every option row
  (y 140.4 / 170.1 / 199.8, h 29.7) read the same before and after. The block grows by
  144.8 -> 208.8px (+64.0), which is the field's own 56px plus its 8px of padding.
- The drawer's own scroller reads `scrollHeight 860 / clientHeight 860` in every state of
  both trees: it does not grow a scrollbar. The field adds a second scroller of its own
  (54/54, not scrolling) that only appears when the field does.
- The free-text field is 56px against the 34px bare input it replaces, and is named by its
  question.
- The in-page `dom_audit` (the design-qa script's own `inPageAudit`, lifted verbatim and
  scoped to `[data-ask-drawer]`) ran in four states (`h1`, `c2`, `d2`, `e2`) and reported no
  `low-contrast` finding in any of them, in either palette. Its primary findings are the
  three `target-size` rows of the drawer's filter
  chips (21px tall; present before this change and untouched by it). The one finding this
  change REMOVES is the old input's `input-label`: `before/d2` has 4, `after/d2` has 3.

## Decisions the frames cannot show

- **Enter in the field commits, Shift+Enter is a newline.** That is the shared composer's
  own convention (`use-message-input.ts` tests `shiftKey` alone), so Cmd/Ctrl/Alt+Enter
  commit too and no chord is a trap; an IME's composition Enter is left alone. What
  "commit" means is the card's: send the ask when it is complete, otherwise move to the next
  question that still needs an answer. Step d records it on both trees: Enter answers the ask
  after, and did nothing before (the bare input had no handler).
- **A secret question gets no `Other` row.** The masked field IS its free-form entry, and a
  plain box beside a credential is the failure the main composer's own secret refusal
  (`askComposerHoldsSecret`, kept) exists for.
- **The field is text-only, and says so.** A pasted image or file is REFUSED IN WORDS under
  the field and a dragged file gets the pointer's own "no drop"; no control accepts what it
  then drops. Attachments in `Other` are NOT in this change: on core's latest release
  (v0.68.7) an answer is `Record<string, string[]>`. Core's `images` key on the answer
  body (local-operator#2058) is merged to core's main after that tag, so it is unreleased,
  and it is gated on a `features.ask_attachments` capability this renderer does not read
  yet. The attach affordance follows in a later change that gates on it.
- **Nothing here takes focus by itself.** The field takes focus only inside the handler of
  the user's own press on the `Other` row (`h1` reads `focused: true` after the press). On
  an option question the mount, the door landing and a re-render are pinned NOT to move
  focus into the `Other` field. The one field that holds focus in `after/d1-card` is the
  free-text card's: that card has no options, so the drawer's own door landing (#864's
  rule, unchanged) finds the only control it has, exactly as it found the old bare input in
  `before/d1-card`.

## Re-deriving the frames

Everything is under `harness/`, resolves the repository from its own location, and reuses
`ask-drawer-stuck`'s Vite config. `rig-up.sh` serves WHICHEVER TREE `RIG_REPO` names, which
is how one harness photographs both arms:

```
# 1. a worktree of origin/main for the BEFORE arm, and this branch for the AFTER arm
RIG_REPO=<main worktree>  ASKS_RIG_PORT=5321 bash docs/evidence/ask-other/harness/rig-up.sh   # prints its scratch root
RIG_REPO=<this worktree>  ASKS_RIG_PORT=5322 bash docs/evidence/ask-other/harness/rig-up.sh
# 2. drive both through ONE headless Chrome; --theme=localOperatorLight --only=a,b,c,d,e is the Light pass
node docs/evidence/ask-other/harness/drive-other.mjs <out-dir> \
  "before,http://localhost:5321,<before scratch>" "after,http://localhost:5322,<after scratch>" \
  --audit=<design-qa skill>/scripts/dom_audit.mjs
# 3. stop each rig BY EXACT PID (never by name) and remove its scratch root
RIG_SCRATCH=<scratch root> bash docs/evidence/ask-other/harness/rig-down.sh
```

The driver launches ONE private headless Chrome through `scripts/chrome-keychain.mjs`
(`--use-mock-keychain`, so it never reaches Keychain Services under a scratch profile),
closes it through the browser's own `Browser.close`, kills it by exact pid only if that
fails, and removes its profile once the process has exited. Every press is a CDP mouse
event at the element's measured centre, hit-tested first; text goes in through
`Input.insertText`; Enter and Escape are real key events. A secret field's value is never
read back into a record. The `--net` flag traces every `/__desktop` request the page makes.

## What this does not cover

- **No Electron window.** The renderer, the components, the answer path and the
  `/__desktop` bridge are the shipping ones; the IPC/preload channel and a packaged native
  window are not exercised, and the frames say so.
- **The model is a recording stub.** It answers one line and never calls a tool, so core's
  `ask_withdraw` (`reason=answered_in_chat`) is not exercised here; step f proves the UI
  half only (the message reaches the agent as a plain user message and the ask stays open).
- **The free-text-only question is enqueued as a plain mapping.** `AskQuestion` refuses a
  non-secret question with fewer than two options, so no model can emit one today; the wire
  contract and the card both carry the shape, and `serve-other.py` says so where it enqueues.
- **Run-to-run:** the Dark matrix ran error-free in each of its last four passes (the
  matrix grew between them, 21 to 27 frames before and 32 to 40 after). The ask logs, the
  `Other` presence map and the card, row and field geometry were compared programmatically
  between passes 8 and 9 and between 9 and 10 and are identical in both comparisons. The
  committed frames are the last pass, at this branch's head after folding `origin/main`.
