# The ask row item: the queued-ask affordance moves into the composer status row

The queued-ask affordance was a full-width strip above the composer. It is a **row
item in the composer's status row** now — a peer of `All to-dos resolved` and
`2 wakes armed` — because a queued ask is one more thing a session has
outstanding, and the register that lists those things is the row, not a banner.

The pair below is the whole change: the same queue states, photographed on the
old surface and on the new one, plus the frames that prove what the item opens.
Round 1 grew the set to **15 cases in `after/` and 14 in `before/`** at the two
`localOperator` palettes, because the interaction the change turns on needed
frames of its own and four states the copy contract distinguishes had none
(`mixed`, `truncated`, `zero-ask`, `narrow-longest`) plus `driven-open`,
which presses the chip rather than pinning the flag. Round 2 added one more
(`focused-panel`, the settled panel's landing stop with the keyboard on it),
taking the set to **60 frames over 16 after directories and 14 before ones**.

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
| `mixed` (round 1) | one waiting ask AND one the agent moved on from | the strip: `2 questions waiting — …` (no split: the old reading counts the timed-out ask as one the agent is still waiting on) | the item: `1 question waiting` — the split (`1 question waiting · 1 moved on`) is in the announced name and tooltip |
| `truncated` (round 1) | a capped list with a published tally | the strip: `12 questions waiting — … showing 1 of 12` | the item: `12 outstanding` — the tally, never a split of a prefix |
| `zero-ask` (round 1) | a published queue with nothing in it | the strip is absent; the row's chips stand | the ITEM is absent; the row's chips stand (`ask-zero` has no `[data-status-asks]` target at all) |
| `narrow-longest` (round 1) | the longest clause at the narrow band | the 393px band's strip, clipped mid-question (`Which environment should I…`) | the item at 148.39px, wrapping as a unit rather than truncating |
| `expanded-waiting` (round 1) | the panel over a WAITING ask | strip + panel | the ATTENTION item with its panel open — the one combination round 0 had no frame for |
| `expanded-multiple` (round 1) | the panel over two waits | strip + panel | `2 questions waiting` with the queue's two forms behind it |
| `driven-open` (round 1) | the chip PRESSED, not pinned | **no counterpart**: the old bar opened on a chevron that no longer exists | the band starts collapsed; the chip is pressed after paint and the panel opens from it (`data-capture-pending` holds the shutter until the panel's root is up) |
| `focused-panel` (round 2) | the settled panel's landing stop, FOCUSED | **no counterpart**: the old surface had no scripted landing stop | the panel root carries the keyboard and paints the app's `:focus-visible` ring — measured `outline: solid 2px rgb(56,201,106)`, offset 2px, the same ring the chip and the panel's controls paint |

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

node scripts/capture-evidence.mjs http://localhost:6017 \
  --only=chat-composer-status-row--ask --allow-backend \
  --themes=localOperatorDark,localOperatorLight            # AFTER, round 1 (all fifteen)

node scripts/capture-evidence.mjs http://localhost:6017 \
  --only=ask-focused-panel --allow-backend \
  --themes=localOperatorDark,localOperatorLight            # AFTER, round 2 (the one new case)
```

**Round 1's six new BEFORE halves came from a temporary restore, not from a
committed fixture**: they were shot with the base versions of the eight touched
source files restored into the worktree (`git checkout 791e8cf92af -- <paths>`)
plus the extra base-compatible stories appended to the restored
`ask-surface.stories.tsx`, and the worktree was restored to the branch's own files
immediately afterwards — so nothing in the tree renders a base strip now, and the
six frames are single-sided in TIME rather than in space. `791e8cf92af` (round 0's
temporary-fixture commit) was not modified.

**Round 1 re-shot all fifteen AFTER cases at the committed src head**
(`54133cdc0a4`) rather than only the new ones, so every after frame in the set
depicts one tree: the item's markup changed this round (the chip no longer carries
`data-lo-ask-surfaces`, and the panel root is itself a focus stop), and a mixture
of two runs' frames would have been a set claiming more than it shows.

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

### Round 1's readings (seven stories, both viewports)

Run at the round-1 head over `ask-neighbours`, `ask-waiting`, `ask-mixed`,
`ask-truncated`, `ask-narrow-longest`, `ask-zero` and `ask-driven`, the same way
(`--playwright /Users/damian/node_modules/playwright-core`). Every reading below
is the tool's own `target-size` finding for the `[data-status-asks]` button:

| story | 1440x900 | 390x844 |
| --- | --- | --- |
| `ask-neighbours` | item **133x24** at x=152 (between the plan and the wakes) | same, plus the harness `body` clip |
| `ask-waiting` | item **133x24** | same, plus the harness `body` clip |
| `ask-mixed` | item **133x24** (the visible clause stays the waiting one) | same, plus the harness `body` clip |
| `ask-truncated` | item **115x24** (`12 outstanding`) | same, plus the harness `body` clip |
| `ask-narrow-longest` | item **148x24** (the longest clause) | same, plus the harness `body` clip (`scroll 441x844`) |
| `ask-zero` | **no `[data-status-asks]` target** — the item is absent, and only the row's own chips are advisory | same |
| `ask-driven` | item **133x24**, unchanged by the panel being open | same, plus the harness `body` clip |

No non-advisory finding beyond the `body` clip — which is the story harness's
fixed band (617/633/441px) in a 390px viewport, listed in every story and in
round 0's readings above, not a product reading — and no contrast, overlap,
tiny-text, control-name, input-label or heading-order finding at either viewport.
The `ask-zero` row is the one worth reading twice: the absence of the item is not
an impression from a still, it is the audit having no target to report.

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
| `ask-mixed` (round 1) | **32px** | **24px** | 49.39px | 133.47px | `minimized` |
| `ask-truncated` (round 1) | **32px** | **24px** | 49.39px | 115.38px | `minimized` |
| `ask-zero` (round 1) | **32px** | — | — | — | no item (absent by design) |
| `ask-narrow-longest` (round 1) | 80px (two lines, 393px band) | 24px | 92.78px | 148.39px | `minimized` |
| `ask-neighbours` | 58px (two lines) | 24px | 75.39px | 133.47px | `minimized` |
| `ask-neighbours-narrow` (round 1) | 80px (two lines) | 24px | 92.78px | 133.47px | `minimized` |
| `ask-expanded-waiting` (round 1) | **32px** | **24px** | 266.77px | 133.47px | `expanded` |
| `ask-driven` (round 1) | **32px** | **24px** | 266.77px | 133.47px | `expanded` |

**The row height does not change between states: measured 32px in all four**
(`waiting`, `settled`, `moved-on`, `multiple`) **and in the four states round 1
added** (`mixed`, `truncated`, `zero` — where the row is 32px with no item in it —
and both expanded cases), and the item is 24px with its top edge at 49.39px in
every one of the single-chip states. Only the WIDTH moves, and only by the
clause's own length. In `neighbours` the item's top edge (75.39px) is exactly the
row's other count chips' (75.39px) and its height (24px) is exactly theirs (24px),
which is what "peer of the existing chips" means as a number rather than as an
impression. The expanded cases put the item at 266.77px because the panel is above
it in the band — the item's own height is the same 24px, which is the claim the
row is being measured for.

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

## Round 1: what the set gained, and what the frames now carry

Three of round 1's fixes changed what these frames MEAN, so the set was grown as
well as re-shot. Each claim below is carried by the frame it names, and where a
frame cannot carry it, by the test that can — saying which is which is the point.

- **The item renders only where the host wires the door** (agent review round 1,
  F1, major). A host that mounts this row without the ask lane — the mini
  quick-send window, the agent-config composer — now draws no item at all, because
  the item is a toggle and the panel it opens exists in exactly one host. NO FRAME
  can photograph that: the absence is a property of the HOST, and every story here
  renders a host that wires the lane. It is pinned instead by
  `scripts/composer-tabs.test.mjs` — *the ask item renders only where the host
  wires the door* — which renders the row with and without `onAskToggle` and
  asserts the chips beside it are unaffected. `zero-ask` is the other absence, the
  wire-side one, and it IS a frame: a published queue with no rows draws no item,
  and `dom_audit` has no `[data-status-asks]` target to report on it.
- **A press carries focus into the panel** (UX round 1, U1, major). The panel sits
  above the row in the DOM, so forward Tab from the chip used to leave the lane.
  `driven-open` is the frame for the press itself — the band starts collapsed and
  the chip clicks itself, so the panel in that picture was opened by the item
  rather than pinned open for the shot — and the full cycle (press → focus lands
  inside the panel → Escape → focus returns to the item) is driven in
  `scripts/composer-tabs.test.mjs` against the real `AskSurfaces` with a real chip
  in the document, because a still cannot show where the keyboard went next.
- **`data-lo-ask-surfaces` marks the PANEL, and only the panel** (UX round 1, U3;
  agent review round 1, F5). The chip used to carry it too, so the natural "is the
  panel open?" probe answered yes over a closed panel. The chip keeps
  `data-lo-ask-item-toggle`, `pressIsOurs` accepts it as the lane's trigger, and
  the panel root renders nothing while collapsed — so the marker is trustworthy,
  which is why `driven-open`'s own shutter could wait on it.

The two registers, the copy contract and the four states' frames are unchanged by
round 1 beyond the re-shoot: the item's geometry, ink and clauses are the same
pixels the round-0 pair showed.

## Round 2: the landing stop's ring, and four findings that render nothing

Round 2 was a micro-remediation: four of its five findings are code or prose that
changes no pixel, and one added a frame precisely because a still is the only
instrument that could carry it.

- **The focused landing stop paints the app's ring** (agent review round 2, F9;
  UX round 2, U4). The panel root is where keyboard focus lands when a SETTLED
  queue is opened (its panel has no controls to land on), and it carried
  `outline-none`, so the one scripted focus stop the panel has painted nothing —
  `:focus-visible` matched but `outline-style: none` (UX round 2's measurement).
  The root now takes the base layer's ring (`styles/index.css`, `html
  :focus-visible`) like every chip beside it. **Measured on `focused-panel`, one
  headless Chrome, computed style of `document.activeElement`:** the element is
  `DIV[data-lo-ask-surfaces]`, `:focus-visible` **true**, `outline-style: solid`,
  `outline-width: 2px`, `outline-color: rgb(56, 201, 106)` (the `accent` role),
  `outline-offset: 2px`, `box-shadow: none` — and the panel it belongs to has
  **0** focusable controls, which is what makes the root the stop. The frame
  `after/focused-panel/` is that state, and it is **AFTER-ONLY**: the old surface
  had no scripted landing stop, so a before half would be a frame of nothing.
  The probe is `ask-panel-ring.mjs` in the capture session's scratch, not a
  committed script; the command and its full output are in the round-2
  remediation comment on the PR.
- **F6** — `ASK_PANEL_FOCUSABLE` now excludes `[aria-disabled="true"]`, the
  exclusion its doc already claimed. Nothing in the panel is inert today; the arm
  is there because this app marks inert controls with `aria-disabled` rather than
  the native attribute, so the next one would have become the landing stop.
- **F7** — `askSplitIsKnowable` is one predicate read by both the visible clause
  and the announced name, hoisted above `askChipClause`, which is now built on its
  negation instead of restating the pair.
- **F8** — the merged focus effect seeds its `wasExpanded` ref with the mount's
  own value (`useRef(expanded)`), so an already-open panel is not a transition and
  the comment above it is true as written.
- **D4** — the palette record's sweep sentence now says the median reproduces over
  the fleet's *other* 57 palettes (the brand file excluded from its own baseline),
  and names the two figures a reader rebuilding it will get instead (39.89 over
  58, 39.05 over the 59 registry definitions) plus the three palettes whose
  `accent` and `success` are the same hex, which put this palette 4th-lowest
  rather than 2nd. The claim is unchanged and deliberately conservative.
