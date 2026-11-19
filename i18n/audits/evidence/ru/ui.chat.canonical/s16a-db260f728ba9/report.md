# ru audit — S16a tool state words (PR #1870)

- Audit id: `s16a-ru-toolstate`
- Locale: `ru` · namespace/file group: `ui.chat.canonical` (14 new keys)
- Audit date: 2026-11-11
- Verdict: **clean-with-findings** (`status: passed`) — counts {blocker: 0, major: 0, minor: 0, nit: 4}
- Auditor: `i18n-auditor`, session `db260f728ba9`, model `deepseek/deepseek-flash`
  (harness session header `Model: deepseek/deepseek-flash`; no fallback used or declared this run)
- Translator (not me, not edited by me): `i18n-translator`, `anthropic/claude-sonnet-5-5`

## Independence

I did not write these strings, did not edit them, and touched no repo file. I ran no
translation/MT API and no back-translation; every judgement below is my own reading of
Russian against the English source, its sidecar and the shipped ru catalogue.

## Inputs (sha256, computed here)

| Input | Path | sha256 |
|---|---|---|
| English | `src/i18n/catalogues/en/ui.chat.canonical.json` | `d6d47d31667fe69448cf408f5a4fecf9948782e850506a6141217585de9db1fd` |
| Context sidecar | `src/i18n/catalogues/en/ui.chat.canonical.context.json` | `ef8a12dea1835c241af3a166754322ce093af88592ec625036211458a50accac` |
| Target (translator draft) | `…/s16a-drafts/ru-s16a.json` | `40ed4f6b7baf948daaabee2b3e3b902fc443d8eb9a2b9d2df7917f55914e2e5d` |
| Shipped ru catalogue at head | `src/i18n/catalogues/ru/ui.chat.canonical.json` | `a84811e9c087aa79873ef756a2a268e298ebe4b6789d7dd834f4f51a127b4acb` |
| Glossary (core) | `~/local-operator/i18n/glossary.md` | `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8` |
| ru style guide (core) | `~/local-operator/i18n/style-guides/ru.md` | `f20e1cafaf70578c17ce072c71725628808d228e4be5604329f8da30386f1fb5` |

Head `93a61605b059ada503d75da6e9e38e8ef14e1b67`. The ru catalogue at head carries **0 of the 14**
keys (`en` 456 keys / `ru` 442 keys; the 14 missing are exactly this set) — the translations are
not yet landed, so this audits the draft, not committed bytes.

**Draft bytes proved:** my working copy differs from the draft file only by one trailing newline;
`sha256(copy minus final newline)` = `40ed4f6b…2e5d` = the draft's own hash. The ICU runs below
therefore ran on the draft's exact bytes.

## 1. Mechanical — run, not assumed

Ran with the worktree's own `node_modules` (no installs):
`@formatjs/icu-messageformat-parser@3.5.21` (AST parity) and `intl-messageformat@12.1.3`
(real formatting), scripts `ast-ru.mjs`, `fmt-ru.mjs`, logs `ast-run.log`, `fmt-run-1.log`.

- **JSON / key set**: parses; 14 draft keys = 14 English new keys; no key added or dropped.
- **Argument names/types**: identical per key — `size` (composing_sized, queued_sized), `count`
  (queue_ahead), `material` + `total` (running_batch); nothing else. `ARGS_ALL_EQUAL: true`.
- **`::group-off`**: preserved on `{count, number, ::group-off}` in all four ru branches.
- **`#` nested-plural parity**: en 8 `#` (2 categories × 4 materials) vs ru 16 (4 × 4) — the
  difference is the extra ru categories, every branch carries its own `#`. `1 000 000` renders
  with the NBSP grouping the glossary mandates (same as en's `1,000,000`) — not hand-written.
- **select branches**: `material[other,sound_effect,video,voiceover]` — all four, byte-identical
  branch names to en, in all six select messages. `SELECT_PARITY_ALL: true`.
- **CLDR categories**: `new Intl.PluralRules('ru').resolvedOptions().pluralCategories` =
  `["one","few","many","other"]`; both plural messages carry all four. `RU_PLURAL_CATS_OK_ALL: true`.
  (Matches the ru guide's category note and `scripts/i18n/tool-state-copy.test.mjs:535`.)
- **Typography**: U+00B7 middle dot ×2 with single spaces (`<status> · <detail>`, file:key
  `tool.composing_sized`, `tool.queued_sized`); U+2026 ellipsis ×21, no ASCII `...`; no NBSP, no
  bidi controls, no double spaces, no edge whitespace, no Latin letters in copy (only ICU keywords).
- **Formatted output**: 64 formatted lines (counts 0,1,2,3,5,11,21,22,100,1000000 × 4 materials ×
  6 select messages) — **0 parse errors, 0 leftover braces, 0 Latin runs** in the rendered text.

Ran the one repo gate that is meaningful at head without the draft in the tree:
`node scripts/i18n/check-strings.mjs` → `ok — 1664 file(s) scanned, 0 literal(s) at or below the
baseline; 40 literal(s) in the data shapes, all listed in i18n/literal-allowance.json (shrink-only)`.
That confirms the PR's own claim (the two surfaces now resolve through `t()`),
and it is green at `93a6160`.

Could NOT run `pnpm check-i18n` / `generate --check` / `context-parity` / `ledger-check`: they are
catalogue-wide and run against the in-tree catalogues, while the ru values are uncommitted and I am
read-only. My AST + formatting runs cover, for these 14 keys, what those gates cover; the
catalogue-wide halves remain CI's.

## 2. Genitive agreement after «Генерация» — the manager's question, answered with formatted output

`Генерация` is a verbal noun governing the genitive, so the counted noun follows the numeral in
the genitive, not the nominative counting form. One → genitive singular («одного изображения»),
2+ → genitive plural («двух изображений», «пяти изображений», «двадцати двух изображений»).
Required per category: **one → gen sg; few → gen pl; many → gen pl; other → gen pl.** The draft
does exactly that.

Real output (`intl-messageformat`, locale `ru`):

| material | 1 (one) | 2 (few) | 5 (many) | 21 (one) | 22 (few) | 100 (many) | 1000000 |
|---|---|---|---|---|---|---|---|
| image (`other`) | Генерация 1 изображения… | Генерация 2 изображений… | Генерация 5 изображений… | Генерация 21 изображения… | Генерация 22 изображений… | Генерация 100 изображений… | Генерация 1 000 000 изображений… |
| voiceover | Генерация 1 озвучки… | Генерация 2 озвучек… | Генерация 5 озвучек… | Генерация 21 озвучки… | Генерация 22 озвучек… | Генерация 100 озвучек… | Генерация 1 000 000 озвучек… |
| sound_effect | Генерация 1 звукового эффекта… | Генерация 2 звуковых эффектов… | Генерация 5 звуковых эффектов… | Генерация 21 звукового эффекта… | Генерация 22 звуковых эффектов… | Генерация 100 звуковых эффектов… | Генерация 1 000 000 звуковых эффектов… |
| video | Генерация 1 видео… | Генерация 2 видео… | Генерация 5 видео… | Генерация 21 видео… | Генерация 22 видео… | Генерация 100 видео… | Генерация 1 000 000 видео… |

Read for grammar: number + noun agree in every cell; «озвучки/озвучек» fleeting vowel correct;
«звукового эффекта / звуковых эффектов» correct; «видео» indeclinable, correct in all four.
Note the shipped counting-position plural (`few → изображения`, e.g.
`ui.chat.attachment_refusal.images_many`) is NOT the form for this governed position — the draft's
`few → изображений` is the correct one here and is not an inconsistency.

`other` = fractions (ru guide): `Генерация 1,5 изображений…` — gen pl, right under a genitive
governing head; `total` is an integer count, so the category cannot fire in practice.

`queue_ahead` (no noun, by sidecar) is textually identical in all four categories, which is
correct: there is nothing to inflect. Formatting: `впереди: 0 … впереди: 1000000` (group-off
honoured, `1000000` ungrouped as in en).

## 3. Accuracy, register, terminology

Every key read against its English value, its sidecar role/tone/length/note, and the shipped ru
catalogue. Meaning preserved in all 14; no omission, no addition, no polarity/negation error; the
failure branches are impersonal and blame-free («Не удалось создать …» — the ru guide's preferred
shape); nothing claims a duration the English does not.

Shipped-term reuses claimed by the translator's notes — all verified present, at file:key:

| claim | verified at |
|---|---|
| generation → «генерация» | `ru/ui.chat.canonical.json :: ui.chat.canonical.image_gen.progress` = «Прогресс генерации изображения» |
| image → «изображение» | same file, `ui.chat.canonical.image_gen.progress`, `ui.library.kind.image` = «Изображение» |
| video → «видео» | `ru/ui.library.json :: ui.library.kind.video` = «Видео» |
| queued → «в очереди» | `ru/ui.chat.status.json :: ui.chat.status.degraded`; `ui.chat.pickers.json :: ui.chat.pickers.info_model.queued` = «в очереди: {formatcount}» |
| colon-label datum style | `ui.chat.pickers.info_model.queued` (above) — house precedent for «впереди: N» |
| composing-verb 3rd person precedent | `ui.chat.canonical.tool_row.verb.wrote.running` = «Записывает» |
| «написано» sibling register | `ui.chat.canonical.tool.never_sent_composed` = «не отправлено · написано {size}» |
| sound effect: no shipped term | 0 hits for «звуков\* эффект»; `ui.library.category.sounds` = «Звуки» (broader, correctly not used) |
| voiceover: no shipped countable term | 0 hits for «озвучк\*»; the feature is named «Озвучивание» in `ui.settings.speech.speech_section.speech_voicing` |
| batch: no shipped term | `ui.chat.canonical.image_gen.batch_summary` counts «элемент/элемента/элементов»; «набор» ships only as set-of-instructions/tools |

Glossary: no row covers image/video/voiceover/sound effect/batch/queue, so these are per-locale
calls, not violations; the plural rule (all four categories, `other` required, `0` = many) is met;
no kept-English token is present or translated.

Register: tool-row status words lowercase, no trailing punctuation, ` · ` inside the message —
parallel to `never_sent_*`; card state lines sentence case with U+2026 — parallel to shipped
«Загрузка изображения…». No «Вы», no Title Case, no added politeness.

Fit: the card state line is `<p class="flex min-w-0 items-baseline gap-1.5">` with a `min-w-0`
span and no `truncate`/`whitespace-nowrap`
(`src/renderer/src/features/chat/canonical/image-gen-card.tsx:461-470`) — it **wraps**, so the
longest string («Генерация 100 звуковых эффектов…», 32 chars vs en 29) costs a wrap at most. The
tool-row object column does truncate (`canonical-transcript.tsx`, `truncate` span): «формируется ·
12,4 КБ» is 21 chars vs «composing · 12.4 KB» 19 — an inherent ru cost, and the size is what
drops, not the state word.

## 4. Findings — 0 blocker, 0 major, 0 minor, 4 nit (none gating)

**ru-N1 — NIT** · `ui.chat.canonical.tool.composing_sized` = «формируется · {size}»
Problem: the sibling it is told to parallel is a past participle («не отправлено · написано
{size}»), while this is a reflexive present — the pair reads slightly unalike; «пишется» would
pair with «написано» and is 4 characters shorter in a truncating column.
Current: `формируется · {size}` · Proposed (optional): `пишется · {size}`
Judgement: **defensible as drafted** — and it is the same stem as `writing_request`, which is the
better reason to keep it. Not a change request.

**ru-N2 — NIT** · `ui.chat.canonical.image_gen.state.queue_ahead` = «впереди: {count}»
Problem: the English is «3 ahead» with no punctuation; the ru adds a colon. It matches house
precedent in this catalogue (`в очереди: {formatcount}`) and disambiguates 0 («впереди: 0»), so it
reads fine.
Judgement: **defensible**. Not a change request.

**ru-N3 — NIT** · «озвучка» (voiceover item) — `running`, `running_batch`, `done`, `done_batch`,
`failed`, `failed_batch`
Problem: first use of «озвучка» anywhere in ru (0 shipped hits). The settings surface names the
same feature «Озвучивание» (`ui.settings.speech.speech_section.speech_voicing`). The countable
need (plural, gen pl «озвучек») is exactly what «озвучивание» cannot do well, so the coinage is
justified — but it is currently recorded nowhere.
Judgement: **accept as drafted**; ask: the wave records «озвучка» as the settled countable term in
the ru style guide (glossary §4), so the settings wave does not drift to a third word.

**ru-N4 — NIT** · «набор» for batch — `done_batch`, `failed_batch`
Problem: «набор» ships elsewhere meaning a *set of instructions/tools* («набор инструкций»);
reused here for a generated batch. Deliberate (the notes reject «пакет» as software-package).
Judgement: **accept as drafted**; «Набор изображений» / «Не удалось создать набор видео.» read
naturally as a generated set.

## 5. The translator's «unsure» items — judged

- «озвучка» vs «закадровый голос»: **keep «озвучка»**. «Закадровый голос» is the film-dubbing
  sense and cannot pluralise into a batch («Набор закадровых голосов» reads like a cast list).
- «формируется» vs «пишется»: **keep «формируется»** (see ru-N1) — stem-consistent with
  «Формирование запроса…», and the status word is not a synthesis of writing but of a call taking
  shape.

## 6. Out of scope, but told to the manager (not a finding against this locale)

The card's cancelled branch still prints model-layer English on every locale:
`CANCEL_QUEUED_COPY` / `CANCEL_RUNNING_COPY`
(`src/renderer/src/features/chat/canonical/image-gen-card-model.ts:217-221`) and the template
sentence `` `${batchMaterialTitle(...)} batch stopped.` ``
(`image-gen-card.tsx:456`). **Pre-existing**: both are byte-identical on `origin/main` and this
PR does not add them; the PR's own suite pins the batch sentence as belonging to a later
cancel-copy slice (`scripts/i18n/tool-state-copy.test.mjs:42-45`). So it neither gates this PR nor
this audit — but under the operator's «NO English anywhere» acceptance a ru user who cancels a
generation still reads English there, on every locale. Worth a follow-up key round.

## 7. Ledger

I cannot land the row (read-only; and the ru bytes on disk do not yet carry the 14 keys, which
`ledger-assemble.mjs` refuses by design — it requires the target sha256 to name the bytes on disk).
After the ru translations are committed the manager can assemble it:

```
node scripts/i18n/ledger-assemble.mjs --auditor-instance db260f728ba9 \
  --auditor-model deepseek/deepseek-flash --result clean-with-findings \
  --receipt <record.json or a receipt derived from it>
```

Suggested note (≤280 chars, 226):
`s16a tool state words 14 keys: 0 blocker / 0 major / 4 nit (composing verb, ahead colon, ozvuchka + nabor coinages). Genitive after «Генерация» verified by formatting all four ru categories. Record: i18n/audits/evidence/ru/ui.chat.canonical/s16a-ru-toolstate/record.json`

## 8. Honest gaps

- I am not a native speaker; this is one careful reading, not a native review. I did the second
  pass myself rather than a second auditor running independently.
- No rendered frame: no browser, no window, no screenshot. Width judgements are code + character
  arithmetic (and the card wraps), not measured pixels.
- No CI, no pseudo-localisation run, and none of the catalogue-wide `pnpm` gates
  (`generate --check`, `context-parity`, `ledger-check`); only `check-strings` was run (green at head),
  plus the two direct ICU harnesses in §1.
- I did not read any earlier ru audit of `ui.chat.canonical` (deliberately, to keep this pass
  independent), so I make no claim about how it relates to prior rounds.
