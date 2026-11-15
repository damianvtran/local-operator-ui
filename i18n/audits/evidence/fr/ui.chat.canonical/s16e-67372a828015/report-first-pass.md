# Audit report — fr / `ui.chat.canonical` / slice S16e-renderer (12 ICU keys)

- **Audit id:** `s16e-au-fr-2` · **auditor:** i18n-auditor (independent, did not translate)
- **Model (actual):** `deepseek/deepseek-flash` · **session:** `c25b8a640092` · **date:** 2026-11-12
- **Target:** `fr` · **namespace:** `ui.chat.canonical` · **keys:** 12
- **Draft audited:** `…/sessions/3ef6295a5545/scratchpad/s16e/fr/draft-fr-s16e.json`
  sha256 `a46fdb56c6007dd225382a8f94f4972d7a4dfc6aaaab790dca2d7cdf27b4da62` (matches the task's hash)
- **English source:** `src/i18n/catalogues/en/ui.chat.canonical.json`
  sha256 `b967adc33296c5ef0264a8a3ffd698fdfc5a50e4a3ebc8de99114a599b837e17` (matches the task's hash)
- **Verdict: PASSED** — 0 BLOCKER · 0 MAJOR · 0 MINOR · 2 NIT. Nothing gates the slice.

Ground truth read before judging: core `i18n/style-guides/fr.md`
(`ae1519ab…f0a4226`) and `i18n/glossary.md` (`0eb34437…eba962f8`), the English source with its
per-key context (`s16e-brief.json`, `a0326137…55bef0c`), the shipped fr catalogue
(`99f7c0b2…9e209c88f6`, 467 keys — terminology authority), and the PR worktree at
`bd8e90542506e8bec4a98862b868095409b28329` for the call sites.

## Findings

| id | severity | key | current | problem | suggested |
|---|---|---|---|---|---|
| F1 | NIT | `…image_gen.error_class.audio_rate_limited` | « Débit audio limité » | In an audio card « débit audio » is the settled fr phrase for *bitrate*, so the compound reads first as "audio bitrate limited"; the corpus spells the rate-limit concept « limite de débit » (`ui.chat.error_block.rate_limit.before`) and « limité en débit » (`ui.code_review.host.cooling`). Wording ambiguity only: the error sentence under the label disambiguates it and the class stays distinct from the other five. | « Limite de débit audio » (23 cells — still a short label), or keep as is, since « débit » is the corpus's own term. |
| F2 | NIT | `…image_gen.settlement.pending` + `…image_gen.cancel.checking` | « Règlement en attente — … » / « Vérification du règlement. » | « règlement » is new to the shipped fr corpus (0 of 467 keys) and has no glossary row; the corpus states the same pending-charge fact as « frais finaux non confirmés » (`sound.cost.estimated_zero`). Both keys use it consistently, so nothing collides — a programme term decision, and both keys must move together if it changes. | Keep « règlement » (correct fr billing) and add a glossary row; otherwise align with the corpus: « Frais finaux en attente — … » / « Vérification des frais. » |

Answered, rejected, deferred: none. Both findings are NIT and do not gate; F1/F2 are answered
here with the wording above and are **deferred** to the programme's glossary work, not to a fix.

## Per-axis result

1. **Mechanical — pass.** JSON valid; 12/12 keys, no additions or drops. ICU parsed with the
   repo's own `@formatjs/icu-messageformat-parser` (from the primary checkout's `node_modules`;
   the worktree has none). AST shape identical to English for all 12: the only argument is
   `{material}` in `state.cancelled_batch`, a `select` whose option set is exactly
   `video|voiceover|sound_effect|other`, every branch a non-empty complete sentence. Brace counts
   balance, no brace leak. **No ICU plural exists in this slice**, so the fr CLDR category rule
   (`one`/`many`/`other`, never `few`) is vacuous here — noted so a later reader does not mistake
   its absence for an unchecked axis. No markup/Rich tags, backticks, commands, flags or machine
   identifiers to preserve. Four negative controls each failed as required (below).
2. **Accuracy — pass.** Promises intact and correctly separated: `cancel.queued` keeps the flat
   no-charge promise (« vous ne serez pas facturé », no hedge); `cancel.running` states the request
   and the *conditional* charge (« sera facturée si elle produit un audio ») with no guarantee that
   nothing is billed; `settlement.pending` states an outstanding charge and no amount and no zero
   (« les frais finaux apparaîtront dès que le fournisseur les aura communiqués »). No omission,
   addition or polarity change anywhere. The failure classes stay mutually distinguishable —
   `denied` (« Refusé ») vs `gate_failed` (« Échec du contrôle »); `unknown_tool` (« Outil inconnu »)
   vs `invalid_arguments` (« Arguments invalides »); labels verified unique as a set and each free of
   a full stop, as the label register requires.
3. **Idiom and register — pass.** *vous* throughout, lowercase mid-sentence; imperative for the one
   action (« Patientez un instant et réessayez », no « Veuillez »); terse past-participle statuses;
   sentence case; no Title Case; no specific wait time promised. « Arrêt demandé. » reads as a
   status, matching the shipped « demande d’arrêt » family.
4. **Terminology — pass with 1 NIT (F2).** Every term checked against the shipped fr catalogue:
   fournisseur ✅ (`control.stop_hint_queued`, `sound.stop.warning`), `endpoint` kept Latin and
   inflected (« d’aucun endpoint d’annulation ») ✅, facturer ✅, « frais finaux » ✅
   (`sound.cost.estimated_zero`), arrêt/arrêté rather than annulation for the stop ✅ while keeping
   the shipped « endpoint d’annulation » ✅, `ID` uppercase ✅ (`ui.agents.settings.general.id`),
   `audio` Latin ✅, outil per glossary §2 ✅, « Refusé » ✅ (`ui.teamBridge.invitations.declined`).
   The four material nouns are byte-identical to the shipped `done_batch`/`failed_batch` branch nouns
   (« Lot de vidéos », « Lot de voix off », « Lot d’effets sonores », « Lot d’images ») — verified per
   noun, not assumed. Only `règlement` is new (F2).
5. **Fit — pass.** The six failure-class labels are 6–19 cells against English 6–17
   (`gate_failed` is the only one materially longer: 17 vs 11; `invalid_arguments` 19 vs 17) — none
   near a wrap at label width. The wrapping sentences sit inside the card with no cell budget:
   `cancel.running` 138/125, `settlement.pending` 97/79, `error.audio_rate_limited` 88/64,
   `cancel.queued` 65/64, `cancel.checking` 26/24. The four `cancelled_batch` branches measure
   21/23/28/20 cells against English 20/24/27/20 — no branch overflows. No wide glyphs, no combining
   marks (all values NFC-stable; verified).
6. **RTL — n/a.** `fr` is LTR; no bidi hazard, no digits policy, no mirrored glyph question.

## Per-key judgement (all 12)

| key (`ui.chat.canonical.image_gen.…`) | fr | verdict |
|---|---|---|
| `state.cancelled_batch` | « Lot de vidéos arrêté. / Lot de voix off arrêté. / Lot d’effets sonores arrêté. / Lot d’images arrêté. » | ok — complete sentence per branch, masculine agreement on *lot* correct, same family and same nouns as `failed_batch`/`done_batch` |
| `cancel.queued` | « Arrêtée avant l’appel au fournisseur ; vous ne serez pas facturé. » | ok — promise kept flat; U+202F before `;` present; feminine participle has an exact shipped precedent (`transcript.stopped_before_finishing` « Arrêtée avant la fin », subject *la génération*) |
| `cancel.running` | « Arrêt demandé. Le fournisseur ne dispose d’aucun endpoint d’annulation ; la génération continue et sera facturée si elle produit un audio. » | ok — the two factual clauses are the shipped `sound.stop.warning` sentences verbatim (diffed char by char: only the join changes, `.` → U+202F`;` and « La » → « la »), and the guarantee clause the shipped string adds is correctly *absent* here |
| `cancel.checking` | « Vérification du règlement. » | ok — three words, complete sentence, own full stop, joins correctly after `cancel.running`; term is F2 |
| `settlement.pending` | « Règlement en attente — les frais finaux apparaîtront dès que le fournisseur les aura communiqués. » | ok — no amount, no zero; em dash is U+2014 with plain spaces (0x20/0x2014/0x20 measured), which is the corpus's own punctuation (265 occurrences across the fr catalogues); term is F2 |
| `error.audio_rate_limited` | « La génération audio est très sollicitée en ce moment. Patientez un instant et réessayez. » | ok — two short sentences, calm, actionable, no promise the retry succeeds, no specific wait time |
| `error_class.audio_rate_limited` | « Débit audio limité » | ok with F1 (word-order ambiguity vs *bitrate*) |
| `error_class.unknown_tool` | « Outil inconnu » | ok |
| `error_class.invalid_arguments` | « Arguments invalides » | ok |
| `error_class.duplicate_id` | « ID en double » | ok — `ID` is the shipped form |
| `error_class.denied` | « Refusé » | ok — unmarked masculine, as shipped |
| `error_class.gate_failed` | « Échec du contrôle » | ok — `gate` is not on the fr kept-English list so translating is right; « contrôle » has corpus support (`ui.updates.panel.seal.startup.message` « son contrôle d’intégrité ») and stays distinct from « Refusé » |

## Checked and deliberately not flagged (so the next reader does not re-litigate)

- **English left:** every value compared to English byte-wise — none identical (`[]`), and the only
  Latin tokens are `endpoint`, `ID`, `audio`, all three already shipped in fr on this surface.
  « un audio » is the shipped `sound.stop.warning` wording; changing it here would split the corpus.
- **Typography:** two `;` in the whole slice, both preceded by U+202F (0x202f measured per key); zero
  ASCII apostrophes, zero `...`, all values NFC-stable; no `?`/`!`/`:` occur in this slice, so no
  other French-spacing case arises.
- **`cancel.queued` agreement:** the manager flagged the feminine participle against
  `cancelled_batch`'s masculine « Lot … arrêté ». Both are correct for their own subject — *la
  génération* (feminine) vs *le lot* (masculine) — and the feminine form is not invented: it is the
  shipped `transcript.stopped_before_finishing` construction. Not a finding.
- **`cancelled_batch` family shape:** « Lot de vidéos arrêté. » vs `failed_batch` « Échec du lot de
  vidéos. » — a third nominal shape, but each reads as a complete, terse state line and the nouns are
  the shipped ones; « Arrêt du lot de vidéos. » would be more parallel and is a taste call, not a
  defect. Not a finding.
- **`gate_failed` length:** +6 cells over English is the slice's largest label growth; at 17 cells it
  is far from wrapping, so it is not a fit finding.

## Mechanical evidence (actual commands, actual output — full transcript in `audit.log`)

`node checker.mjs` (this session's, sha256 `22f3ee2a…aff7f1d`, ICU parser from
`/Users/damian/local-operator-ui/node_modules`) reading the draft on **stdin** — the sibling
session's path is never handed to node, which also lets the negative controls mutate in memory:

```
MECHANICAL PASS: 0 failure(s)
info  keys: 12 draft / 12 en slice
```

Negative controls, each piped through the same checker (all four must fail; all four did):

| control | injected mutation | result |
|---|---|---|
| drop a select branch | removed `other {…}` from `state.cancelled_batch` | `ICU parse … MISSING_OTHER_CLAUSE` → FAIL (exit 1) |
| rename placeholder | `{material` → `{media` | `STRUCTURE … en: select:material:{other\|sound_effect\|video\|voiceover}` / `fr: select:media:{…}` → FAIL |
| ASCII space + straight apostrophe | `\u202f;` → ` ;`, U+2019 → `'` in `cancel.queued` | `TYPO … ';' preceded by " "` + `straight apostrophe U+0027` → FAIL (2) |
| English left in | `error_class.unknown_tool` → `Unknown tool` | `ENGLISH … byte-identical to English` → FAIL |

## Ledger — not recorded, and why

`node scripts/i18n/ledger-assemble.mjs` is the writer, and it refuses the current bytes **by
construction**: it requires the receipt to name the target bytes on disk and refuses *a locale file
whose key set differs from English* (`scripts/i18n/ledger-assemble.mjs:35`). Measured read-only:
English has **479** keys, the shipped fr catalogue **467**, the difference is **exactly the 12 S16e
keys**, 0 extra. So no honest row can be assembled for a draft that is not yet in the catalogue.

- **If you land the 12 keys**, run (from the PR worktree, with this receipt copied to
  `i18n/receipts/s16e-au-fr-2.json`):
  `node scripts/i18n/ledger-assemble.mjs --locale fr --namespace ui.chat.canonical --file src/i18n/catalogues/fr/ui.chat.canonical.json --auditor-instance s16e-au-fr-2 --auditor-model deepseek/deepseek-flash --result clean-with-findings --receipt <receipt.json>`
- The existing `fr/ui.chat.canonical` row is **stale for this slice**: it carries
  `source_sha256 905fb4d8…` while the English on disk is `b967adc3…`, so the row needs the re-audit
  this receipt backs, derived from the landed target bytes rather than from this draft hash.
- **Retention:** artifacts are held in this auditor's scratchpad by instruction (≈444 MB free on
  this machine; no repo writes, no tree copies, no builds). The tracked home once the block lands is
  `i18n/audits/evidence/fr/ui.chat.canonical/s16e-au-fr-2/{record.json,audit.log,receipt.json}`.
  `i18n/audits/evidence/README.md` does **not** exist in this worktree, so the contract the task
  names is not present to copy; this receipt carries the fields that contract requires.
- Translator notes (`notes-fr-s16e.md`) were read **after** my own per-key view and the mechanical
  pass were formed. They agree with my reading on every substantive point; I verified their cited
  precedents myself rather than taking them on trust (see the greps in `audit.log`), and two of their
  own open questions are exactly F1 and F2 above.
