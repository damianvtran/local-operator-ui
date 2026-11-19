# S16d audit — `ru` · `ui.common.time`

**Auditor:** `i18n-auditor` (independent, fresh instance) · **agent** `i18n-auditor` · **session** `1d3841078034` · **model** `deepseek/deepseek-flash` (session header; no fallback observed)
Independent from translator `i18n-translator` / `anthropic/claude-sonnet-5-5` and from any earlier auditor. Read-only: no edits, commits, pushes or PR posts; wrote only my scratchpad.
**Verdict: `clean-with-findings`** — blocker 0 · major 0 · minor 2 · nit 0

## 1. Inputs

| Input | sha256 |
|---|---|
| `ru-s16d.json` (candidate) | `ed1b7781989c9e0000c73ae33970181a00d1fb594494c3648c50a046be2a0250` |
| `ru-s16d-notes.md` | `a06577bb67fb660e862bad0a49e00b669a8a6e403dcd498ea112a0839e001217` |
| candidate, sorted-key compact UTF-8 | `1d97aaeb1c2b226b18dd8db8a21ebb7ab09ed0c01bc411b35c01e2a97590a833` ✓ **matches the recorded `1d97aaeb`** |
| `en/ui.common.time.json` (source) | `bb0b3aa1a71679cc73cb40d73616b5e22057c7dcbc86705c2ec4425984971e13` |
| `en/ui.common.time.context.json` (sidecar) | `a9069037edc11c59288a7c2d3171496b1ef44a0982fc28e6a0edb4bcae0f98d2` |
| `ru/ui.common.time.json` @ `dcdcb6a9` (pre-landing) | `5436047ba2fc7843f2a63605c5ed74d6183ce751d1b5958c9b3850cf2f2243ea` |

Worktree `~/local-operator-ui/.worktrees/i18n-s16d` verified at `dcdcb6a9d8c4a80d239fc56498765c2b64417d38`, clean (`git status --porcelain` empty).

## 2. Mechanical

Scratch mirror: `git archive HEAD` of `src/i18n scripts/i18n i18n package.json`, `node_modules` symlinked from the worktree (nothing installed); the 4 values applied to a copy of `ru/ui.common.time.json` in English key order.

- **`node scripts/i18n/generate.mjs --check` → PASS**, `keys.gen.ts` byte-identical to a fresh generation. No key added or dropped; the applied file carries all 5 English keys of the namespace.
- **`node --test scripts/i18n/locale-parity.test.mjs` → all six `[ru]` rows PASS**: ships ≥1 message · ≤1 namespace per key · carries EVERY key · names only keys the English source defines · **preserves every ICU placeholder** · **is not an English stub**. The same run FAILS `[zh-CN]` for the 4 keys I did not apply — a live negative control proving the guard actually bites.
- **Own ICU grid** through the app's own entry point (`new IntlMessageFormat(msg, "ru")`, identical to `src/i18n/messages.ts:152`) with the **real** arguments the app's formatter produces for `ru`: `time` = `14:30`, `weekday` = `понедельник`, `date` = `5 ноября 2026 г.` — no throws; placeholders `{time}`/`{weekday}`/`{date}` identical to English with no additions; every value NFC; no bidi controls; no English words.
- **Negative controls (in-memory mutants), all DETECTED**: dropped `{time}` → placeholder-mismatch; `Today {time}` → English residue; `{tmie}` → throws; unclosed `{time` → throws; NFD-decomposed value → NFC gate. My first two controls were built wrong (the "dropped" mutant still contained `{time}`, and `Вчера` has no decomposable letter) and were rebuilt before the run above — the proof is real, not assumed.

## 3. What the app actually inserts (probed, not assumed)

`Intl.DateTimeFormat("ru", …)`, resolved locale `ru`:

| Argument | Real value | Note |
|---|---|---|
| `{time}` | `14:30` | 24-hour ✓ per guide |
| `{weekday}` | `понедельник` | **lowercase** |
| `{date}` | `5 ноября 2026 г.` | narrow NBSP (U+202F) before `г.` |

CLDR `ru` patterns for the same component sets (authoritative for the joiners):

| Skeleton | CLDR `ru` output |
|---|---|
| `weekday:long` + `hour` + `minute` | `понедельник 14:30` — **space, no comma** |
| `day` + `month:long` + `year` + `hour` + `minute` | `5 ноября 2026 г. в 14:30` |

## 4. Composed, end to end

| Key | ru candidate | Composed with real arguments |
|---|---|---|
| `today_at` | `Сегодня в {time}` | **Сегодня в 14:30** |
| `yesterday` | `Вчера` | **Вчера** |
| `weekday_at` | `{weekday}, {time}` | **понедельник, 14:30** |
| `date_at` | `{date} в {time}` | **5 ноября 2026 г. в 14:30** |

## 5. Per-key judgement

- **`today_at` — PASS.** Mirrors the shipped sibling `ui.common.time.yesterday_at` = «Вчера в {time}» and the exact precedent `ui.schedules.scheduled_task_dialog.tonight_at_8_00_pm` = «Сегодня в 20:00». Same preposition, same sentence case, no punctuation, 24-hour clock per guide. The day-word-first order is right for ru.
- **`yesterday` — PASS.** One word, sentence case, exactly what the sidecar asks. Byte-identical to the three shipped standalone «Вчера» values (`ui.projects.project_model.yesterday`, `ui.notifications.group.yesterday`, `ui.teamBridge.thread.yesterday`) — consistency, not an English stub.
- **`weekday_at` — MINOR (RU-S16D-01).** Correct that «в {weekday}» was rejected: `{weekday}` is nominative and the preposition needs the accusative, which differs for the feminine days (`в среду`, `в пятницу`, `в субботу` would illegalise the string for three of seven weekdays). The comma, however, is added punctuation the source context does not grant — see finding.
- **`date_at` — PASS, strong.** Composes **byte-identical to CLDR `ru`'s own date+time pattern**. «в» is the correct ru joiner where English uses a comma; the narrow NBSP before «г.» survives untouched.
- **Terminology / glossary:** no glossary §1 or §2 term occurs in these strings; nothing to violate. No product names, flags, paths or identifiers here, so nothing to keep Latin.
- **English residue:** none — every value is Cyrillic; only the digits and `:`/`,` punctuation are non-Cyrillic, which is correct ru. No named exception needed.

## 6. Findings

### RU-S16D-01 — MINOR · punctuation / source tone · `ui.common.time.weekday_at`
- **Current:** `{weekday}, {time}` → «понедельник, 14:30»
- **Problem:** The English sidecar sets this key's tone to *"Terse label, no punctuation."* and its note grants no joiner freedom (unlike `date_at`, whose note explicitly says *"The joiner between date and clock is yours to choose (comma, space, 'at')"*). CLDR `ru` renders this exact component set as `понедельник 14:30` — a bare space — and the English joiner is a space too. The comma is an addition on both counts. It is not *wrong* to a native reader (Russian commas between a day and a clock are common enough), which is why this is minor rather than major, but it contradicts the stated tone and the platform's own ru pattern for the same pieces.
- **Proposed:** `{weekday} {time}` → «понедельник 14:30»
- **Precedent:** CLDR `ru` weekday+time skeleton; en source `{weekday} {time}`; sidecar tone.

### RU-S16D-02 — MINOR · typography, **app-side — no catalogue fix exists** · `ui.common.time.weekday_at`
- **Current:** composes to «понедельник, 14:30», starting the divider label with a **lowercase** letter.
- **Problem:** `Intl.DateTimeFormat("ru", {weekday:"long"})` returns `понедельник` in lower case, and `ConversationDivider` paints the label verbatim — no `capitalize` class, no first-letter transform anywhere in the path (`src/renderer/src/features/chat/components/conversation-divider.tsx`, no helper in `src/i18n/*`). English is unaffected because English weekday names are already capitalised (`Monday`), so this is an ru-specific wart that a translator cannot fix: the placeholder must be inserted unchanged.
- **Scope, stated honestly:** today this label only reaches `formatDividerLabel` → `groupMessages` → `src/renderer/src/features/chat/components/trace/trace.stories.tsx`; the live transcript states time per turn via `TurnTimestamp`, so the wart is visible in the swept `chat-trace--*` stories rather than the shipped chat surface. It becomes user-visible the day a divider returns.
- **Proposed:** no catalogue change. App-side: capitalise the first character of the composed divider label (or the `{weekday}` argument) at the render site.

## 7. Receipt / ledger

The assembler derives `target_sha256` **from the file on disk** and refuses (exit 2) a receipt that does not name those exact bytes, so pre-landing bytes genuinely cannot be bound. I therefore pinned a **predicted** landed hash by reproducing the repo's byte convention — my serialiser round-trips the current `ru/ui.common.time.json` to its exact sha256 `5436047b…`, which is what makes the prediction trustworthy:

| Landed form | Predicted `target_sha256` |
|---|---|
| as drafted (comma) | `45f4bdfa8813dea770ad0cc6168080034ecad25a9940b42b84726a48621b9819` |
| with RU-S16D-01 applied | `239ecea62883a7f889d5b565ec0184e73830594284470c98f2bbb06830f89f03` |

Both assume tab indentation, English key order, `ensure_ascii=false` and a trailing newline. **If the landed file differs by one byte, re-derive `target_sha256` from disk** — the assembler refuses otherwise, naming the mismatch.

### Validated command (I ran this end to end, in my mirror)

I did run the real assembler and the real gate against my scratch mirror with the values applied. It **accepted my receipt** and produced:

```
ledger-assemble: ru/ui.common.time -> status audited (prior audits were of older bytes: moved to superseded)
  | clean-with-findings, 0 blocker, 0 major, 2 minor, 0 nit
```

and `ledger-check.mjs` then reported **zero** ru findings while failing all six other locales (es, fr, hi, ur, vi, zh-CN) for the 4 unapplied keys — the control that shows the gate really ran and really evaluated ru. The row it wrote:

```
"locale":"ru" "namespace":"ui.common.time"
  source_sha256 bb0b3aa1… (en)   target_sha256 45f4bdfa… (as-drafted landed form)
  auditors[0]: i18n-auditor / deepseek/deepseek-flash / 2026-11-12
               clean-with-findings {blocker 0, major 0, minor 2, nit 0}
               receipt i18n/receipts/1d3841078034.json
  status: "audited", prior row moved to "superseded"
```

Command to run **after the 4 values land** (the row exists, so no `--translator-*` flags; the assembler supersedes the older row itself):

```
node scripts/i18n/ledger-assemble.mjs \
  --locale ru \
  --file src/i18n/catalogues/ru/ui.common.time.json \
  --auditor-instance 1d3841078034 \
  --auditor-model deepseek/deepseek-flash \
  --result clean-with-findings \
  --receipt <durable path to this audit receipt.json> \
  --scope "ru ui.common.time S16d: 4 new keys audited against en + context sidecar; composed with real Intl ru arguments" \
  --note "S16d ru ui.common.time: clean-with-findings 0 blocker/0 major/2 minor; date_at = CLDR ru exactly; RU-01 comma in weekday_at, RU-02 app-side lowercase weekday." \
  --date 2026-11-12
```

`--note` measures 158 characters (limit 280). The assembler copies the receipt byte-for-byte to `i18n/receipts/1d3841078034.json`, so **the receipt path handed to it must be durable first** — `receipt.json` currently lives only in this session's scratchpad; attach it to the project before running. If RU-S16D-01 is applied before landing, the predicted hash becomes `239ecea6…` and the receipt's `target_sha256` must be updated to it (or re-derived from disk).

The manager must run a **landed-bytes confirmation** before the row is trusted; I cannot sign it from here, and I do not claim the mirror run is that confirmation.

## 8. Honest notes

- I did not run `generate.mjs --check` / `locale-parity` against the repository working tree — the worktree is read-only and shared. Both ran against the mirror described above; the zh-CN failure is the expected artefact of applying only ru and doubles as the guard's control.
- Nothing in the brief asked me to compare against other locales; I read `es`/`fr`/`hi`/`ur`/`vi`/`zh-CN` drafts only to the extent of confirming ru was not accidentally copied from them. It was not.
- I found no BLOCKER and no MAJOR. Agreeing is a failure mode, so both minors are argued from citable evidence (CLDR pattern output, sidecar tone text, and the absence of a capitalising transform in the render path) rather than taste.
