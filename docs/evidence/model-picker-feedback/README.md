# The model picker's feedback, and the latency of a session-scoped change

The operator's report: *"insufficient feedback on hover, click, etc to indicate
that the model selection change has happened"*. The design audit measured it on
this same harness: the active row painted `bg-elevated` inside a dialog whose own
ground is `bg-elevated`, so **hover, the keyboard highlight and "which row will
Enter pick" were all 1.000:1 / ΔE00 0.00** — 4,810,358 of 4,813,440 pixels
identical while the pointer crossed four rows.

This directory holds the in-app before/after pairs for the eight states that
carry those findings, plus the ninth that is the pick's own outcome. The
all-twelve-themes set lives in `docs/evidence/chat-model-picker/` and
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

The backend is a real `local-operator serve` on a port the script owns, with
`LOCAL_OPERATOR_CONFIG_DIR` / `LOCAL_OPERATOR_HOME` under `/tmp`, so no request
can reach the operator's own store. The app was frontmost in 0 of 66 samples and
the run reported 0 renderer errors.

**The `before-*` halves are the audit's own frames**, captured on the base tree
(`78e694777`, this branch's merge-base) with the same seed, the same driver, the
same viewport and the same route — so the pair differs by the change under test,
not by the setup. `before-keyboard-highlight/localOperatorDark.webp` is
byte-identical to `before-pointer-left-list/localOperatorDark.webp`, which is the
defect itself recorded in the evidence.

All twelve themes' picker and band states are captured separately and swept by
Storybook (`chat-model-picker--*`, eleven stories; and
`chat-session-status-strip--model-switch-pending`), because the row's ground is a
class the palette gate cannot see, and because the app harness only ever boots
into its default theme.

## Before / after

| State | `before-*` (`78e694777`) | `after-*` (this branch) |
| --- | --- | --- |
| `picker-open` | selected row computed `rgb(40,35,24)` = the dialog's own `rgb(40,35,24)`: **1.000:1, ΔE00 0.00** — the row that is about to be picked is invisible | selected row `rgb(15,12,8)` (`sunken`) against the dialog's `rgb(40,35,24)` (`elevated`): **ΔE00 8.32**, the adjacent-ground pair `check-themes` asserts in every theme |
| `row-hovered` | the pointer *moved the selection*, so hovering gave no separate mark | the pointer marks its own row (`accent-wash`) and the selection does not move |
| `keyboard-highlight` | selection on row 8, ground `rgb(40,35,24)` — a highlight the user cannot see | selection on row 4, ground `rgb(15,12,8)` — visible |
| `pointer-left-list` | **byte-identical to `keyboard-highlight`**: AE 0 of 4,813,440 px, same md5 — the highlight never cleared | differs from `keyboard-highlight` by 32,347 px (0.67%): the pointer's tint clears and the selection stays |
| `persist-checked` | the label is `Also make it the default for new sessions`, **identical to unchecked** — nothing says what the tick did to *this* pick | `This pick also sets the default for new sessions` |
| `refresh-clicked-immediate` | the button still reads `Refresh from providers` (disabled) and the listing is **gone** — the listbox is not in the DOM | the button reads `Refreshing…`, and the 1005 rows it already had are still painted (`keepPreviousData`) |
| `refresh-settled` | still **no rows**, the body reading `Listing unavailable for:` followed by 21 provider names, while the footer went on advertising the arrow keys; the description reads `This session runs /.` | rows present (1505 after the live re-list), the same 21 provider names now a note *above* the list, and a description that names the session's model |
| `pick-in-flight` | footer `Working`, right-hand button **`Cancel`** (the wrong action: closing does not cancel the switch), picked row unmarked, its ground the dialog's | picked row marked with a spinner in its meta slot, footer `Waiting for the backend…`, button **`Close`** |
| `after-close` | transcript unchanged: a refused pick left nothing behind | the composer's own outcome path carries the refusal, so the user learns after the dialog is gone |

The number in the `refresh-*` row that matters is the transition, not the total:
the two runs' catalogues came from the live backend registry (1450 rows before,
1005 then 1505 after), so the absolute counts are not comparable — what is
comparable is 0 rows after the click versus the rows it already had.

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
- **No screen-reader announcement** was verified.
- Two findings are deliberately not fixed here and are recorded in the PR:
  the dark-palette `success-border` on the dialog's ground measures 2.91:1
  (`D10`, a palette/contract change, deferred), and the row's `data-current`
  attribute is kept as an unstyled a11y/test hook (`D11`).

## Known gaps in the change itself

The selection ground is `bg-sunken` rather than the sibling composer popup's
`bg-accent-wash` — which is the token the audit first proposed — because
`accent-wash` collapses onto `elevated` in obsidian (ΔE00 0.77), is ΔE00 3.99 in
dracula and under 4 in dune and tokyoNight: it would reproduce the original
defect in those four themes. `sunken` clears ΔE00 5.85-16.70 against `elevated`
in all twelve, which is why the theme gate's adjacent-ground pair now pins it and
`contrast-contract.mjs` pins the class at the call site. The composer popup's own
active row still uses `accent-wash`; that is pre-existing and out of scope, and
it is the same latent defect in obsidian.
