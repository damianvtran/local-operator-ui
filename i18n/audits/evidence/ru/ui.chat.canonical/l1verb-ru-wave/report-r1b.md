# Audit ru-B — L1 tool-row verbs (182 keys)

Auditor: i18n-auditor (team lopdev), session ecef9b4b2a09, model anthropic/claude-sonnet-5-5 (actual served model; no fallback).
Independent of translator (openai/gpt-6.1-sol). Report only; no files edited. No MT service used.
Inputs: keys.json sha256 b3f3bfe3688d1461a061009e98a58802171eb181343fdb8fcfd0af07652ca419; ru.json sha256 08ee34b8151659c5c2eb2d51acfcf6847e011b38e2914d0be2bcefb4fcc249f9.
Read: ru.md + en.md style guides, glossary.md, shipped ru ui.chat.canonical.json (tool_row.generic_verb.*, bridge.verb.*), shipped ui.projects.json / ui.mesh.json for этап / устройство / задачи vocabulary.

## Verdict: clean-with-findings — {blocker 0, major 0, minor 6, nit 4}

## Mechanical (python3, actually run)
- key count 182 == 182; key order identical to keys.json: True.
- empty values: none. English-identical values: none. Manual bidi/format characters: none (N/A for ru anyway).
- Latin letters in values: only `ran_python.*` ("Python" — technology name, allowed). No stray English.
- Word count per value 1–4 (all pass). Longest: previewed_rename.running 33 chars (src 17), .settled 30; next raised_panic.running 29. Mean ru/en length ratio 1.31 (guide predicts 20–30%).
- Duplicate ru value for two different English strings: none.
- settled/running pair completeness: every .settled has .running; same lexeme and same word count in every pair (Выполнил/Выполняет, Ждёт/Дождался, etc.). Pair consistency: PASS.
- Destructive vs read-only polarity: Delete/Remove/Reset/Cancel/Stop/Close map to Удалил/Удалил/Сбросил/Отменил/Остановил/Закрыл; all read-only ops (list/show/peek/read/status/log) use read verbs. No swaps. panic = «аварийная блокировка» (code: marks network untrusted + panic) — faithful.
- Terminology vs glossary/shipped: сессия, агент, субагент, команда, проект, задание (job), задачи (todos), пробуждение (wake), секрет, этап (milestone; matches ui.projects), устройство (matches ui.mesh «Удалить устройство»), консоль, сеть — all conformant. Trailing prepositions: «Заглянул в» (+acc), «Привязал сессию к» (+dat), «Отвязал сессию от» (+gen), «Присоединился к сети», «Выполнил в Python» — grammatically valid before a monospace object; case of an untranslated object is not inflectable, which is fine for names/ids/paths.
- Register: masculine past ("Выполнил") / 3sg present, consistent with shipped bridge.verb.* («Опубликовал в», «Прочитал ветку:»). Consistent.

## Findings

### MINOR
1. `verb.peeked_at_session.settled` — "Прочитал вывод сессии" / `.running` "Читает вывод сессии". `sessions peek` returns the transcript/steps of another session, not "output" (вывод = stdout; transcript = транскрипт per ru.md). It also diverges from the sibling `peeked_at` ("Заглянул в"). Suggest "Заглянул в сессию" / "Заглядывает в сессию".
2. `verb.spawned_session.settled` — "Создал сессию" / `.running` "Создаёт сессию". Spawn = launch a new run; shipped ru uses «запустить сессию» (ui.projects the_session_could_not_be_started). Suggest "Запустил сессию" / "Запускает сессию".
3. `verb.listed_network_peers.settled` — "Получил список пиров сети" / `.running` "Получает список пиров сети". «пиры» is an unrecorded calque, and shipped mesh copy calls these devices (устройство). Suggest "Получил список устройств сети" / "Получает список устройств сети" (28 chars, within existing maxima).
4. `verb.described_secret.settled` — "Описал секрет" / `.running` "Описывает секрет". Reads as the agent writing a description (a mutation); `secret describe` only reads metadata. Suggest "Посмотрел описание секрета" / "Смотрит описание секрета" (or "Прочитал описание секрета" / "Читает …"; fits pair style of read_*).
5. `verb.ran_python.settled` — "Выполнил в Python" / `.running` "Выполняет в Python". The object is a code snippet, so "Выполнил в Python `print(1)`" is a clipped, slightly broken sentence. Suggest "Выполнил Python-код" / "Выполняет Python-код" (Python stays Latin, allowed).
6. `verb.fetched.settled` — "Загрузил" / `.running` "Загружает". In ru UI «загрузить» usually means upload (shipped ru uses «Загрузить» for upload actions); web_fetch retrieves a URL. Suggest "Запросил" / "Запрашивает" (neutral, followed by the URL) or "Получил страницу" / "Получает страницу".

### NIT
1. `verb.searched.settled` — "Выполнил поиск" / `.running` "Выполняет поиск" (grep). Shares «Выполнил» with `ran` (bash) and differs from siblings «Искал в интернете» / «Искал агентов». Suggest "Искал" / "Ищет" for grep family consistency. Current text is acceptable.
2. `verb.previewed_rename.*` — "Просмотрел план переименования" (adds "план"; longest rows, 30/33 chars = 1.8–1.9× English). If the gutter is tight, "Просмотрел переименование" / "Просматривает переименование" (25/28).
3. `verb.listed.settled` — "Получил список" (glob): bare before a pattern (`**/*.py`) reads slightly ambiguous but mirrors English "Listed"; acceptable, could be "Нашёл файлы" if the wording is ever revisited.
4. Shipped `generic_verb.*` is passive («Вызван» / «Вызывается») whereas the new rows (and shipped bridge verbs) are active masculine. Not an error; fallback rows will simply read in a different voice from named rows. No action required.

## Commands run
- python3 loads of keys.json / ru.json (OrderedDict): key list equality, empty, identical-to-English, Latin letters, bidi chars, 1–4 words, duplicate-value, settled/running pairing, length stats — outputs as stated above.
- Grepped the shipped ru catalogues (ui.projects.json, ui.mesh.json, ui.chat.canonical.json) for этап/устройство/запустить/задач to check consistency.
- Read local_operator/network/cli.py `_cmd_panic` to confirm panic semantics.
- Did NOT run the repo validator or the audit-ledger command (out of this slice's scope; report-only).
