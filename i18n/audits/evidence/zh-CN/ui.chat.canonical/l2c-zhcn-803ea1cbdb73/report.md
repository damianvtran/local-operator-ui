# L2 combined-namespace audit — `zh-CN` / `ui.chat.canonical`

## Record

| field | value |
|---|---|
| locale | `zh-CN` (Simplified Chinese) |
| namespace | `ui.chat.canonical` (442 keys) |
| candidate | commit `659ef7e44b7ccb4800e9853ef355ea58b49854cc` (branch `cand-rebased-unaudited`), read only via `git show` in `~/local-operator-ui/.worktrees/i18n-l2-file-sizes` |
| auditor agent | `i18n-auditor` (independent of the translator; read-only — no edits, no repo writes) |
| ACTUAL served model | `deepseek/deepseek-flash` (session runtime model header; **no** provider fallback used or declared for this run) |
| session id | `803ea1cbdb73` |
| date | 2026-11-11 |
| `input_hashes:` | en `38f1069648c9241799bb1b316820e0530bf9445dfba3151e1c28df70153916b3` · context `c258ab485de698eec85e81ffed506866e3b1e8caf29cb3ff434901388065b390` · target `zh-CN` `4176670606e68058e498a36006ba8c770af64489ec77d77e78d3a2754ab2ddf0` |
| baseline hashes | en@origin/main `a385671b988e5f03df6f650beb4a06f73c9efaead2316dfa9ab15bf043798765` · zh-CN@origin/main `5a2d874409f2839c78ee8d63bcc62305bd9cc7b11782c80551561edc189515e2` |
| style guide / glossary | core `i18n/style-guides/zh-CN.md` `8f95d89debbd0af848e72e4805e256ef9566632e520a5c6d9b37928cd617142c` · core `i18n/glossary.md` `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8` (both byte-identical to core `origin/main`; the UI repo carries **no** `i18n/style-guides/` directory) |
| **verdict** | **clean-with-findings → status `passed`** |
| severity counts | **BLOCKER 0 · MAJOR 0 · MINOR 3 · NIT 2** |

No BLOCKER or MAJOR remains, so the ledger status for this pair is `passed`. Every MINOR is a **retained** byte (present unchanged on `origin/main`), so none of them gate this PR.

## What this audit covers, and what it reuses

The rebase made #1861's file-size keys and #1862's tool-row verbs land in the same namespace file, so the ledger rows — which hash the whole file — no longer describe the bytes. This audit re-binds the **combined** file.

The delta is auditable exactly: comparing values against `origin/main`, the candidate's `zh-CN` file has **0 changed keys, 2 added keys, 0 removed keys**, and the English source likewise adds exactly the same 2 keys. So:

- the two added keys (`ui.chat.canonical.tool.never_sent_composed`, `…never_sent_empty`) got the focused review below;
- the 440 retained values are carried as previously audited **on proof of byte identity** with `origin/main` (`5a2d8744…`), not on memory of the earlier reports;
- I still read every retained value rather than relying on that proof alone, and the three MINORs below are what that reading found.

## 1. Mechanical (all PASS)

Repo validator substitution, stated plainly: **`pnpm check-i18n` was NOT run.** This lane is read-only and forbids installs, builds, tests and the generator (memory guard active). I re-implemented what I could verify statically in python and name below which gate each check stands in for and what remains CI's:

| check | result | stands in for |
|---|---|---|
| 442/442 keys present, no extras, no duplicates (raw key lines counted too) | PASS | `generate.mjs --check` freshness / `check-coverage.mjs` |
| key order identical to English | PASS | convention, not machine-gated |
| valid JSON, tab indent, trailing newline | PASS | parse gate |
| all values NFC | PASS | typography gate |
| no empty values | PASS | coverage gate |
| placeholder names **and types** identical per key (`{size}` simple in both; `never_sent_empty` has none) | PASS | `t()` param-map / `keys.gen.ts` types |
| 58 plural/select messages: same argument names + node types as English; `other` present in all 58; no `one`/`few`/`many` introduced (zh-CN CLDR = `other` only) | PASS | ICU structure gate |
| en `one`/`=1` arms collapsed to `other`, `=0` arms kept where meaningful (`bridge.summary.members`, `…messages`) | PASS — correct for Chinese, which has no grammatical number | — |
| no backticks, markup/Rich tags or standalone CLI flags exist in the English source, so none could be damaged | PASS (0/0/0) | token-preservation gate |
| English-identical values: exactly 2, both structural — `tool_row.bridge.detail.headline.target` = `{verb} {target}` (pure placeholder scaffolding) and `fold.unit_separator` = `" · "` (a mid-dot separator token). Neither is copy. | PASS (named exceptions) | "no English left" rule |
| stray whitespace: only `fold.unit_separator` (`" · "`), which is its contract | PASS | — |
| Latin runs inside `zh-CN` values: only allowed technical tokens — Team Bridge, Local Operator, Python, shell, `diff`, `seq`, Canvas, Finder, HTML, Enter, `id`, `code`, `error`, `duration` — plus ICU argument names. No untranslated English sentence anywhere. | PASS | operator acceptance ("no English anywhere") |
| fullwidth punctuation present where prose punctuation is used; the two new keys use the shipped ` · ` separator and carry no sentence-final `。` | PASS | style guide |

Reuse is not contradicted by the two exceptions: nothing in that table is English *copy*.

## 2. The file-size keys, reviewed against what the formatter actually prints

**What I verified (executed, not inferred):** ran `Intl` in `node v24.22.1 / ICU 78.3 / CLDR 48.0` with the exact style the code uses (`format.ts::fileSizeUnitLabel` reads the **narrow** unit part; `fileSizeSeparator` reads the short-kilobyte literal):

```
zh-CN narrow byte/kilobyte/megabyte/gigabyte = B / kB / MB / GB
separator = U+0020 (plain space)
512 B -> "512 B"; 1536 -> "1.5 kB"; 1048576 -> "1.0 MB"; 2600000 -> "2.5 MB"
```

That measurement matches the repo's own pinned table at `scripts/i18n/file-size.test.mjs:68` (`"zh-CN": ["0 B","1 B","1 kB","1 kB","1.5 kB","1 MB","2.5 GB"]`). **Correction to my brief:** zh-CN does *not* use `字节/KB` on this runtime — CLDR 48 gives the Latin `B / kB / MB / GB`, so the app prints Latin unit symbols for Chinese and the copy must not hard-code a translation of them. The translated strings correctly contain **no unit text at all**; `{size}` carries the whole number-and-unit run. Nothing to fix — this is a fact correction, not a finding.

**The two strings:**

| key | en | zh-CN |
|---|---|---|
| `…tool.never_sent_composed` | `never sent · {size} composed` | `未发送 · 已编写{size}` |
| `…tool.never_sent_empty` | `never sent · nothing composed` | `未发送 · 未编写内容` |

Accuracy: `未发送` = "never sent" — correct and, importantly, **distinct from** `未送达` ("not delivered", which the catalogue uses for `transcript.not_delivered`); the source comment is explicit that this state never reached a tool, so the stronger word is the right one. Both lines are parallel (`已编写{size}` / `未编写内容`), terse, pronoun-free, no trailing punctuation, and the ` · ` separator and its spacing match the shipped `fold.unit_separator` and `bridge.outcome.*` (`失败 · {code}`).

Fit, measured in cells (CJK/fullwidth = 2):

```
未发送 · 已编写512 B   -> 20 cells
未发送 · 已编写1.5 kB  -> 21 cells
未发送 · 已编写2.0 MB  -> 21 cells
未发送 · 未编写内容    -> 19 cells
```

The English counterpart is 29 cells for the same size, so the Chinese row is **shorter than the line it replaced in English** and inherits the existing ellipsis truncation — no new overflow risk. No `maxCells` exists in this namespace's sidecar (it carries prose `length` hints; measured 0 entries with `maxCells`), so cells are the usable evidence. No space between `编写` and the digit run is correct here: the zh-CN style guide forbids it, and the file is consistent (`{count}个文件`, `再按一次Enter`).

Terminology in the neighbourhood: `tool_row.outcome.never_ran` = `未运行`, `send_failure.*` = `消息未发送`, `tool_row.verb.sent.*` = `正在发送/已发送` — the new pair is consistent with all of them, and `智能体`/`子智能体` (glossary rows) are used everywhere with no `代理` anywhere in the file.

## 3. Findings

### MINOR

**M1 — `ui.chat.canonical.supplement.withheld.line` and `…line_no_reason`**
Current: `{count, plural, other {# 个文件未显示}}：{reason}` / `{count, plural, other {# 个文件未显示}}`
Problem: a plain space sits between the substituted count and the classifier `个` (renders "3 个文件未显示"). The zh-CN style guide's punctuation section says *"No space inserted between Chinese text and Latin/digit runs"*, and the file's own plural counts comply (`fold.count.file` → `{count, number, ::group-off}个文件`, `supplement.withheld` is the only space).
Proposed: `#个文件未显示` in both keys.
Status: **pre-existing** — byte-identical on `origin/main`; disposition **deferred** (not this PR's copy, non-gating).

**M2 — `ui.chat.canonical.tool_row.verb.found_definition.settled` and `…found_references.settled`**
Current: `已查找定义` / `已查找引用`
Problem: the settled state says **found**; `已查找` says "looked up / searched", which is the *running* verb (`正在查找定义`). The settled column of the same table elsewhere is genuinely perfective (`已读取`, `已写入`, `已创建`).
Proposed: `已找到定义` / `已找到引用`.
Status: **pre-existing** (retained #1862 bytes, unchanged by the rebase); disposition **deferred**.

**M3 — `ui.chat.canonical.tool_row.diff.truncated`**
Current: `{count, plural, other {diff已截断 — 还有#行未记录}}`
Problem: a spaced single em dash in Chinese prose. The style guide requires full-width punctuation for prose and allows Latin punctuation only inside Latin/code fragments; the sibling `notice.compaction_not_run_after_colon` in this same file uses the Chinese `——`.
Proposed: `{count, plural, other {diff已截断——还有#行未记录}}`.
Status: **pre-existing**; disposition **deferred**.

### NIT

**N1 — `ui.chat.canonical.transcript.worked`**: `已进行工作` for "Worked" is stiff ("work was carried out"). `已工作` would be terser and status-like; the adjacent `transcript.worked_for` = `工作耗时{duration}` already carries the noun. Pre-existing; no change required.

**N2 — `ui.chat.canonical.security_notice.show_code`**: `显示审核的代码` can be read as "code that audits". `显示已审核的代码` removes the ambiguity in a security-adjacent control. Pre-existing; no change required.

### Observations (no severity, not findings)

- **O1 — my brief's unit expectation was wrong, not the translation.** See §2: measured zh-CN CLDR gives `B/kB/MB/GB`, so the localized copy correctly carries no unit spelling. Anyone reviewing this locale should expect Latin units here and must not "fix" them to `字节`.
- **O2 — the same row still prints English beside the new keys (pre-existing, outside this namespace).** `src/renderer/src/features/chat/canonical/canonical-transcript.tsx:2322-2323` still returns raw literals `` `composing${…}` `` / `` `queued${…}` ``; confirmed identical on `origin/main`. So a zh-CN transcript shows `composing · 1.5 kB` / `queued · 1.5 kB` in English one line below the audited `未发送 · …` line. Not a translation defect and not this PR's scope, but it is an operator-acceptance gap ("no English anywhere") that the programme will have to close separately.
- **O3 — the ledger rows are stale and this audit is what unblocks them.** Candidate en `38f10696…` ≠ ledger `source_sha256 a385671b…` (= main), and candidate zh-CN `41766706…` ≠ ledger `target_sha256 5a2d8744…` (= main). All seven `ui.chat.canonical` rows need re-binding to the combined bytes; for zh-CN the row must cite this record's path and note (≤280 chars). This audit asserts nothing about the other six locales.

## 4. Validator substitution — what I did not run, and what remains for CI

Not run, by lane rule: `pnpm check-i18n` and therefore, in their repo implementations, `generate.mjs --check` (generated map freshness), `ledger-check.mjs` (which will currently fail on the stale hashes — expected, see O3), `context-parity.mjs`, `check-coverage.mjs`, `check-strings.mjs` and the added-copy guard. My python suite reproduces the *key/placeholder/CLDR/NFC/emptiness/order* semantics of those gates but is **not** their code, and it proves nothing about `keys.gen.ts` freshness or the literal ratchet. Those remain CI's to prove on the pushed head; this audit claims no execution of them.

## 5. Hand-off for the ledger (values the manager needs)

- **Bind for `zh-CN` / `ui.chat.canonical`:** source (en) `38f1069648c9241799bb1b316820e0530bf9445dfba3151e1c28df70153916b3`, target `4176670606e68058e498a36006ba8c770af64489ec77d77e78d3a2754ab2ddf0`; auditor `i18n-auditor`, actual model `deepseek/deepseek-flash`, instance `803ea1cbdb73`, result `clean-with-findings`, findings `{blocker: 0, major: 0, minor: 3, nit: 2}`.
- **Suggested receipt:** `i18n/receipts/803ea1cbdb73.json` (prepared at `scratchpad://au1861/receipt.suggested.json`).
- **Suggested ledger note (167 chars, ≤280):** `Combined-bytes audit 659ef7e4 (file-size + tool-row verb union): 0 blocker/major; record i18n/audits/evidence/zh-CN/ui.chat.canonical/l2c-zhcn-803ea1cbdb73/record.json`
- **Copy into the tracked evidence root before session cleanup** (they are auditor-side artifacts, not repo writes): `scratchpad://audit-1861-zh-CN.md` → `…/l2c-zhcn-803ea1cbdb73/report.md`; `scratchpad://au1861/mechanical.json`; `scratchpad://au1861/audit.log`; `scratchpad://au1861/record.suggested.json` → `…/record.json`; `scratchpad://au1861/receipt.suggested.json` → `…/receipt.json`.
