# The model picker's feedback, and the latency of a session-scoped change

The operator's report: *"insufficient feedback on hover, click, etc to indicate
that the model selection change has happened"*. The design audit measured it on
this same harness: the active row painted `bg-elevated` inside a dialog whose own
ground is `bg-elevated`, so **hover, the keyboard highlight and "which row will
Enter pick" were all 1.000:1 / ΔE00 0.00** — 4,810,358 of 4,813,440 pixels
identical while the pointer crossed four rows.

This directory holds the in-app before/after pairs for the eight states that
carry those findings, plus the ninth that is the pick's own outcome, plus the
four states the remediation round added (below). The all-twelve-themes set lives
in `docs/evidence/chat-model-picker/` and
`docs/evidence/chat-session-status-strip/model-switch-pending/`.

## What produced these frames

**The real built Electron app**, not Storybook and not a browser: `pnpm build`,
then the repository's own window-mode harness
(`docs/evidence/window-mode/harness/run.sh`) in headless mode at 1380x900, with
the driver the audit added (`DRIVE_SCRIPT=…/drive-model-picker.mjs`) and its
extra seed (`EXTRA_SEED=…/seed-model-picker.mjs`, which binds a model so the app
boots into chat rather than into the first-run wizard).

```sh
cd ~/workspace/repos/lo-ui-model-picker
ELECTRON_BIN=$PWD/node_modules/.bin/electron \
EXTRA_SEED=$PWD/docs/evidence/window-mode/harness/seed-model-picker.mjs \
DRIVE_SCRIPT=$PWD/docs/evidence/window-mode/harness/drive-model-picker.mjs \
SCRATCH=/tmp/modelswitch-after \
  bash docs/evidence/window-mode/harness/run.sh . pickerafter headless 1380x900
```

And the credentialed run, which is the only way to reach a switch the owner
accepts (and therefore the only way `needs-sign-in-*` exists):

```sh
ELECTRON_BIN=$PWD/node_modules/.bin/electron \
EXTRA_SEED=/tmp/qa130/seed-qa.mjs \
DRIVE_SCRIPT=$PWD/docs/evidence/window-mode/harness/drive-model-picker.mjs \
SCRATCH=/tmp/modelswitch-credentialed \
  bash docs/evidence/window-mode/harness/run.sh . pickercred headless 1380x900
```

The backend is a real `local-operator serve` on a port the script owns, with
`LOCAL_OPERATOR_CONFIG_DIR` / `LOCAL_OPERATOR_HOME` under `/tmp`, so no request
can reach the operator's own store. The app was frontmost in 0 of 66 samples and
the run reported 0 renderer errors.

**The `before-*` halves are the audit's own frames**, captured on the base tree
(`78e694777`, the tree the audit's frames were taken on — after the branch merged
main its own merge-base moved to `4ed8e0852`, an ancestor, and main changed no
`src/` and not `scripts/contrast-contract.mjs` between the two) with the same
seed, the same driver, the same viewport and the same route — so the pair differs
by the change under test, not by the setup.
`before-keyboard-highlight/localOperatorDark.webp` is byte-identical to
`before-pointer-left-list/localOperatorDark.webp`, which is the defect itself
recorded in the evidence.

All twelve themes' picker and band states are captured separately and swept by
Storybook (`chat-model-picker--*`, eleven stories; and
`chat-session-status-strip--model-switch-pending`), because the row's ground is a
class the palette gate cannot see, and because the app harness only ever boots
into its default theme.

## Before / after

| State | `before-*` (`78e694777`) | `after-*` (this branch) |
| --- | --- | --- |
| `picker-open` | selected row computed `rgb(40,35,24)` = the dialog's own `rgb(40,35,24)`: **1.000:1, ΔE00 0.00** — the row that is about to be picked is invisible | selected row `rgb(15,12,8)` (`sunken`) against the dialog's `rgb(40,35,24)` (`elevated`): **ΔE00 8.32**, the adjacent-ground pair `check-themes` asserts in every theme |
| `row-hovered` | the pointer *moved the selection*, so hovering gave no separate mark | the pointer marks its own row: the `accent-wash` tint **and** a 1px `outline-control` edge, while the selection stays put. The edge is the mark that survives every palette — the wash alone is ΔE00 0.77 on this ground in obsidian (design D12) |
| `keyboard-highlight` | selection on row 8, ground `rgb(40,35,24)` — a highlight the user cannot see | selection on row 4, ground `rgb(15,12,8)` — visible, and the footer names it (`Enter picks …`) |
| `pointer-left-list` | **byte-identical to `keyboard-highlight`**: AE 0 of 4,813,440 px, same md5 — the highlight never cleared | the pointer's tint clears and the selection stays. **The demonstrating pair is `row-hovered` → `pointer-left-list`**: design D18 caught this row claiming `keyboard-highlight` → `pointer-left-list` demonstrates it, when the arrow keys had already landed the selection on the row the pointer was over — `isHovered && !isActive` suppresses the tint there, so frame 04 has no tint to clear and the 04→05 difference is text antialiasing plus a fading scrollbar. Measured after the re-capture: 03→05 removes the tint pixels inside the hovered row's band; 04→05 does not. |
| `persist-checked` | the label is `Also make it the default for new sessions`, **identical to unchecked** — nothing says what the tick did to *this* pick | `This pick also sets the default for new sessions` |
| `refresh-clicked-immediate` | the button still reads `Refresh from providers` (disabled) and the listing is **gone** — the listbox is not in the DOM | the button reads `Refreshing…`, and the 1005 rows it already had are still painted (`keepPreviousData`) |
| `refresh-settled` | still **no rows**, the body reading `Listing unavailable for:` followed by 21 provider names, while the footer went on advertising the arrow keys; the description reads `This session runs /.` | rows present (1505 after the live re-list), the same provider names reduced to a count above the list (the ids are in the note's tooltip), and a description that names the session's model |
| `pick-in-flight` | footer `Working`, right-hand button **`Cancel`** (the wrong action: closing does not cancel the switch), picked row unmarked, its ground the dialog's | picked row marked with a structural edge and a spinner in its meta slot, footer `Switching the model…` (the change, not the machinery), button **`Close`** |
| `after-close` | transcript unchanged: a refused pick left nothing behind | the composer's own outcome path carries the refusal, so the user learns after the dialog is gone |

The number in the `refresh-*` row that matters is the transition, not the total:
the two runs' catalogues came from the live backend registry (1450 rows before,
1005 then 1505 after), so the absolute counts are not comparable — what is
comparable is 0 rows after the click versus the rows it already had.

### The four states this remediation added

These have **no `before-*` half**, and the reason is the finding rather than an
omission: each is a state the old code could not produce or could not report, so
there is no frame of it on the base tree to pair with.

| State | What it shows |
| --- | --- |
| `footer-names-the-pick` | UX U1. The list is scrolled 1500px away from the keyboard's row and the pointer rests on a different one, so the only thing that says which model Enter will switch to is the footer: `Arrows move · Enter picks <the keyboard's row> · Esc closes`, beside the row mark that now moves WITH a click. Measured in the run's `picker-metrics.json` (`activeInList`, `footerText`, `hoveredLabel`). |
| `closed-while-in-flight` | UX U2. Escape 80ms after the click: the dialog is gone and the band carries the paint at `ink-dim` with its spinner — the band is the only surface left saying a switch is in flight. |
| `refusal-after-close` | UX U2 again, at the moment it matters: the refusal lands with nothing on screen, and the transcript now carries `The model was not changed. /model did not run: …` — written when the answer arrived rather than on the close edge, which is why this case used to leave nothing behind. |
| `needs-sign-in-*` | QA Q1, three frames: the row the dialog labels `no credential`, the settled strip (`The model was changed (this session)` **plus** the renderer's own caveat and a `warning` tone), and the note that same fact leaves in the transcript. This is the one state here captured under a **credentialed** seed, because the distinction only exists once the owner accepts the switch — see below. |

`needs-sign-in-*` was captured in a second run of the same harness with QA's
credentialed seed (`/tmp/qa130/seed-qa.mjs`, which writes a synthetic provider
credential through the backend's own `AuthStore`): without a credential the owner
refuses every switch, so the "switched but cannot run yet" state does not exist.
The nine paired states above keep the branch's own seed, so their before/after
comparison is unchanged.

## What these frames do not prove

- **No successful switch.** The sandbox has no provider credentials, so the
  owner never resolves a switch: the result strip's success state, its `Done`
  label and the in-force checkmark on the newly chosen row were NOT reached —
  before or after. The refusal path is reached, which is why `after-close` is
  here; the success path is covered by the Storybook `result` story and by the
  component tests, and by nothing in the live app.
- **One theme** (`localOperatorDark`, the app's own default). The other eleven
  are the Storybook set.
- **Still frames.** Paint timing, the profiler numbers behind the row
  memoization and the 1.1-4.2 s cold bind are asserted in the PR's own
  measurements and in `scripts/picker-feedback.test.mjs`, not read off these
  images.
- **The band's optimistic paint** is not visible in the in-app frames: the dialog
  covers the composer while a pick is in flight, so the band is evidenced by
  `chat-session-status-strip--model-switch-pending` (all twelve themes) and by the
  handle's reconciliation test.
- **No screen-reader announcement** was verified. The pending band now carries a
  labelled spinner (`Switching the model`) and the footer names the row Enter
  would pick, which ARE the accessibility-tree changes this round made — but
  whether a screen reader announces them on change was not measured here.
- Two findings are deliberately not fixed here and are recorded in the PR: the
  dark-palette `success-border` on the dialog's ground (`D10`, a palette/contract
  change, deferred — **six** dark palettes, 2.64 obsidian worst to 2.96 dracula,
  and no ground role is within 3:1 of `elevated`, so only the token can clear
  it), and the row's `data-current` attribute is kept as an unstyled a11y/test
  hook (`D11`).

## Known gaps in the change itself

The selection ground is `bg-sunken` rather than the sibling composer popup's
`bg-accent-wash` — which is the token the audit first proposed — because
`accent-wash` collapses onto `elevated` in obsidian (ΔE00 0.77), is ΔE00 3.74 in
tokyoNight, 3.99 in dracula and 4.88 in dune: it would reproduce the original
defect in those four themes. `sunken` clears ΔE00 5.85-16.70 against `elevated`
in all twelve, which is why the theme gate's adjacent-ground pair now pins it and
`contrast-contract.mjs` pins the class at the call site.

The same measurement is why the POINTER's mark and the in-flight mark are not
wash-only: `accent-wash` is the pointer's tint where it reads, and the 1px
`outline-control` edge on top of it is what carries the perceptibility floor in
all twelve themes (design D12). The wash stays because it is the same gesture the
composer popup teaches; the edge is what stops the gesture disappearing on
themes where the tint does not exist. The composer popup's own active row still
uses `accent-wash` alone; that is pre-existing and out of scope, and it is the
same latent defect in obsidian.
