# The asks drawer — the container, and only the container

The ask queue's panel was a column mounted on the composer's band: no chrome, no
dismiss, and **no scroll owner of its own** (`ask-panel-design-note.md` D1/D2). It
is now the right slot's FIFTH occupant — a member of the canvas family, with a 40px
chrome bar (scope line + dismiss), its own scroller, and the family's width
arithmetic — which is what makes the card fill a pane the family sizes instead of
being the widest thing on the screen (D5).

## The frames

`after/` renders the shipped components from `PendingAsk` fixtures, in the two brand
palettes, at `1280x800`:

| directory | state |
| --- | --- |
| `drawer-empty/` | a published queue with nothing in it: the empty sentence, and chrome no further than the scope line and the dismiss |
| `drawer-few/` | one open ask: the card body, its options, `Send answer` / `Decline` |
| `drawer-many-overflow/` | twelve pending asks and two settled ones — the state the D1 defect could not survive |
| `drawer-mixed/` | one open, one timed out (still answerable), one declined |
| `drawer-settled-collapsed/` | the settled section on its own terms: one line, closed |
| `drawer-settled-open/` | the same section opened: one line per settled ask, each bearing the copy contract's own status WORD (`Answered`, `Declined`) |
| `band-drawer-open/` | the composer's status-row chip pressed, with the drawer open beside it |
| `band-closed-by-x/` | **the same band after a press on the drawer's own dismiss** — the drawer is gone and the chip stands |

## Measured, off the rendered frames

One Storybook (`storybook dev -p 6035 --no-open --ci`), one private headless Chrome
launched through the repo's own `scripts/chrome-keychain.mjs`, both reaped by exact
pid. Geometry is read in the page (`getBoundingClientRect` + `scrollHeight`):

- **The page never scrolls, in any state.** `document.scrollingElement` reads
  `scroll == client` (800/800) in all sixteen frames — **including
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
- **The scope line is the chip's own clause**: `This conversation · 12 questions
  waiting` on the overflow frame, `This conversation · All asks settled` on the
  empty one — `askScopeLine` reuses `askChipCountClause`, so a drawer and the chip
  that opened it cannot describe one queue differently.

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
- **The card's own items are not this change**: truncation hierarchy,
  recommendation-vs-selection and the pending-session row indicator are separate
  follow-up changes and have no frame here.
