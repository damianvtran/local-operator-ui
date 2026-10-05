# The asks drawer — the container, and only the container

The ask queue's panel was a column mounted on the composer's band: no chrome, no
dismiss, and **no scroll owner of its own** (`ask-panel-design-note.md` D1/D2). It
is now the right slot's FIFTH occupant — a member of the canvas family, with a 40px
chrome bar (scope line + dismiss), its own scroller, and the family's width
arithmetic — which is what makes the card fill a pane the family sizes instead of
being the widest thing on the screen (D5).

## The frames

`after/` renders the shipped components from `PendingAsk` fixtures, in the two brand
palettes, at `1280x800` — every frame, including the `band-askmode-*` pair, which was
re-shot from its own committed story after design round 2's D6 (see that row):

| directory | state |
| --- | --- |
| `drawer-empty/` | a published queue with nothing in it: the empty sentence, and chrome no further than the scope line and the dismiss |
| `drawer-few/` | one open ask: the card body, its options, `Send answer` / `Decline` |
| `drawer-mixed/` | the queue at its honest worst: one open, one that TIMED OUT and is still answerable, and one `Answered late` |
| `drawer-many-overflow/` | twelve queued asks and two that timed out and are still answerable — **fourteen pending cards, and no settled section at all** — the state the D1 defect could not survive |
| `drawer-many-overflow-scrolled/` | the same list after a REAL wheel: the thumb on the drawer's own scroller, the chrome bar pinned, the page still not scrollable (D5) |
| `drawer-settled-collapsed/` | the settled section on its own terms: one line per ask, closed, with the words its rows actually carry |
| `drawer-settled-open/` | the same section opened: one line per settled ask, each bearing the copy contract's own status WORD — `Answered`, `Answered late`, `Declined` — the look-alike pair the section exists to tell apart |
| `drawer-other/` | an answer the option LIST never offered — what the composer's own door produces — drawn on the card as an explicit `Other` row rather than as an empty group beside an answered question |
| `dock-asks/` | the drawer in the REAL shell (`shell-app-shell--chat-dock-asks`), docked beside the conversation it is answering for, its bar reaching the window's top-right (D4) |
| `band-drawer-open/` | the composer's status-row chip pressed, with the drawer open beside it |
| `band-closed-by-x/` | **the same band after a press on the drawer's own dismiss** — the drawer is gone and the chip stands |
| `band-askmode-open/` | the composed §5.0 state the design round asked for: the drawer open AND the composer still in its ask mode, both live doors to one question (design round 1, D2) — re-shot at this pass from `chat-composer-status-row--ask-driven-drawer-open` |
| `band-askmode-closed/` | the control for that pair: no drawer, the composer's ordinary invitation — re-shot from `chat-composer-status-row--ask-driven-drawer-closed` |

## Measured, off the rendered frames

This pass's frames come from a scratch rig in the session that made the change, not
from `scripts/capture-evidence.mjs`: one Storybook (`storybook dev -p 6131 --no-open
--ci`) and ONE private headless Chrome launched through the repo's own
`scripts/chrome-keychain.mjs` (so it never reaches Keychain Services under a scratch
profile), driven over raw CDP at `1280x800`, one frame per state per palette, both
processes reaped by exact pid. Geometry is read in the page (`getBoundingClientRect`
+ `scrollHeight`):

- **The page never scrolls, in any state.** `document.scrollingElement` reads
  `scroll == client` (800/800) in every frame — **including
  `drawer-many-overflow`, whose list scrolls 2987px inside a 600px box**. That is
  the D1 defect fixed as a number, not an impression: the overflow belongs to the
  drawer's own scroller (`overflow-y: auto`, `min-h-0 flex-1`), and the transcript
  beside it does not move.
- **The chrome bar is 40px and full width** (560x40 at the docked cap, 400x40 in
  the narrower band story) — the family's height, and the drawer's root wears the
  lane's last stop (`bg-elevated`), which `scripts/pane-slot-ground.test.mjs`
  asserts for all five occupants.
- **The card fills the drawer's content box and nothing else**: 536px inside a
  560px drawer (24px of `px-3` inset) and 376px inside the 400px band drawer. The
  card's width is therefore a consequence of the container, not a rule of its own —
  which is what the note asks for when it refuses to patch the width separately.
- **The chip's duration is rendered ONCE**: the overflow frame's chip reads
  `1 question waiting · expires in 48m`, not the doubled form round 1's rig produced
  (see the two-launch note below) — the yield spans are a container query, and a
  frame taken outside the container shows both.
- **The scope line is the DRAWER's own count, not the chip's clause** (UX round 1, U5): `This conversation · 12 waiting, 2 moved on` on the overflow
  frame — every card the surface draws is counted, because `askDrawerCountClause`
  states both halves of a mixed queue — and `This conversation · All asks settled`
  on the empty one. On a single-state queue it falls through to
  `askChipCountClause`, so the drawer and the chip that opened it still cannot
  describe one queue differently.
- **The settled header's descriptor is read FROM the section** (M1 = UX U1 = design
  D1): `drawer-settled-open` reads `Settled · 3  Answered, Answered late, Declined`,
  `drawer-mixed` reads `Settled · 1  Answered late`. The fixed legend this replaced
  printed `answered, timed out, declined, dismissed` over every state — naming a word
  the section can never hold (`timed out` is in the backend's outstanding set, so it
  is a pending CARD with live controls) and omitting two it routinely holds.

## Two notes a reader needs: one launch difference, one re-shoot

### The scrolled pair is the one pair shot WITHOUT `--hide-scrollbars`
  The set's standing discipline is to hide the platform scrollbar (a classic one
  would move the card's content box the frames measure), and that is exactly why the
  D5 frame asks for the other launch: the app's scrollbars are overlay thumbs that
  appear on scroll, so "the overflow is the list's" is a pixel only while the thumb
  is in the picture. Every other frame keeps the flag.
### The §5.0 pair is re-shot rather than inherited, and the history is the point

Design round 2's D6. Round 1's pair came from the design round's own rig
(`review-ask-mode-composition--drawer-open-composer-ask-mode`), whose host lacked the
`@container/chatcol` ancestor the chip's two yield spans resolve against — so both
spans painted and both frames showed `1 question waiting · expires in 48m · 48m`, a
string the product does not render. The designer voided the claim as a rig artifact,
and the frames were re-taken from the committed stories
(`chat-composer-status-row--ask-driven-drawer-open` / `--ask-driven-drawer-closed`) at
the set's own `1280x800`, where the chip reads the duration once. A frame that shows
something the product does not render is the defect class this set exists to refuse,
so the frames were replaced rather than annotated.

## The absent-backend state has no frame here, deliberately

A backend that does not publish `asks` renders **nothing at all** — the capability
is field presence, and the panel, the chip and the drawer all stand down. A frame of
that state is a frame of a bare ground, and `scripts/check-evidence.mjs` refuses one
(`100.00% of the frame is one colour — this frame is a ground with nothing on it`)
for the reason its own header gives: it cannot tell a story that rendered nothing
from a story that failed to render. So the claim is carried by the two things that
can substantiate it — the fixture story (`chat-asks-queued-asks--unsupported-backend`)
and the checker's refusal — rather than by a blank picture filed under a real
state's name. This is the same treatment the base's own absent frame got.

## The before half, and why it is not re-committed here

The before half of this pair is the DESIGN NOTE's own rendered frames —
`~/workspace/ask-panel-design-1004/frames/*.png`, UI `origin/main` @ `2de4e2e9de7`
(0.32.0), by the designer who wrote the note. They are not re-committed because a
`before/` half here has to be re-derivable from a tree this branch does not contain
(the base's stories still exist at `origin/main`, so a reviewer can re-shoot them
with the same rig), and copying another run's PNGs into a WebP set under a second
provenance would be a frame whose stated source the pixels do not carry.

## What this set does NOT claim

- **No live wire.** Every frame is a fixture story; nothing here exercises the core
  half, the real tally or `asks_open` from a queue.
- **No fleet-scope frame.** The desktop has no top-level asks surface: the drawer
  takes a `scope`, renders the scope line for it, and nothing opens `fleet` yet.
- **No narrow-window frame.** The dock/overlay arithmetic is the canvas family's
  own (`resolveRightSlotWidth` + `canvasPaneMode`) and is asserted in
  `scripts/right-slot-width.test.mjs`; the frames here are one window size.
- **No OS-caption-corner frame.** The chrome bar's trailing inset
  (`[padding-inline-end:max(0.5rem,var(--chrome-inset-end))]`) is a SHELL value — the
  main process sets `--chrome-inset-end` from the platform's caption buttons — and a
  browser rig has no such value, so the frames carry the 8px floor rather than a Mac's
  traffic-light inset. The value is asserted where it is read
  (`scripts/pane-slot-ground.test.mjs`), and the reservation is the same one the
  canvas's bar makes.
- **The card's own items are not this change**: truncation hierarchy,
  recommendation-vs-selection and the pending-session row indicator are separate
  follow-up changes and have no frame here.
