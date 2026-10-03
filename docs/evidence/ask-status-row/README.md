# The ask row item: the queued-ask affordance moves into the composer status row

The queued-ask affordance was a full-width strip above the composer. It is a **row
item in the composer's status row** now — a peer of `All to-dos resolved` and
`2 wakes armed` — because a queued ask is one more thing a session has
outstanding, and the register that lists those things is the row, not a banner.

The pair below is the whole change: the same four queue states, photographed on
the old surface and on the new one, plus the two frames that prove what the item
opens. Both halves are 8 cases × 2 palettes = 16 frames, 32 in the set.

| state | what the queue is | BEFORE (`before/`) | AFTER (`after/`) |
| --- | --- | --- | --- |
| `waiting` | one ask, inside its window | the strip: a bordered, filled full-width box reading `1 question waiting — Which environment should I deploy this to?` | the row item: `1 question waiting`, mark in `accent`, label in `ink` |
| `settled` | one ask, answered and delivered | the strip: `1 settled — …` | the row item: `All asks settled`, muted rest state |
| `moved-on` | one ask whose deadline passed | the strip: `1 question waiting — …` (**the defect**: a timed-out ask counted as one the agent is still waiting on) | the row item: `1 question moved on`, muted, and still answerable |
| `multiple` | two asks waiting | the strip: `2 questions waiting — …` | the row item: `2 questions waiting` |
| `neighbours` | the item among the chips it joins | the strip ABOVE the row's chips (`Goal`, `1 to-do open`, `2 wakes armed`, `1 monitor armed`) | the item INSIDE the run of chips, after the plan and before the wakes |
| `neighbours-narrow` | the same row at the narrow band | the same strip above the wrapped chips | the item wrapping with its neighbours rather than claiming a row |
| `expanded-settled` | the panel over a settled queue | strip + panel | the item + panel: `Answered — delivering`, the question as asked, the answer as given (`staging`) |
| `expanded-moved-on` | the panel over a moved-on ask | strip + panel | the item + panel: `Timed out — the agent moved on; you can still answer`, controls LIVE |

## The four states, and the two registers

The item is one element in four states, and the whole difference between the
loud one and the quiet ones is **colour**:

- **ATTENTION (`waiting`, `multiple`)** — the label steps to `ink`, the mark to
  `accent`. Nothing else.
- **QUIET (`settled`, `moved-on`)** — exactly the row's other settled chips'
  register: the shared control box in the muted rest ink.

`moved-on` is deliberately NOT attention. A timed-out ask is still answerable (a
late answer reaches the model), so the row keeps offering it — but the agent has
walked past it, and the row's one urgency spend is not spent on a question nobody
is waiting on. That is the same scoping `waiting`/`movedOn` apply in the read
model, where the backend's own outstanding tally folds both together.

The visible clause is the short one even when the queue is mixed
(`1 question waiting`); the split (`1 question waiting · 1 moved on`) is spelled
in the **announced name** and the tooltip, which is the one place with room for
it. The visible text is always a substring of the announced name, and both come
from one function in the copy contract (`askChipClause` / `askChipLabel`), so the
two readers cannot describe different states.

## What produced these frames

The repo's own capturer, one private headless Chrome per run (reaped by the rig),
against a Storybook dev server:

```
node_modules/.bin/storybook dev -p 6017 --no-open --ci --quiet

node scripts/capture-evidence.mjs http://localhost:6017 \
  --only=chat-asks-queued-asks --allow-backend \
  --themes=localOperatorDark,localOperatorLight            # BEFORE

node scripts/capture-evidence.mjs http://localhost:6017 \
  --only=composer-status-row--ask- --allow-backend \
  --themes=localOperatorDark,localOperatorLight            # AFTER
```

`--allow-backend` because a backend was listening on the app's configured port;
the ask stories render from fixtures and never call out, which is what that flag
states.

**This set is NOT in the sweep's `STORIES` table**, and that is deliberate: the
sweep re-captures every story from the tree it runs on, so a `before/` directory
in the table would be overwritten by the CURRENT code on the next sweep and the
pair would silently become a pair of identical frames. It is declared in
`docs/evidence/manifest.json`'s `supplementary` list instead — the same shape
every bespoke set in this tree uses — and its frames are excluded from the swept
count.

The rig selects entries by story id, so the two halves needed the two ids below
and a `dir` override per state; those eight rows per half existed only for the
length of the run and were removed before the commit (the sweep's table stays
`main`'s):

```js
/* BEFORE - the strip above the composer, from the base tree's own surface */
["chat-asks-queued-asks--minimized-one",          617, 150, { dir: "../ask-status-row/before/waiting" }],
["chat-asks-queued-asks--minimized-settled-only", 617, 150, { dir: "../ask-status-row/before/settled" }],
["chat-asks-queued-asks--minimized-moved-on-only",617, 150, { dir: "../ask-status-row/before/moved-on" }],
["chat-asks-queued-asks--minimized-two-waiting",  617, 150, { dir: "../ask-status-row/before/multiple" }],
["chat-asks-queued-asks--neighbours",             617, 320, { dir: "../ask-status-row/before/neighbours" }],
["chat-asks-queued-asks--neighbours-narrow",      393, 320, { dir: "../ask-status-row/before/neighbours-narrow" }],
["chat-asks-queued-asks--expanded-settled",       617, 470, { dir: "../ask-status-row/before/expanded-settled" }],
["chat-asks-queued-asks--expanded-moved-on",      617, 470, { dir: "../ask-status-row/before/expanded-moved-on" }],

/* AFTER - the row item, from the tree this change ships */
["chat-composer-status-row--ask-waiting",           617, 320, { dir: "../ask-status-row/after/waiting" }],
["chat-composer-status-row--ask-settled",           617, 320, { dir: "../ask-status-row/after/settled" }],
["chat-composer-status-row--ask-moved-on",          617, 320, { dir: "../ask-status-row/after/moved-on" }],
["chat-composer-status-row--ask-multiple",          617, 320, { dir: "../ask-status-row/after/multiple" }],
["chat-composer-status-row--ask-neighbours",        633, 420, { dir: "../ask-status-row/after/neighbours" }],
["chat-composer-status-row--ask-neighbours-narrow", 441, 460, { dir: "../ask-status-row/after/neighbours-narrow" }],
["chat-composer-status-row--ask-expanded-settled",  617, 660, { dir: "../ask-status-row/after/expanded-settled" }],
["chat-composer-status-row--ask-expanded-moved-on", 617, 660, { dir: "../ask-status-row/after/expanded-moved-on" }],
```

### The BEFORE recipe, exactly

`before/` is the base tree — `e0e2e563c28`, the branch point — plus one
commit of **temporary base-compatible fixtures**, `791e8cf92af`. The two
surfaces are different components, so the pair cannot share a story file:

- **Already on the base, reused as-is**: `minimized-one` (the waiting state).
- **Added by `791e8cf92af`, and deleted by the commit that moved the
  affordance**: `minimized-settled-only`, `minimized-moved-on-only`,
  `minimized-two-waiting`, `neighbours`, `neighbours-narrow`, `expanded-settled`
  and `expanded-moved-on` (the neighbours pair stacks the base strip above a
  `ComposerStatusRow` carrying the goal, plan, wakes and monitors). Nothing on the
  base drew a settled-only or a moved-on-only queue, and nothing drew the ask
  element beside the row's chips, which is what the pair is about.
- **A fixture correction that is part of the evidence rather than of the
  product**: the base story file's own `frontend()` helper publishes
  `asks_open` as `status === "open"` only, while the wire's field is the
  backend's OUTSTANDING set (`open` OR `timed_out`). Under the helper's count a
  timed-out ask publishes zero outstanding and the base strip reads `1 settled` —
  a fixture artifact rather than the product. The BEFORE fixtures publish the
  count the product's own wire carries, which is why `before/moved-on/` reads
  `1 question waiting` (the shipped strip's real reading for a moved-on ask, and
  the state this change replaces with `1 question moved on`).

Both halves are 2 palettes (`localOperatorDark`, `localOperatorLight`), and the
frames are the rig's own WebP output. Frame widths differ between the halves
because the two surfaces are shot through two different harnesses: the ask
stories' decorator is a fixed 617px frame, while the row story is a composer band
that renders `band + 48px` of harness padding. The comparable number is the
**band**: `neighbours` is a 585px band in both halves (617- and 633px frames),
and the four states are a 569px band against the base's 617px frame.

## The measured gate (`dom_audit.mjs`)

The design-qa skill's DOM audit ran against the rendered stories — the same
installed Chrome the frames come from, `--use-mock-keychain` (the tool's own
launch args), one browser per invocation, all headless:

```
node $HOME/.local-operator/skills/design-qa/scripts/dom_audit.mjs \
  "http://localhost:6017/iframe.html?id=chat-composer-status-row--ask-neighbours&viewMode=story" \
  --channel chrome --playwright /Users/damian/node_modules/playwright-core \
  --wait-ms 2500 --viewports 1440x900,390x844 --json --out <scratch>/dom-audit-neighbours.json
```

**The `--playwright` path in the brief does not exist on this host**
(`minervaai/interfaces/user-dashboard/node_modules/playwright` is absent). The
machine does carry a real `playwright-core@1.63.0` at `~/node_modules`, and the
audit resolved against it — nothing was installed. This is stated because the
tool path is part of how the numbers were produced.

Readings, `ask-neighbours` (the story with every chip present):

| viewport | elements scanned | findings |
| --- | --- | --- |
| 1440x900 | 52 | 5 × `target-size` **advisory** — every row chip, the item included: `1 question waiting` measures **133x24px** against the 44px touch recommendation, exactly as `1 to-do open` (104x24), `2 wakes armed` (117x24) and `1 monitor armed` (124x24) do |
| 390x844 | 52 | the same 5 advisories, plus 1 × `text-clipped` **fail** on `body` (`scroll 633x844 vs client 390x844`) |

**The `body` clip is a harness artifact and is not claimed as a product
reading**: the story renders a FIXED 633px-wide band (the pane measure the two
halves share), and a 390px viewport clips it. The app's own narrow case is the
`neighbours-narrow` frame, whose band is 393px — which is why that state exists
as its own story rather than only as a narrower window on the wide one.

`ask-waiting` and both `expanded-*` stories return the same shape (the
`target-size` advisories on the chips; no contrast, overlap, tiny-text,
control-name, input-label or heading-order finding at either viewport). **No
primary finding is attributable to the ask item**: it is the same 24px control as
its neighbours, its label/ink pair clears the contrast contract in both palettes
(`pnpm check-themes`, 30,304 assertions across 59 themes), and nothing overlaps
or clips.

## Geometry: the row does not change height between the states

Measured off the rendered stories with one headless Chrome and the same
`playwright-core` (a scratchpad probe, `getBoundingClientRect` per story — one
browser for all five cases):

| story | row height | item height | item top | item width | item state |
| --- | --- | --- | --- | --- | --- |
| `ask-waiting` | **32px** | **24px** | 49.39px | 133.47px | `minimized` |
| `ask-settled` | **32px** | **24px** | 49.39px | 117.50px | `minimized` |
| `ask-moved-on` | **32px** | **24px** | 49.39px | 148.39px | `minimized` |
| `ask-multiple` | **32px** | **24px** | 49.39px | 141.44px | `minimized` |
| `ask-neighbours` | 58px (two lines) | 24px | 75.39px | 133.47px | `minimized` |

**The row height does not change between states: measured 32px in all four**
(`waiting`, `settled`, `moved-on`, `multiple`), and the item is 24px with its top
edge at 49.39px in every one of them. Only the WIDTH moves, and only by the
clause's own length. In `neighbours` the item's top edge (75.39px) is exactly the
row's other count chips' (75.39px) and its height (24px) is exactly theirs (24px),
which is what "peer of the existing chips" means as a number rather than as an
impression.

The same identity is pinned without a browser in
`scripts/composer-tabs.test.mjs`: the attention and quiet buttons' class token
sets are compared with the ink classes removed and must be equal, so a future
edit that gave one state its own padding or fill fails in CI rather than in a
frame.

## What this pair does NOT claim

- **The open triage PR's urgency and deadline work is not ported.** The
  `waiting`/`movedOn` split and their counts are mirrored from
  `fix/ask-bar-triage-1003` (#798) so the two converge, but that branch's
  `urgent` flag, its `soonestExpiryMs` deadline reading and its
  waiting-first `head` ordering are out of this change's scope and do not appear
  in these frames. The fold between the two branches is where they land.
- **No deadline is drawn on the item.** The collapsed surface states the
  count and the register; the panel carries the countdown (`askExpiryText`).
- **The item shows no expand/collapse chevron.** Its announced name flips
  (`Expand the ask history` ⇄ `Collapse the ask history`) and `aria-expanded`
  tracks the panel, but the visible clause is the same string in both states by
  design — the row item is a peer of the settled chips, and none of them carries
  a chevron. The panel's presence is the visible state.
- **This is a story-level measurement, not a live-app one.** The frames and the
  numbers come from the production components rendered by Storybook; the
  end-to-end wiring (the item's press moving the composer into ask mode, the
  draft swap, the Escape ladder) is covered by `scripts/ask-draft-swap.test.mjs`,
  `scripts/ask-queue.test.mjs` and the chat-page suite rather than here.
