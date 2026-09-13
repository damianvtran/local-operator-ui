# The model picker's feedback, and the latency of a session-scoped change

The operator's report: *"insufficient feedback on hover, click, etc to indicate
that the model selection change has happened"*. The design audit measured it on
this same harness: the active row painted `bg-elevated` inside a dialog whose own
ground is `bg-elevated`, so **hover, the keyboard highlight and "which row will
Enter pick" were all 1.000:1 / ΔE00 0.00** — 4,810,358 of 4,813,440 pixels
identical while the pointer crossed four rows.

This directory holds the in-app before/after pairs for the eight states that
carry those findings, plus the ninth that is the pick's own outcome, plus the
seven states the remediation round added (below), plus the pair the UX round's
U7 added — twenty-six frames, nine of them the audit's `before-*` halves and one
this branch's own pre-fix head. The all-twelve-themes set lives
in `docs/evidence/chat-model-picker/` and
`docs/evidence/chat-session-status-strip/model-switch-pending/`.

The two runs' own measurements are committed beside the frames:
`picker-metrics.json` (the branch's seed) and `picker-metrics-credentialed.json`
(the credentialed run whose `needs-sign-in-*` frames these are). Every number
this README quotes can be read off them, and both are produced by
`drive-model-picker.mjs`'s `MEASURE` block rather than typed.

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
accepts (and therefore the only way `needs-sign-in-*` exists). The seed below is
QA's scratch script from round 1 and is **not** in this repository, so that run is
described rather than reproducible from the tree: it writes
`values: {hosting: openai, model_name: gpt-4o-mini}` into the scratch config, one
synthetic `openai` API-key row through the backend's own `AuthStore`, and a cached
`openrouter` listing of 480 rows into the scratch `HOME` (the catalogue cache
resolves from `HOME`, not `LOCAL_OPERATOR_CONFIG_DIR` — `model/catalogue.py`'s
`default_cache_dir()`); the driver then prefixes every frame it takes with `cred-`
(`PICKER_FRAME_PREFIX=cred-`) so no frame can be mistaken for the other run's.

```sh
ELECTRON_BIN=$PWD/node_modules/.bin/electron \
EXTRA_SEED=/tmp/qa130/seed-qa.mjs \
DRIVE_SCRIPT=$PWD/docs/evidence/window-mode/harness/drive-model-picker.mjs \
SCRATCH=/tmp/modelswitch-credentialed \
  bash docs/evidence/window-mode/harness/run.sh . pickercred headless 1380x900
```

The backend is a real `local-operator serve` on a port the script owns, with
`LOCAL_OPERATOR_CONFIG_DIR` / `LOCAL_OPERATOR_HOME` **and `HOME`** under `/tmp`,
so no request can reach the operator's own store and no cache write can land in
`~/.local-operator`. The `HOME` override is QA round 2's Q3: the catalogue cache
resolves from `HOME` (`local_operator/model/catalogue.py` `default_cache_dir()`
→ `~/.local-operator/cache`) rather than from the config dir, so the runs that
produced the frames below READ the operator's real cache and a bare
`bash run.sh` would have WRITTEN a run's synthetic listing into it. The app was
frontmost in 0 of 66 samples and the run reported 0 renderer errors — 0 of 120
in the U7 re-capture, which is the first run whose cache lives in the scratch
root: it seeds that cache with a copy of the same listing files the earlier run
read, so its frames still differ by the change rather than by their catalogue,
and nothing outside `/tmp` is written.

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
| `pointer-left-list` | **byte-identical to `keyboard-highlight`**: AE 0 of 4,813,440 px, same md5 — the highlight never cleared | the pointer's tint AND edge clear and the selection stays. **The demonstrating pair is `row-hovered` → `pointer-left-list`**: design D18 caught this row claiming `keyboard-highlight` → `pointer-left-list`, and the re-capture measures why that pair cannot demonstrate it — the arrow keys had already landed the selection on the row the pointer was over, `isHovered && !isActive` suppresses the mark there, so **04→05 is AE 0 of 4,813,440 px again** (md5-equal). 03→05 differs by **AE 268,767 px (5.6% of the frame)**: 113,661 of them (42.3%) sit inside the marked row's own box — y 1008–1106 × x 780–1970, i.e. 97% of that row, which is the clearing — and the remainder is a text-repaint residue elsewhere in the frame (the description line, other rows' labels with subpixel fringing, sidebar items). The pair demonstrates the clearing; "all of them" is not what the pixels hold. |
| `persist-checked` | the label is `Also make it the default for new sessions`, **identical to unchecked** — nothing says what the tick did to *this* pick | `This pick also sets the default for new sessions` |
| `refresh-clicked-immediate` | the button still reads `Refresh from providers` (disabled) and the listing is **gone** — the listbox is not in the DOM | the button reads `Refreshing…`, and the 1005 rows it already had are still painted (`keepPreviousData`) |
| `refresh-settled` | still **no rows**, the body reading `Listing unavailable for:` followed by 21 provider names, while the footer went on advertising the arrow keys; the description reads `This session runs /.` | rows present (1505 after the live re-list), the same provider names reduced to a count above the list (the ids are in the note's tooltip), and a description that names the session's model |
| `pick-in-flight` | footer `Working`, right-hand button **`Cancel`** (the wrong action: closing does not cancel the switch), picked row unmarked, its ground the dialog's | picked row marked with a structural edge and a spinner in its meta slot, footer `Switching the model…` (the change, not the machinery), button **`Close`** |
| `after-close` | transcript unchanged: a refused pick left nothing behind | the composer's own outcome path carries the refusal, so the user learns after the dialog is gone |

The number in the `refresh-*` row that matters is the transition, not the total:
the two runs' catalogues came from the live backend registry (1450 rows before,
1005 then 1505 after), so the absolute counts are not comparable — what is
comparable is 0 rows after the click versus the rows it already had.

### The seven states this remediation added

These have **no `before-*` half**, and the reason is the finding rather than an
omission: each is a state the old code could not produce or could not report, so
there is no frame of it on the base tree to pair with.

| State | What it shows |
| --- | --- |
| `pick-pending-band` | UX U3 and design D12 together, 60 ms after the click: the picked row carries its structural edge and the spinner, the footer reads `Switching the model…`, and the band below the dialog shows the chosen model at `ink-dim` **with its own spinner** (measured: `bandSpinners: 2`) — so "waiting" is not a colour step and a hover-only tooltip. |
| `footer-names-the-pick` | UX U1. The list is scrolled 1500 px away from the keyboard's row and the pointer rests on a different one, so the only thing that says which model Enter will switch to is the footer: `Arrows move · Enter picks <the keyboard's row> · Esc closes`. Measured in this run's own committed metrics (`picker-metrics.json` beside these frames, `states[15-footer-names-the-pick]`): `activeIndex: 0`, `activeInList: false`, `footerText: "Arrows move · Enter picks GPT-5.6 Sol · Esc closes"`. |
| `closed-while-in-flight` | UX U2. Escape 80 ms after the click, dialog gone, and the band carries the paint with its spinner (`bandText: "GPT-4.1Switching the model"`, `bandSpinners: 2`) while the transcript still holds **1** note — the answer has not landed yet. |
| `refusal-after-close` | UX U2 at the moment it matters: the refusal landed with nothing on screen. The same run measures the transcript note count going **1 → 2** across this pair, which is the falsifiable form of the claim — the refusal sentence is identical for every refused pick, so only a count can show that THIS pick's outcome was written with the dialog already gone. Before the fix nothing was written at all. |
| `needs-sign-in-row` | QA Q1, part 1: the row the dialog itself labels `no credential`, which is the case the strip used to report as an ordinary success. |
| `needs-sign-in-pick-settled` | QA Q1, part 2: the settled strip quotes the owner's receipt (`model: openai/gpt-4.1 → anthropic/claude-opus-5 (this session)`) **and** appends the renderer's own sentence, on `border-warning-border`/`bg-warning-wash` instead of the success pair. The picked row's ✓ has moved to it in the same frame, which is QA Q2's fix. |
| `needs-sign-in-after-close` | QA Q1, part 3: the same fact in the transcript (`The model was changed. This model has no credential yet…`) for the case where the dialog is gone by the time it lands. |

The four `needs-sign-in-*`/credentialed frames came from a **second run of the same
harness with QA's credentialed seed** (`/tmp/qa130/seed-qa.mjs`, which writes a
synthetic `openai` credential through the backend's own `AuthStore`, and caches an
aggregator listing): without a credential the owner refuses every switch, so
"switched but cannot run yet" does not exist there. The driver prefixes that run's
frames with `cred-` so a frame cannot be mistaken for the other seed's, and the
nine paired states above keep the branch's own seed — which is what makes their
before/after comparison a comparison of the change rather than of the setup.

### UX U7's pair: the header sentence

`before-header-names-the-switch` is the ONE `before-*` half that is not the
audit's: it is this branch's own pre-fix head (`ccbeb0e2a`), because UX filed U7
against the branch's remediation rather than against the base. The state is
`needs-sign-in-pick-settled` again: the switch to `anthropic/claude-opus-5` has
landed — the strip names it, the ✓ has moved to the row, the band reads
`Claude Opus 5` — and the dialog's own header sentence still reads
`This session runs openai/gpt-4.1.` UX measured that over 100 samples spanning
15.4 s and it never resolved, because the sentence read `selected_model` alone
while the ✓, the strip and the band followed the receipt.

The after half is the re-capture on the fixed head, from the same seed, the same
driver and the same state. Its own committed metrics
(`picker-metrics-credentialed.json`, `states[19-needs-sign-in-pick-settled]`)
read `dialogDescription: "This session runs anthropic/claude-opus-5. …"`,
`currentIndex: 12`, `activeLabel: "Claude Opus 5anthropic, no credential1000k"`,
strip `model: openai/gpt-4.1 → anthropic/claude-opus-5 (this session)` — one
answer to "which model is this session on?" in all four places, measured rather
than asserted.

Measured between the two frames: **AE 85,307 px (1.77%)** of 4,813,440, and of
that, at a 2% fuzz to ignore resampling, **13,230 px sit in one 952x64 band
across the sentence's own text line** (the model name is longer, so the sentence
re-wraps before its last clause), **274 px are the clock** (6:37 → 7:14) and the
rest is text antialiasing. The rows, the ✓, the strip, the band and the rest of
the frame are unchanged — the pair differs by the sentence it is about.

## What these frames do not prove

- **The success path is reached only in the second run, and only for the states
  that needed it.** The branch's own seed has no provider credential, so in the
  nine paired states the owner refuses every switch: the refusal path is what
  those frames show (`after-close`). The credentialed run reached an ordinary
  successful switch too, but its two success frames (`cred-12`/`cred-13`) are not
  committed — they show no state the Storybook `result` story does not, and
  committing them under the same names as the refusal frames would misrepresent
  which seed produced which pair. What IS committed from that run is
  `needs-sign-in-*`, whose whole subject is the success path.
- **The result strip's success wording** quotes the owner's own text, which in
  these runs came from a real `local-operator serve` deciding a real switch — not
  from a fixture — but with a synthetic credential, so nothing here proves that
  the model ANSWERED.
- **One theme** (`localOperatorDark`, the app's own default). The other eleven
  are the Storybook set.
- **Still frames.** Paint timing, the profiler numbers behind the row
  memoization and the 1.1-4.2 s cold bind are asserted in the PR's own
  measurements and in `scripts/picker-feedback.test.mjs`, not read off these
  images.
- **No screen-reader announcement** was verified. The pending band now carries a
  labelled spinner (`Switching the model`) and the footer names the row Enter
  would pick, which ARE the accessibility-tree changes this round made — but
  whether a screen reader announces them on change was not measured here.
- Findings deliberately not fixed here, each recorded in the PR's *Not
  addressed* section: the dark-palette `success-border` on the dialog's ground
  (`D10`, a palette/contract change — **six** dark palettes, 2.64 obsidian worst
  to 2.96 dracula, and no ground role is within 3:1 of `elevated`, so only the
  token can clear it); the same class in the new `warning`-toned needs-sign-in
  strip, which renders on `elevated` where the `warning callout` triple is
  asserted only on `canvas`/`surface` (design N1, **seven** palettes
  2.51 monokai – 2.98 neon against the 3:1 floor, text legible everywhere) —
  `D17`'s deferred palette work and this one are one question, and the
  `elevated` alternative is not a one-line change: the contract's edge assertion
  is the one branch that does not consult `EXCEPTIONS`, so it would hard-fail
  those seven palettes with nowhere to record the acceptance; the out-of-band
  case in `pickedCurrent`'s reconciliation (reviewer round 2, nit 2 — clearing on
  any disagreement would put the ✓ back on the old row until the owner's frame
  arrived, which is QA Q2, so the correct fix keeps the pre-pick selector and
  changes the arbitration that round verified); and the row's `data-current`
  attribute is kept as an unstyled a11y/test hook (`D11`).

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
