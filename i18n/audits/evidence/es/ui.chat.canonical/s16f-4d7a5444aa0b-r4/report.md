# S16f (PR #1876) — independent audit, `es`, `ui.chat.canonical`

- **Auditor:** `i18n-auditor` (this session), session `f6655caaf9ed`, instance `4d7a5444aa0b`
- **Model:** `deepseek/deepseek-flash` (this session's own header line; the i18n-auditor role
  default, not a mid-run switch. The served provider cannot be verified from inside the session.)
- **Date:** 2026-11-12
- **Scope:** the 15 keys in `es/ui.chat.canonical.json` named by the manager — main-added
  `loading.{cold,older,region_label,remote,revalidating}` and PR-added
  `media.{image_label,sound_label}`, `sound.batch.{item_status,latest_update,summary}`,
  `sound.cost.{batch_unknown,estimated_zero,no_charge,unknown}`,
  `supplement.sound_fallback_label` — plus mechanical integrity of the other 452 values.
- **Verdict:** `passed` — no BLOCKER, no MAJOR. 1 MINOR + 2 NIT, both NITs recorded as
  "accepted, no change requested".
- **Read-only:** nothing edited, committed, checked out or installed. Every check ran against
  the shared worktree `~/local-operator-ui/.worktrees/i18n-s16a` @
  `8180eff1f705eb79d4df5123d6108c539b585b2e` (HEAD verified, `git status --porcelain` empty).
  Catalogue audit only — **not** rendered fit, activation or release. No browser/Electron
  frame was captured (machine is near its RAM limit and this brief is catalogue-scoped).

## Bytes audited (computed here, full hex)

| Input | Path | sha256 |
|---|---|---|
| target | `src/i18n/catalogues/es/ui.chat.canonical.json` | `547b85e9670eec79f82211f50325092bf75c13eda4504995cce1a1d5ab25e272` |
| source | `src/i18n/catalogues/en/ui.chat.canonical.json` | `905fb4d86bab02148e90dea09a1e7d74c628fcdeb3f40f49126b21f491a8d28e` |
| context | `src/i18n/catalogues/en/ui.chat.canonical.context.json` | `8f56e0d2b384c6b41add57a64e6c863e565cb61d5a7c0de482d42f380be3acfe` |
| glossary | `~/local-operator/i18n/glossary.md` @ HEAD `b42471d3` (= `origin/main:i18n/glossary.md`) | `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8` |
| style guide (read) | `~/local-operator/i18n/style-guides/es.md` @ HEAD `b42471d3` | `77b9227213802d14c74d4298d6b346ad842bbf2a5ca3b9d46fc6144430d26c3e` |
| style guide (current `origin/main`) | `origin/main:i18n/style-guides/es.md` | `4a6f6270f028e5f5fbca7156a8f5099077f92585db94c14653482e9b188248a6` |

**Style-guide freshness disclosure.** The local `~/local-operator` checkout is 1844 commits
behind `origin/main`, so the guide I read first is the older of the two. I re-read the
`origin/main` version (snapshot kept as `es-style-guide-origin-main.md`). The 44-line delta is
three es amendments — `carpeta` vs `directorio de trabajo`, `cuota` vs `asignación`,
`pull`/`push` kept English — plus TUI width exceptions. **None of them names any term, surface
or budget in this audit's 15 keys**, so the verdict does not change; both hashes are recorded.
The ru S16f receipt (`9f927eaac669-s16f-r3-ru`) recorded the same `77b9227…` es hash, i.e. the
same stale checkout.

## 1. Mechanical — PASS

- `node --test scripts/i18n/locale-parity.test.mjs` → **44/44** (every shipped locale: key set,
  unknown keys, ICU placeholder preservation, English-stub check).
- `generate.mjs --check` → `src/i18n/keys.gen.ts` byte-identical to a fresh generation.
- `check-duplicates.mjs` → 1437 files, 0 duplicate keys.
- `context-parity.mjs` → ok (129 allowed gaps, shrink-only allowance).
- `ledger-check.mjs` → FAILED with 14 findings across 1113 entries, of which exactly two are
  `es/ui.chat.canonical: status is "pending"` + `no auditor recorded` — the expected pre-audit
  state this receipt rebinds. (All seven non-`en` locales are pending; that is the reset the
  manager described, not an es defect.)
- `node --test scripts/i18n/generation-card-labels.test.mjs` → **27/27**.
- My own checker (`es-mechanical.mjs`, both parses by the app's real ICU parser
  `@formatjs/icu-messageformat-parser`): for all 15 keys, **argument name/type set identical to
  English** once arm multiplicity is normalised (es legitimately has 4 arms where en has 2);
  every English selector key preserved; every added category is a legal es CLDR category
  (`one`/`many`/`other` only — `few` never appears in the file); the `=0` hide-branches on
  `cancelled`/`unknown` are intact; `::group-off` skeletons preserved in every arm; NFC; no
  bidi controls; no `...` three-dot ellipsis; no double spaces; valid JSON.
- Runtime grid through `intl-messageformat` (`es`) — **112 renderings, 0 throws, 0 leftover
  braces**: counts `{0,1,2,3,5,11,21,22,100,1000,1e6,1.5e6,2e6,3.1e7}` × statuses
  `{failed,cancelled,other,queued,"",undefined}` × `has_attention {yes,no}` × positions.
  `1e6`→`many`→"1000000 de completadas", `1.5e6`→`other`→"1500000 completadas", `2e6`→`many`.
- Negative controls, 5 mutants, each observed to change the render or throw: dropping a `many`
  arm (text falls back to `other`), renaming `{failed}` (throws, missing context variable),
  replacing the empty `=0` arm with a second `one` arm (`DUPLICATE_PLURAL_ARGUMENT_SELECTOR`),
  an English leftover in the `other` arm, and losing the ` · ` separator.

## 2. Merge integrity — PASS (counts)

`es-integrity.py` (reads with `git show`, nothing checked out):

| Comparison | Result |
|---|---|
| merged key count / `origin/main` / PR head `107ff1dd` | 467 / 457 / 466 |
| `origin/main` keys absent from the merged file | **0** |
| keys added on top of `main` | **10**, exactly the declared PR-added set |
| `main` keys whose **value** changed in the merge | **0** |
| `main` keys byte-identical to `origin/main` | **457 / 457** |
| PR-added keys equal to `107ff1dd`'s audited values | **10 / 10** |
| non-PR keys changed vs `main` | **0** |
| the four renamed-away keys (`older_history.loading`, `placeholder.loading`, `placeholder.region_label`, `transcript.stale_caption`) | absent from both `en` and `es` |

So the ~452 untouched values need no re-reading, and nothing outside the 15 in-scope keys moved.

## 3. Findings

### S16F-ES-A3-01 — MINOR — `ui.chat.canonical.sound.batch.summary`

- **Current** (one of four plurals; the other three are identical in shape):
  `{completed, plural, one {{completed, number, ::group-off} completada} many {{completed, number, ::group-off} de completadas} other {{completed, number, ::group-off} completadas}}`
- **Problem.** The `many` arms are es-authored — English has no category arms here — and they
  exist because es CLDR puts exact millions in `many` ("un millón de completadas"). But each
  `many` arm reuses the sibling arms' `::group-off` skeleton, so the only number that can reach
  it prints **ungrouped**: render at `completed=1000000` → `"1000000 de completadas"`. Spanish
  always groups, and the es style guide's own exemplar for this category is
  `many {# de sesiones}` (`#` renders the *formatted* number), which the guide illustrates as
  "1.000.000 de sesiones". Verified: `many {# de completadas}` renders
  `"1.000.000 de completadas"`.
- **Why MINOR and not MAJOR.** A user reaches it only with ≥1,000,000 requests in one sound
  batch; nothing ships broken. It is real, it is in es-authored text, and it is a one-commit fix.
- **Suggestion.** In the four `many` arms use `#`: `many {# de completadas}`,
  `many {# de fallidas}`, `many {# de detenidas}`, `many {# con estado desconocido}`. All other
  arms keep the `::group-off` skeleton exactly as English. Gate-safe: the repo's placeholder test
  only counts argument-bearing node types (`ARGUMENT_TYPES`, `scripts/i18n/locale-parity.test.mjs:1904`),
  so `#` is not a placeholder and this passes locale-parity unchanged.

### S16F-ES-A3-02 — NIT — `ui.chat.canonical.media.sound_label` (accepted, no change requested)

- **Current.** `{count, plural, =1 {Sonido} other {Sonido {position, number, ::group-off}}}`
- **Problem.** This value is not only the visible tile label and alt text: `media-label.ts`
  documents that it becomes the audio player's accessible name, and `sound-player.tsx` composes
  it into `ui.chat.audio.play_label` / `pause_label` / `position_label` → **"Reproducir Sonido 2"**.
  A capitalised common noun mid-sentence is an orthography error in Spanish. The two surfaces
  pull opposite ways: a bare visible label wants the capital (and `media.image_label` "Imagen"
  keeps it for that reason); the composed accessible name wants lower case.
- **Disposition.** Screen-reader-only, invisible, and the sidecar's tone field asks for a
  capitalised bare noun. Same trade-off the ru round-3 audit recorded (its `S16F-RU-R3-01`), and
  I concur with leaving it rather than flipping one surface alone. If a later wave decides, it
  must change `Sonido`/`Imagen` and the audio templates together.

### S16F-ES-A3-03 — NIT — `ui.chat.canonical.sound.cost.no_charge` (accepted, no change requested)

- **Current.** `Sin cargo.`
- **Problem.** "Charge" has two renderings inside one card: `cobro` in
  `sound.cost.estimated_zero` ("cobro final sin confirmar") and `sound.stop.warning`
  ("se cobrará … el cobro"), and `cargo` here.
- **Why no change.** The shipped es catalogue already names an unbilled amount `sin cargo`
  (`ui.chat.session_spend.plan_clause`: "…equivalente a API, sin cargo"), so this follows product
  precedent; `Sin coste.` would be the alternative if card-internal uniformity is ever wanted.
  I first read this as a MINOR and reversed that on finding the shipped precedent — recorded so
  the reversal is visible, not silently dropped.

## 4. Considered and rejected (recorded, no change)

- **`media.*_label` carries only `=1`/`other`, not `one`/`many`.** Not a defect: the English
  source branches on `=1` only, `=1` matches exactly one, and every other count — including es
  `many` at 1e6 — falls to `other`, which is the numbered form ("Imagen 1000000", verified by
  render). Semantics are complete; adding `one`/`many` arms would be text-identical ceremony.
  `fr`, `vi`, `ur` and `hi` ship the same shape in this PR; only `ru` expanded it. I disagree
  with requiring the expansion, and agree with the es round-2 receipt's call that it "correctly
  stays =1/other".
- **`has_attention` `yes` → "Atención: {labels}"** vs English "Needs attention: {labels}". A
  verbless warning label is idiomatic es UI and keeps the meaning (these items did not complete);
  "Necesita atención:" would be a calque. No change.
- **`loading.remote` width.** 40 cells vs en 31 (+29%, just above the guide's 15-25% band) — but
  the pill is `truncate` on a single `text-meta` line, the sidecar's "five words or fewer" is met
  (5 words), and no shorter form keeps "your own other device", which the sidecar says is the
  point of the label. No change.
- **Word order / register.** All 15 read as native es product copy in **tú** register
  ("desde tu otro dispositivo"), sentence case, single-character ellipsis, no space before
  `;`, middle dots spaced ` · `, and the glossary's `coste` (cost) / `dispositivo` (device)
  renderings. No calque found. No English word in any of the 15 except the literal `$0` and
  user-data placeholders.

## 5. Out of scope, still true (operator's "no English anywhere" claim)

`soundBatchCostCaption` (`src/renderer/src/features/chat/canonical/sound-batch-model.ts`)
still builds the batch **total** line from English literals plus `caption.slice(5)` of
`soundCostCaption`'s English output ("Cost $X (billed)."), and its own code comment defers the
fix to the structured-cost slice. Under es that line renders English. It is **not** one of this
PR's 15 keys, and the es round-2 receipt already reported it
(`756ed6175781`, out_of_scope_observations). Reported here, not gated.

## 6. The receipt is assemble-able (proved without writing the repo)

`ledger-assemble.mjs` was run against a **scratch mirror** (copies of `i18n/ledger.json` and the
`en`/`es` catalogue files under this scratchpad) — the real worktree ledger was never opened for
write. Result:

```
ledger-assemble: es/ui.chat.canonical -> status audited | clean-with-findings, 0 blocker, 0 major, 1 minor, 2 nit
mirror row: source 905fb4d8…d28e, target 547b85e9…e272,
            instance 4d7a5444aa0b, model deepseek/deepseek-flash,
            receipt_sha256 0d53576dd82e8db22742ddcaa18810c5e786cf93d88d15f0d6181de37adfc7c3
```

The shared worktree stayed clean throughout (`git status --porcelain` → 0 lines).

## 7. Artifacts (this session's scratchpad, pending integration)

`receipt.json`, `report.md`, `audit.log` (real commands + their actual output; the one earlier
`FAIL` line is annotated in place with why the checker, not the translation, changed),
`es-mechanical.mjs`, `es-renders.mjs`, `es-integrity.py`, `es-style-guide-origin-main.md`.
Note vs execution log: this report is *notes*; `audit.log` is the execution record.
