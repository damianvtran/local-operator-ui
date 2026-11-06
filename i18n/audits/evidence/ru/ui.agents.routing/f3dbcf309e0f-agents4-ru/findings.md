# i18n audit - `ru` - `ui.agents.routing` (12 values)

- Instance: `f3dbcf309e0f-agents4-ru`
- Auditor: `i18n-auditor`, session `f3dbcf309e0f`, model `anthropic/claude-sonnet-5-5`
- Date: 2026-10-30. Source `en` `d7903758`, target `ru` `5d127ad1`.
- **Verdict: PASS** - 0 BLOCKER, 0 MAJOR, 7 MINOR, 5 NIT.

Independent of the translator (session `3ef6295a5545`) and of the earlier ru receipt. No MT service.

## Findings

### M1 MINOR - coder
- Current: самостоятельный и хорошо описанный кусок работы
- Problem: «кусок» is colloquial for a card; the ru guide steers 'slice'-type nouns to «часть» and the sibling description of the same agent says «одну ограниченную часть работы». Same agent, two registers on two surfaces the operator sees back to back.
- Suggested: самостоятельная и хорошо описанная часть работы, не требующая дополнительных решений

### M2 MINOR - designer
- Current: проверить, как что-то ВЫГЛЯДИТ для пользователя: ревью экрана или терминального UI, читаемость компоновки, отступов, цвета и текстов, сделать интерфейс приятнее — …
- Problem: EN 'whether a layout, spacing, colour or copy reads well' is a judgement of quality; «читаемость … цвета» is not Russian (colour has contrast or fit, not legibility) and turns the clause into a list of nouns. The sentence also breaks parallelism: infinitive (проверить) - nouns (ревью, читаемость) - infinitive (сделать).
- Suggested: Когда нужно проверить, как что-то ВЫГЛЯДИТ для пользователя: оценить экран или терминальный UI, удачны ли компоновка, отступы, цвета и тексты, сделать интерфейс приятнее — дизайн- и UX-ревью видимого пользователю изменения.

### M3 MINOR - manager
- Current: работа распадается на части в нескольких агентах или репозиториях
- Problem: EN 'multi-part work across several agents or repositories': «в нескольких агентах» is the wrong preposition - parts are not located inside agents; the work is spread among them. «в … репозиториях» works, so the pair reads unevenly.
- Suggested: Когда работа из нескольких частей распределена между агентами или репозиториями и её нужно координировать и отслеживать, выяснить, что заблокировано, или собрать сводку статуса либо отчёт о прогрессе.

### M4 MINOR - reviewer
- Current: …; аудит и разбор чужого кода, в том числе написанного другим агентом.
- Problem: After «Когда нужно …» the second half drops to a bare noun phrase with no verb («аудит и разбор»). EN keeps a participle chain ('auditing or critiquing'). Reads as a note fragment on a card whose first half is sentential.
- Suggested: …; провести аудит или критический разбор чужого кода, в том числе написанного другим агентом.

### M5 MINOR - tui_designer
- Current: клавиатурные сценарии, компоновка и плотность информации на малых фиксированных экранах, совместимость с цветом и Unicode
- Problem: Three drifts from EN: 'keyboard-first' loses 'first' (primary input path, not merely a keyboard flow); 'small/fixed terminals' becomes «экранах» (screens), dropping the word that tells the operator this is about terminals; «совместимость с цветом» is not idiomatic (support for colour). The agent's trigger words are exactly what search matches.
- Suggested: сценарии с приоритетом клавиатуры, компоновка и плотность информации в малых терминалах фиксированного размера, поддержка цвета и Unicode

### M6 MINOR - ux_reviewer
- Current: провести ревью пользовательского опыта (UX) изменения
- Problem: The sidecar says EXPERIENCE is capitalised to contrast with the visual review and to 'keep the emphasis with whatever device the locale uses'. The ru siblings do (КАК, ВЫГЛЯДИТ) but here «опыта» is plain, so the contrast that the closing clause names is carried by «в отличие от» alone. Also '(UX)' is an addition that costs width.
- Suggested: провести ревью ПОЛЬЗОВАТЕЛЬСКОГО ОПЫТА изменения

### M7 MINOR - copy_reviewer
- Current: удаление признаков ИИ-текста
- Problem: The sidecar calls 'AI-isms' the house term that 'stays untranslated'; ru renders it as a descriptive phrase and also shifts the meaning slightly (signs of AI-written text vs machine-sounding phrasing). Defensible - the sibling ru description already says «признаки ИИ-текста», so the two surfaces agree and the corpus has no kept-English precedent - but it contradicts the sidecar, so it is recorded rather than waved through.
- Suggested: удаление «AI-измов» (оборотов, выдающих ИИ-текст)  [or keep «признаков ИИ-текста» and record the deviation in the sidecar]

### N1 NIT - scout
- Current: отыскать, где объявлена функция или класс, проследить поток выполнения
- Problem: 'is defined' is «определена» (the corpus uses it 4x; «объявлена» means declared). 'tracing a flow' is generic in EN; «поток выполнения» narrows it to execution flow.
- Suggested: отыскать, где определена функция или класс, проследить ход работы кода

### N2 NIT - ux_reviewer
- Current: можно ли на деле пройти задачу без препятствий
- Problem: «пройти задачу» is a calque of 'go through a task'; ru UX copy says «выполнить» or «завершить» a task.
- Suggested: можно ли на деле без препятствий выполнить задачу

### N3 NIT - copy_reviewer
- Current: никогда для инженерной прозы
- Problem: «инженерная проза» is a calque of 'engineering prose'; «технических текстов» is the natural ru.
- Suggested: никогда для технических текстов или комментариев в коде

### N4 NIT - architect
- Current: ещё до написания кода
- Problem: EN 'before writing it' - 'it' is the thing being built, not necessarily code. «кода» narrows a little; harmless on a card.
- Suggested: ещё до начала работы

### N5 NIT - qa_tester
- Current: новая возможность
- Problem: EN says 'feature'; «новая» is an addition. Coder uses «новую возможность» for 'building a feature', so the pair is at least consistent.
- Suggested: PR, патч или возможность

## Fit
- aida: 136 -> 152 (1.1176)
- architect: 169 -> 178 (1.0533)
- coder: 183 -> 215 (1.1749)
- copy_reviewer: 354 -> 416 (1.1751)
- designer: 202 -> 226 (1.1188)
- librarian: 121 -> 152 (1.2562)
- manager: 155 -> 192 (1.2387)
- qa_tester: 170 -> 193 (1.1353)
- reviewer: 157 -> 162 (1.0318)
- scout: 258 -> 265 (1.0271)
- tui_designer: 260 -> 287 (1.1038)
- ux_reviewer: 257 -> 309 (1.2023)
