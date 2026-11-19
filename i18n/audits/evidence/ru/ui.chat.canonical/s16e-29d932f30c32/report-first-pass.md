# S16e — ru (`ui.chat.canonical`) independent audit

- **Audit ID:** `s16e-ru-20261112`
- **Slice:** S16e-renderer, PR damianvtran/local-operator-ui #1884
- **Namespace:** `ui.chat.canonical` — 12 keys of the generation card's stop / settlement / failure-class copy
- **Locale:** ru
- **Verdict:** **passed** — 0 BLOCKER, 0 MAJOR, 0 MINOR, 2 NIT
- **Audited draft:** `draft-ru-s16e.json`, sha256 `ccc4674d071cc725e48f54c2becd2ac38eaa9004dbcdde8890ecaeedcf9c6060`
  (verified against the manager manifest before use; byte-identical copy in this bundle)
- **Auditor:** `i18n-auditor`, session `17d1e8b0f671`, model `deepseek/deepseek-flash` (session-configured model, no fallback observed)
- **Independence:** separate session from the translator; authored none of the 12 values; made no edit, commit, install or build in any repository. Judgement is my own reasoning; no MT service, back-translation or translation API was used.

## Inputs (hashes verified by me, in `audit.log`)

| Role | Path (repo-relative) | sha256 |
|---|---|---|
| English source | `src/i18n/catalogues/en/ui.chat.canonical.json` (worktree `i18n-s16e` @ `bd8e9054`) | `b967adc33296c5ef0264a8a3ffd698fdfc5a50e4a3ebc8de99114a599b837e17` |
| English context sidecar | `src/i18n/catalogues/en/ui.chat.canonical.context.json` | `ec598772089552ace910c857a38b364bdfa83a32c76c62b752b761527531e7b7` |
| Shipped ru catalogue (terminology authority) | `src/i18n/catalogues/ru/ui.chat.canonical.json` | `fddef0897968450fb0157457dda37f7472fa467b4df1aea68af16bbe260f10f1` |
| Core glossary | `~/local-operator/i18n/glossary.md` | `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8` |
| ru style guide | `~/local-operator/i18n/style-guides/ru.md` | `f20e1cafaf70578c17ce072c71725628808d228e4be5604329f8da30386f1fb5` |
| Brief (en + context sidecar as delivered) | manager scratchpad `s16e-brief.json` | `a0326137bff43ed38fc4a1c63d4a26e1887cfd56d4826df0e615df28055bef0c` |
| Audited draft | manager scratchpad `s16e/ru/draft-ru-s16e.json` | `ccc4674d071cc725e48f54c2becd2ac38eaa9004dbcdde8890ecaeedcf9c6060` |

Call sites read (read-only): `src/renderer/src/features/chat/canonical/image-gen-card.tsx` (composition at `runningStopSentence`/`keyedStopSentence`, label render at the `text-meta` `<p>`, `cancelled_batch` at the batch branch of the `cancelled` case), `image-gen-card-model.ts`, `scripts/image-gen-card.test.mjs`.

## Answer to the requested check: case / gender in every `state.cancelled_batch` branch

The head noun is «Набор» in all four branches: masculine, singular, nominative. The short passive participle therefore takes **«остановлен»** in every branch, and the material noun sits in the **genitive governed by «набор»**, never in the nominative — so no branch can flip the participle's gender.

| Branch | Value | Analysis |
|---|---|---|
| `video` | Набор видео остановлен. | «видео» = gen. sg., indeclinable; participle agrees with «набор» ✓ |
| `voiceover` | Набор озвучек остановлен. | «озвучек» = gen. pl. ✓ |
| `sound_effect` | Набор звуковых эффектов остановлен. | gen. pl. ✓ (+ appropriate adjective agreement inside the genitive phrase) |
| `other` | Набор изображений остановлен. | gen. pl. ✓ |

Each branch is a complete sentence with a full stop, sentence case, and the noun phrases are **byte-identical** to the shipped `state.done_batch` and `state.failed_batch` values in the ru catalogue, so the line reads as the same family as the failed/queued lines it sits beside. No agreement, case or word-order finding.

## Findings

| ID | Sev | Key | Current | Problem | Suggested |
|---|---|---|---|---|---|
| N1 | NIT | `ui.chat.canonical.image_gen.error.audio_rate_limited` | `Генерация аудио сейчас перегружена. Подождите немного и повторите попытку.` | Grammatically correct and faithful; the slight friction is that the *process* («генерация») is said to be overloaded rather than the service behind it. Meaning, register and the "no promise / no wait time" constraints all hold. | `Сервис генерации аудио сейчас перегружен. Подождите немного и повторите попытку.` (only if the copy owner wants the subject to be the service) |
| N2 | NIT | `ui.chat.canonical.image_gen.error_class.audio_rate_limited` | `Лимит аудио` | A bare noun phrase names the quota rather than the exceeded state that the English label reports ("rate limited"). It is anchored by the sentence below and collides with nothing in the shipped catalogue (checked: 0 collisions), so it works as a class label. | `Превышен лимит аудио` (19 chars; sibling labels run to 22 — `Неизвестный инструмент`) |

Neither NIT gates: both are wording preferences on strings that read correctly, and both are non-blocking under the review-economy rule.

## Per-axis results

1. **Mechanical — PASS.** All 12 values parse with the repo's own `@formatjs/icu-messageformat-parser` 3.5.21 (required read-only from `~/local-operator-ui/node_modules`); argument name and kind are identical to English for every key (`select:material` only, in `state.cancelled_batch`); the select keyword set `video` / `voiceover` / `sound_effect` / `other` matches the English set exactly (no extra, none missing); no markup/Rich tags, no backtick spans, no `#`; brace counts balanced; no double spaces; valid JSON, 12/12 keys, none added or dropped. **No plural in this slice** (the only ICU structure is one `select`), so CLDR ru plural categories are not applicable here — the surface's plural strings (`state.running_batch`, `batch_summary`) are outside S16e and already ship `one`/`few`/`many`/`other`.
   **Negative controls (4/4 fail as designed, so the PASS is not vacuous):** dropping the `other` branch → `MISSING_OTHER_CLAUSE` FAIL; renaming `{material}` → `{mat}` → placeholder-signature FAIL; adding an `audio` branch → extra-keyword FAIL; dropping a closing brace → `EXPECT_ARGUMENT_CLOSING_BRACE` FAIL. Real transcript in `audit.log`.
2. **Accuracy — PASS.** The facts the English promises or withholds survive: `cancel.queued` keeps the *only* no-charge promise («плата не взимается», impersonal present, firm, no hedging); `cancel.running` promises nothing — it states the stop was *requested*, that the provider has no cancellation endpoint, that the generation continues, and that a charge arises **if** it produces audio («если она создаст аудио» — conditional, not asserted); `cancel.checking` is a bare status sentence with no claim; `settlement.pending` states no amount and no zero, and its negation («ещё не завершён») scopes to the settlement, not to the existence of the charge. The six failure classes remain mutually distinguishable: `denied` «Запрещено» (permissions) vs `gate_failed` «Проверка не пройдена» (policy gate); `unknown_tool` «Неизвестный инструмент» vs `invalid_arguments` «Неверные аргументы». No omission, addition, negation or polarity error; no unsafe wording on a destructive/permission/error string.
3. **Idiom and register — PASS (N1).** Impersonal constructions where Russian prefers them («Остановлено до обращения к провайдеру», «Запрошена остановка»), `вы`-imperative only where the English commands («Подождите немного и повторите попытку»), no «Пожалуйста» padding, no «!», sentence case throughout, labels without full stops and every sentence key with one. Punctuation per the ru guide: no space before `;` (unlike fr), spaced em dash in `settlement.pending`, «ёлочки» not needed, `…` not needed, no NBSP/NNBS or other invisible characters present (codepoint scan: none). No Title Case.
4. **Terminology — PASS.** Verified against the shipped ru catalogue rather than assumed: «набор» + genitive material (byte-identical to `state.done_batch` / `state.failed_batch`); the stopped/cancelled family «остановлен/остановлено» matches `sound.batch.item_status` (`cancelled` → «Остановлено»), `transcript.stopped_before_finishing`, `notice.stopped_with_error`; «провайдер» everywhere; `endpoint` Latin, undeclined, exactly as shipped `sound.stop.warning` does; «плата» / «итоговая плата» / «взимается» match `sound.cost.no_charge` and `sound.cost.estimated_zero`; «Запрещено» matches the shipped ru browser-approval wording for a denied approval; «инструмент» per glossary §2. `cancel.running`'s second and third clauses are deliberately near-verbatim from the shipped `sound.stop.warning`, which is the correct call — the same billing fact must not get two wordings in one product, and the two never render in the same place (`sound.stop.warning` is only in the stop-confirmation dialog, `sound-stop-confirmation.tsx`).
   *On Latin `ID` (`error_class.duplicate_id`):* I first suspected a style-guide violation, because the shipped `ui.chat.canonical` ru catalogue has no uppercase `ID` in its 467 values. Checked wider and **retract it**: uppercase Latin `ID` occurs **28 times across 14 shipped ru catalogues** (`ui.agents.settings` `ID`, `ui.common.errors` «…по ID», «ID сессии», `ui.schedules` «ID расписания: {id}»). It is an established ru locale habit, not an English leak — no finding.
   «Расчёт» (settlement) has no shipped precedent in this namespace; it is used consistently in both keys that need it (`cancel.checking`, `settlement.pending`) and pairs with «плата» without collapsing the two concepts. That is a *glossary gap*, not a translator violation — it should be recorded (see below) so the next wave reuses it.
5. **Fit — PASS.** These 12 keys carry no `maxCells`/`maxChars` hint in the English sidecar (length is prose only: "two to four words", "one long sentence"), and the failure-class label renders in a wrapping block `<p className="text-meta text-ink-dim">` (`image-gen-card.tsx`, label block above `StateLine`), so labels wrap rather than truncate. Widest label: «Неизвестный инструмент» 22 chars vs en 12; next «Проверка не пройдена» 20 vs 11. Longest value: `state.cancelled_batch` 178 chars (four branches; each branch 22–38). No ru-specific width regression that changes state: every string stays within its stated length budget or wraps.
6. **RTL — not applicable** (ru is LTR); no bidi controls, no mirrored-glyph hazards.

## Notes for the manager / next wave

- Zero BLOCKER/MAJOR: no re-round needed for this locale on my account. The two NITs may be folded into a later wave or deferred — they survive a pass unchanged.
- Glossary gaps worth recording (evidence-backed, from the shipped catalogue, so a future wave cannot re-litigate them): **charge** = «плата» / «взимается плата» (de-facto in `sound.cost.*`, absent from the glossary table); **settlement** = «расчёт»; **final charge** = «итоговая плата»; **batch of media** = «набор» + genitive; **provider** = «провайдер». These are proposals, not findings.
- The translator's notes were read only **after** I had formed my own reading of all 12 keys, as the brief requires; my two NITs are independent of their reasoning (their note on `audio_rate_limited` argues the opposite for «перегружена», and I still prefer recording the subject-of-sentence nuance as a NIT rather than silence).
- Not run, deliberately: `pnpm check-i18n` / the generator, and the electron/UI test suite. The worktree has no installed dependency tree and is read-only for this run; the runtime parser above is the same module the shipped `t()` path uses, and catalogue-level checks remain the coder's/CI's step. This is an audit of copy bytes, not a rendered-frame claim.
- Landing: the bundle here is scratch-side. The canonical tracked home is `i18n/audits/evidence/ru/ui.chat.canonical/s16e-ru-20261112/` (core repo `~/local-operator`), with the ledger row pointing at `record.json`. I made no edit or commit in either repo, by instruction.
