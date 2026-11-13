# i18n audit — `ru` — slice L1, tool-row verbs — pass **A**

- **Audit id:** `l1-au-ru-A`
- **Locale:** `ru` · **Namespace / file group:** `ui.chat.canonical` (`tool_row.verb.*`, 182 keys = 91 settled/running pairs)
- **Audit date:** 2026-11-11
- **Auditor (actual):** agent `i18n-auditor`, session `b5e155569c21`, model `deepseek/deepseek-flash`
  (`actual_model_source`: harness run header — "Model: deepseek/deepseek-flash"; no fallback used)
- **Independence:** `independent_from_translator_session: true`. Translator was `openai/gpt-6.1-sol` in a session unknown to me. I did not read any other auditor's report (pass B included) and used no translation/MT/back-translation service; every judgement below is reasoned from the English source, its `context`/`notes`, the style guide, the glossary and the shipped copy.
- **Verdict:** **changes_requested** — 2 MAJOR, 4 MINOR, 3 NIT, 0 BLOCKER. `passed` is not available while a MAJOR stands.

## Inputs (hashes as read this run)

| Input | Path | SHA-256 |
|---|---|---|
| English source + per-key context/notes | `~/local-operator-ui/.worktrees/_l1-prep/keys.json` | `b3f3bfe3688d1461a061009e98a58802171eb181343fdb8fcfd0af07652ca419` |
| Translation audited | `~/local-operator-ui/.worktrees/_l1-prep/ru.json` | `08ee34b8151659c5c2eb2d51acfcf6847e011b38e2914d0be2bcefb4fcc249f9` |
| en catalogue | `…/i18n-l1-tool-verbs/src/i18n/catalogues/en/ui.chat.canonical.json` | `a385671b988e5f03df6f650beb4a06f73c9efaead2316dfa9ab15bf043798765` |
| en context sidecar | `…/catalogues/en/ui.chat.canonical.context.json` | `2e755f12e46bb6dded6dbf950eda6402b0a7bcb05e9489fa17f7369543f3ac7f` |
| shipped `ru` catalogue (consistency baseline) | `…/catalogues/ru/ui.chat.canonical.json` | `ea9eff38bfa4c9fcea0fa519aaa37fc890ac09977df535940494aa92194a61e3` |
| ru style guide | `~/local-operator/i18n/style-guides/ru.md` | `f20e1cafaf70578c17ce072c71725628808d228e4be5604329f8da30386f1fb5` |
| en style guide | `~/local-operator/i18n/style-guides/en.md` | `c967c91037be79a7b184b3288b8c0326a261e4adae95b7db06d83e96f8ea6ec7` |
| glossary | `~/local-operator/i18n/glossary.md` | `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8` |

Register/terminology baselines read: shipped `tool_row.bridge.verb.*` in the same `ru` catalogue, `origin/main`'s `tool_row.generic_verb.*`, and a shipped-term sweep across all `ru` namespaces. Branch head `6c0b841872d89a507dc9d45d9a2f68c92ebb6e5d`; the branch's `ru` catalogue holds **zero** `tool_row.verb.*` keys, so this audits the prep file, not shipped copy.

## 1. Mechanical — all PASS

| Check | How | Result |
|---|---|---|
| key set **and order** equal to `keys.json` | `list(keys) == list(ru)` | **PASS** — 182/182, `order equal: True`, `missing: []`, `extra: []` |
| empty values | `not str(v).strip()` | **PASS** — none |
| valid JSON | `json.load` on both | **PASS** |
| duplicate values (two operations reading the same) | `defaultdict` over values | **PASS** — no value repeats |
| English-identical values | `ru[k].strip() == en[k].strip()` | **PASS** — none |
| Latin script left untranslated | `[A-Za-z]` scan | **PASS** — only `Python` in `ran_python.*`, kept per glossary §1 |
| manual bidi / zero-width controls | U+200B–200F, U+202A–202E, U+2066–2069, U+FEFF scan | **PASS** — none |
| placeholders / ICU / markup | `{` scan both sides | **PASS** — all 182 declare `placeholders: none`; no ICU, no Rich tags, no code spans |
| width hint "one to four words" | `len(v.split())` | **PASS** — max 4 words, exactly at the budget and only in `listed_network_peers` (both forms); 32 one-word, 84 two-word, 64 three-word values |
| typography | `!` `:` `...` quotes, doubled/leading/trailing spaces | **PASS** — none; sentence case throughout |
| settled/running = same verb | all 91 pairs | **PASS** — every pair is a true aspect pair (Выполнил/Выполняет, Нашёл/Ищет, Дождался/Ждёт, Ввёл/Вводит, Вышел/Выходит, Сделал снимок/Делает снимок …). 19 pairs differ in root only because Russian perfective/imperfective pairs legitimately do. |

## 2. Accuracy — read all 182 in source order

Preserved everywhere: the exact tool/operation named in `context.role` (`grep` → `searched`, `glob` → `listed`, `eval` → `ran_python`, `hub|jobs peek` → `peeked_at`, `sessions peek` → `peeked_at_session`, `console keys|secure|capture|read|check` → its own verb, `lsp definitions|references|symbols|rename_preview` → its own verb, `wake` → `listed_wakes`/`cancelled_wake`/`scheduled`), no omissions, no added negation, no polarity flips.

- **Destructive vs read-only is never swapped.** Destructive/state-changing: `Удалил` (team, project, secret, device, milestone), `Отменил` (wake, job, hub cancel), `Остановил`, `Приостановил`, `Присоединился`, `Вышел`, `Включил аварийную блокировку`. Read-only: `Прочитал`, `Просмотрел`, `Получил`, `Получил список …`, `Искал`, `Проверил`, `Нашёл`, `Заглянул в`. No read-only row carries a delete/stop verb and vice versa.
- **Dangerous actions stay explicit.** `deleted_*` and `removed_device` are unambiguous; `raised_panic` names an emergency lockout rather than softening it (see M2 for the term-recording gap).
- **Trailing prepositions keep their relation to the object that follows**, which is the whole contract of this column: `linked_session_to` `Привязал сессию к` (+ dative object), `unlinked_session_from` `Отвязал сессию от`, `peeked_at` `Заглянул в`, `typed_in_console` `Ввёл в консоль` (+ the typed text after the noun, where Russian needs the noun to close the phrase). All correct.
- **`Выполнил`/`Выполняет` is shared by `ran` (bash) and `ran_python` (eval)** exactly as English shares "Ran"/"Running" — right call, the pair stays one verb family.

## 3. Idiom, register, terminology — matches the guide

- **Formality:** impersonal third-person masculine past / present — `Выполнил`, `Найдёт`-style forms are avoided; no `вы`/`ты` appears, so the guide's `вы` decision is not at risk. Matches the shipped `tool_row.bridge.verb.*` voice (`Прочитал`, `Опубликовал`, `Взял в работу`, `Освободил`), which is the right baseline for this column.
- **Terse, no politeness padding, no `!`, sentence case** — the guide's rules are all met.
- **Glossary conformance:** session `сессия` ✓; subagent `субагент` ✓; team `команда` ✓; project `проект` ✓; wake `пробуждение` ✓; job `задание` ✓; relay `ретранслятор` (not used here); `Python` kept Latin ✓.
- **Shipped-copy consistency verified term by term, not assumed:**
  - milestone → `этап` ✓ (`ui.projects.json`: «Новый этап», «Удалить {name}», `count.milestones` = `этап/этапа/этапов`).
  - todo → `задача` ✓ (`ui.projects.json`: `count.todo` = `задача`; and shipped `fold.count.todo` = `обновление списка задач`, `fold.count.todo_read` = `чтение списка задач`, so `Прочитал список задач` / `Обновил список задач` mirror shipped wording).
  - log → `журнал` ✓ (`ui.common.errors.*`: «приложив журнал приложения», `ui.common.updates`: «Показать журнал обновления»).
  - snapshot → `снимок` ✓ (`ui.chat.pickers`: «снимок git {value}», `ui.hub.adoption`: «полный восстанавливаемый снимок»), so `Сделал снимок консоли` is in-vocabulary.
  - secure input → `защищённый ввод` ✓ (`ui.console.json`: «Защищённый ввод включён…»).
  - peer → `пир` ✓ shipped precedent (`ui.mesh.mesh_list.answered_the_peer_read_but_is_in`: «о пире»), so `пиров сети` is consistent jargon, not an invention.
  - block/lock vocabulary → `блокиров*` ✓ widely shipped (`Заблокировано`, `Блокировать файл`, `Отправка заблокирована`).

## 4. Findings

### MAJOR

Severity honesty: M1 is a meaning-level defect (source operation renamed and collapsed into another operation's verb). M2 is a guide-rule/geometry defect, not a mistranslation — the value is comprehensible Russian and inside the word budget; it breaks the ru guide's tighten-to-+20–30 % rule and the renderer's "verb never truncates" doctrine. I rate it MAJOR because it is the single worst fit in the file and the fix costs 5 cells, not because a reader would misunderstand it.

**M1 — `ui.chat.canonical.tool_row.verb.peeked_at_session.settled`** (and `.running`)
- Current: `Прочитал вывод сессии` / `Читает вывод сессии` — EN `Peeked at session` / `Peeking at session`.
- Problem: two defects in one pair. (a) **Meaning drift:** the source's operation is *peek* — recently read steps, a digest, or query matches (`sessions` tool, `peek`); the value asserts the session's **вывод** (output), a noun the source does not have and that a session does not produce the way a console or a command does. (b) **It collapses peek into read:** `Прочитал` is the verb this same set assigns to the `read` tool (`verb.read`, and `read_variable`, `read_todos`, `read_console`, `read_network_log`), so a `sessions peek` row now claims the same operation class as a genuine file read, while its sibling `peeked_at` (`hub`/`jobs` `peek`) is `Заглянул в`. One English verb, two Russian verbs, and the wrong one collides with `read`.
- Suggested: `Заглянул в сессию` / `Заглядывает в сессию` — parallel to `peeked_at`, and the noun is needed anyway because the object that follows is a bare session id/name. It stays inside the 1–4-word budget and is 17/20 cells (the current wording is 21/19).

**M2 — width, `ui.chat.canonical.tool_row.verb.previewed_rename.*`**
- Current: `Просмотрел план переименования` (30 cells) / `Просматривает план переименования` (33 cells) — EN 16/17 cells, i.e. **+88 % / +94 %**, against a guide expectation of +20–30 % for ru.
- Problem: this is a *fit* failure, not a taste note. The verb cell is `shrink-0 whitespace-nowrap` in `src/renderer/src/features/chat/components/trace/tool-row.tsx` (~line 986) and the row's documented shedding order is "diff counters go first, then the object truncates, and the verb never does" — so 33 cells do not overflow the row, they **consume** it: every cell beyond the column's present worst case is taken from the monospace object, which is the half that carries the file/query/id and truncates at the row's narrow layouts (`@[19rem]/toolrow` = 304 px). Measure against the right baselines: the widest English verb in this set is 23 (`Checking network status`), whose ru pair is 24; the widest ru value outside `previewed_rename` and `raised_panic` is 27 (`Получает список пробуждений`). At 33 cells, `previewed_rename.running` is the longest string in all 182 and ~6 cells beyond the next-longest non-panic value, all of it taken from the object (~45–55 px on the 13 px sans ramp — geometric estimate; the cell counts are exact). The 4-word reading is *within* the sidecar's "one to four words" (as are the only other 4-word values, `listed_network_peers`), so the finding is cell length, not word count.
- Suggested: `Просмотрел переименование` (25) / `Просматривает переименование` (28) — the `lsp rename_preview` operation shows the proposed edits, so "план" is an inference that may be dropped; if the translator prefers to keep "план", record it in `i18n/style-guides/ru.md` as a width exception the way `cli.services_status` is recorded, rather than letting it land unrecorded.

### MINOR

**m1 — `sent_keys.*`** — `Отправил нажатия клавиш` / `Отправляет нажатия клавиш` (23/25 cells for EN 9/13, ratio 2.56/1.92 — second-worst `settled` ratio after `searched.settled`'s 2.75). Also reads awkwardly once the key spec is appended: `нажатия` (presses) is the event, not the thing sent. Suggested: `Отправил клавиши` (16) / `Отправляет клавиши` (18).
**m2 — `searched.*`** — `Выполнил поиск` / `Выполняет поиск` (22/23 cells for EN 8/9, ratio 2.75/2.56 — the worst ratio in the file) is clerical register for the most-used transcript verb, and the two sibling search keys chose plain verbs (`searched_agents` = `Искал агентов`, `searched_the_web` = `Искал в интернете`). Suggested: `Искал` (5) / `Ищет` (4), same aspect pair, and the three search rows then share one register.
**m3 — `steered.*`** — `Перенаправил` / `Перенаправляет`. In a chat transcript that sits two rows away from `messaged` (`Написал`), `перенаправить` is the everyday word for *forwarding a message*, while `steer` injects guidance into a turn that is already running. Suggested: `Скорректировал` (14) / `Корректирует` (12), or `Скорректировал курс` (19) / `Корректирует курс` (17) if the course metaphor is worth the cells.
**m4 — `raised_panic.*` — term not recorded** — `Включил аварийную блокировку` / `Включает аварийную блокировку` (28/29 cells, ratio 2.2/2.3). The width is defensible: this is a network-wide, hard-to-reverse untrust action (`docs/design/mesh-incident-response.md`: `net_panic` mints a fresh secret, latches `trust = untrusted` locally, broadcasts to every peer), and safety beats brevity here — I am **not** asking for a shorter string. What is missing is the paper trail: `panic` is a new user-visible concept that appears in no glossary row and in no shipped `ru` string, and the en guide states a new concept needs a glossary row before it ships in copy. Suggested: keep the wording, add the `panic → аварийная блокировка` row to the glossary (ru cell) or record it in the ru guide as a wave call, alongside the existing `cli.services_status` width exception.

### NIT

**n1 — `ran_python.*`** — `Выполнил в Python` / `Выполняет в Python`. Acceptable and glossary-clean (`Python` stays Latin), but `в Python` leaves the following object syntactically unanchored. Keep if the translator tested the render; otherwise `Выполнил код Python` / `Выполняет код Python` (19/20 cells, two cells longer than the current wording) reads more clearly as a phrase.
**n2 — `captured_console.*`** — `Сделал снимок консоли` / `Делает снимок консоли`. In-vocabulary with shipped `снимок`, but `снимок` alone reads as a *screenshot* to many ru readers; the operation captures console text. No change requested; if the wave touches it, `Снял текст консоли` is more precise (18 cells vs 21, same register).
**n3 — `listed_network_peers.*`** — `Получил список пиров сети` / `Получает список пиров сети` (25/26 cells). `пир` is correct per shipped precedent, so this is a note only: it is one of the 15 values at/over 25 cells, and it is the one place where a shorter settled synonym (`узлов`) exists but must not be used without changing the shipped mesh wording.

## Checks that came back clean, stated so they are not re-litigated

- No stray English anywhere: the only Latin run in the file is `Python` (technology name, glossary §1). Operator acceptance ("switching to `ru` must leave NO English in the interface") is met by these values on the text side.
- No manual bidi controls, no NBSP or thin-space contamination, no trailing punctuation, no Title Case.
- Every settled/running pair reads as a matching pair (`running` = 3rd-person present, `settled` = masculine past), which is also the shipped bridge-row voice.
- No two different operations render identically; no key was added or dropped; order preserved.
- RTL: not applicable to `ru`. Wide-glyph/combining risk: none (Cyrillic is single-cell in the row's faces; no combining marks, no CJK, no emoji).

## 5. Observation (out of scope for these 182 values; does not gate)

Shipped `origin/main` renders the **fallback** row passively — `tool_row.generic_verb.settled` = `Вызван`, `.running` = `Вызывается` — while the 180 new specific verbs (and the shipped bridge verbs) are **active**. After this lands, an unrecognised tool and a recognised tool speak in two different voices in one column. The audited values follow the dominant shipped pattern, so this is not a finding against them; the wave should either align `generic_verb` to the active voice in a later slice or record why the column carries both.

## 6. Ledger / retention status

**No ledger row was written by me, and none can be honestly written yet.** `i18n/ledger.json` entries need the `target_sha256` of the *shipped* catalogue file, and the branch's `src/i18n/catalogues/ru/ui.chat.canonical.json` currently contains zero `tool_row.verb.*` keys (`verb.* count: 0`) — the audited bytes have no home in the tree yet. My slice brief named no ledger command, so I ran none and claim no `receipt_sha256`. For the manager's `ledger-assemble.mjs` pass, once the values land:

- locale `ru`, namespace `ui.chat.canonical`, status `audited`; result is `changes_requested` **as it stands** (counts `{blocker: 0, major: 2, minor: 4, nit: 3}`). A `clean-with-findings` entry requires M1 and M2 fixed and this pass re-run on the new head.
- auditor fields: agent `i18n-auditor`, instance `b5e155569c21`, model `deepseek/deepseek-flash`, independent of the translator.
- suggested note (≤280 chars, re-word once hashes are final): `ru tool_row.verb.* pass A: 182 keys, 0 blocker; M1 peeked_at_session adds «вывод» and borrows the read verb, M2 previewed_rename 30/33 cells in the shrink-0 verb slot; 4 minor, 3 nit. Report: i18n/audits/evidence/ru/ui.chat.canonical/l1-au-ru-A/`

## 7. Commands actually run

Working dirs: `~/local-operator-ui/.worktrees/i18n-l1-tool-verbs` and `~/local-operator-ui/.worktrees/_l1-prep`.

1. `ls -la _l1-prep/`, `ls ~/local-operator/i18n/style-guides/` — 7 locale files + `_template.md`; inputs present.
2. `python3` — key-set/order/empty: `keys 182 ru 182 · order equal: True · missing: [] · extra: [] · empty: []`.
3. `python3` — full side-by-side dump of all 182 pairs (550 lines), then a second `python3` pass printing `context.role` + `tone` for the operations where tool identity decides the verb (`grep`, `glob`, `eval`, `hub peek` vs `jobs peek` vs `sessions peek`, `console keys`/`secure`/`capture`, `lsp rename_preview`, `wake`, `network …`).
4. `python3` — mechanical battery (duplicates, en-identical, Latin, bidi, `{`, word count, typography): all PASS as tabulated in §1.
5. `python3` — length-expansion table; top rows `raised_panic` 12→28 / 13→29, `previewed_rename` 16→30 / 17→33, `sent_keys` 9→23 / 13→25, `searched` 8→22 / 9→23; 15 values ≥25 cells, listed.
6. `python3` — 91 settled/running pairs compared by root: 19 differ, each a legitimate aspect pair; none a verb change.
7. `python3` (worktree `ru` catalogue) — shipped `generic_verb` = `Вызван`/`Вызывается`; `git show origin/main:src/i18n/catalogues/ru/ui.chat.canonical.json` → no `.verb.ran.settled`, i.e. all 91 pairs are new in this slice; shipped bridge verbs `Освободил/Освобождает`, `Прочитал/Читает`, `Опубликовал/Публикует в` confirm the active voice baseline.
8. `python3` — shipped-term sweep across every `ru` namespace for `этап`, `задача`, `журнал`, `снимок`, `защищённый ввод`, `пир`, `блокиров`, `довер`, `переименован`: each slice term has shipped precedent (§3).
9. `sed -n '20,60p;975,1003p' src/renderer/src/features/chat/components/trace/tool-row.tsx` — the `shrink-0 whitespace-nowrap` verb cell and the "verb never does [truncate]" shedding doctrine behind M2.
10. `grep -n "cell|maxCells|width|gutter" scripts/i18n/tool-verbs-copy.test.mjs` and `ls scripts/i18n/`, `package.json` scripts — the feature's own test pins key resolution, not width; no `maxCells` exists on any of the 182 context entries (`python3` over `ui.chat.canonical.context.json`, 182 verb entries, zero with `maxCells`), so the sidecar's word budget plus the renderer doctrine are the only constraints.
11. `python3` — SHA-256 of all eight inputs (§ table), plus `git rev-parse HEAD` → `6c0b841872d89a507dc9d45d9a2f68c92ebb6e5d`, `git status --porcelain` → clean.
