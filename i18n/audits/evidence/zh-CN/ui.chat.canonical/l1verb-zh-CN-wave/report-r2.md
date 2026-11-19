# l1-a2-zh-CN — zh-CN round-2 delta audit (182 tool-row verb keys, v2)

Auditor: i18n-auditor (independent; did not translate; did not read other round-2 reports). Served model: anthropic/claude-sonnet-5-5.
Inputs: keys.json, zh-CN.json (v1), zh-CN.v2.json, zh-CN.v2-changes.md, audit-zh-CN-A/B.md, style guide zh-CN.md, glossary.md, shipped catalogue ../i18n-l1-tool-verbs/src/i18n/catalogues/zh-CN/ (8879 string values).

**Verdict: clean** — blocker 0, major 0, minor 0, nit 0. Not a ledger write; the repo ledger gate remains the manager's integration step.

## 1. Changed keys (python3 diff v1 vs v2: 16 values, 9 families)
| key | v1 → v2 | judgment |
|---|---|---|
| steered | 已调整方向 / 正在调整方向 → 已引导 / 正在引导 | OK. Matches shipped `fold.receipt.steered` = 已引导, `composer.steer_hint` 立即引导智能体, `placeholder.waiting` 引导智能体 (verified by grep). Child ID now reads as the object. Fixes A:F1 MAJOR. |
| peeked_at | 已查看进展 / 正在查看进展 → 已查看 / 正在查看 | OK. Role = hub AND jobs peek; the object 进展 was pre-filled and wrong for a job ID. No collision: no other bare 已查看 row. |
| peeked_at_session | …会话进展 → 已查看会话记录 / 正在查看会话记录 | OK. Distinct from viewed_session (已查看会话, `info`); 会话记录 is the guide's standalone-transcript term (zh-CN.md line 34). |
| scheduled | 已设定定时任务 → 已安排唤醒 / 正在安排唤醒 | OK. Role is `wake create`; sibling rows listed_wakes 已列出唤醒 / cancelled_wake 已取消唤醒 now one family; guide "wake → 唤醒". Not a recurring schedule, so dropping 定时任务 is right. |
| listed_network_peers | 网络设备 → 网络成员 | OK. 网络设备 = network hardware; shipped `mesh_reach.handshake_refused_hint` uses 网络成员. Parity with English "peers" vs "device" (invited/removed_device keep 设备), so not a two-names-one-concept regression. |
| captured_console | 已截取控制台 → 已截取控制台画面 | OK. Disambiguates screenshot op. 18 cells running. |
| typed_in_console | 已输入至控制台 → 已向控制台输入 | OK. Natural; following object is the console ID, same slot pattern as the other console rows. |
| found_definition / found_references (settled only) | 已找到… → 已查找… | OK. Settled/running now share 查找; 已查找 is also true on an empty result. |

Neighbour check (unchanged keys a changed key could contradict): wake family, console family (10 ops all 控制台), sessions family, network family, hub family (messaged 已发送消息给 vs sent 已发送 distinct) — no contradictions found.

## 2. Declined findings — adjudication
- **A:F4 / B:N3 unlinked_session_from (已将会话移出) — UPHELD.** Source key notes require the trailing "from" slot; 移出 + following project reads as "removed from <project>". Shipped use confirms the same container-removal sense (`mesh_approvals.move_sessions_to_or_from_there` 将会话移入或移出该设备; teamBridge 移出对话 ×several; 10 shipped values contain 移出). Proposed 已解除会话关联 leaves the project without a source relation. 解除关联 occurs once, as a full sentence (`the_session_was_not_unlinked`) — not slot-compatible.
- **A:N1 messaged — UPHELD** (reviewer asked for no change; 给 binds recipient, distinguishes hub send from 已发送).
- **B:M1 secret family (敏感信息, 6 families/12 values) — UPHELD.** Re-counted over shipped zh-CN: 敏感信息 = 22 values (translator's number correct), 机密 = 1, 密钥 = 131, 凭据 = 62, and 敏感信息 is the established noun for the secret *input* concept (`fold.count.secret`, `question_dock.secret_*`, `composer.secret_*`, `credential_notice.*`, `slash.locked.fields`). 凭据 is an authentication-credential term in shipped copy (`credential_notice`, credential picker); 密钥 = keys. B's "reads as personal data" has weaker basis than "matches the shipped secret surface". Consistency over minor semantics; 调取 acceptable. Tiny caveat only (not a finding): the single shipped 机密 hit is the secret-tool description; translator should log the 敏感信息 choice in the glossary as proposed.
- **B:N2 listed/cancelled 唤醒 — UPHELD.** Guide line 34 + glossary §2 prescribe 唤醒; 49 shipped values use it; scheduled now joins the family.

## 3. Mechanical pass on whole v2 (python3, actually run)
- 182 keys; `list(v2)==list(keys.json)` True (same set and order); same for v1.
- Empty values: none. English-identical/Latin: only `Python` in ran_python.settled/.running (allowed, no space, per guide and shipped `已使用Team Bridge`).
- Unicode Cf/Cc/Zs characters: none. ASCII/CJK punctuation (。，、,.!！?？…): none.
- 91 pairs: every settled = 已+X and running = 正在+X with identical X (0 violations).
- Duplicate values across different ops: none. No same-concept-two-names regression found (secret, wake, console, session each single term).
- Width (CJK=2): max 20 (described_secret.running), then 18 (resized_console.running, described_secret.settled, captured_console.running); no spaces, ≤5 words, all ≤32 cells — no overflow of the shrink-0 verb column.

## Commands actually run
python3 (v1/v2 diff, key-order/set compare, empties, Latin, Cf/Cc/Zs, punctuation, pair-parallelism, duplicates, East-Asian-width scan, role/context dump); python3 over all shipped zh-CN JSON (counts for 敏感信息/机密/密钥/凭据/网络成员/网络设备/引导/唤醒/移出/解除关联 + hit listings); grep glossary.md and zh-CN.md; sed of glossary/guide lines. Did not run ledger-check or write any ledger row.
