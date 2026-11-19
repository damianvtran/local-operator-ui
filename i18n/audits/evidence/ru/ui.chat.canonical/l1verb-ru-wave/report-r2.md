# Round-2 delta audit — ru, tool-row verbs (L1)

Auditor: i18n-auditor (independent of the translator), served model anthropic/claude-sonnet-5-5.
Input: ru.v2.json sha256 0e9c3046b9932ca4cc2921ed6442be9a0cf0d155e3fdc1ac9665a9300486a3e2 (182 keys).
**Verdict: clean-with-findings. Counts: blocker 0, major 0, minor 1, nit 2.**

## 1. Delta (python3 diff v1 vs v2: 16 keys = 8 pairs)
| stem | v1 → v2 | judgement |
|---|---|---|
| peeked_at_session | Прочитал/Читает вывод сессии → Заглянул/Заглядывает в сессию | OK. role = `sessions peek`; parallel to `peeked_at` («Заглянул в»); no neighbour contradiction. |
| previewed_rename | …план переименования → Просмотрел/Просматривает переименование | see m1 |
| sent_keys | …нажатия клавиш → Отправил/Отправляет клавиши | OK, shorter, `keys` op, send verb kept. |
| searched | Выполнил поиск → Искал/Ищет | OK; matches `searched_agents`, `searched_the_web`. |
| steered | Перенаправил → Скорректировал/Корректирует | acceptable; see n1 |
| ran_python | Выполнил в Python → Выполнил/Выполняет Python-код | OK. Only Latin token = official name Python. |
| described_secret | Описал секрет → Прочитал описание секрета / Читает описание секрета | OK; read-only describe, 25/24 chars, no mutation implied. |
| spawned_session | Создал → Запустил/Запускает сессию | OK; distinct from `resumed_session` (Возобновил) and `created_*`. |

## 2. Declined findings (counts re-run over shipped ru catalogue, 8872 string values)
- **A-n2 captured_console (keep «Сделал снимок консоли») — UPHELD.** keys.json role = console `screenshot`; «снимок» shipped (`info_panel.git_snapshot`, hub adoption). 
- **A-n3 / B-m3 «пиров сети» — UPHELD.** ru.md lines 88–90: «keep “пиры” for peers»; I count 1 shipped `\bпир` value (`ui.mesh.mesh_list…`, matches claim) and 95 `устройств` values (matches claim). Style guide decision outranks frequency.
- **B-m6 fetched «Загрузил/Загружает» — UPHELD, with a caveat on the evidence.** Claimed "16 rows with fetch key + loading/retrieval term" reproduces (16/17, via загруз|получ). But the split is 13 «получ» vs 3–4 «загруз», so precedent mostly favours «получить» (API-fetch errors); «загрузить» is used for fetch only in code_review/loading copy. Claimed 31 download / 13 upload do not reproduce (mine: 43 / 70 keys containing the word; value-level «загруз*»: 24 / 16, «скача*» 18 on download), i.e. «загрузить» is product-wide ambiguous between up/download. Still not defective: «Получил» is already taken by `received` and «Получил список…», and «Загрузил <URL>» reads as retrieval in a web-fetch row. No change required (see n2).
- **B-n3 listed «Получил список» — UPHELD.** glob/list op; verb+pattern reads fine.
- **B-n4 register — UPHELD.** Past masculine / present 3sg matches shipped bridge rows (95 existing tool_row values) and all 91 pairs are uniform.
- **A-m4 raised_panic — deferred, accepted.** «Включил аварийную блокировку» is clear and safe; 0 shipped «аварийн*» values so no conflict; glossary row pending is a coordinator item, not a blocker.

## 3. Mechanical (whole v2 file)
182 keys, set and order identical to keys.json; 182 distinct values (no duplicates); no empties/leading/trailing/double spaces/trailing punctuation; no placeholders in source or target; only Unicode categories Ll/Lu/Zs/Pd (no Cf/bidi); Latin only in «Python»; 91 settled/running pairs parallel (same verb, past m. ↔ present 3sg); no concept named two ways (peek=Заглянул, search=Искал/Ищет, session verbs launch/resume/stop distinct).

## 4. Width
max 29 chars (`raised_panic.running`), max 4 words (`listed_network_peers`); nothing beyond 5 words/32 cells. Cyrillic is single-cell; no wide glyphs. Measured as string length, not rendered.

## Findings
- **m1 MINOR** `previewed_rename` «Просмотрел переименование»: dropping «план» leaves the verb identical to `viewed_*`/`browsed` («Просмотрел»), losing the preview/dry-run nuance (could read as viewing an existing rename). Optional: «Проверил переименование» (also used by checked_*, so weaker) or keep «Просмотрел план переименования» (30/33 chars, still < 32 cells settled? 30 ok, running 33 slightly over). Acceptable as is.
- **n1 NIT** `steered` «Скорректировал»: with an agent name as object it can read as correcting the agent itself; «Направил» would be closer to course-steering but A-m3 flagged forwarding. Acceptable.
- **n2 NIT** `fetched` «Загрузил»: ambiguity with upload exists product-wide; accepted given URL object.

## Commands actually run
python3 load/diff of ru.json, ru.v2.json, keys.json (set/order, changed keys, Unicode categories, duplicates, length/word counts); python3 scan of shipped ~/local-operator-ui/.worktrees/i18n-l1-tool-verbs/src/i18n/catalogues/ru/*.json for `\bпир`, `устройств`, fetch/download/upload keys and «загруз*/получ*/скача*»; sed of ru.md lines 84–92; sha256 of ru.v2.json. No ledger entry written (not requested).
