# Russian L1 remediation — v2

- Date: 2026-11-11. Translator: `i18n-translator`, session `f220dd25f9cf`, actual served model `openai/gpt-6.1-sol` (runtime header; no fallback). No MT used.
- Scope: the 182 entries in `keys.json`, in source order. Output: `ru.v2.json`. **16 changed keys / 8 complete settled-running pairs.** Findings: **12 fixed, 6 declined, 1 deferred** (19 total across A and B). Both A MAJOR findings fixed; no BLOCKER reported by either input audit.
- Input reports: `audit-ru-A.md` (deepseek/deepseek-flash), `audit-ru-B.md` (anthropic/claude-sonnet-5-5). B has numbered lists rather than IDs; `B-m1` etc. below identify those list items. A IDs retain its case-sensitive M/m/n distinction.
- This is translation remediation, NOT an independent audit or a `passed` ledger entry. A different auditor must re-check the delta. No shipped catalogue, ledger, style guide, or glossary was modified.

## Finding dispositions

Key stems below mean `ui.chat.canonical.tool_row.verb.<stem>.{settled,running}`. Both forms are shown; semicolon separates settled and running.

| Finding | Disposition | Key, old → new / evidence and reason |
|---|---|---|
| A-M1 | fixed | `peeked_at_session`: Прочитал вывод сессии → Заглянул в сессию; Читает вывод сессии → Заглядывает в сессию. `context.role` says `sessions peek`, not console output. Same peek verb as sibling `peeked_at`; session name/id follows. |
| A-M2 | fixed | `previewed_rename`: Просмотрел план переименования → Просмотрел переименование; Просматривает план переименования → Просматривает переименование. Role is `lsp rename_preview`: proposed rename remains clear without adding «план». Length drops 30/33 → 25/28 characters. The guide's 20–30% expansion is an expectation, not a universal hard per-string cap; shortening is accepted for the real non-truncating verb-column constraint. |
| A-m1 | fixed | `sent_keys`: Отправил нажатия клавиш → Отправил клавиши; Отправляет нажатия клавиш → Отправляет клавиши. Shorter before the following key specification; retains send rather than execute/press. |
| A-m2 | fixed | `searched`: Выполнил поиск → Искал; Выполняет поиск → Ищет. Matches `searched_agents` and `searched_the_web`, retaining grep's search semantics. The audit's stated old lengths 22/23 are inaccurate: Python counts 13/14; this does not change the accepted brevity/consistency improvement. |
| A-m3 | fixed | `steered`: Перенаправил → Скорректировал; Перенаправляет → Корректирует. Role is `hub steer`: live direction, not forwarding a message. Object remains the subagent/turn being corrected. |
| A-m4 | deferred | Keep `raised_panic` unchanged: Включил аварийную блокировку / Включает аварийную блокировку. Glossary proposal recorded below. Adding the glossary/style-guide row is outside this explicitly two-file remediation assignment; coordinator can carry the proposal into the shared glossary change. Do not claim the term-recording request is already landed. |
| A-n1 | fixed | `ran_python`: Выполнил в Python → Выполнил Python-код; Выполняет в Python → Выполняет Python-код. The following code snippet now has an explicit object; official technology token `Python` is preserved. |
| A-n2 | declined | Keep `captured_console`: Сделал снимок консоли / Делает снимок консоли. The supplied `keys.json` role explicitly names the `console` tool's **`screenshot`** operation, not text capture. Therefore the report's assertion that it captures only console text does not apply to this key. «снимок» is already shipped, e.g. `ui.chat.pickers.info_panel.git_snapshot`. |
| A-n3 | declined | Keep `listed_network_peers`: Получил список пиров сети / Получает список пиров сети. Auditor explicitly says no term substitution without changing shipped mesh wording. ru.md lines 88–90 say keep «пиры» for peers; replacing it with «узлы» would violate that decision. |
| B-m1 | fixed | Same `peeked_at_session` pair as A-M1: Прочитал вывод сессии → Заглянул в сессию; Читает вывод сессии → Заглядывает в сессию. |
| B-m2 | fixed | `spawned_session`: Создал сессию → Запустил сессию; Создаёт сессию → Запускает сессию. `sessions spawn` launches a run, not just a stored record. Shipped `ui.projects` uses session-start vocabulary (the_session_could_not_be_started). |
| B-m3 | declined | Keep «пиров сети», not «устройств сети». The claim that «пиры» is unrecorded is contradicted by ru.md lines 88–90: «keep “пиры” for peers». A sweep of shipped ru namespaces finds one `пир*` value: `ui.mesh.mesh_list.answered_the_peer_read_but_is_in` («о пире»). Devices are separately established (95 values matching `устройств`); frequency does not override the explicit peer/device distinction. |
| B-m4 | fixed | `described_secret`: Описал секрет → Прочитал описание секрета; Описывает секрет → Читает описание секрета. Actual source `local_operator/tools/secret_tool.py` has a read-only `describe` branch and says `describe` returns the full description (lines 319–323); read verb removes implied metadata mutation. |
| B-m5 | fixed | Same `ran_python` pair as A-n1: Выполнил в Python → Выполнил Python-код; Выполняет в Python → Выполняет Python-код. |
| B-m6 | declined | Keep `fetched`: Загрузил / Загружает. «загрузить» is not upload-only in this shipped product or in Russian. Independent sweep: 16 shipped rows with `fetch` in their key and a loading/retrieval term, 31 with `download`, 13 with `upload`. Concrete fetch precedents: `ui.code_review.code_review_model.couldn_t_fetch_this_pass_will_retry` = «Не удалось загрузить в этот раз — будет повтор.» and `ui.code_review.code_review_row.fetching_current_state` = «Загрузка текущего состояния…». URL object disambiguates retrieval. «Запросил» would weaken completed retrieval to request issuance; «Получил страницу» would wrongly assume every fetched resource is a page. |
| B-n1 | fixed | Same `searched` pair as A-m2: Выполнил поиск → Искал; Выполняет поиск → Ищет. |
| B-n2 | fixed | Same `previewed_rename` pair as A-M2: Просмотрел план переименования → Просмотрел переименование; Просматривает план переименования → Просматривает переименование. |
| B-n3 | declined | Keep `listed`: Получил список / Получает список. Role explicitly identifies `glob`; verb-before-pattern remains valid. «Нашёл файлы» would replace the source's listing operation with finding and narrow glob's file/directory result type. Auditor calls current wording acceptable. |
| B-n4 | declined | No register rewrite. This is an explicit no-action observation, not a systemic defect: shipped bridge rows use active masculine past / third-person present (`channel_history`: Прочитал / Читает; `channels`: Получил список разговоров / Получает список разговоров). Both audits endorse matching that column. ru.md's impersonal preference applies where English allows; infinitives are action-label guidance, not completed transcript narration. Keep all 91 pairs in the existing bridge register rather than change a subset to passive fallback forms. |

## Consistency and width

Read ru.md, en.md, glossary.md; core AGENTS i18n section, docs/I18N.md and RFC catalogue/audit contract; UI AGENTS general guidance; source role/notes for all 91 pairs; shipped ru catalogue bridge verbs and targeted terminology across namespaces.

Unchanged terminology: консоль, пробуждение, секрет, обновление, задание (job), задача (todo), этап, переменная, пир. Pair register stays consistent across all 182 values. Existing trailing-preposition pairs (`Заглянул в`, `Привязал сессию к`, `Отвязал сессию от`) are unchanged.

No word-budget outlier: maximum **4 words**, only `listed_network_peers` (both states). No five-word justification needed. Longest values after remediation: `raised_panic.running` **29** characters, `raised_panic.settled` **28**, `previewed_rename.running` **28**. The panic pair retains its explicit safety meaning; no numeric maxCells is supplied for these keys. These are source-string measurements, not rendered-font geometry or screenshot evidence.

Ambiguities resolved: `describe` is metadata reading, `spawn` is launch, console capture key's authoritative role is `screenshot`, peers are not renamed devices, and fetch is retrieval rather than merely issuing a request. `rename_preview` keeps viewing rather than applying a rename.

## Glossary proposals

- `panic` (network incident action) → «аварийная блокировка». Retain clear network-safety meaning; tool/operation identifier `panic` stays Latin when used as an identifier. Proposed only; no shared glossary edit in this assignment.
- `steer` (live agent/turn guidance) → «скорректировать» / «корректировать», distinct from message forwarding. Proposed action terminology, not renaming the identifier `steer`.

## Validation actually run

1. Python validation in the session and then **`python3`** loading `keys.json`, `ru.json`, `ru.v2.json`:
   `python3: PASS — 182 keys, same source key order, 16 changed keys, 91 pairs, no empty/English-identical/bidi-control values, maximum 4 words`.
   The session check additionally verified Latin appears only in `Python`, every value is a string, no Unicode `Cf` format controls, and JSON readback equals the written mapping.
2. `pnpm check-i18n:catalogues`, from `~/local-operator-ui/.worktrees/i18n-l1-tool-verbs`, **exit 1**:
   - generate --check: `src/i18n/keys.gen.ts is byte-identical to a fresh generation`.
   - `check-duplicates: ok — 1428 file(s) scanned, 0 duplicate key(s)`.
   - `check-strings.mjs: ok — 1660 file(s) scanned, 0 literal(s) at or below the baseline; 40 literal(s) in the data shapes, all listed in i18n/literal-allowance.json (shrink-only)`.
   - `ledger-check: FAILED — 24 finding(s) across 1106 ledger entr(ies)`: all seven target locales lack the 182 new tool-row keys in their assembled `ui.chat.canonical` catalogue; source hashes/receipts remain pre-L1. For ru specifically, missing 182 keys and stale source/receipt. Independently reloaded the shipped ru mapping and confirmed **182/182 staging keys absent**, explaining why validating the prep file cannot make the assembly ledger green. No bypass, catalogue injection or self-audit attempted.
3. Because the chain stopped at ledger-check, ran `node scripts/i18n/context-parity.mjs` separately, **exit 0**:
   `context-parity: ok — every English key is covered, apart from 129 allowed gap(s) in 4 namespace(s) (shrink-only; see i18n/context-allowance.json).`

The mechanical staging check passes; the **repository catalogue gate is not green**, pending coordinator assembly and independent audit receipts. This report is a record of translation and actual validation results, not an execution log for an independent audit.

Output SHA-256 (`ru.v2.json`): `0e9c3046b9932ca4cc2921ed6442be9a0cf0d155e3fdc1ac9665a9300486a3e2`.
