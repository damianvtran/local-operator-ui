# Wave A `ru` render and typography check

Source commit `a81c00cdda2667dc6b094128ff47ec72d0c4d095` on branch `i18n-wave-a`, read from a `git archive` export (`git show`-identical bytes, verified by SHA-256 in `audit.log`). Rendering by `IntlMessageFormat` (`intl-js` CLDR data bundled with the repo's `intl-messageformat`) at locale `ru`. The values are the committed bytes in the read-only export; the arguments below are test arguments, not product data.

## 1. Every value, with one realistic render

| # | key | English | ru | rendered (sample args) |
|---:|---|---|---|---|
| 1 | `ui.chat.checkpoint.generating_name` | Generating name… | Создание названия… | Создание названия… |
| 2 | `ui.chat.checkpoint.jump_agent` | Jump to turn {turn, number} of {total, number}, {name} | Перейти к ходу {turn, number} из {total, number}, {name} | Перейти к ходу 1 из 1 234, Исправить сборку |
| 3 | `ui.chat.checkpoint.jump_agent_unnamed` | Jump to turn {turn, number} of {total, number} | Перейти к ходу {turn, number} из {total, number} | Перейти к ходу 1 из 1 |
| 4 | `ui.chat.checkpoint.jump_user` | Jump to your message in turn {turn, number} of {total, number}, {clock} | Перейти к вашему сообщению — ход {turn, number} из {total, number}, {clock} | Перейти к вашему сообщению — ход 3 из 12, 3:42 PM |
| 5 | `ui.chat.checkpoint.jump_user_no_clock` | Jump to your message in turn {turn, number} of {total, number} | Перейти к вашему сообщению — ход {turn, number} из {total, number} | Перейти к вашему сообщению — ход 3 из 12 |
| 6 | `ui.chat.checkpoint.turn` | Turn {turn, number} of {total, number} | Ход {turn, number} из {total, number} | Ход 1 из 1 |
| 7 | `ui.chat.header_identity.aria_agent_assign` | Agent: {label}. Assign an agent | Агент: {label}. Назначить агента | Агент: Без агента. Назначить агента |
| 8 | `ui.chat.header_identity.aria_agent_closed` | Agent: {label}. {reason} | Агент: {label}. {reason} | Агент: Local Operator Dev. The runtime closed this seat. |
| 9 | `ui.chat.header_identity.aria_agent_switch` | Agent: {label}. Switch agent | Агент: {label}. Сменить агента | Агент: Local Operator Dev. Сменить агента |
| 10 | `ui.chat.header_identity.aria_team_assign` | Team: {label}. Assign a team | Команда: {label}. Назначить команду | Команда: Без команды. Назначить команду |
| 11 | `ui.chat.header_identity.aria_team_closed` | Team: {label}. {reason} | Команда: {label}. {reason} | Команда: Platform. The runtime closed this seat. |
| 12 | `ui.chat.header_identity.aria_team_switch` | Team: {label}. Switch team | Команда: {label}. Сменить команду | Команда: Platform. Сменить команду |
| 13 | `ui.chat.header_identity.assign_agent` | Assign an agent | Назначить агента | Назначить агента |
| 14 | `ui.chat.header_identity.assign_team` | Assign a team | Назначить команду | Назначить команду |
| 15 | `ui.chat.header_identity.no_agent` | No agent | Без агента | Без агента |
| 16 | `ui.chat.header_identity.no_team` | No team | Без команды | Без команды |
| 17 | `ui.chat.region.composer` | Message composer | Ввод сообщения | Ввод сообщения |
| 18 | `ui.chat.region.conversation` | Conversation | Разговор | Разговор |
| 19 | `ui.chat.header.archive_conversation` | Archive conversation | Архивировать разговор | Архивировать разговор |
| 20 | `ui.chat.header.cancel_rename` | Cancel rename | Отменить переименование | Отменить переименование |
| 21 | `ui.chat.header.rename_conversation` | Rename conversation | Переименовать разговор | Переименовать разговор |
| 22 | `ui.chat.header.restore_conversation` | Restore conversation | Восстановить разговор | Восстановить разговор |
| 23 | `ui.chat.header.saving_conversation_name` | Saving the conversation name | Сохранение названия разговора | Сохранение названия разговора |
| 24 | `ui.chat.response_actions.answer_label` | Answer actions | Действия с финальным ответом | Действия с финальным ответом |
| 25 | `ui.chat.response_actions.copied` | Copied | Скопировано | Скопировано |
| 26 | `ui.chat.response_actions.copy` | Copy | Копировать | Копировать |
| 27 | `ui.chat.response_actions.yours_label` | Your message actions | Действия с вашим сообщением | Действия с вашим сообщением |
| 28 | `ui.chat.sidebar.entity.collapse_chats` | Collapse {name} chats | Свернуть чаты «{name}» | Свернуть чаты «Исправить сборку» |
| 29 | `ui.chat.sidebar.entity.expand_chats` | Expand {name} chats | Развернуть чаты «{name}» | Развернуть чаты «Исправить сборку» |
| 30 | `ui.chat.sidebar.entity.manage` | Manage {name} | Управление «{name}» | Управление «Исправить сборку» |
| 31 | `ui.chat.sidebar.entity.pin` | Pin “{name}” | Закрепить «{name}» | Закрепить «Исправить сборку» |
| 32 | `ui.chat.sidebar.entity.unpin` | Unpin “{name}” | Открепить «{name}» | Открепить «Исправить сборку» |
| 33 | `ui.chat.sidebar.pins.pin_label` | Pin “{title}” | Закрепить «{title}» | Закрепить «Исправить сборку» |
| 34 | `ui.chat.sidebar.pins.unpin_label` | Unpin “{title}” | Открепить «{title}» | Открепить «Исправить сборку» |
| 35 | `ui.chat.sidebar.row_menu.archive` | Archive conversation | Архивировать разговор | Архивировать разговор |
| 36 | `ui.chat.sidebar.row_menu.pin` | Pin conversation | Закрепить разговор | Закрепить разговор |
| 37 | `ui.chat.sidebar.row_menu.unarchive` | Unarchive conversation | Восстановить разговор | Восстановить разговор |
| 38 | `ui.chat.sidebar.row_menu.unpin` | Unpin conversation | Открепить разговор | Открепить разговор |

## 2. Adversarial-name table (keys with a name/title/label slot)

Slots are filled with: a plain title, a vowel-initial one-word name, a name carrying «», a name with a comma, a very long title, a CJK/Latin mixed title, an Arabic (RTL) name, and a Latin title. `{turn}`/`{total}` are 1000/1234 in the last row to force ru grouping.

### `ui.chat.checkpoint.jump_agent`

| args | render |
|---|---|
| turn=1, total=1234, name='Исправить сборку' | Перейти к ходу 1 из 1 234, Исправить сборку |
| turn=21, total=1234, name='Оценка' | Перейти к ходу 21 из 1 234, Оценка |
| turn=3, total=1234, name='«Срочный фикс»' | Перейти к ходу 3 из 1 234, «Срочный фикс» |
| turn=2, total=1234, name='Исправить сборку, затем деплой' | Перейти к ходу 2 из 1 234, Исправить сборку, затем деплой |
| turn=7, total=1234, name='Проверить сборку релиза и развернуть её на всех устройствах команды' | Перейти к ходу 7 из 1 234, Проверить сборку релиза и развернуть её на всех устройствах команды |
| turn=4, total=1234, name='Build 修复 — 构建发布' | Перейти к ходу 4 из 1 234, Build 修复 — 构建发布 |
| turn=1000, total=1234, name='شركة النور — Local Operator' | Перейти к ходу 1 000 из 1 234, شركة النور — Local Operator |
| turn=8, total=1234, name='Q4 launch review' | Перейти к ходу 8 из 1 234, Q4 launch review |

### `ui.chat.header_identity.aria_agent_assign`

| args | render |
|---|---|
| label='Без агента' | Агент: Без агента. Назначить агента |
| label='Local Operator Dev' | Агент: Local Operator Dev. Назначить агента |
| label='ООО «Ромашка»' | Агент: ООО «Ромашка». Назначить агента |
| label='Очень длинное имя агента для проверки переноса' | Агент: Очень длинное имя агента для проверки переноса. Назначить агента |

### `ui.chat.header_identity.aria_agent_closed`

| args | render |
|---|---|
| label='Local Operator Dev', reason='The runtime closed this seat.' | Агент: Local Operator Dev. The runtime closed this seat. |

### `ui.chat.header_identity.aria_agent_switch`

| args | render |
|---|---|
| label='Local Operator Dev' | Агент: Local Operator Dev. Сменить агента |
| label='ООО «Ромашка»' | Агент: ООО «Ромашка». Сменить агента |

### `ui.chat.header_identity.aria_team_assign`

| args | render |
|---|---|
| label='Без команды' | Команда: Без команды. Назначить команду |
| label='Platform' | Команда: Platform. Назначить команду |

### `ui.chat.header_identity.aria_team_closed`

| args | render |
|---|---|
| label='Platform', reason='The runtime closed this seat.' | Команда: Platform. The runtime closed this seat. |

### `ui.chat.header_identity.aria_team_switch`

| args | render |
|---|---|
| label='Platform' | Команда: Platform. Сменить команду |

### `ui.chat.sidebar.entity.collapse_chats`

| args | render |
|---|---|
| name='Исправить сборку' | Свернуть чаты «Исправить сборку» |
| name='Оценка' | Свернуть чаты «Оценка» |
| name='«Срочный фикс»' | Свернуть чаты ««Срочный фикс»» |
| name='Исправить сборку, затем деплой' | Свернуть чаты «Исправить сборку, затем деплой» |
| name='Проверить сборку релиза и развернуть её на всех устройствах команды' | Свернуть чаты «Проверить сборку релиза и развернуть её на всех устройствах команды» |
| name='Build 修复 — 构建发布' | Свернуть чаты «Build 修复 — 构建发布» |
| name='شركة النور — Local Operator' | Свернуть чаты «شركة النور — Local Operator» |
| name='Q4 launch review' | Свернуть чаты «Q4 launch review» |

### `ui.chat.sidebar.entity.expand_chats`

| args | render |
|---|---|
| name='Исправить сборку' | Развернуть чаты «Исправить сборку» |
| name='Оценка' | Развернуть чаты «Оценка» |
| name='«Срочный фикс»' | Развернуть чаты ««Срочный фикс»» |
| name='Исправить сборку, затем деплой' | Развернуть чаты «Исправить сборку, затем деплой» |
| name='Проверить сборку релиза и развернуть её на всех устройствах команды' | Развернуть чаты «Проверить сборку релиза и развернуть её на всех устройствах команды» |
| name='Build 修复 — 构建发布' | Развернуть чаты «Build 修复 — 构建发布» |
| name='شركة النور — Local Operator' | Развернуть чаты «شركة النور — Local Operator» |
| name='Q4 launch review' | Развернуть чаты «Q4 launch review» |

### `ui.chat.sidebar.entity.manage`

| args | render |
|---|---|
| name='Исправить сборку' | Управление «Исправить сборку» |
| name='Оценка' | Управление «Оценка» |
| name='«Срочный фикс»' | Управление ««Срочный фикс»» |
| name='Исправить сборку, затем деплой' | Управление «Исправить сборку, затем деплой» |
| name='Проверить сборку релиза и развернуть её на всех устройствах команды' | Управление «Проверить сборку релиза и развернуть её на всех устройствах команды» |
| name='Build 修复 — 构建发布' | Управление «Build 修复 — 构建发布» |
| name='شركة النور — Local Operator' | Управление «شركة النور — Local Operator» |
| name='Q4 launch review' | Управление «Q4 launch review» |

### `ui.chat.sidebar.entity.pin`

| args | render |
|---|---|
| name='Исправить сборку' | Закрепить «Исправить сборку» |
| name='Оценка' | Закрепить «Оценка» |
| name='«Срочный фикс»' | Закрепить ««Срочный фикс»» |
| name='Исправить сборку, затем деплой' | Закрепить «Исправить сборку, затем деплой» |
| name='Проверить сборку релиза и развернуть её на всех устройствах команды' | Закрепить «Проверить сборку релиза и развернуть её на всех устройствах команды» |
| name='Build 修复 — 构建发布' | Закрепить «Build 修复 — 构建发布» |
| name='شركة النور — Local Operator' | Закрепить «شركة النور — Local Operator» |
| name='Q4 launch review' | Закрепить «Q4 launch review» |

### `ui.chat.sidebar.entity.unpin`

| args | render |
|---|---|
| name='Исправить сборку' | Открепить «Исправить сборку» |
| name='Оценка' | Открепить «Оценка» |
| name='«Срочный фикс»' | Открепить ««Срочный фикс»» |
| name='Исправить сборку, затем деплой' | Открепить «Исправить сборку, затем деплой» |
| name='Проверить сборку релиза и развернуть её на всех устройствах команды' | Открепить «Проверить сборку релиза и развернуть её на всех устройствах команды» |
| name='Build 修复 — 构建发布' | Открепить «Build 修复 — 构建发布» |
| name='شركة النور — Local Operator' | Открепить «شركة النور — Local Operator» |
| name='Q4 launch review' | Открепить «Q4 launch review» |

### `ui.chat.sidebar.pins.pin_label`

| args | render |
|---|---|
| title='Исправить сборку' | Закрепить «Исправить сборку» |
| title='Оценка' | Закрепить «Оценка» |
| title='«Срочный фикс»' | Закрепить ««Срочный фикс»» |
| title='Исправить сборку, затем деплой' | Закрепить «Исправить сборку, затем деплой» |
| title='Проверить сборку релиза и развернуть её на всех устройствах команды' | Закрепить «Проверить сборку релиза и развернуть её на всех устройствах команды» |
| title='Build 修复 — 构建发布' | Закрепить «Build 修复 — 构建发布» |
| title='شركة النور — Local Operator' | Закрепить «شركة النور — Local Operator» |
| title='Q4 launch review' | Закрепить «Q4 launch review» |

### `ui.chat.sidebar.pins.unpin_label`

| args | render |
|---|---|
| title='Исправить сборку' | Открепить «Исправить сборку» |
| title='Оценка' | Открепить «Оценка» |
| title='«Срочный фикс»' | Открепить ««Срочный фикс»» |
| title='Исправить сборку, затем деплой' | Открепить «Исправить сборку, затем деплой» |
| title='Проверить сборку релиза и развернуть её на всех устройствах команды' | Открепить «Проверить сборку релиза и развернуть её на всех устройствах команды» |
| title='Build 修复 — 构建发布' | Открепить «Build 修复 — 构建发布» |
| title='شركة النور — Local Operator' | Открепить «شركة النور — Local Operator» |
| title='Q4 launch review' | Открепить «Q4 launch review» |

## 3. Clock argument (the rail supplies it, not the catalogue)

`checkpointClockLabel()` composes a 12-hour `h:mm` plus an English `AM`/`PM` marker; the catalogue slot `{clock}` receives that string verbatim:

- `3:42 PM` → Перейти к вашему сообщению — ход 3 из 12, 3:42 PM
- `12:05 AM` → Перейти к вашему сообщению — ход 3 из 12, 12:05 AM
- `11:11 PM` → Перейти к вашему сообщению — ход 3 из 12, 11:11 PM
- `15:42` → Перейти к вашему сообщению — ход 3 из 12, 15:42

## 4. Typography and encoding facts over all 38 values

- Placeholder names, types and occurrence order: identical to English in all 38 (`problems: []`).
- ICU structures: no `plural` or `select` among the 38, so no CLDR arm set is exercised in this group (file-wide plural arms are covered by `locale-parity.test.mjs`).
- NFC: all 38 values are NFC.
- Bidi control characters (U+200E/200F, U+202A–202E, U+2066–2069): zero in all 38. `ru` is LTR; RTL-name-in-LTR renders are in section 2 and need no isolation because the whole message is an LTR paragraph.
- Typographic quotes: «» paired in every value that quotes; ASCII quotes: none; ASCII hyphen used as a dash: none; ellipsis: U+2026 in `generating_name`.
- Em dash in `jump_user`/`jump_user_no_clock`: ` — ` (U+2014, spaced), per the ru guide.

## 5. Length (characters, this group)

| namespace | longest English | longest ru |
|---|---|---|
| `ui.chat` | 71 (`jump_user`) | 75 (`jump_user`) |
| `ui.chat.header` | 28 (`saving_conversation_name`) | 29 (`saving_conversation_name`) |
| `ui.chat.response_actions` | 20 (`yours_label`) | 28 (`answer_label`) |
| `ui.chat.sidebar` | 22 (`unarchive`) | 24 (`expand_chats`) |

Chip labels: `no_agent` 10 chars and `no_team` 11 chars, inside the header chip's 24ch label cap; both truncate only past that cap. The longest new menu label is `row_menu.pin`/`unpin` (18) and the header menu's `archive`/`restore` (21) — below the English 22-char maximum in the same group. Long aria-only strings (`saving_conversation_name` 29, `answer_label` 28) have no visual width budget in their sidecars and are not rendered as button text.
