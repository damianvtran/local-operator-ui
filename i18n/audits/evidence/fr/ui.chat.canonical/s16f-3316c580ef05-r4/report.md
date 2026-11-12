# Independent translation audit — `fr`, `ui.chat.canonical` (PR #1876, S16f)

- **Audit instance:** `3316c580ef05` · session `9d5e5bb1a1d4` · **actual model `deepseek/deepseek-flash`** (session runtime header; no pin, no fallback requested or observed)
- **Date:** 2026-11-12 · **worktree:** `~/local-operator-ui/.worktrees/i18n-s16a` @ `8180eff1f705eb79d4df5123d6108c539b585b2e` (verified clean)
- **Inputs:** `src/i18n/catalogues/fr/ui.chat.canonical.json` (target), `src/i18n/catalogues/en/ui.chat.canonical.json` + `…context.json` (source/meta), `~/local-operator/i18n/glossary.md`, `~/local-operator/i18n/style-guides/fr.md`
- **Audit kind:** delta on the **merged** bytes — the 5 `loading.*` keys main landed, the 10 PR-added generation-card keys — plus a proven merge-integrity statement for the other 452 values.
- **Independence:** I did not translate these files and cannot edit them. Agreeing with the earlier rounds is not the basis of this report; the currency finding below was re-derived from the corpus and the runtime formatter before I read why round 3 had raised it.

## Verdict

**`passed` — 0 BLOCKER, 0 MAJOR, 1 MINOR, 1 NIT** (`result: clean-with-findings`).

Nothing in the 15 keys misstates meaning, polarity, safety or permissions. Every placeholder, every ICU branch and every `select` arm is structurally intact; all ICU arguments match the English source by name and type; the file is valid JSON; the key set is the merge of `origin/main` and the PR with the 4 main-deleted renames gone; typography follows the fr guide (U+2026 ellipsis, U+2019 apostrophe, U+202F before `:` and `;`, no straight quotes, no ASCII `...`, no bidi controls, all values NFC).

## Findings

### M1 — MINOR · `ui.chat.canonical.sound.cost.estimated_zero`

- **Current:** `Coût estimé à 0 $ ; frais finaux non confirmés.`
- **Problem:** bare `$` is the only **money** rendering in the shipped fr corpus. The corpus writes the currency as the ISO code: `ui.common.account.low_credits_dialog.detail` « {detail} USD », `ui.providers.phone.action.activate` « Activer pour {amount} USD par mois », `ui.providers.phone.consent` « … à {amount} USD par mois … ». The app's own fr money formatter agrees: `Intl.NumberFormat('fr',{style:'currency',currency:'USD'}).format(0)` → `0,00 $US`. An unqualified `$` is read as CAD in a Canadian reading, while this is a USD billing sentence. Not MAJOR: the amount is zero, so no charge can be misread, and the sentence's real claim (an estimate, not a confirmed bill — which the sidecar forbids shortening to « Sans frais ») survives intact.
- **Suggested:** `Coût estimé à 0 $US ; frais finaux non confirmés.` (U+00A0 before `$US`, U+202F before `;`) — or, more consistent with the three shipped USD strings, `Coût estimé à 0 USD ; frais finaux non confirmés.`
- **Prior round:** same defect raised as M1 by instance `5f26f5727a24` (deepseek/deepseek-flash, 2026-11-11). **I agree with it**, and it still stands unremediated on the merged bytes.

### N1 — NIT · `ui.chat.canonical.media.sound_label`

- **Current:** `{count, plural, =1 {Son} other {Son {position, number, ::group-off}}}`
- **Problem:** `Son` is correct French and matches this namespace's prose (« Impossible de lire ce son », « Son généré »), but as a standalone label it is homographic with the possessive determiner, and it is always read after a verb: `ui.chat.audio.play_label` is « Lire {label} », so the accessible names compose as « Lire Son » / « Lire Son 2 ». The namespace's own noun for the media type in a name position is `audio` (« Pièce jointe audio indisponible », « … sera facturée si elle produit un audio »).
- **Suggested:** `{count, plural, =1 {Audio} other {Audio {position, number, ::group-off}}}` — 5 characters, shorter than English's `Sound`. Non-gating judgement call; if changed, leave « Son généré » and « ce son » alone (prose, no homograph).
- **Why NIT and not MINOR:** a sighted reader is not misled by « Son 2 » beside a player, and a screen-reader listener hears it in an audio context. I am not inflating a defensible choice into a defect.

## Judgements I made and cleared (evidence, not preference)

- **`many` on `media.image_label` / `sound_label`.** Both carry only `=1` and `other`, so a French `many` count (an exact multiple of 10⁶) falls through to `other` and renders « Image 1000000 ». That is a correct French label — the `many` form (« de ») would be wrong after a numbering noun — and the shape is the English source's own; not a defect. `sound.batch.summary` *does* carry `one`/`many`/`other` for every count, as the fr guide requires.
- **`0 terminé`, `1 terminé`.** French CLDR puts 0 in `one`, so the singular is policy-correct (fr style guide, *Plurals*), and « 1 terminé » / « 0 échoué » render cleanly from a real receipt (see audit.log).
- **Capitalised state after the middle dot** (`{label} · Échoué`). The same file's other middle-dot clauses are lower case (`tool_row.bridge.outcome.failed` « échoué · {code} »), but capitalisation after `·` is precedented for a trailing **state** label and the English source capitalises. Round 3 filed this as a NIT with "no change requested"; **I would not have filed it at all** — a finding that asks for nothing is padding.
- **`arrêté` where English says "cancelled/stopped".** Not an omission: the fr UI has one stop verb (`Demander l'arrêt`, `Arrêter cette génération`), so the English double wording disambiguates vocabulary the French product never uses.
- **`élément` for "item".** Matches existing fr house use (`image_gen.batch_summary`), and `latest_update`/`item_status` agree with each other.
- **Middle-dot separators use plain spaces**, matching 144 existing fr occurrences (the single U+202F case in the corpus is a percent readout, not a separator).
- **Fit.** No `maxCells`/`maxChars` exists in the English sidecar for any of the 15 keys (the hints are word counts). Measured, rendered lengths: `loading.cold` 30 ch (en 21), `older` 35 (en 25), `region_label` 29 (en 20), `remote` 44 (en 31), `revalidating` 31 (en 26), `latest_update` 52 (en 40), summary 73 vs en 87 on the widest sampled receipt. `older` is the longest of the four loading labels and still inside its "three or four words" hint; all four sit on a full-width transcript status line. No overflow observed or claimed — rendered fit was not exercised (catalogue-level audit).

## Mechanical results

- **Repo validator:** `node --test scripts/i18n/locale-parity.test.mjs` → 44 tests, **44 pass, 0 fail** (key-set equality with `en`, ICU placeholder parity, no-English-stub, all 8 locales). `media.image_label` is byte-identical to English and is a recorded `fr`-scoped cognate exemption in that test.
- **My own ICU pass** (the repo's parser, `@formatjs/icu-messageformat-parser`): argument names/types identical to `en` on all 15 keys; `select` branches identical; plurals differ only by the `many` branch French needs.
- **Render pass** through the engine the app itself imports (`intl-messageformat`, see `src/i18n/messages.ts`) over a matrix (count 1 / 3 / 2 of 3 / 1000000 / 1000001; status failed / cancelled / unrecognised; item 2 of 5; zero/one/many summaries): no message threw, every output grammatical.
- **Merge integrity (the other 452 keys, not re-audited):** merged file 467 keys = `origin/main` 457 + 10 PR-added. **457/457 identical to `origin/main`**, **10/10 identical to `107ff1dd`**, the 4 main-deleted renames (`transcript.stale_caption`, `older_history.loading`, `placeholder.loading`, `placeholder.region_label`) absent, **0 unexpected differences**. Per-key hashes reproduce the prior round's `47631358ab381012` / `0c7f9fff71e4231c`, confirming the PR bytes are unchanged since that audit.

## Hashes

- `fr` `src/i18n/catalogues/fr/ui.chat.canonical.json` = `99f7c0b27d6c75b16935cc58874477cab24da430284576defaacf19e209c88f6` (equals the pending ledger row's `target_sha256`, i.e. the row is waiting on exactly these bytes)
- `en` `src/i18n/catalogues/en/ui.chat.canonical.json` = `905fb4d86bab02148e90dea09a1e7d74c628fcdeb3f40f49126b21f491a8d28e` (equals the row's `source_sha256`)
- `context` = `8f56e0d2b384c6b41add57a64e6c863e565cb61d5a7c0de482d42f380be3acfe`; glossary `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8`; fr style guide `ae1519ab7617d19aa826918d607de1d018595094166edbc18aa58f6a8f0a4226`

## Artifacts (session scratchpad — for the integrator to copy into tracked evidence)

- `~/…/sessions/9d5e5bb1a1d4/scratchpad/s16f-au3-fr/receipt.json`
- `~/…/sessions/9d5e5bb1a1d4/scratchpad/s16f-au3-fr/report.md` (this file)
- `~/…/sessions/9d5e5bb1a1d4/scratchpad/s16f-au3-fr/audit.log` (every command and its real output)
- `~/…/sessions/9d5e5bb1a1d4/scratchpad/s16f-au3-fr/{mechanical.mjs,render.cjs,integrity.mjs}` (the scripts the log runs)

Note to the manager: nothing was written to the worktree. One stray path of mine exists outside it — a mistyped `~/.local-operator/sc rat chpad/x` created by a bad `write` path, which the delete guardrail then (correctly) refused to remove; it is an empty file in an empty directory and needs the operator's hand, not mine.
