# s16f — round-2 independent audit — `es` (generation-card labels)

Slice S16f, PR [#1876](https://github.com/damianvtran/local-operator-ui/pull/1876). English-first; the
10 new keys are **landed** in `src/i18n/catalogues/es/ui.chat.canonical.json` (the last 10 keys, in
English order). This pass audits the **landed bytes**, not a draft.

- **Auditor**: `i18n-auditor`, session `756ed6175781`, model **deepseek/deepseek-flash**
  (this session's own header line; no fallback commanded or observed; `actual_model_source` =
  session header — the served provider cannot be verified from inside the session).
- **Independence**: not the translator (`i18n-translator`, `anthropic/claude-sonnet-5-5`, session
  `6df6edff657a`) and **not the round-1 auditor of `es`** (session `7a0414234ed5`). Fresh session;
  the round-1 report was read afterwards as *input*, and every correction was re-judged on the landed
  bytes. This is also the second independent reader for the status/error copy the round-1 report
  recommended covering.
- **Worktree** (read-only, manager-owned): `~/local-operator-ui/.worktrees/i18n-s16a` @
  `9931d62addf8a0606bb26d32a8bc163dc7c126b3` — `git rev-parse HEAD` verified, `git status` clean
  before and after. Nothing written to the repo: no edit, commit, push or PR comment.
- **Guidance read**: `~/local-operator/i18n/glossary.md`
  (`sha256 0eb34437…`), `~/local-operator/i18n/style-guides/es.md` (`sha256 77b92272…`).
  Judgments are reasoned from source + sidecar + guide/glossary + shipped `es` catalogue precedent +
  real renders. **No translation/MT service** was used to compare or back-translate.

## Verdict: **clean-with-findings** — {blocker 0, major 0, minor 0, nit 1}

All 10 values are accurate, idiomatic neutral Spanish, glossary- and guide-conformant, and
structurally identical to English. The single finding is a NIT about one clause brushing the
sidecar's word hint; **no change is requested** and none of the three round-1 corrections needs
revisiting.

## Input hashes (SHA-256)

| Input | Value |
|---|---|
| 10 landed `es` pairs, sorted-key compact UTF-8 JSON | `fac4c52e211fa93044ec89506976f17a9868e1b6e5e5f58d90ac251613cdbea6` |
| 10 `en` pairs, same normalisation | `bdd1d9d1cfcd327c7445396ad806220fa850fe820c638a59ec6bc195f882e307` |
| `src/i18n/catalogues/es/ui.chat.canonical.json` (466 keys) | `1098c579c75debf77b9339dbaf87232d51850a592499c4481275e922a09196bb` |
| `src/i18n/catalogues/en/ui.chat.canonical.json` (466 keys) | `12ec2698434dcb39497e288af62d11d70f0fd71d494a9becf3fd611d6568bbdd` |
| `en/ui.chat.canonical.context.json` | `95aa203759416c93180b7eb4967e6fcf5bce0dffe20e9d005b431c645e9e11e6` |

Pair-hash recipe: `sha256(json.dumps({k: v for the 10 keys}, sort_keys=True,
separators=(",",":"), ensure_ascii=False).encode("utf-8"))`.

## 1. Mechanical — PASS

Scratch mirror = `git archive HEAD` of `src/`, `scripts/i18n`, `i18n/`, `package.json`, `docs/I18N.md`
into this session's scratchpad; `node_modules` is a symlink to the worktree's existing tree (shared,
never installed); `CMUX_*` unset. **First attempt symlinked `src/renderer` and every locale test in
`generation-card-labels.test.mjs` failed** — the components then resolved a *second* copy of
`src/i18n` through the symlink's realpath, so the marker catalogue never reached them. Rebuilt with
real archived renderer/shared sources: 27/27 pass. Recorded because it is exactly the class of
false negative a rig can produce.

- `node scripts/i18n/generate.mjs --check` → `keys.gen.ts is byte-identical to a fresh generation`, exit 0.
- `node scripts/i18n/check-coverage.mjs` → ok, `0 allowed key(s) remain across 0 pair(s)`, exit 0.
- `node scripts/i18n/check-duplicates.mjs` → ok, 1428 files, 0 duplicate keys.
- `node scripts/i18n/context-parity.mjs` → ok (129 allowed gaps in 4 namespaces, shrink-only).
- `node --test scripts/i18n/locale-parity.test.mjs` → **44/44 pass**.
- `node --test scripts/i18n/generation-card-labels.test.mjs` → **27/27 pass** (English locked
  against the old templates, marker-catalogue lookup for fr/ru/ur, source guard, RTL isolation).
- Own checker (`audit-es-s16f-r2.mjs`, `@formatjs` parser + `new IntlMessageFormat(message, "es")`
  exactly as `src/i18n/messages.ts` builds it), run on the landed file:
  - argument names **and types identical to English, compared per plural/select arm** — this is what
    catches a placeholder dropped from one arm (a mutant dropping `{label}` from the `failed` arm was
    caught only after the per-arm comparison was added; the global argument-set check missed it);
  - `es` CLDR = `one,many,other`; every plural the source branches by category carries
    `one`+`many`+`other`; `cancelled`/`unknown` keep their empty `=0` arms; offsets unchanged;
    `media.*_label` correctly stays `=1`/`other` because the source has no category arms;
  - 51 renders (counts 0,1,2,3,5,11,21,22,100,1000,1e6,1.5e6,2e6 × statuses
    failed/cancelled/other/unknown-value/empty × has_attention yes/no × positions 0…1e6): no throw, no
    leftover `{ } #`, no `undefined/NaN/null`, no space before `; : . , ? !`, no double space;
  - `$0` literal present; NFC; no bidi controls; no quote/ellipsis drift; no slash alternative.
- **Negative control** — 7 in-memory mutants, each makes the same checker exit 1: dropped arm
  placeholder, deleted `many` arm, deleted `one` arm, English leftover (`No charge.`), the round-1
  `cancelada/detenida` slash form, `$0`→`0`, renamed placeholder. Log: `audit.log`.
- Real render of the card under `es` (`probe-render-es.mjs`, `renderToStaticMarkup`): summary,
  item-status row line, latest-update note, per-row cost line, batch-unknown line, `Imagen 2` /
  `Sonido 3` labels all read Spanish, e.g.
  `1 completada · 1 fallida · 1 detenida · 1 con estado desconocido. Atención: Rain; Piano suave; Sin nombre`.

## 2. Findings

### S16F-ES-R2-01 — NIT — one count clause sits at the sidecar's word hint

`ui.chat.canonical.sound.batch.summary`, `unknown` arms:

```
one { · {unknown, number, ::group-off} con estado desconocido}
many/other { · {unknown, number, ::group-off} con estado desconocido}
```

Renders `· 1 con estado desconocido`. The sidecar's length hint is "keep each count clause under four
words"; this clause is four (`1 | con | estado | desconocido`) against English's three
(`1 | status | unknown`).

Problem: hint boundary only. The obvious short form `1 sin estado` (3 words) loses precisely the
distinction the same sidecar entry requires — "it must read as *unknown*, never as success or
failure". `1 desconocido` is worse still: it moves the doubt onto the item. No shorter form keeps
both the count and the "the *status* is unknown" reading.

Suggested wording: **none — keep as is.** If the hint is ever enforced strictly, `1 sin estado` is
the only three-word candidate and should be taken deliberately, accepting the precision loss. The
clause is also vanishingly rare in practice (a receipt with an unrecognised status).

## 3. Round-1 corrections, re-judged on their merits — all ACCEPTED

| Correction | My judgment |
|---|---|
| `cancelled` arms → `detenida` / `de detenidas` / `detenidas` | **Accept.** The sound flow's own verb is *detener* — `sound.stop.question` "¿Detener esta generación?", `sound.stop.request_stop` "Solicitar detención", `image_gen.control.stop` "Detener"; `ui.projects.project_model.stopped` "Detenida" and `ui.chat.pickers.info_model.stopped_ago` "detenida hace …" are the shipped bare-state precedent. A slash alternative (`cancelada/detenida`) asks the reader to pick a word and splits one state into two terms — right to remove it. English needs two words because it has no settled user word; Spanish does. |
| `many` arms → `… de completadas` / `de fallidas` / `de detenidas` | **Accept.** Binding rule in the style guide ("1.000.000 **de** sesiones"), and shipped in-file precedent: `fold.count.file`, `fold.images_aria`, `image_gen.batch_summary`, `agents.starters.summary.failed` "de agentes fallidos". |
| `has_attention` yes → `. Atención: {labels}` | **Accept**, with the reasoning I would have written: the subject is a name list of variable length, so a verb cannot agree — `Requieren atención:` (shipped twice: `ui.mesh.approval.needs_attention`, `ui.mesh.approval.result_status`) is ungrammatical for one name, `Requiere atención:` for many. `Atención:` is count-agnostic, keeps the sentence break the sidecar requires, and keeps the standard es callout register. Its one weakness is that the catalogue has no other standalone `Atención:` label — recorded as a deliberate extension, not a defect. |
| Round-1 left `estimated_zero` (`$0`) and `con estado desconocido` unchanged | **I independently agree** — see §4. |

## 4. Per-key judgment (my own read, not the round-1 table)

| Key | Landed `es` | Judgment |
|---|---|---|
| `sound.batch.item_status` | `{label} · Fallida` / `· Detenida` / `· Estado desconocido` | Accurate, one to two words, no punctuation, sentence case. Feminine agreement reads the implied *solicitud/generación* and matches `ui.settings.imports.outcome_failed` "fallida", `ui.code_review.ci.failing` "… fallida", `ui.chat.pickers.analytics_panel.failed` "… fallidas". `Estado desconocido` is the shipped `ui.ownerAudit.unknown_status`; the `other` arm therefore reads as *unknown*, never as success. Note the catalogue's bare state adjectives split by referent rather than by convention (`ui.chat.action.stopped` "Detenido" vs `ui.projects.project_model.stopped` "Detenida"); the slice is internally consistent, which is what matters inside one card. |
| `sound.batch.summary` | counts by outcome, then `. Atención: …` | Accurate, terse, lower-case clauses, `·` separators per guide. Each count has its own plural so the adjective agrees; `many` carries `de`. Consistent with the row suffix (same word per state). |
| `sound.batch.latest_update` | `Última actualización: {name} (elemento {item} de {total}).` | Accurate, one sentence, full stop, one-based item kept. `elemento` is the namespace's own word for a batch item (`image_gen.batch_summary` "{count} elemento"); `Última actualización` has shipped precedent across `ui.common.updates`. |
| `sound.cost.unknown` | `Coste aún sin determinar.` | Accurate ("not reported **yet**", no promise of a figure); `coste` per glossary §2 + guide ("standardised on coste — recorded 2026-10-11"). |
| `sound.cost.no_charge` | `Sin cargo.` | Accurate for a confirmed zero bill; `sin cargo` is the catalogue's own money-free phrasing (`ui.chat.session_spend.plan_clause` "… sin cargo"). Not a glossary term ("cost" is not in the sentence), so no `coste` obligation. |
| `sound.cost.estimated_zero` | `Coste estimado de $0; cobro final sin confirmar.` | Accurate, one semicolon, keeps the estimate-vs-bill distinction the sidecar demands. `de $0` is idiomatic Spanish for an amount ("un coste estimado de 500 €"), and `$0` stays byte-identical per the slice rule (sign first as in English; understood in Spain and standard in LatAm). `cobro` matches `sound.stop.warning` "se cobrará". |
| `sound.cost.batch_unknown` | `Coste total aún sin determinar.` | Accurate; sibling of the per-row line, same shape. |
| `media.image_label` | `=1 {Imagen}` / `other {Imagen {position}}` | Correct: numbering after the noun, matching `ui.chat.canonical.image_label` "Imagen", `ui.common.viewer.image_progress` "Imagen {index} de {count}", `ui.teamBridge.attachments.position`. `=1`/`other` is the source's own scheme. |
| `media.sound_label` | `=1 {Sonido}` / `other {Sonido {position}}` | Correct and playable through the player's accessible name (`ui.chat.audio.play_label` "Reproducir {label}" → "Reproducir Sonido 3"); `Sonido` is the catalogue's word (`ui.settings.notifications.sound.heading`, `sound.player_failed` "este sonido"). Not "Audio" — no shipped precedent. |
| `supplement.sound_fallback_label` | `Sonido generado` | Correct bare noun phrase, sentence case, two words; matches `image_gen.state.done` ("Vídeo generado"/"Efecto de sonido generado"). |

Register/formality: no address forms occur, so the guide's *tú* decision is not exercised; tone is
terse, imperative-free, sentence case, no `!`. Punctuation: no space before `; : .`, `…` absent,
`¿…?` absent because these are statements and labels. Terminology: every glossary term that occurs
(`coste`, `sesión`-free) follows its row; no product names or machine tokens occur, and nothing is
translated inside a placeholder.

## 5. Fit and width

Render sites (read, not changed): the card's summary paragraph, the per-row status line
(`text-body`, `break-words [overflow-wrap:anywhere]`), the `text-meta` cost line and the latest-update
note, and the media labels as alt text / tile names / player accessible names.

| Key | en → es chars | Note |
|---|---|---|
| `item_status` | 106 → 112 (+5.7%) | state is 1–2 words; +2 chars per row line |
| `summary` | 579 → 801 (+38.3%, includes the ICU `many` arms) | **rendered** text is *shorter* than English on realistic grids: `1 completada · 1 fallida · 1 detenida · 1 con estado desconocido. Atención: …` because English spells `cancelled/stopped` |
| `latest_update` | 89 → 100 (+12.4%) | wraps under the state line |
| `cost.unknown` | 19 → 25 (+31.6%) | one `text-meta` line, wraps |
| `cost.estimated_zero` | 46 → 48 (+4.3%) | |
| `cost.batch_unknown` | 25 → 31 (+24.0%) | |
| `media.*_label` | 73 → 75 (+2.7%) | "Imagen 2"/"Sonido 3", 1–2 words |
| `sound_fallback_label` | 15 → 15 (0%) | |

No sidecar entry carries `maxCells`/`maxChars`; each length hint is met except the NIT in §2. No
overflow finding. Wide-glyph / combining-mark risk: none (`es` is Latin). RTL: not applicable.

## 6. Nothing left in English

Within the 10 values: nothing. The only Latin text is `$0` and the user-data placeholders
(`{label}`, `{name}`), which must not be translated.

**Out of scope, but it blocks the operator's acceptance claim for this card** — the batch *total*
cost line and the per-row settled-cost line are not keyed at all:
`src/renderer/src/features/chat/canonical/sound-batch-model.ts` builds them from English literals, and
the file says so on purpose ("NOT YET KEYED, ON PURPOSE … `caption.slice(5)` drops \"Cost \" … belongs
to the structured-cost slice"). Measured under `es`:

```
batchCost: Known total cost $0.65 (estimated). Unknown or late charges are not included.
card row : Cost $0.4 (billed).
```

Pre-existing (not this PR) and explicitly deferred, so it does not gate these 10 keys; recorded here
so nobody reads "es is clean" as "this card is English-free". The keyed branch
(`sound.cost.batch_unknown` → "Coste total aún sin determinar.") is correct — it is simply not the
branch that renders when any amount exists.

## 7. Ledger receipt

`receipt-es-s16f-r2.json` (scratch; **not** written into the repo). Validated by the repo's own
assembler in the scratch mirror — it derived `status audited | clean-with-findings, 0 blocker,
0 major, 0 minor, 1 nit`, and `ledger-check.mjs` reports **no** `es/ui.chat.canonical` finding (the
18 remaining findings are fr/hi/ru/ur/vi/zh-CN rows stale against their unmoved audits).

Integrator command (run from the repo root, with the receipt copied anywhere readable):

```bash
node scripts/i18n/ledger-assemble.mjs \
  --locale es \
  --file src/i18n/catalogues/es/ui.chat.canonical.json \
  --auditor-instance 756ed6175781 \
  --auditor-model deepseek/deepseek-flash \
  --result clean-with-findings \
  --receipt <path-to>/receipt-es-s16f-r2.json \
  --scope "Round-2 independent audit of the 10 S16f generation-card keys on the landed bytes at 9931d62addf8 (sound.batch.*, sound.cost.*, media.*_label, supplement.sound_fallback_label); other 456 keys untouched, read only as precedent" \
  --note "S16f, PR #1876. Round-2 independent re-read of all 10 landed es values (mechanics, idiom, precedent, width, RTL n/a). Detail: i18n/audits/evidence/es/ui.chat.canonical/au2-s16f-es-756ed6175781/report.md" \
  --date 2026-11-11
```

`--note` is 202 characters (limit 280). The assembler copies the receipt to
`i18n/receipts/756ed6175781.json` and records its `receipt_sha256` itself; the es row's prior audits
are moved to `superseded` because this PR changed the target bytes (expected).

## 8. Evidence bundle (to land, not landed here)

Intended tracked path: `i18n/audits/evidence/es/ui.chat.canonical/au2-s16f-es-756ed6175781/`
with `record.json`, `report.md` (this file), `receipt.json`, `audit.log` (real captured output, 17
command blocks — `audit_notes_not_execution_log` does not apply to it), and `auditor-files/`
(`audit-es-s16f-r2.mjs`, `probe-render-es.mjs`, `mutants/*.json`, `capture-log.sh`).

## 9. Limitations

- Read-only audit: nothing written to the repo, no commit, no PR comment, no ledger row.
- Widths are character counts and the real rendered strings from `renderToStaticMarkup`, not a
  captured frame; this group's verdict does not rest on layout.
- Native fluency is this auditor's own; no external native reviewer was consulted.
- The 456 pre-existing keys were read as precedent only; they are not re-audited here.
