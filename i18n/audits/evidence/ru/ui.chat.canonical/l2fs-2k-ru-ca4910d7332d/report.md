# Independent translation audit — `ru`, namespace `ui.chat.canonical` (l2 file-size wave)

- **Verdict: clean** — no BLOCKER, MAJOR, MINOR or NIT finding. Counts `{blocker: 0, major: 0, minor: 0, nit: 0}`.
- **Auditor:** `i18n-auditor`, session `ca4910d7332d`, served model **`deepseek/deepseek-flash`** (session runtime model header; no provider fallback used).
- **Translator under audit:** `openai/gpt-6.1-sol` — different agent and model; this auditor did not translate these files and edited nothing.
- **Audit id:** `l2fs-2k-ru-ca4910d7332d` · **date:** 2026-11-11 · **keys:** 2 of 2 read in full.
- **Inputs (sha256):** en `27ae7327…f031` · context `c0aff0d8…53e4` · candidate `ru.json` `f1c0c985…3c7a` · shipped `ru/ui.chat.canonical.json` baseline `ea9eff38…61e3`.
- **Evidence:** `~/local-operator-ui/.worktrees/i18n-l2-file-sizes/i18n/audits/evidence/ru/ui.chat.canonical/l2fs-2k-ru-ca4910d7332d/` (`record.json`, `audit.log`, `mechanical.json`, `receipt.json`).

## Strings audited

| key | en | ru |
|---|---|---|
| `ui.chat.canonical.tool.never_sent_composed` | `never sent · {size} composed` | `не отправлено · написано {size}` |
| `ui.chat.canonical.tool.never_sent_empty` | `never sent · nothing composed` | `не отправлено · ничего не написано` |

## 1. Mechanical

Run against the worktree at `479c2673fab`; all green for this delta.

- `node scripts/i18n/generate.mjs --check` → `keys.gen.ts is byte-identical to a fresh generation`.
- `node scripts/i18n/context-parity.mjs` → `ok — every English key is covered, apart from 129 allowed gap(s) in 4 namespace(s)` (pre-existing shrink-only allowance, unrelated to these keys).
- Key set: 2 en / 2 ru, no keys added or dropped, valid JSON, no empty values, no value identical to English.
- `{size}`: exactly once in the first key (en 1 / ru 1), braces intact, no renames. The second key has no placeholder, as in English.
- ICU: neither key carries `plural`/`select`, so CLDR category coverage is not applicable here — no `#`, no plural branches to check. Nothing to hand-format: the digits and the unit both arrive inside `{size}`.
- Separator: exactly one U+00B7 in each value, spaced `" · "` — matches the English source and the shipped ru convention in this same file (`ui.chat.canonical.tool_row.bridge.outcome.failed` = `сбой · {code}`, `fold.unit_separator` = `" · "`). No ASCII period, hyphen or bullet separator.
- Typography/format: no leading or trailing whitespace, no trailing sentence punctuation (status fragment), NFC-normalised, no stray spaces beyond the single ones around the middot, no NBSP/NNBSP introduced by hand.
- Script: Cyrillic throughout except the `{size}` token (Latin letters present only inside the placeholder, which is correct and required). No English left in either line.
- Repository ledger gate (`node scripts/i18n/ledger-check.mjs`) is **red repo-wide right now** — 24 rows across all seven locales, each `missing 2 key(s) — …never_sent_composed, …never_sent_empty` plus a stale-source line. That is this wave's in-flight state (English landed, translations not yet in the catalogues), **not** a finding of this audit; the `ru` rows say exactly that.

## 2. Accuracy

Both lines preserve meaning, including the two distinctions the context demands.

- **"never sent"** = the call never reached a tool. «не отправлено» is the perfective passive ("was not sent", a settled negative state), so it carries the same terminal sense as the English and does not suggest a pending or retried send — which the imperfective «не отправляется» would have implied. It is also the phrase already used for the neighbouring send failures in this namespace (`ui.chat.canonical.send_failure.*`: «Сообщение не отправлено»), so one verb, one behaviour.
- **"composed"** = how much of the request the model had *written*, not "composed" as in music. «написано {size}» renders that as an impersonal quantity — the standard Russian status idiom («прочитано 1 из 3», «загружено 12,4 МБ») — and attributes the writing to the model by virtue of the row it sits in, without inventing «моделью».
- The first key does **not** drop the measure and the second does **not** invent one: «ничего не написано» is exactly "nothing written", no negation is added or lost, and no polarity flipped. No omission, no addition, no unsafe wording (nothing destructive, no permission or error semantics in these two strings).

## 3. Idiom and register

- Formality: no address form appears, so the guide's «вы» rule cannot be violated; nothing in either line is over-familiar or padding ("Пожалуйста", «Уважаемый пользователь» — absent, correctly).
- Register: terse lower-case status fragments with no full stop, exactly the shape of the shipped ru tool-row fragments (`сбой · {code}`, `отклонено · {code}`, `доставка не подтверждена`). Sentence-casing only the sentence, never Title Case. ✓
- **Parallelism (required by the source note):** the two lines share the prefix «не отправлено ·» and the same verb, with the negation flipped onto the second line's object — «написано {size}» ↔ «ничего не написано». That is a stronger parallel than a word-for-word calque would give, and it reads as Russian, not as translated English.
- No calque of "composed" as «составлено» (which means "compiled/drawn up" in Russian and is the exact trap the style guide warns about for other terms); «написано» is the natural verb here.
- Word order follows the target language, which the source note explicitly permits ("the whole line is one message"): the quantity sits after the verb instead of before it. Nothing is lost, and the status-first reading order (state, then detail) survives.
- Punctuation/typography: spaces around the middot, no typographic spacing before punctuation (none present), no «ёлочки» needed, no em dash needed. ✓

## 4. Terminology

- No glossary term appears in either string, so no glossary row can be violated; nothing in §1 (product surfaces, tool names, identifiers) is translated, renamed or inflected.
- Consistent with the ru guide's recorded calls that are adjacent in meaning: `tool`/`tool call` wording belongs to the surrounding catalogue (unchanged here), and the verb «написал» family is what the shipped ru copy already uses for the model's own writing (`ui.chat.canonical.tool_row.bridge.verb.dm.settled` = «Написал:»).
- `{size}` is left alone — no unit symbol is baked in, which is right: ru units come from CLDR via the formatter (`12,4 кБ`), per the wave's own `_no_unit_keys` note.

## 5. Fit

- Context carries **no `maxCells`** for these keys — the row shares space with the tool name and truncates with an ellipsis when narrow.
- Measured with East-Asian/combining-aware width: key 1 is 31 cells in ru vs 28 in en (+11 %), key 2 is 34 vs 29 (+17 %). Rendered with the ru sample size (`12,4 кБ`, NBSP grouping): 32 vs 29 and 34 vs 29 cells (+10 % / +17 %) — inside the guide's expected ru expansion (20-30 % is the outer case) and short enough for a status row that truncates rather than wraps.
- No wide-glyph or combining-mark risk: all Cyrillic + Latin placeholder, no CJK, no Devanagari, no combining marks.

## 6. RTL

Not applicable (`ru` is LTR). Noted for completeness: the Latin `{size}` sits at the end of line 1 with a normal space — correct LTR bidi behaviour, no isolate needed and none added.

## Second independent pass (this group is high-visibility chat copy)

Both keys were re-read from scratch after the first pass, specifically for: (a) whether «написано» could be mistaken for "saved to disk" — considered, rejected as a defect because the leading «не отправлено» scopes the line to a call that reached nothing, and the English "composed" carries the same tension; (b) whether «текста» should be added for clarity — rejected, it costs cells and the sibling line supplies the elliptical noun; (c) whether «не отправлялось» would be more faithful to "never" — rejected in favour of namespace consistency with `send_failure.*`, since the perfective passive already reads as terminal; (d) whether the two lines stay parallel under both — yes. The second pass found nothing the first missed.

## Ledger state (deferred, with reason)

A ledger row **cannot** be written from here yet, and I did not fake one:

```
node scripts/i18n/ledger-assemble.mjs --repo <scratch-copy> --locale ru \
  --file src/i18n/catalogues/ru/ui.chat.canonical.json ...
ledger-assemble: refused - ru/ui.chat.canonical is not key-complete against English
(2 missing, 0 extra) - an incomplete locale cannot be recorded
exit=2   (ledger bytes unchanged)
```

`ledger-assemble.mjs` derives `target_sha256` from the catalogue on disk, so the row becomes writable only after the landing commit puts these two values in `src/i18n/catalogues/ru/ui.chat.canonical.json`. At that point, run:

```
node scripts/i18n/ledger-assemble.mjs --locale ru \
  --file src/i18n/catalogues/ru/ui.chat.canonical.json \
  --auditor-instance ca4910d7332d --auditor-model deepseek/deepseek-flash \
  --result clean --receipt i18n/receipts/<landed-receipt>.json \
  --translator-agent i18n-translator --translator-model openai/gpt-6.1-sol \
  --scope "the 2 keys this wave adds (never_sent_composed, never_sent_empty)" \
  --note "l2 file-size wave; audit l2fs-2k-ru-ca4910d7332d"
```

Before assembling, confirm the landed values are the audited bytes —
`ui.chat.canonical.tool.never_sent_composed` `6cc03e25b1ecd19ce8d0ac0ac69d6703471ba25aba4ecbc1f3cad14830a0f057`,
`ui.chat.canonical.tool.never_sent_empty` `470332be4dc8b7b298d9caba20b19056f4274b56268e578cce3023283a7ddfe5`
(sha256 of the value text alone). This verdict attaches to those bytes; any edit invalidates it and needs a fresh audit instance.

## Commands actually run (this session)

```
node scripts/i18n/generate.mjs --check            # keys.gen.ts byte-identical
node scripts/i18n/context-parity.mjs              # ok (129 pre-existing allowed gaps)
node scripts/i18n/ledger-check.mjs                # red repo-wide: wave in flight (ru: missing 2 keys, stale source)
node scripts/i18n/ledger-assemble.mjs --repo <scratch> ...   # refused: not key-complete (exit 2)
python3 (key set / placeholder / middot / NFC / width / hashes)   # all green, see mechanical.json
```

Model served to this session and used for every judgement above: **`deepseek/deepseek-flash`** (no fallback).
