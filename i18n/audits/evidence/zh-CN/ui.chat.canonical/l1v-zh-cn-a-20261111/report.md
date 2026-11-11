# Audit — `zh-CN` — L1 tool-row verbs (182 keys) — report A

**Verdict: `changes_requested`** — 1 MAJOR, 5 MINOR, 2 NIT. No BLOCKER: the whole
slice is a handful of value swaps away from `passed`.

- Mechanical: **all green** (key identity, JSON, placeholders/markup, ICU, bidi,
  English leakage, duplicate values, settled/running pairing, style-guide
  prohibitions, width).
- The MAJOR is a terminology conflict with shipped `zh-CN` copy for the same
  action (`已调整方向` where the product already says `引导`), not a meaning error.

## Scope

| | |
|---|---|
| Locale | `zh-CN` (Simplified Chinese) |
| File group | L1 tool-row verbs — the 182 `ui.chat.canonical.tool_row.verb.*` keys (91 settled/running pairs) |
| Namespace | `ui.chat.canonical` |
| Translating agent | `openai/gpt-6.1-sol` (session unknown to me — I did not translate these files and cannot edit them) |
| Audit | independent pass **A** of the two the manager requested for this high-visibility group (`B` is a separate auditor) |
| Auditor | `i18n-auditor`, session `206ec0ccdd57`, served model **`deepseek/deepseek-flash`** (as reported by this session's model header; no fallback observed) |
| Date | 2026-11-11 |

Inputs, hashed by `run-audit.sh` (see `audit.log` §4):

| Role | Path | sha256 |
|---|---|---|
| English source | `.worktrees/i18n-l1-tool-verbs/src/i18n/catalogues/en/ui.chat.canonical.json` @ `6c0b841872d8` | `a385671b988e5f03df6f650beb4a06f73c9efaead2316dfa9ab15bf043798765` |
| Context sidecar (role/tone/width/placeholders; the 182 verb entries are here) | `…/en/ui.chat.canonical.context.json` | `2e755f12e46bb6dded6dbf950eda6402b0a7bcb05e9489fa17f7369543f3ac7f` |
| Review copy handed to auditors (en + context + notes) | `.worktrees/_l1-prep/keys.json` | `b3f3bfe3688d1461a061009e98a58802171eb181343fdb8fcfd0af07652ca419` |
| Target under audit | `.worktrees/_l1-prep/zh-CN.json` | `d96442be4d7a34decacb52b5133f9ba808c177e01c53261250a51571269cd8bc` |
| Currently shipped `zh-CN` catalogue (consistency reference) | `…/zh-CN/ui.chat.canonical.json` | `705f67d486f9d011925a234c0a5adb2eb258570ebbc78d3eaa2cf25d24299a13` |

Verified disposition of the en input: all 182 English strings in `keys.json` are
byte-identical to the same keys in the English catalogue at `6c0b841872d8`
(0 mismatches), and the context sidecar carries all 182 verb entries — so the
target was translated from the current source, not a stale copy.

Style/terminology authorities read first: `~/local-operator/i18n/style-guides/zh-CN.md`,
`…/style-guides/en.md`, `~/local-operator/i18n/glossary.md`, plus the shipped
`zh-CN` catalogue for consistency. No translation or MT service was used.

## 1. Mechanical — every rule green

Run by `checks.py` inside `run-audit.sh`; full stdout in `audit.log` §1–§3.

| Rule | Result |
|---|---|
| Valid JSON, 182 keys in, 182 out | PASS |
| Key set **and order** identical to `keys.json` | PASS |
| No empty / non-string value | PASS |
| Placeholder/markup/code-span/`%s` sets identical to en (none in source, none added) | PASS |
| No ICU structure introduced (no `{`/`}` anywhere in the values) | PASS |
| No manual bidi control characters (U+200E/200F/202A–202E/2066–2069/U+061C) | PASS |
| No value left identical to English | PASS |
| No stray English — only `Python` (allowed technology name), on `ran_python.{settled,running}` | PASS |
| No two keys share a value (no operation collapsing into another) | PASS |
| Every stem has both `.settled` and `.running` (91 pairs) | PASS |
| Aspect convention: settled `已…`, running `正在…` | PASS |
| One verb per pair, bar the reviewed `find` pair (see below) | PASS |
| No `您`, no `！`, no `。`, no `「」`, no `...`, no ASCII `, : ; ? !`, no space before Latin runs, no stray whitespace | PASS |
| Glossary equivalents only — `会话`, `智能体`, `子智能体`, `项目`, `设备`, `里程碑`; no `对话/代理/子代理/工程/装置/阶段目标` | PASS |

Two facts worth recording, because they are what the operator's acceptance
criterion ("switching to `fr` must leave NO English anywhere") depends on for
this group:

1. The English catalogue at `6c0b841872d8` has all 182 verb keys and the shipped
   `zh-CN` catalogue has **none** of them — so today these rows render English in
   a Chinese session. This slice is the fix, not a cosmetic pass.
2. The repo's own gate is red for the same reason and says so:
   `node scripts/i18n/ledger-check.mjs` → **FAILED — 24 finding(s) across 1106
   ledger entries**, exit 1, with `zh-CN/ui.chat.canonical: missing 182 key(s)`,
   `stale source_sha256 (ledger 38f767d08ff0…, file a385671b988e…)` and two
   auditor-staleness lines (full output in `audit.log` §5). All seven shipped
   locales report the same three or four lines; this is the prep-stage state of
   the shared branch, not a defect of the translation.

## 2. Accuracy — meaning preserved on all 182 keys

Every value names the operation in `context.role`, with the destructive/read-only
polarity right. Spot-checked the pairs where a swap would be dangerous:

- destructive vs read-only: `deleted_team/project/secret` 已删除…, `removed_milestone` 已移除里程碑,
  `removed_device` 已移除设备, `cancelled*` 已取消…, `paused` 已暂停, `stopped_session` 已停止会话,
  `reset_agent` 已重置智能体, `raised_panic` 已触发紧急封锁, `left_network` 已退出网络 — all correct.
- `member_rm` (移除设备) vs `disconnect` (退出网络): the two *network-leaving*
  operations are correctly distinguished — a device is removed, a member leaves.
- `hub` vs `sessions` vs `agent` families do not blur: `已查看会话` / `已查看智能体` /
  `已查看团队` / `已查看项目` / `已查看网络` are distinct.
- `sent` (send tool) 已发送 vs `messaged` (hub send) 已发送消息给 — deliberately distinct, no collision.
- `fetched` (web_fetch) 已获取 vs `searched_the_web` (web_search) 已搜索网页 vs `read` (read/web_read) 已读取 — distinct.
- No generalisation to a generic verb: nothing renders 已调用/已使用/已处理, which the
  sidecar forbids ("keep the tool's own meaning"); the generic verb lives separately
  as `tool_row.generic_verb.*` (正在调用/已调用) and is untouched.

## 3. Idiom and register

Correct for `zh-CN` per the style guide: no pronoun (the guide asks for
verb-forward phrasing), no 您, no sentence-final ., no exclamation, terse
(2–10 glyphs), `已`/`正在` aspect used exactly as the shipped catalogue does
(`已私信`, `已发布至`, `正在列出对话`…). Nothing reads as a calque except the object-slot joins in F1–F3, the
移出/输入至 collocations in F4–F5, and the 定时任务 naming in F6.

## 4. Terminology — one conflict with shipped copy (F1), otherwise clean

Glossary §2 bindings all honoured: session 会话 · agent 智能体 · subagent 子智能体 ·
project 项目 · device 设备 · wake 唤醒 · schedule 定时 · tool trace 轨迹(n/a) ·
compact 压缩(n/a) · prompt 提示词(n/a). Product names, `--flags`, identifiers and
paths are byte-identical (none appear in these values); kept-English is only `Python`.

Cross-file consistency checked against the shipped `zh-CN` catalogue:

- `secret` → **敏感信息** — the *dominant shipped* rendering (`fold.count.secret`
  "…次敏感信息操作", the whole composer secret-request family). The new six values
  follow it. (One older shipped string uses 机密 — pre-existing, out of scope, no
  action here.)
- `todo` → 待办 ✓ (shipped `fold.count.todo` 待办更新 / `run_details.todos` 待办事项).
- `milestone` → 里程碑 ✓; `rename` → 重命名 ✓; `link` → 关联 ✓ (shipped 关联会话).
- `steer` → **已调整方向** ✗ — shipped copy for the same action is **引导**
  (`fold.receipt.steered` 已引导, `composer.steer_hint` 引导智能体). This is F1.
- `join`/`leave`/`devices` → 加入/退出/设备 ✓; `console` → 控制台 ✓ (all eight console keys agree).

## 5. Fit / width (measured, not eyeballed)

The verb column is `shrink-0 whitespace-nowrap` and **never truncates**; the
monospace object is the half that truncates (`tool-row.tsx`, "a verb is at most
three short words"). The widest English verb in this slice is
**`Checking network status` = 23 cells**, so that is the gutter's demonstrated
capacity.

- Widest `zh-CN` values: `正在查看敏感信息说明` 20 cells (en `Describing secret`, 17),
  `正在调整控制台大小` 18 (en 16), `已查看敏感信息说明` 18 (en 16); 16 more sit at
  16 cells each.
- Against English, 126 values are narrower, 20 are equal and 36 are wider; the
  largest inflation is `正在设定定时任务` at 16 cells for `Scheduling` at 10 (+6,
  and it is also F6).
- **No value exceeds 23 cells** → no overflow finding. The 20-cell outlier eats
  object width on a narrow panel — worth knowing, but it is inside the budget
  English itself sets, so I am not charging a change for it.
- Wide-glyph/combining risk: values are pure CJK with no combining marks; the one
  Latin run (`Python`) is ASCII, so cell counts are exact.

## 6. RTL

Not applicable — `zh-CN` is LTR. Checked only that no directional control
characters were introduced (none).

## Second pass (this report **is** pass A; A independently re-derived every key)

I re-walked all 182 values a second time against `context.role` and the *actual*
tool operation semantics, deliberately trying to break the first pass:

- Re-checked each op mapping one by one (bash/eval/read/write/edit/glob/grep/
  web_search/web_fetch/browser, ask/send/wait/secret/project/todo/wake/jobs/peer/
  task, agent/team/hub, network ×12, console ×10, lsp ×4, sessions ×6) — no
  operation reads as a different operation.
- Re-examined `steer`, `peek`, `unlink` specifically because they carry English
  prepositions; that is where the pass found its four object-slot/preposition
  findings, and it is why F1 is MAJOR rather than a nit.
- Re-examined `found_definition`/`found_references` (already `已找到定义` /
  `正在查找定义`): **not a finding**. `正在找到` is not Chinese, so the pair
  cannot share a stem; 已找到 / 正在查找 is the correct settled/progress pair and
  mirrors English's own Found/Finding. My checker initially flagged it and was
  corrected, not the translation.
- Re-examined `已运行Python` for spacing: the guide forbids a space between Chinese
  and Latin runs, so no space is right; `Python` stays as a technology name.
- Re-examined 网页 vs 网络 for `searched_the_web`: 网络 is the *mesh network* in this
  very slice (`listed_networks` 已列出网络), so 网页 is the correct disambiguation.
  No finding.
- Second pass produced **no finding the first pass had missed** and retracted none.

## Findings

### F1 — MAJOR — `steered` / `steering` (`hub` tool's `steer`)

- Current: `已调整方向` / `正在调整方向`
- Problem: two independent grounds.
  1. **Terminology conflict with shipped copy for the same action.** `zh-CN`
     already ships `引导` for hub steering — `fold.receipt.steered` = 已引导,
     `composer.steer_hint` = "立即引导智能体（Enter）", `placeholder.waiting` =
     "引导智能体。…", `run_details` = "…不能用来引导它". A Chinese user steers from
     the composer (引导) and then reads the row as 已调整方向 for that same steer.
  2. **The row's object has no slot.** The verb column is followed by the child's
     name (`已调整方向 qa-tester`); `方向` already fills the object, so the name
     arrives with nothing to attach to. `已引导 qa-tester` parses immediately.
- Suggested: `已引导` / `正在引导` (also 3 cells narrower — 6 → 4 cells).

### F2 — MINOR — `peeked_at` (`hub` peek and `jobs` peek)

- Current: `已查看进展` / `正在查看进展`
- Problem: same object-slot problem — rendered as `已查看进展 qa-8e63` the child/job
  token has no slot after the mass noun 进展 (`已查看进展任务 3` would need a
  classifier, which this layout cannot supply). Readable, but the join is wrong.
- Suggested: `已查看` / `正在查看` — the row supplies the object, as English
  "Peeked at" does. Distinct from every other value in the catalogue (no key is
  bare `已查看`).

### F3 — MINOR — `peeked_at_session` (`sessions` tool's `peek`)

- Current: `已查看会话进展` / `正在查看会话进展`
- Problem: the session id has no slot after 进展; also `已查看会话进展` vs
  `viewed_session` `已查看会话` differ only by a suffix that is part of the *verb*
  rather than the object, so the two `sessions` operations stay confusable.
- Suggested: `已查看会话记录` / `正在查看会话记录` — 记录 is the glossary's transcript
  rendering (`sessions peek` returns recent steps), grammatical with the id
  following, and distinct from `已查看会话`.

### F4 — MINOR — `unlinked_session_from` (`project` tool's `unlink`)

- Current: `已将会话移出` / `正在将会话移出`
- Problem: the `from` relation is dropped — compare the sibling `linked_session_to`
  = `已将会话关联至`, which keeps it — so the project name that follows has no
  anchor (`已将会话移出 proj-x`). Shipped copy for unlink is 解除关联
  (`projects.project_detail.the_session_was_not_unlinked` = "会话未解除关联。").
- Suggested: `已解除会话关联` / `正在解除会话关联`.

### F5 — MINOR — `typed_in_console` (`console` tool's `input`)

- Current: `已输入至控制台` / `正在输入至控制台`
- Problem: 至 collocates with movement verbs in this catalogue (发送至, 发布至,
  关联至, 移至) but not with 输入; `已输入至控制台` reads stiff, and with the typed
  text following, the phrase order fights the object.
- Suggested: `已向控制台输入` / `正在向控制台输入` — natural order, object still lands
  at the end.

### F6 — MINOR — `scheduled` (`wake` tool's `create`)

- Current: `已设定定时任务` / `正在设定定时任务`
- Problem: the product distinguishes a **wake** (唤醒) from its **schedule**
  (定时任务) — shipped `run_details.wake.managed_note` says "此唤醒属于{name}自己的
  定时任务", and 定时任务 is also a *page* name in the command palette. The sibling
  keys of this same tool say `已列出唤醒` / `已取消唤醒`, so one tool's rows now use
  two nouns for one thing, and 定时任务 additionally promises a recurring task
  where a wake is a single follow-up.
- Suggested: `已安排唤醒` / `正在安排唤醒` (alternatively `已创建唤醒` / `正在创建唤醒`).

### N1 — NIT — `messaged` / `messaging` (`hub` tool's `send`)

- Current: `已发送消息给` / `正在发送消息给`. Shipped Team Bridge copy renders the
  same English word differently (`bridge.verb.dm` "Messaged" = 已私信). The new
  longer wording is *clearer* here (it distinguishes the hub send from the `send`
  tool's 已发送, and keeps 给 for the following recipient), so I am not requesting
  a change — flagging the divergence only.

### N2 — NIT — `captured_console` (`console` tool's `screenshot`)

- Current: `已截取控制台` / `正在截取控制台`. 截屏 is the settled word for a screenshot
  and saves 2 cells (`已截屏`). Optional.

## Reviewed and deliberately **not** reported

| Item | Why not |
|---|---|
| `found_definition`/`found_references` stems differ (已找到 / 正在查找) | `正在找到` is ungrammatical Chinese; 已找到/正在查找 is the only correct pair, and English itself varies (Found/Finding) |
| `敏感信息` for "secret" | Dominant shipped rendering in this catalogue (`fold.count.secret`, composer secret family); consistent, and a safe wording |
| `已运行Python` with no space | The style guide explicitly forbids a space between Chinese and Latin runs |
| `网页` for "the web" | Correct disambiguation: 网络 is the mesh network elsewhere in this same slice |
| `已触发紧急封锁` for "Raised panic" | Strong but safe wording for a destructive network action; no over- or under-statement of what happened |
| 20-cell `正在查看敏感信息说明` | Wider than its English sibling but inside the 23-cell ceiling English sets; no truncation and the object is the half that truncates |
| Older shipped strings (机密 for secret, etc.) | Pre-existing, out of this slice's scope |

## Limitations

This is a **catalogue audit of a staging file** (`_l1-prep/zh-CN.json`), not of
rendered bytes: it proves wording, mechanics, terminology and cell width, and
does **not** prove rendered fit in the running app, activation/eligibility, or
release readiness. I did not run `ledger-assemble` — it cannot be honest yet:
it derives the row's hashes from the catalogue **on disk**, and the `zh-CN`
catalogue does not carry these 182 keys until the values are applied
(`ledger-check` above is the proof). After applying, the ledger row is:

```
node scripts/i18n/ledger-assemble.mjs --locale zh-CN \
  --file src/i18n/catalogues/zh-CN/ui.chat.canonical.json \
  --auditor-instance l1v-zh-cn-a --auditor-model deepseek/deepseek-flash \
  --result <derived> --receipt i18n/audits/evidence/zh-CN/ui.chat.canonical/l1v-zh-cn-a-20261111/receipt.json \
  --scope "L1 tool-row verbs, 182 keys, audit pass A" \
  --note "…" --translator-agent translator --translator-model openai/gpt-6.1-sol
```

That receipt is a **staging** receipt: its `sha256.zh-CN` names the prep file, so
whoever assembles the row must re-point it at the applied catalogue (the tool will
refuse otherwise — by design). If F1–F6 are fixed first, the applied bytes differ
and this audit's hash refers to the pre-remediation file; the remediation round
then re-audits the delta.

## Reproduce

```
bash ~/local-operator-ui/.worktrees/i18n-l1-tool-verbs/i18n/audits/evidence/zh-CN/ui.chat.canonical/l1v-zh-cn-a-20261111/run-audit.sh
```

Evidence retained (tracked path, untracked until the PR commit):

```
i18n/audits/evidence/zh-CN/ui.chat.canonical/l1v-zh-cn-a-20261111/
  record.json   audit.log   checks.py   run-audit.sh   receipt.json
```

Report copy for the manager: `.worktrees/_l1-prep/audit-zh-CN-A.md`.
