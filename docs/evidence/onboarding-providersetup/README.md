# Connecting a provider: the onboarding step, wider, searchable, Radient first

The owner's brief was four things about onboarding step 1, the screen a brand-new
user has to get through before the product does anything at all: make the dialog
wider so more of the grid is visible, add a search function, highlight Radient as
the first login option because it is the easiest way to start, and improve the
visuals of that section.

## What changed

1. **A per-step panel measure.** `OnboardingDialog` took one hardcoded
   `max-w-140` (560px) for all six steps, justified in a comment about the
   two-field forms. The provider step is not a form — it is a grid of registry
   rows — so the measure is now a named table (`ONBOARDING_PANEL_WIDTHS`) with
   two shapes: `form` (560px, unchanged, still the default) and `grid` (960px),
   which `onboarding-modal.tsx` selects per step. 960 rather than the 928 that
   also looks plausible, because the arithmetic that decides it is the
   scrollbar: 960 − 48px of body padding = 912px of grid, which is 3 × 280px
   cards and two 12px gaps (864) with 48px to spare, and 897px even after a
   classic scrollbar takes 15px — where 928 leaves 1px and a platform with
   space-taking scrollbars would silently drop back to two columns.
2. **Search always available.** The field was gated behind `rows.length > 6`.
   The census is 18 rows and only grows, so that condition is unreachable in the
   shipped app while its failure mode (a short registry hiding the only control
   a reader scanning it wants) is not. The gate is gone; the empty state and its
   "Clear search" stay; matching still covers name, id and `search_aliases`. No
   shortcut key was added — see "Decisions" below.
3. **Radient promoted.** `radient` is pinned to the front of the **unfiltered**
   list, with a "Recommended" cue and one reason line, and everything else keeps
   registry order. The registry has two Radient entries and the census FOLDS
   them: `radient-key` declares `store_credentials_as="radient"`, so
   `providers.list` reports one row whose methods are the browser sign-in and
   then the Pass key. There is no second card to promote, and the promoted row's
   own primary method is the sign-in the cue is about — which is also why the
   reason line says "one browser sign-in, nothing to paste" rather than that no
   key exists.
4. **The card set.** Cards take the frame radius (14px) instead of the control
   radius, `h-full` so a row's cards are one height even though the promoted card
   carries an extra line, and the column count now follows the CONTAINER
   (`repeat(auto-fill, minmax(min(17.5rem,100%),1fr))`, the rule the agent-hub
   card grid already uses) instead of the window — which is what lets the same
   component be 3 columns in a 960px dialog and 3 in Settings' 896px column.

## What produced these frames

`scripts/capture-evidence.mjs` (private headless Chrome over CDP) against the
stories in `src/renderer/src/features/onboarding/components/provider-setup.stories.tsx`,
which did not exist before this branch — no story rendered `ProviderGrid`, and
the frames committed under `onboarding-onboardingmodal/default` were taken
before the registry grid existed at all (they paint the "Choose your setup"
two-gate screen #87 replaced), so the screen this step shows had no picture of
itself.

The stories drive the production component through its production data path: the
`providers.list` desktop op over `window.api.desktop.request`, stubbed the way
`mcp-management-section.stories.tsx` stubs it, so the real query, the real hook,
the real search and the real card composition all run. The rows are a
first-run machine's census, transcribed by replaying the census rule in
`server/routes/auth.py::providers` over `providers/registry.py` — the ORDER is
the registry's own (Radient is 15th of 18) and the method labels are the
registry's own names. The story file carries the derivation.

`--allow-backend` was passed because the operator's own backend answers on
`:1111` on this machine. It cannot reach a frame: the transport is stubbed
in-page, and the browser console shows no request to that port.

**Two themes, not twelve.** `--themes=localOperatorDark,localOperatorLight` — the
two palettes the brand owns. The other ten are covered by `pnpm check-themes`,
which asserts every role triple this change uses (`ink` on `surface`,
`ink-muted` on `surface`, `border-control` on the grounds) across all twelve.

### The before half

`provider-setup-ux-before/` is the same rig, same stories, same themes, run on a
tree whose `src/` is byte-identical to `origin/main` `847f750d7` for every
component the frames photograph: the story file is additive, and the two `data-`
hooks it needs (on the grid and on each row) paint nothing. Reproduced by
stashing the three implementation files and running the same command:

```sh
git stash push -- src/renderer/src/features/providers/provider-grid.tsx \
  src/renderer/src/features/onboarding/components/onboarding-dialog.tsx \
  src/renderer/src/features/onboarding/components/onboarding-modal.tsx
node scripts/capture-evidence.mjs http://localhost:6017 --allow-backend \
  --only=onboarding-providersetup --themes=localOperatorDark,localOperatorLight \
  --dirs=settings-column,short-registry,search-active,search-no-results,narrow-column,in-dialog
# Only the six directories that pass names: the two `dir` entries below are states
# the pre-change tree cannot produce (a promoted card to hover and to Tab to), and
# copying the surface wholesale would carry their AFTER frames into the before half.
for d in settings-column short-registry search-active search-no-results narrow-column 'in-dialog@1280' 'in-dialog@800'; do
  mkdir -p "docs/evidence/provider-setup-ux-before/$d"
  cp docs/evidence/onboarding-providersetup/"$d"/*.webp "docs/evidence/provider-setup-ux-before/$d/"
done
git stash pop
```

The after half is the same command with `provider-grid.tsx`,
`onboarding-dialog.tsx` and `onboarding-modal.tsx` restored, plus the two
entries that only the changed tree can produce (`card-hovered`, `card-focused`
— a real pointer and real Tab presses, because those states are browser state a
story cannot set).

## The geometry, read off the captions in the frames

Every frame carries a measurement strip along its foot: each probe prints its
box, its horizontal and vertical overflow in px **only when there is one**, and
for a grid the columns the browser resolved and a card's measured width.

| State | Before | After |
| --- | --- | --- |
| Settings column, 896px (`max-w-4xl`), 18 rows | 2 cols, card 442, grid 896×1072.2 | **3 cols**, card 290.7, grid 896×736.2 |
| Step 1 in the dialog, 1280×900 window | dialog 560×836, body 558×706, grid 510×1072.2, 2 cols, card 249 | **dialog 960×836**, body 958×706, grid 910×736.2, **3 cols**, card 295.3 |
| Step 1 in the dialog, 800×900 window (the app's floor) | dialog 560 (its own cap), grid 510, 2 cols, card 249 | dialog 800, body 798×706 (v529), grid 750×1097.6, **2 cols**, card 369 |
| Registry shorter than the old threshold (5 rows), 896 | **no search field at all**, grid 896×349.4, 2 cols, card 442 | field present, grid 896×228.9, **3 cols**, card 290.7 |
| Container 512 (below every width the app can produce) | — | **1 col**, card 512 |
| Query `cloud` | 2 matches, 2 cols | 2 matches in registry order, no cue (the pin is off while a query is active) |
| Query `zzz` | empty state + Clear search | unchanged |

No frame in either half overflows horizontally: `h` appears in no caption, and
the widest card is 512px inside a 512px container at the 1-column floor.

## Decisions, where the brief left a choice

- **The cue is words, not a colour.** "Recommended" is `font-medium text-meta`
  at `ink`, matching `ask-options.tsx`'s reviewed marker: the accent is already
  spent on this screen's primary action and its progress track, and § 2's budget
  is three spends per screen. So no component gained a fill or a border, and
  `CONTROLS` in `scripts/contrast-contract.mjs` did not gain a row — there is no
  new component triple to assert.
- **The pin applies to the unfiltered list only.** A query is the reader telling
  the screen what they are looking for; reordering matches under that
  instruction would fight it, so a filtered list is pure registry order and
  carries no cue either (the cue and the position are one statement).
- **No keyboard shortcut was added.** The field is the first tab stop in the
  grid, always present. `/` — the obvious candidate — is the composer's slash
  vocabulary app-wide, and the dialog deliberately focuses its own body on open
  so the arrow keys scroll it; a second meaning for one key would fight both.
- **No clear control inside the field.** The empty state's "Clear search" is the
  one this grid has always had, and the sibling surface it was modelled on
  (`mcp-management-section.tsx`) has exactly the same one. Adding a second would
  be two idioms for one job.

## What these frames do not prove

- **Not the packaged app, and no real backend.** They are the renderer, with the
  desktop transport stubbed. That the shipped backend serves this census, and
  that a real sign-in completes, is QA's job against a real app.
- **Not the other ten themes** (see above).
- **Not the classic-scrollbar case.** The rig hides scrollbars; on macOS the
  body's scrollbar is an overlay and takes no width, so `body 958` is the widest
  the grid can be. The 960px dialog is sized so that a 15px scrollbar still
  leaves three columns — arithmetic, not a frame.
- **Not a hover state under a keyboard.** `card-hovered` is a real pointer move
  over the promoted card (the ground step), `card-focused` is real Tab presses
  landing on it (the ring). Neither is a mouse click.
