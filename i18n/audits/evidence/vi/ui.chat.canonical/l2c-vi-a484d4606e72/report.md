# Audit — vi · ui.chat.canonical (combined bytes, PR #1861 rebased onto post-#1862 main)

## Record block

| field | value |
|---|---|
| `locale` | `vi` (Vietnamese) |
| `namespace` | `ui.chat.canonical` (442 English keys) |
| `audit_date` | 2026-11-11 |
| `auditor.agent` | `i18n-auditor` (independent: did not translate these files, edits nothing) |
| `auditor.model` (ACTUAL served) | `deepseek/deepseek-flash` — taken from this session's own runtime header (`Model: deepseek/deepseek-flash`); no fallback model was involved or reported |
| `auditor.session` | `a484d4606e72` |
| `auditor.independent_from_translator_session` | `true` — translators were `openai/gpt-6.1-sol` (`tool_row.verb.*`, #1862) and `anthropic/claude-sonnet-5-5` (file-size keys, #1861) |
| `actual_model_source` | session runtime header; no fallback |
| source commit | `659ef7e44b7ccb4800e9853ef355ea58b49854cc` (branch `cand-rebased-unaudited`), read via `git show` only |
| `key_count` | 442 |

`input_hashes` (sha256 over `git show 659ef7e44b7c:<path>` bytes, computed with Python `hashlib` and cross-checked with `shasum -a 256`):

```
en       src/i18n/catalogues/en/ui.chat.canonical.json          38f1069648c9241799bb1b316820e0530bf9445dfba3151e1c28df70153916b3   39293 B
context  src/i18n/catalogues/en/ui.chat.canonical.context.json  c258ab485de698eec85e81ffed506866e3b1e8caf29cb3ff434901388065b390  245714 B
vi       src/i18n/catalogues/vi/ui.chat.canonical.json          325e37d1a3b5e8a0bbdfbf57bbb5ea3208fb377e35407ca989cba6d5e08b6cb8   41497 B
```

For orientation (not the audited bytes): `origin/main` en is `a385671b988e5f03df6f650beb4a06f73c9efaead2316dfa9ab15bf043798765` (440 keys) and the stale ledger row for `vi`/`ui.chat.canonical` records target `cf703b1f…` / source `a385671b…`. Both are superseded by the hashes above.

**Verdict: `passed` — clean-with-findings.** 0 BLOCKER · 0 MAJOR · 2 MINOR · 3 NIT.
Both MINORs and all three NITs are pre-existing text (present byte-identical in `origin/main`'s `vi` catalogue); none is in this PR's added delta. The two keys this candidate adds are clean.

---

## Scope and what changed in the combined bytes

`git show 659ef7e44b7c:…/en/ui.chat.canonical.json` diffed against `origin/main`'s copy adds exactly two keys (442 vs 440), both from #1861's file-size slice:

```
+ ui.chat.canonical.tool.never_sent_composed  "never sent · {size} composed"
+ ui.chat.canonical.tool.never_sent_empty     "never sent · nothing composed"
```

The `tool_row.verb.*` keys from #1862 are already on `main` (182 keys) and are unchanged by this candidate. The `vi` file differs from `origin/main` by exactly those two appended keys and nothing else (checked key-by-key: 0 changed, 0 dropped, order preserved).

## Mechanical pass (all 442 keys)

I did **not** run the repository validator (`pnpm check-i18n` / `node scripts/i18n/generate.mjs`) — the manager's brief for this audit forbids builds, tests and the repo generator under the active memory guard, and this is a read-only audit. Instead I wrote a small read-only validator in session scratch (`icu.py`, a brace-aware ICU parser, plus `audit-vi.py`) and ran it over `git show` output. Everything below is output I observed, not inference:

- **JSON / structure** — parses; 442 key lines, 442 unique (no duplicate keys silently collapsed by the parser); no CRLF; file ends with a newline; 0 `\uXXXX` escapes (the `vi` file is literal UTF-8 while `en` escapes `\u00b7`, a representation difference only, both decode identically).
- **Key set and order** — identical to `en`: 0 missing, 0 extra, order matches index-for-index (so the two appended keys sit in the same tail position as English).
- **Placeholders** — for every key, the set of argument names and types (`{size}`, `{name}`, `{count, number, ::group-off}`, `{count_display}`, nested `{count, number, ::group-off}` inside plural arms, …) is identical to English; 0 mismatches. `{size}` appears exactly once in `never_sent_composed` and not at all in `never_sent_empty`, matching English.
- **ICU plural/select** — 58 plural nodes on both sides. `vi` uses only the `other` category plus exact-value arms (`=0` retained where English has it: `tool_row.bridge.summary.members`, `.messages`), which is exactly the CLDR set for `vi` (`other` only) and exactly what the style guide mandates ("never add one/other branches"). No `one`, `few`, `many`, `two` arms anywhere in `vi`; no illegal category; no offset; braces balanced on every value.
- **Four keys drop an English `=1` exact arm** (`fold.images_aria`, `fold.more_images`, `image_gen.batch_summary`, `lightbox.filmstrip_aria`). Checked one by one: in each, the English `=1` arm differs from its `other` arm only by singular/plural inflection, so collapsing to `other` loses no meaning in a language without plural agreement. Correct, not a finding.
- **Markup / code / tokens** — no backtick code spans and no rich tags in this namespace; every Latin or numeric literal in the English (product names, `Team Bridge`, `Local Operator`, `seq`, `python`, `console`, `HTML`, `Finder`, `Canvas`) is present unchanged in `vi` except where the English word itself was translated on purpose (checked token-by-token; the only mechanical hits were `DM` in `tool_row.bridge.fallback.dm` and `…delivery.inbox_only.note`, discussed below and cleared).
- **Hygiene** — every value is NFC (style guide: always precomposed); no combining-mark decomposition; no `U+00A0`/`U+202F`/zero-width/`U+FEFF` characters anywhere; no stray tabs/newlines; no double spaces; no space before punctuation; no straight `"` quotes; no ASCII `...` (all ellipses are `…`); no `!` that English does not have. The only leading/trailing-space values are the two separator keys `fold.unit_separator` (`" · "`) and `supplement.withheld.reason_separator` (`", "`), identical to English by design.
- **Values identical to English** — 6, all structural and all legitimate: `fold.sentence.join` (`{first}, {second}`), `fold.count.named`, `fold.unit_separator`, `supplement.withheld.reason_separator`, `tool_row.bridge.detail.headline.target` (`{verb} {target}`), `tool_row.bridge.summary.count`. No English prose is left untranslated.

## File-size semantics (focused pass)

`tool.never_sent_composed` / `tool.never_sent_empty` are one-line tool-row status lines (`canonical-transcript.tsx::toolRecordSummary`, candidate line 2321); `{size}` is inserted **already formatted** and must not be reformatted. `vi` renders:

- `never sent · {size} composed` → `không được gửi · đã soạn {size}` (31 cells vs en 28)
- `never sent · nothing composed` → `không được gửi · chưa soạn gì` (29 cells vs en 29)

Judgement: **correct**. "never sent" is the harness's verdict or a dead turn, and `không được gửi` ("was not sent", passive, no tense overreach into "will be sent") preserves that without claiming a failure; the file's other status words are lower-case, punctuation-free fragments (`đang chờ`, `thất bại`, `bị ngắt`) and these match that register. `đã soạn` / `chưa soạn gì` are a parallel pair and put the amount after the verb, which the sidecar explicitly permits ("whole line is one message so word order can follow the target language"). The middle-dot separator, both spaces and the absence of a trailing period match English and the neighbours (`thất bại · {code}`).

Consistency with the neighbouring `tool_row.verb.*` column: the verbs use the active `Đang …/Đã …` (`Đã gửi`, `Đã tạo`), and this line deliberately does **not** borrow `Đã gửi` — it would claim a send that never happened, which is the exact distinction the English makes ("`never sent`, not `failed`"). It also stays distinct from `tool_row.outcome.never_ran` → `không chạy` (a different, English-distinguished state).

**Units: verified, not inferred.** In this namespace the catalogue carries no unit symbol at all — I searched all 442 `en`/`vi`/`fr` values and found zero hard-coded `B/KB/MB/GB/KiB` strings, so no locale-vs-formatter mismatch is possible here. I also measured what the formatter actually prints, with a single `node -e` call (Node 24.22.1 / ICU, the runtime `src/i18n/format.ts` targets): `Intl.NumberFormat("vi", {style:"unit", unit:"kilobyte", unitDisplay:"short"})` → `12,4 kB`, megabyte → `12,4 MB`, and **bare byte in `short` → `12,4 byte` (an English word)**, which is why the module reads bytes from `narrow` (`12,4 B`). So a Vietnamese user sees `không được gửi · đã soạn 12,4 kB` / `… 512 B`; comma decimal, Latin unit, no English leaked. That matches the recorded `FILE-SIZE UNITS` decision in `src/i18n/format.ts` (fr `o/ko/Mo`, ru `Б/кБ/МБ`, zh-CN `字节/KB`, vi/es/ur Latin `kB/MB/GB`) — for `vi` the Latin form **is** CLDR's own spelling, so there is nothing to localize and the style guide's "digits: Latin (v1)" is honoured.

## Findings

### MINOR

**vi-1 — `tool_row.verb.steered.running` / `.settled`** (pre-existing; unchanged from `main`)
Current: `"Đang chuyển hướng"` / `"Đã chuyển hướng"` (en: `Steering` / `Steered`).
Problem: the same English term is rendered two ways inside this one file — `fold.receipt.steered` says `"Đã định hướng"` — and the house wording for steering a running turn is `định hướng` (`ui.mesh.json`: `"định hướng lượt đang chạy ở đó"`; `ui.projects.json`: `"…sẽ định hướng lượt đang chạy"`). `chuyển hướng` is the word this product uses for redirecting a path/URL (`ui.chat.pickers.json`: `"được chuyển hướng bởi LOCAL_OPERATOR_HOME"`), so the verb column reads as "redirecting" rather than "steering".
Suggested: `"Đang định hướng"` / `"Đã định hướng"`.

**vi-2 — `tool_row.verb.cancelled_wake.*` and `tool_row.verb.listed_wakes.*` vs `fold.count.wake`, `fold.receipt.wake`** (pre-existing)
Current: `"Đang hủy lịch thức dậy"`, `"Đã liệt kê lịch thức dậy"` in the verb column, but `"…lịch đánh thức"` and `"…biên nhận đánh thức"` in the fold counts.
Problem: one namespace, two spellings of the same noun. The product's shipped noun for a schedule is `lịch đánh thức` (`ui.schedules.json`: 27 values, 31 occurrences, audited waves), while the style guide's citation form for the concept is `thức dậy` (intransitive). Neither is wrong in isolation — `đánh thức` is the causative "a schedule wakes the agent" — but the file cannot show both. The guide is silent on the compound, which is where the split comes from.
Suggested: align the two verb keys to the house noun (`"lịch đánh thức"`), **or** record the distinction in `vi.md` ("`thức dậy` for the agent's own verb; `lịch đánh thức` / `biên nhận đánh thức` for the noun compounds") and leave the text as is. Auditor's preference: align the text, since the compound already has 27 shipped values behind it.

### NIT

**vi-3 — `tool_row.bridge.verb.ack_done.failed/running/settled`** (pre-existing)
Current: `"Không thể nhả"` / `"Đang nhả"` / `"Đã nhả"` (en: `Couldn't release` / `Releasing` / `Released`, object = a claimed message).
Problem: `nhả` alone is dev-register shorthand; the row appends an object ("Đã nhả #release"), and the counterpart `ack_working` is spelled out (`"Đã nhận xử lý"`), so the pair is asymmetric.
Suggested (only if the reviewer agrees the row reads short): `"Đã nhả xử lý"` / `"Đang nhả xử lý"` / `"Không thể nhả xử lý"`. Keeping `nhả` is defensible.

**vi-4 — `lightbox.show_image`** (pre-existing)
Current: `"Hiện hình ảnh {index, number, ::group-off}/{count, number, ::group-off}"` (en: `Show image {index} of {count}`).
Problem: the sidecar says this is the thumbnail's *tooltip and accessible name*, and every other locale spells the relation out — `sur` (fr), `de` (es), `из` (ru), `از …` (ur), `कुल … में से` (hi), `（共{count}张）` (zh-CN). A `1/3` run is conventionally read as a fraction or ratio in Vietnamese, not as a position in a set. That reading judgement is mine from the copy alone — I did not drive a screen reader here, so this is a copy nit, not a measured a11y defect.
Suggested: `"Hiện hình ảnh {index, number, ::group-off} trên {count, number, ::group-off}"` (+6 cells; it is an accessible name, not a tight status line).

**vi-5 — `send_failure.aside_not_answered`** (pre-existing)
Current: `"Câu hỏi bên lề chưa được trả lời."` (en: `The aside was not answered.`)
Problem: `chưa` shifts a closed past statement ("was not answered") to "hasn't been answered yet", which reads as still-pending. It pairs acceptably with the sibling `aside_still_answering` (`"…vẫn đang được trả lời"`), so this is a nuance call, not an error.
Suggested: leave as is, or `"Câu hỏi bên lề không được trả lời."` if the "closed" reading is wanted.

## Considered and cleared (deliberate divergences, not findings)

- `tool_row.bridge.fallback.dm`: `"a DM"` → `"một người"` ("a person"). Every other locale says "a direct message", so this looked like an accuracy slip. It is not: the object is appended after `verb.dm.*`, which `vi` renders `"Đã nhắn cho"`, so the row reads `Đã nhắn cho một người` — the corrected English shape, and it avoids the English's own awkward `Messaged a DM`. Cleared after reading the call site (`bridge-row-model.ts::bridgeTargetText`).
- `fold.count.wake` / `fold.receipt.wake` using `đánh thức`: cleared as *usage*, raised only as the consistency point vi-2 above.
- `=[0-9]` exact arms retained, `one` arms dropped: correct for `vi` (CLDR `other` only, style guide binding).
- `supplement.file_actions.open_in_canvas` → `"Mở trong Canvas"`: capital `C` matches the product's shipped name for the feature (`ui.canvas.shell.canvas` = `"Canvas"`), so it is a proper noun here, not Title Case.

## Out of scope for this file group (recorded, not gating)

`canonical-transcript.tsx` lines 2326 and 2331 (candidate) still build two sibling tool-row states from raw English literals, unchanged from `origin/main`:

```ts
return `composing${record.argumentBytes ? ` · ${formatBytes(record.argumentBytes)}` : ""}`;
return `queued${record.argumentBytes ? ` · ${formatBytes(record.argumentBytes)}` : ""}`;
```

No catalogue key exists for `composing` / `queued` in this namespace, so a `vi` user watching a live tool row reads `composing · 4,2 kB` in English. It is a code-level keying gap (the scanner's baseline is empty at this commit, so it is not currently counted), it predates this PR, and it is not a translation defect — flagged here only because it bears on the programme's "no English anywhere" acceptance and sits directly beside the two keys I audited.

## Ledger

I am read-only, so I recorded nothing: the ledger row and the tracked evidence bundle are the manager's (or an integrating coder's) writes. Values this audit authorises:

```
locale            vi
namespace         ui.chat.canonical
source_sha256     38f1069648c9241799bb1b316820e0530bf9445dfba3151e1c28df70153916b3
target_sha256     325e37d1a3b5e8a0bbdfbf57bbb5ea3208fb377e35407ca989cba6d5e08b6cb8
auditor           i18n-auditor · deepseek/deepseek-flash · session a484d4606e72
date              2026-11-11
result            clean-with-findings   status: passed
findings          blocker 0 · major 0 · minor 2 · nit 3
instance          <manager picks; suggested: l2size-vi-r1>
```

Proposed note for the ledger row (≤280 chars, path to be true only once the record is committed). Suggested tracked record dir: `i18n/audits/evidence/vi/ui.chat.canonical/l2size-vi-r1/` (`record.json` + `audit.log` + `receipt.json`, contract per `i18n/audits/evidence/README.md`):

> vi ui.chat.canonical combined 442 keys at 659ef7e44b7c (#1861 never_sent size keys + #1862 tool_row.verb). 0 blocker/0 major/2 minor/3 nit, all 5 pre-existing. Record: i18n/audits/evidence/vi/ui.chat.canonical/l2size-vi-r1/record.json

## Artifacts used in this audit (session scratch, temporary)

- `scratchpad://audit-vi.py` — mechanical validator (key set/order, brace-aware ICU shape, NFC, hygiene, expansion ratios)
- `scratchpad://icu.py` — brace-aware ICU message parser used by the above
- `scratchpad://pairs.txt`, `scratchpad://xloc.py`, `scratchpad://out-vi.txt` — paired listings and cross-locale comparison used for reading
- `scratchpad://vi.raw.json` — the `vi` bytes as read from `659ef7e44b7c` (byte-level checks)

These are work-in-progress notes, not the record of audit; the record must be committed under `i18n/audits/evidence/`.
