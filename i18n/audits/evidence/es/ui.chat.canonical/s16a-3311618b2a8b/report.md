# s16a — es audit of the 14 new chat tool-state keys

**Auditor:** i18n-auditor · **model:** deepseek/deepseek-flash · **session:** 3311618b2a8b · **instance:** `3311618b2a8b-s16a-es` · **date:** 2026-11-11
**PR:** local-operator-ui #1870, branch `feat/i18n-s16a-tool-state-words`, audited at head `93a61605b059ada503d75da6e9e38e8ef14e1b67` (worktree `~/local-operator-ui/.worktrees/i18n-s16a`, read-only)
**Artifact audited:** the translator's draft `$LOCAL_OPERATOR_SCRATCHPAD/s16a-drafts/es-s16a.json` (manager session `3ef6295a5545`), `sha256 = d5e50601a2c09101a83f1c4f9c11ae69375e96fd6e050fff1af5f5a9ce85ae29` (recomputed here, matches the brief)
**Translator:** i18n-translator, `anthropic/claude-sonnet-5-5` — I did not author it and did not edit it.

## Verdict

**clean-with-findings** — 4 findings, all NIT. **blocker 0 · major 0 · minor 0 · nit 4.** No BLOCKER or MAJOR remains, so the registry status is `passed`.

The draft reads as native Spanish product copy, keeps the terse lower-case status register of the tool row and the sentence-case register of the generation-card state line, and is internally consistent with the shipped es vocabulary. Nothing in the 14 values is English, literal, or a calque of the English word order.

## Mechanical — all pass

| Check | Result |
|---|---|
| Key set | 14/14 new keys present, none extra, no duplicate JSON members, UTF-8 no BOM (`mech.log`) |
| Placeholders | names/types identical to English: `{size}`, `{count}`, `{total}`, `{material}` — 14/14 OK |
| `select` branches | identical to English in all 6 select-bearing keys: `video`, `voiceover`, `sound_effect`, `other` |
| CLDR categories (es) | `Intl.PluralRules('es')` → `one`, `many`, `other`; every plural message carries all three (`queue_ahead`, `running_batch` × 4 materials) |
| `::group-off` | present in all three `queue_ahead` branches, absent elsewhere — same as English |
| `#` in nested plurals | used in all 12 `running_batch` branches, matching English |
| Typography | `…` is U+2026 and `·` is U+00B7 in every case; no three-dot ellipsis, no NBSP, no double spaces, no leading/trailing space |
| Repo validators | `node scripts/i18n/generate.mjs --check` → "byte-identical to a fresh generation", exit 0; `node scripts/i18n/context-parity.mjs` → ok, exit 0, and the 14 keys are covered context, not one of the 129 allowed gaps (`validator.log`) |

### ICU execution evidence (`intl-messageformat` from the worktree's `node_modules`, locale `es`)

Counts `0,1,2,3,5,11,21,22,100,1000000` × materials `image, video, voiceover, sound_effect` (+ the raw wire value `sound-effect` and an unknown value, both correctly falling to `other`). Full run in `fmt.log`; representative lines:

```
tool.composing_sized   es="redactando · 12,4 KB"      en="composing · 12.4 KB"
tool.queued_sized      es="en cola · 12,4 KB"         en="queued · 12.4 KB"
state.writing_request  es="Redactando la solicitud…"
state.queue_ahead      count=0  "0 por delante" · 1 "1 por delante" · 100 "100 por delante" · 1000000 "1000000 por delante"
state.running          image "Generando imagen…" · video "Generando vídeo…" · voiceover "Generando locución…" · sound_effect "Generando efecto de sonido…"
running_batch          image 1 "Generando 1 imagen…" · 2 "Generando 2 imágenes…" · 1000000 "Generando 1.000.000 de imágenes…"
                       video 1 "Generando 1 vídeo…"   · 2 "Generando 2 vídeos…"   · 1000000 "Generando 1.000.000 de vídeos…"
                       voiceover 1 "Generando 1 locución…" · 2 "Generando 2 locuciones…"
                       sound_effect 1 "Generando 1 efecto de sonido…" · 2 "Generando 2 efectos de sonido…"
state.done             "Imagen generada" / "Vídeo generado" / "Locución generada" / "Efecto de sonido generado"
state.done_batch       "Lote de imágenes" / "Lote de vídeos" / "Lote de locuciones" / "Lote de efectos de sonido"
state.failed           "No se pudo generar la imagen." / "…el vídeo." / "…la locución." / "…el efecto de sonido."
state.failed_batch     "Falló el lote de imágenes." / "…de vídeos." / "…de locuciones." / "…de efectos de sonido."
state.already_finished "Ya había terminado."
```

Grammatical reading of every branch: correct noun number and gender agreement per material (`el vídeo`/`generado`, `la locución`/`generada`, `el efecto de sonido`/`generado`, `la imagen`/`generada`), `de` inserted **only** in the CLDR `many` category (1.000.000 de vídeos), singular kept for total=1, `::group-off` keeps the never-wrapping datum narrow, no leftover braces anywhere.

## Accuracy

Meaning, negation and polarity are correct in all 14 keys. `No se pudo generar …` (not "was not generated") and `Falló el lote de …` are the product's own error register, not a claim about cause; `Ya había terminado.` states only that the work had finished, exactly as the English note requires (no duration, no blame); `en cola` is the queue state, not `pendiente` (which would be the different "pending" state the sidecar warns against). Nothing added or dropped.

## Fit

Most rendered lengths stay within es's expected +15–25 % over English (tool row +1 cell on both status lines; `En cola` +1; `Redactando la solicitud…` +4). Three lines are meaningfully longer than English and are the only width risks: `queue_ahead` (+5…+6 cells on a `shrink-0` datum, NIT 1), `done_batch` (`Lote de efectos de sonido` 25 vs 18) and `failed_batch` (`Falló el lote de efectos de sonido.` 35 vs 26). Neither state line has a `maxCells` hint and both are single-line but not truncating; no evidence of overflow, recorded as risk only.

## Per-key verdict (14/14 PASS)

`tool.composing_sized` **PASS** · `tool.composing_empty` **PASS** · `tool.queued_sized` **PASS** · `tool.queued_empty` **PASS** · `image_gen.state.queued` **PASS** · `state.writing_request` **PASS** · `state.queue_ahead` **PASS (NIT 1)** · `state.running` **PASS (NIT 2, NIT 3)** · `state.running_batch` **PASS (NIT 2)** · `state.done` **PASS (NIT 2, NIT 4)** · `state.done_batch` **PASS (NIT 2, NIT 4)** · `state.already_finished` **PASS** · `state.failed` **PASS (NIT 4)** · `state.failed_batch` **PASS (NIT 4)**.

## Findings (4 NIT, 0 blocker/major/minor)

### NIT 1 — `ui.chat.canonical.image_gen.state.queue_ahead` — width of the never-wrapping datum
Current: `{count, plural, one {{count, number, ::group-off} por delante} many {…} other {…}}`
Problem: measure, not wording — this datum is `shrink-0` and never wraps; es costs 5–6 cells more than English (`100 por delante` 15 vs `100 ahead` 9; `1000000 por delante` 19 vs 13).
Suggested: no change. `por delante` is the shortest wording that keeps the meaning (`delante` alone is ambiguous, `en espera` would misstate it as queue length) and the sidecar's "2–3 words" is met. Risk recorded so QA can check a narrow card frame.

### NIT 2 — `image_gen.state.running` / `.done` / `.running_batch` / `.done_batch`, voiceover branch — new term “locución” to be recorded
Current: `Generando locución…` / `Locución generada` / `Generando # locuciones…` / `Lote de locuciones`.
Problem: `locución` is a **new** product term with no row in `i18n/glossary.md` and no row in `i18n/style-guides/es.md`, and **zero** shipped precedent (0 hits for `locución`/`voz en off` across all 159 es catalogues; shipped generated-speech copy says `voz`, e.g. `ui.common.errors.speech_generation` "No se pudo generar la voz"). The word itself is native and precise (locutor/locución is the standard broadcast term) and shorter than the colloquial alternative `voz en off`.
Suggested: keep `locución`. Follow-up for the wave, not a copy change: record it in the es style guide (or glossary) so the next es surface reuses one word.

### NIT 3 — `image_gen.state.running`, all four branches — bare singular after the gerund
Current: `Generando vídeo…` / `Generando locución…` / `Generando efecto de sonido…` / `Generando imagen…`.
Problem: the shipped catalogue usually keeps the article with a singular countable object (`Cargando el navegador`, `Cargando el agente guardado…`, `Generando el nombre…` in `ui.chat.checkpoint.generating_name`), though it also ships bare plurals/uncountables (`Cargando agentes`, `Cargando mensajes`, `Cargando archivos…`). The bare form here is the same telegraphic register the English uses, and it keeps the four branches parallel.
Suggested: no change requested. If the wave prefers fuller sentences, `Generando el vídeo…` / `Generando el efecto de sonido…` stays inside the "two to four words" budget.

### NIT 4 — `vídeo` vs the shipped `ui.library` spelling (pre-existing drift)
Current: `Vídeo generado`, `Lote de vídeos`, `No se pudo generar el vídeo.`
Problem: the draft's `vídeo` matches 6 shipped values (`ui.canvas.files.videos`, `ui.canvas.file_rows.video`, both `ui.canvas.video_preview.*`, `ui.chat.directory.folder.videos`, `ui.onboarding.tour.welcome.body.2`) but **not** `ui.library.category.video` and `ui.library.kind.video`, which ship unaccented `Video`. The split is pre-existing and is not introduced by this draft; `vídeo` is the standard form and the majority.
Suggested: keep the draft as-is; the alignment belongs in `ui.library`, out of scope for these 14 keys.

## Observations (not findings)

- **Translator note accuracy.** Two citations are imprecise, neither changes the copy: (a) "verbs are gerund lower-case like `tool_row.verb.*.running`" — those ship **capitalised** (`Actualizando proyecto`, `Escribiendo`); the real lower-case precedent is `ui.chat.canonical.tool.never_sent_composed`/`never_sent_empty` (`redactado: {size}`, `nada redactado`), which the draft does follow. (b) "batch has no shipped es term" — true for the es chat catalogues, but `lote` already ships in `ui.settings.imports.selection_limit` ("por lotes") and `ui.settings.configuration.delegated_retention_copy…` ("en lotes limitados"), which strengthens the reuse rather than contradicting it.
- **Reuse claims verified** against shipped es bytes: `en cola` (`ui.settings.imports.state_queued`, `phase_queued`, `ui.chat.sidebar.row.bg.queued`, `ui.chat.ask_queue.status.open` "En cola — el agente continúa", `ui.chat.aside.adopt.queued`); `redactado`/`nada redactado`; `Generando` (`ui.chat.checkpoint.generating_name`); `imagen/imágenes` (`image_label`, `fold.*_images`, `attachment_refusal.images_*`); `solicitud` for request (`ui.common.errors.media_request`, `ui.browser.media_access.prompt_label`).
- **`Falló el lote …` construction** has shipped precedent (`ui.chat.canonical.older_history.failed.short` "Falló la carga", `ui.chat.run_details.reader.failed` "Falló", `ui.common.errors.request_http` "La solicitud falló", `ui.common.errors.speech_no_audio` "La generación de voz falló").
- **Register decisions the draft got right:** `redactando` keeps the composing/writing distinction English draws (`tool_row.verb.wrote.running` ships `Escribiendo`); `En cola` (card) vs `en cola` (tool row) is a deliberate, source-mirroring case pair; full stops only where English has them; `Falló…`/`Ya había terminado.` carry the sentence case the state-line slot asks for.
- **Second pass:** after the mechanical runs I re-read all 14 values from scratch (the three failure/finished sentences specifically for polarity and safe wording). The second pass agreed with the first, and it is the pass that produced NIT 2 and NIT 3.

## Independence and gaps

I did not translate this file, could not edit it, and used no translation/MT service to compare or back-translate. Findings come from reasoning over the English source, the context sidecar, `i18n/glossary.md`, `i18n/style-guides/es.md` (core `b42471d3`) and the shipped es catalogues.

**Could not check:** no native-speaker review beyond my own Spanish; **no rendered frame** (no browser/Electron run in this read-only audit), so overflow is a character-count argument, not a measured layout; `scripts/i18n/ledger-check.mjs` / `ledger-assemble.mjs` were not run because both derive hashes from the shipped catalogue, which this draft is not yet — the ledger row is the integrator's step once the keys land (the `record.json` here names the **draft** bytes at `sha256.es`, as the brief asked, so it must not be pointed at the merged file without re-derivation).

## Commands actually run (logs retained)

```
node scripts/i18n/generate.mjs --check          → byte-identical, exit 0        (validator.log)
node scripts/i18n/context-parity.mjs            → ok, exit 0                    (validator.log)
node scratchpad/mech.mjs                        → 14/14 structure OK            (mech.log)
node scratchpad/fmt.mjs                         → all renders, no braces left   (fmt.log)
node scratchpad/validate-receipt.mjs            → RECEIPT ACCEPTED by
   scripts/i18n/ledger-rules.mjs deriveReceiptAudit → clean-with-findings,
   findings {blocker 0, major 0, minor 0, nit 4}                                 (receipt-validation.log)
```

Machine-derived identity from the repo's own rules module: agent `i18n-auditor`, instance `3311618b2a8b-s16a-es`, model `deepseek/deepseek-flash`, receipt `sha256 272523031c7b7a164bede335290cee0ca402c10fd2e3e01491d4da3ef230e845`.
