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
tree whose `src/` carries none of this change's LAYOUT: the three implementation
files (`features/providers/provider-grid.tsx`,
`features/onboarding/components/onboarding-dialog.tsx`,
`features/onboarding/components/onboarding-modal.tsx`) are taken from commit
`21bee8af6` — the commit that added the story file and the two inert `data-` hooks
it measures through — while the story file stays the branch's own.

**That is the method, stated as it was run, because an earlier version of this
section described a reproduction that cannot produce these frames (code round 1,
R1-1).** Stashing the three files reverts them to that commit's content, not to
`origin/main`, so "byte-identical to `origin/main` for every component the frames
photograph" was wrong about the hooks: both hooks are ADDED by that commit, and
the strip prints `absent` over a picture of the grid when it cannot find them, so
a tree without them cannot print the numbers these frames carry. What is true,
and what the method is:

```sh
for f in src/renderer/src/features/providers/provider-grid.tsx \
         src/renderer/src/features/onboarding/components/onboarding-dialog.tsx \
         src/renderer/src/features/onboarding/components/onboarding-modal.tsx; do
  git show "21bee8af6:$f" > "$f"
done
node scripts/capture-evidence.mjs http://localhost:6017 --allow-backend \
  --only=onboarding-providersetup --themes=localOperatorDark,localOperatorLight \
  --dirs=settings-column,signed-in,short-registry,search-active,search-recommended,search-no-results,narrow-column,in-dialog
node scripts/capture-evidence.mjs http://localhost:6017 --allow-backend \
  --only=onboarding-providersetup --themes=localOperatorDark,localOperatorLight \
  --dirs=in-dialog-scrolled
# `--dirs` matches a state's own DIRECTORY, and a state that names its own (`dir`)
# is not reached by the story leaf, so the scrolled entry needs its own run.
for d in settings-column signed-in short-registry search-active search-recommended \
         search-no-results narrow-column 'in-dialog@1280' 'in-dialog@800' in-dialog-scrolled; do
  rm -rf "docs/evidence/provider-setup-ux-before/$d"
  mkdir -p "docs/evidence/provider-setup-ux-before/$d"
  cp docs/evidence/onboarding-providersetup/"$d"/*.webp "docs/evidence/provider-setup-ux-before/$d/"
done
git checkout HEAD -- src/renderer/src/features/providers/provider-grid.tsx \
  src/renderer/src/features/onboarding/components/onboarding-dialog.tsx \
  src/renderer/src/features/onboarding/components/onboarding-modal.tsx
```

The before pass runs FIRST, into `onboarding-providersetup/`, and is copied out
before the after pass overwrites that directory — the capturer writes one
feature directory per story and cannot be pointed at two. `card-hovered` and
`card-focused` are deliberately absent from it: they are states the pre-change
tree cannot produce (there is no promoted card in row 1 to hover or to Tab to),
and copying the surface wholesale would carry their AFTER frames into the before
half.

## The geometry, read off the captions in the frames

Every frame carries a measurement strip along its foot: each probe prints its
box, its horizontal and vertical overflow in px **only when there is one**, and
for a grid the columns the browser resolved and a card's measured width.

| State | Before | After |
| --- | --- | --- |
| Settings column, 896px (`max-w-4xl`), 18 rows | 2 cols, card 442, grid 896×1072.2 | **3 cols**, card 290.7, grid 896×732.2 |
| Settings column, recommended provider **signed in** | 2 cols, card 442, grid 896×1072.2 | **3 cols**, card 290.7, grid 896×710.8, Radient 15th of 18, no cue, no reason line |
| Step 1 in the dialog, 1280×900 window | dialog 560×836, body 558×706, grid 510×1072.2, 2 cols, card 249 | **dialog 960×836**, body 958×706, grid 910×732.2, **3 cols**, card 295.3 |
| Step 1 in the dialog, 800×600 window (the app's declared floor on both axes) | dialog 560×536, body 558×406 (v826), grid 510×1072.2, 2 cols, card 249 | **dialog 736×536**, body 734×406 (v825), grid 686×1093.6, **2 cols**, card 337 |
| The same dialog, body scrolled to the end | — | body parked at its last row; 10% of the frame's channel bytes differ from the unscrolled state |
| Registry shorter than the old threshold (5 rows), 896 | **no search field at all**, grid 896×349.4, 2 cols, card 442 | field present, grid 896×228.9, **3 cols**, card 290.7 |
| Container 512 (below every width the app can produce) | — | **1 col**, card 512 |
| Query `cloud` | 2 matches, 2 cols | 2 matches in registry order (no pin while a query is active), no cue — the row is not in the list |
| Query `rad` | 1 match, 2 cols, no cue | 1 match, **cue present** (it travels with the provider) |
| Query `zzz` | empty state + Clear search | unchanged (pixel-identical, measured in round 1) |

Two notes on the numbers. The 800px row used to be an 800×900 window, which is
the width floor but not the height floor; it is now the declared minimum on both
axes (`WINDOW_MIN_WIDTH` / `WINDOW_MIN_HEIGHT`, `src/main/window-mode.ts:109`),
which is the state design round 1's D4 found unphotographed and the one where the
viewport clamp and the height cap both bite. And the panel there is **736**
because of that clamp: 800 − 4rem of viewport inset, with 32px of gutter each
side — the arithmetic from `ONBOARDING_PANEL_WIDTHS`' own comment, reproduced by
the frame.

No frame in either half overflows horizontally: `h` appears in no caption, and
the widest card is 512px inside a 512px container at the 1-column floor. The
strip's `(v…)` probe reads the DOCUMENT's scroll, which does not move between the
plain and scrolled states; the two frames differ in the dialog body, which is why
the scrolled state is a separate capture rather than a caption.

## Decisions, where the brief left a choice

- **The cue is words, not a colour.** "Recommended" is `font-medium text-meta`
  at `ink`, matching `ask-options.tsx`'s reviewed marker: the accent is already
  spent on this screen's primary action and its progress track, and § 2's budget
  is three spends per screen. So no component gained a fill or a border, and
  `CONTROLS` in `scripts/contrast-contract.mjs` did not gain a row — there is no
  new component triple to assert.
- **The pin applies to the unfiltered list only; the CUE travels with the
  provider.** A query is the reader telling the screen what they are looking for;
  reordering matches under that instruction would fight it, so a filtered list is
  pure registry order. The cue is a different statement — being the app's
  suggestion is a fact about the provider rather than about its position — so a
  filtered list keeps it, and `search-recommended/` is the frame of that (`rad`
  narrows to one row, and the cue is on it). UX round 1 measured what gating both
  together cost: `rad` left the recommendation invisible to the reader hunting for
  it.
- **First-run advice stops at the credential.** Neither the pin nor the cue applies
  once the recommended provider is already signed in — on either surface that
  renders this grid. "Recommended" over a credential the reader holds, above a
  sentence promising a sign-in they have already done, argues for a decision they
  have made, and the Settings section is where that state is reachable
  (`signed-in/`: Radient 15th of 18, `Signed in` badge, no cue, no reason line).
  The test is `providerReadiness`'s own answer, so the cue stops exactly where the
  badge changes its mind.
- **The panel is clamped against the viewport on both axes.** Design round 1's D1:
  `DialogContent` is `w-full` and this frame clamped only its height, so a measure
  wider than the window painted the panel's own border on column 0 — at the 800px
  floor the panel stood closer to the window's edge (0) than its content stood to
  the panel's (24). Both measures are now
  `max-w-[min(<measure>,calc(100vw-4rem))]`, the height clamp's mirror.
- **The reason line is `ink-dim` and sits above the method line.** It used to be
  the card's last line at `ink-muted`, which made it the second-loudest stop and
  put the justification below the fact it argues for (design round 1 D3, UX round
  1 U7). State, then why, then how.
- **The cue is separated from the name by the app's own `·`.** Same ink, same
  baseline, a size step apart: without a separator the first line reads as one
  string, "Radient Recommended" (design round 1 D5).
- **Focus is handed back, not left to the dialog.** Opening a provider and coming
  back used to park focus on the dialog container — 7-8 Tab presses to recover
  (UX round 1 U1); `Clear search` failed the same way (U4). The grid names the
  target: the card `selectedId` names on the way out, the field on a clear.
- **The promoted row's height is a named trade.** The reason line makes its row
  134px against 105-107px elsewhere, and its two neighbours carry the difference
  as empty space (design round 1 D2). One taller card and two level neighbours
  beats a ragged first row, and the comment on `h-full` says so.
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

## Remediation round 1 (design, UX and code findings)

Both halves were **re-captured** after the fixes below — a visual fix invalidates
the frame, so the before half was re-taken from the same commit-`21bee8af6` tree
as its method describes, and the after half re-taken whole. Four states are new
in both halves, and every other frame in both was overwritten:

| Finding | Fix, and the frame that shows it |
| --- | --- |
| Design D1 (major) — panel full-bleed below its measure | both measures clamp against `100vw - 4rem`; `in-dialog@800` (now the 800×600 floor) measures a 736px panel with 32px gutters where the un-fixed head 799 of an 800px frame |
| Design D2 — the promoted row is 27px taller | trade named in the card comment (`h-full`); the frames show the row heights |
| Design D3 / UX U7 — the reason line outranked and trailed the method line | reason moved above the method line, `ink-dim`; `in-dialog@1280`, `settings-column` |
| Design D4 (evidence) — no frame at the height floor or scrolled | new `in-dialog@800` at 800×600 and new `in-dialog-scrolled` |
| Design D5 — the cue reads as one string with the name | `·` between name and cue; `in-dialog@1280` |
| Design D6 — the panel is wider than three columns need | answered in the measure's own comment: the 31px past 864px is the classic-scrollbar allowance, and 928 leaves 1px |
| UX U1 (major) / U4 — focus lost on `Back to providers` and `Clear search` | the grid hands focus back to the card `selectedId` names, or to the field on a clear |
| UX U2 — the cue vanished under a query | the cue travels with the provider; new `search-recommended` (`rad`) |
| UX U3 / code R1-6 — the promotion showed over an existing credential | new `signed-in` state, Settings column, with a real `Signed in` badge |
| Code R1-1 — the before half's stated reproduction could not produce it | the method above is the one that was run; the manifest's `source` says the same |
| Code R1-2 — no guard for the new rules | `scripts/provider-grid-pin.test.mjs`, registered in `test:desktop` |
| Code R1-4 / R1-5 — arithmetic and radius nits | the measure's comment counts the panel's 2px of border, and the old radius is named as `rounded-md` (10px) |

**Deferred, with the reason.** UX U5 (a roving tabindex over the card grid would
cut the 20 Tab presses to the exit): not this change's defect, and it would
replace the arrow-key scrolling contract the dialog deliberately sets on its own
body with an arrow-key grid protocol the app has nowhere else. UX U6 (the panel
re-centres between list, detail and empty state): a nit about motion; a
`min-h` on one step is a design decision with its own cost, so it is recorded
rather than taken.
