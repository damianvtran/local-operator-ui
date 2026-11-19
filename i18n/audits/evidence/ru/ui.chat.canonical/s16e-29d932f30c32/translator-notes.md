# S16e — ru (Russian) translation notes

Slice: S16e-renderer, 12 keys of the generation card's stop / settlement / failure-class copy,
namespace `ui.chat.canonical`. English source and context sidecars are the brief
(`s16e-brief.json`, sha256 `a0326137bff43ed38fc4a1c63d4a26e1887cfd56d4826df0e615df28055bef0c`,
verified). Repo worktree read only: `~/local-operator-ui/.worktrees/i18n-s16e` @
`bd8e90542506e8bec4a98862b868095409b28329` (PR damianvtran/local-operator-ui #1884). Nothing in
the worktree was edited, installed into, checked out or committed.

## Sources read (file + sha256)

| Role | Path | sha256 |
|---|---|---|
| Locale style guide (binding) | `~/local-operator/i18n/style-guides/ru.md` | `f20e1cafaf70578c17ce072c71725628808d228e4be5604329f8da30386f1fb5` |
| Shared glossary | `~/local-operator/i18n/glossary.md` | `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8` |
| Programme contract (RFC §2.2, §6) | `~/local-operator/docs/design/i18n.md` | `92eca5a123b65c4dea7e7ec2db9ddd4fec0b04c0fa038d10ba540e30f0d7e096` |
| UI HOWTO (catalogue layout, `t()`/ICU rules) | `docs/I18N.md` (worktree) | `d58ad473701f098b3c2c24343c3a7e7236f22db22cc871016c4cb75f25f41f5c` |
| English source | `src/i18n/catalogues/en/ui.chat.canonical.json` | `b967adc33296c5ef0264a8a3ffd698fdfc5a50e4a3ebc8de99114a599b837e17` |
| English context sidecar | `src/i18n/catalogues/en/ui.chat.canonical.context.json` | `ec598772089552ace910c857a38b364bdfa83a32c76c62b752b761527531e7b7` |
| Existing ru catalogue (same surface) | `src/i18n/catalogues/ru/ui.chat.canonical.json` | `fddef0897968450fb0157457dda37f7472fa467b4df1aea68af16bbe260f10f1` |

`docs/design/i18n.md` does not exist in the UI repo — the UI HOWTO links the core one, which is
what I read. No ru glossary/style guide was missing: both exist in the core repo and are the ones
the UI HOWTO's contract points at.

## Register

- `вы`, but almost every string here is impersonal ("Запрошена остановка", "Остановлено до
  обращения к провайдеру") per the ru guide's preference for impersonal constructions; no "вы"/
  "ваш" is needed in any of the 12 values.
- Sentence case, no "!" (?), no politeness padding, full stops exactly where English has them:
  the five state/settlement/error sentences carry a full stop, `cancel.checking` carries its own
  full stop (it is appended as its own sentence), and the six `error_class.*` labels carry none.
- Terse; no added facts (no wait time, no "the next attempt will work", no amount).

## Terminology, with existing-catalogue evidence

All line numbers are in `src/i18n/catalogues/ru/ui.chat.canonical.json` unless another file is named.

| Concept | ru choice | Evidence |
|---|---|---|
| batch of media results | **набор** + genitive material | `:450` `image_gen.state.done_batch` — «Набор видео», «Набор озвучек», «Набор звуковых эффектов», «Набор изображений»; `:453` `state.failed_batch` — «Не удалось создать набор видео.» |
| material nouns | видео (indeclinable) · озвучка · звуковой эффект · изображение | `:447` `state.running`, `:449` `state.done`, `:451` `state.failed` (same four-branch select, same nouns) |
| stopped / cancelled | **остановлено / остановлен** | `:461` `sound.batch.item_status` (`cancelled` → «Остановлено»), `:40` `transcript.stopped_before_finishing` («Остановлено до завершения»), `:434` `notice.stopped_with_error` |
| provider | **провайдер** | `:16` `sound.stop.warning`, `:29` `transcript.connect_provider`, `:170`/`:171` `control.stop_hint_*` |
| cancellation endpoint | **endpoint** kept Latin, undeclined | `:16` `sound.stop.warning` — «У провайдера нет endpoint для отмены.» |
| the charge | **плата** (noun), verb pattern «взимается плата» | `:466` `sound.cost.no_charge` — «Плата не взималась.»; `:465` `sound.cost.estimated_zero` — «итоговая плата не подтверждена»; `ui.chat.pickers.json:218` — «взимается повышенная плата» |
| final charge | **итоговая плата** | `:465` `sound.cost.estimated_zero` |
| settlement (final accounting) | **расчёт** | no earlier ru row; chosen here, used in both `cancel.checking` and `settlement.pending` so the pair stays one concept (see proposals) |
| billed | **списано** (not used here) | `ui.chat.session_spend.json:3` `basis.billed` — «списано»; kept distinct from «плата» so the two never blur |
| denied (permission refused) | **Запрещено** | `ui.browser.json:2` and `:22` `…denied` — «Запрещено». Deliberately NOT «Отклонено», which ru uses for a reviewer's rejection (`ui.mesh.json:75`, `ui.canvas.json:187`) — this label is a permission decision, not a review outcome |
| id | **ID**, uppercase, Latin | `ui.agents.settings.json:47` — «ID»; `ui.common.errors.json:89` — «по ID»; `ui.schedules.json:51` — «ID расписания: {id}» |
| tool | **инструмент** | glossary §2 (инструмент); `ui.chat.pickers.json:61` «Инструменты» |
| invalid (of arguments) | **неверные** | label register; «недопустимые» was the alternative and is 5 cells longer (see width) |
| rate limit | **лимит** (+ subject in genitive) | `ui.chat.json:99` — «Вы исчерпали лимит запросов…»; `ui.chat.pickers.json:539` — «лимит не указан» |

Punctuation follows the ru guide: «ёлочки» for quotes (not needed here), spaced em dash, ellipsis
…, Latin digits. No string here contains a number, a date, a quote or a backtick span.

## Per-key judgement calls

1. **`state.cancelled_batch`** — all four branches are a whole sentence that names the material
   *inside* the branch (as the en sidecar demands): «Набор видео остановлен.», «Набор озвучек
   остановлен.», «Набор звуковых эффектов остановлен.», «Набор изображений остановлен.» The
   select keywords stay `video` / `voiceover` / `sound_effect` / `other`. Grammar: `набор` is
   masculine, so the short participle is `остановлен` in **every** branch — this is the case-agreement
   trap the brief warns about: the material noun sits in the genitive governed by `набор`
   (видео · озвучек · звуковых эффектов · изображений), never in the nominative, so the participle
   never has to agree with the material and no branch can flip gender. `набор` + genitive is the
   shipped form in `done_batch`/`failed_batch`, so the line reads as the same family as the failed
   line above it. Rejected: «Создание набора видео остановлено.» (5 words, 36 cells — breaks the
   2–4-word budget) and «Остановлен набор видео.» (marked word order for a state line).
2. **`cancel.queued`** — «Остановлено до обращения к провайдеру; плата не взимается.» Reuses
   `stop_hint_queued`'s «до обращения к провайдеру» (`:170`) and the catalogue's own
   «плата не взимается» verb pattern (`:466` keeps the past form «Плата не взималась.»). Firm
   promise, no hedging; semicolon kept so the two-clause shape survives. «с вас не спишут плату»
   was rejected: the ru guide prefers impersonal and the source has no "you".
3. **`cancel.running`** — «Запрошена остановка. У провайдера нет endpoint для отмены; генерация
   продолжится, и если она создаст аудио, за него будет взиматься плата.» The second and third
   clauses are lifted from the shipped `sound.stop.warning` (`:16`) almost verbatim, which is the
   point — the same fact must not get two wordings in one card. `endpoint` stays Latin and
   undeclined (glossary wave-2 kept-English set, and `:16` already does it). «Запрошена остановка»
   mirrors `sound.stop.request_stop` «Запросить остановку». No appended checking clause (the
   sidecar forbids it); it is the callsite's own next sentence.
4. **`cancel.checking`** — «Проверка расчёта.» A Russian nominative sentence is a complete
   sentence, so it keeps the full stop the sidecar requires, and it stays at two words. «Идёт
   проверка расчёта.» was the alternative (+2 words); «Проверяем расчёт.» was rejected for the
   first-person-plural voice the ru guide avoids.
5. **`settlement.pending`** — «Расчёт ещё не завершён — итоговая плата появится, как только
   провайдер сообщит о ней.» The em dash is the ru house punctuation (spaced, per the guide), so
   it is kept rather than replaced — the "if the em dash is not idiomatic" escape hatch does not
   apply to ru. «итоговая плата» is the existing term for the final charge (`:465`). No amount, no
   zero, no "$0" — the note's hard constraint. «сообщит о ней» (reports on it) rather than
   «сообщит её»: same fact, natural Russian word order at the end of a long sentence.
6. **`error.audio_rate_limited`** — «Генерация аудио сейчас перегружена. Подождите немного и
   повторите попытку.» Two short sentences, actionable, no promised success, no number. «перегружена»
   keeps the English's deliberate vagueness (it never says "quota"): «занята» does not collocate
   with «генерация» in Russian, and «недоступна» would overstate a temporary limit. «Повторите
   попытку» follows the shipped phrasing in `ui.chat.json:99`.
7. **`error_class.audio_rate_limited`** — «Лимит аудио» (11 cells vs en 18). Class-name style like
   the other labels; the sentence below supplies the audible subject. «Превышен лимит аудио»
   (+10 cells) and «Лимит на аудио» (+4) were the alternatives.
8. **`error_class.unknown_tool`** — «Неизвестный инструмент» (22 vs en 12). There is no shorter
   accurate noun phrase: инструмент is the glossary term and «неизвестный» is the only label-grade
   adjective. This is the one label that roughly doubles the English width, and it cannot be
   tightened without dropping the glossary term or inventing a calque.
9. **`error_class.invalid_arguments`** — «Неверные аргументы» (18 vs en 17). «Недопустимые
   аргументы» (23) is equally correct and was dropped for width; «аргументы» matches the shipped
   `pickers.json:206`/`:207` «Требуется аргумент» / «Принимает аргумент».
10. **`error_class.duplicate_id`** — «Повторяющийся ID» (16 vs en 12). Keeps `ID` Latin uppercase
    as the ru catalogue already does; «Дубликат ID» (11) is shorter but colloquial where the other
    five labels are neutral register.
11. **`error_class.denied`** — «Запрещено» (9 vs en 6), one word, the same word the ru browser
    approval surface uses for a denied approval (`ui.browser.json:2`). Not «Отклонено»: that is a
    reviewer rejection in ru, not a permissions decision.
12. **`error_class.gate_failed`** — «Проверка не пройдена» (20 vs en 11). ru has no settled noun
    for a policy gate; «гейт» and «шлюз» were rejected (the first is jargon, the second means a
    network gateway and would mislead). «Проверка не пройдена» states the class without inventing
    a term, and the gate's own reason sits below it as the sidecar says. This is the one string
    where I would expect a glossary decision (see proposals).

## Judged identical to English / kept English

None of the 12 values is identical to its English source. The only Latin text is
`endpoint` (in `cancel.running`) and `ID` (in `error_class.duplicate_id`) — both are technical
tokens the existing ru catalogue already leaves Latin in exactly this way (`:16` for `endpoint`,
`ui.agents.settings.json:47` for `ID`), so neither is an English leak.

## Structure and validation

- ICU checked by hand and then by the repository's own runtime modules: `intl-messageformat`
  12.1.3 (the module `src/i18n/messages.ts` constructs) and `@formatjs/icu-messageformat-parser`
  3.5.21, required read-only from the shared checkout's `node_modules` (the worktree has none),
  driven by one small script — `check-ru-s16e.mjs` — on the two JSON files in this scratchpad.
- Result: **12/12 parse** at locale `ru`; the parsed argument signature of every value is
  identical to its English source (same argument names, same kinds, `select` keywords
  `video` / `voiceover` / `sound_effect` / `other` in the same order, same literal/branch shape);
  `state.cancelled_batch` formats for all four materials:
  image → «Набор изображений остановлен.» · video → «Набор видео остановлен.» ·
  voiceover → «Набор озвучек остановлен.» · sound_effect → «Набор звуковых эффектов остановлен.»
- **Not run:** `pnpm check-i18n` / `node scripts/i18n/generate.mjs`. Those need the repo's
  installed dependency tree inside the worktree, which is absent, and the worktree is read-only
  for this run; the memory guard also rules out a full install just for a generator check. So the
  catalogue-level CLI check is CI's/coder's step, not claimed here. The runtime parse above is the
  substantive structure evidence: it is the same parser the shipped `t()` path uses.
- Draft is valid UTF-8 JSON, brief key order, tab-indented, trailing newline, NFC-verified per value.

## Glossary proposals (append to the glossary / ru guide)

1. **gate (policy gate)** → label register «проверка»; noun form, if a surface ever needs it,
   «проверка политики». Reject «гейт» (jargon) and «шлюз» (network gateway — actively misleading).
2. **settlement** → «расчёт» (the provider's final accounting), kept distinct from «плата» (the
   charge) and «списано» (billed). Used in `image_gen.cancel.checking` and
   `image_gen.settlement.pending`; a future surface must reuse it or change both.
3. **charge (noun)** → «плата»; verb pattern «взимается плата» / past «плата не взималась».
   Already de-facto settled in `ui.chat.canonical.sound.cost.*` but absent from the glossary table.
4. **batch (of generated media)** → «набор» + genitive. Already shipped in
   `image_gen.state.done_batch` / `failed_batch`; a glossary row would stop a future wave from
   trying «пакет» / «серия».
5. **final charge** → «итоговая плата» (from `sound.cost.estimated_zero`), so "settlement" and
   "final charge" never collapse into one word.
6. **rate limit (label register)** → «лимит» + subject in genitive («Лимит аудио»), sentence
   register keeps the shipped «лимит запросов».
7. **id** → «ID» uppercase Latin in ru (already the catalogue's habit), never «ид» and not
   «идентификатор» in a label slot — «идентификатор» stays for prose.

## Open questions for the manager / auditor

- `error_class.gate_failed`: if the product later exposes the gate as a first-class object, «проверка
  политики» should be recorded as the term before another surface keys it; until then this label
  is the only evidence.
- `error_class.unknown_tool` is the widest label (22 cells vs en 12) and is the only one that
  cannot be tightened without dropping a glossary term. If the renderer's label slot is narrower
  than ~24 cells it will wrap; the alternative «Инструмент не найден» (20) is 2 cells shorter but
  changes the class name from "unknown" to "not found".
- Nothing was committed: the worktree is read-only for this run, so the ru catalogue file edit and
  the ledger row (`status: translated`, never `passed`) are the coder's landing step, with
  `source_sha256` = `b967adc33296c5ef0264a8a3ffd698fdfc5a50e4a3ebc8de99114a599b837e17`.
