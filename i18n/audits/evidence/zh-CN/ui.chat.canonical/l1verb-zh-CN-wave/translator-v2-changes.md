# zh-CN L1 remediation — v2

- Translator session: `87f2e83b7056`; actual served model: `openai/gpt-6.1-sol` (session header; no fallback observed).
- Inputs: `keys.json`, `zh-CN.json`, `audit-zh-CN-A.md`, `audit-zh-CN-B.md` in this directory; core `i18n/style-guides/{zh-CN,en}.md` and `i18n/glossary.md`; shipped client `src/i18n/catalogues/zh-CN/*.json` in `../i18n-l1-tool-verbs/`.
- Output: `zh-CN.v2.json`: 182 keys in source order, **16 changed values across 9 operation families**. Two running lookup values already used the revised stem and are unchanged.
- Dispositions: **10 fixed, 5 declined, 0 deferred**, counting report-local IDs separately (some findings overlap). All reported MAJORs fixed (A:F1); neither report had a BLOCKER. This is translator remediation, **not an independent audit or a passed ledger claim**. No commits or ledger changes.

## Finding dispositions

Key names below omit `ui.chat.canonical.tool_row.verb.`. Paired arrows list settled / running in that order.

| Finding | Disposition | Keys and old → new, or evidence/reason |
|---|---|---|
| A:F1 MAJOR | fixed | `steered.{settled,running}`: 已调整方向 / 正在调整方向 → 已引导 / 正在引导. Verified `fold.receipt.steered` = 已引导 and composer `steer_hint` = 立即引导智能体（Enter）· Esc停止本轮. The following child ID now attaches directly to 引导. |
| A:F2 MINOR | fixed | `peeked_at.{settled,running}`: 已查看进展 / 正在查看进展 → 已查看 / 正在查看. `context.role` covers hub/jobs peek: remove the already-filled object 进展 so the following job/agent ID is the object. |
| A:F3 MINOR | fixed | `peeked_at_session.{settled,running}`: 已查看会话进展 / 正在查看会话进展 → 已查看会话记录 / 正在查看会话记录. `sessions peek` reads transcript steps, unlike `sessions info`; 记录 is the guide's transcript term. |
| A:F4 MINOR | declined | Retain `unlinked_session_from`: 已将会话移出 / 正在将会话移出. The claim that 出 loses “from” is incorrect: 移出 is a directional compound taking the following project as the source container, e.g. 已将会话移出 proj-x. Here it means removing project membership, not deleting the session. The proposed 已解除会话关联 leaves the following project with no source relation, contrary to this key's explicit `notes` requirement to keep the trailing preposition. Shipped `ui.projects.project_detail.the_session_was_not_unlinked` = 会话未解除关联。 establishes the standalone unlink term, but is a complete sentence without this slot constraint; inserting that exact standalone wording here would worsen the fragment. This is a documented grammar-constrained paraphrase, not a second noun for an object. |
| A:F5 MINOR | fixed | `typed_in_console.{settled,running}`: 已输入至控制台 / 正在输入至控制台 → 已向控制台输入 / 正在向控制台输入. Natural Chinese input phrasing; keeps 控制台, the shipped console term. |
| A:F6 MINOR | fixed | `scheduled.{settled,running}`: 已设定定时任务 / 正在设定定时任务 → 已安排唤醒 / 正在安排唤醒. This is `wake create`, not a recurring schedule. Verified shipped `run_details.wake.managed_note` distinguishes 唤醒 from its owning 定时任务. Consistent with listed/cancelled wake siblings and guide line 34. |
| A:N1 NIT | declined | Retain `messaged`: 已发送消息给 / 正在发送消息给. Report itself requests no change. The trailing 给 correctly binds the recipient and distinguishes hub send from the send tool's 已发送. Team Bridge's 已私信 describes that separate private-message operation. |
| A:N2 NIT | fixed | `captured_console.{settled,running}`: 已截取控制台 / 正在截取控制台 → 已截取控制台画面 / 正在截取控制台画面. Takes the clarity improvement without dropping 控制台: `context.role` specifically names console screenshot, not generic screen capture. Same change resolves B:N1. |
| B:M1 MINOR | declined | Retain all six secret families (12 values, not the report's “14”). The glossary has no endorsed zh-CN secret/credentials equivalence, and this task explicitly requires shipped terminology. Re-derived across all shipped zh-CN namespace files: 敏感信息 occurs in 22 values, including `fold.count.secret` and question-dock/composer secret input; 机密 occurs in 1. 密钥 occurs in 131 and 凭据 in 62, but those include API/passkeys and credentials: raw totals across different concepts do not establish secret-tool terminology. 密钥 would wrongly narrow arbitrary stored secret values to keys; 凭据 would collapse secrets into authentication credentials. Keeping the existing secret-input terminology is more consistent and semantically broader. 调取 is valid for retrieving a stored secret into use; it does not claim an official-records operation here. |
| B:M2 MINOR | fixed | `listed_network_peers.{settled,running}`: 已列出网络设备 / 正在列出网络设备 → 已列出网络成员 / 正在列出网络成员. Peers are member devices, not switches/routers; shipped `ui.mesh.mesh_reach.handshake_refused_hint` already uses 网络成员. Shipped 网络设备 occurrences: 0; 网络成员: 1 (all namespace files). |
| B:M3 MINOR | fixed | Same two changes as A:F1: `steered` 已调整方向 / 正在调整方向 → 已引导 / 正在引导. |
| B:M4 MINOR | fixed | `found_definition.settled`: 已找到定义 → 已查找定义; `found_references.settled`: 已找到引用 → 已查找引用. Running siblings remain 正在查找定义 / 正在查找引用. Both use the same lookup verb now. 已查找 states that the tool completed the lookup, not that it necessarily returned a nonempty result; appropriate for LSP definitions/references operations in `context.role`. A correctly rejected 正在找到 as unnatural, but did not rule out this completion-of-lookup wording. |
| B:N1 NIT | fixed | Same console screenshot pair as A:N2: 已截取控制台 / 正在截取控制台 → 已截取控制台画面 / 正在截取控制台画面. |
| B:N2 NIT | declined | Retain listed/cancelled 唤醒. Core zh-CN style guide line 34 and glossary §2 explicitly prescribe 唤醒; shipped wake details use that noun. A:F6 brings create into that same family. Appending 任务 to only list/cancel would reintroduce the very family split being fixed; appending it everywhere is unnecessary and costs width. |
| B:N3 NIT | declined | Retain unlinked pair for the A:F4 source-slot reasons above. B itself says the current wording is acceptable and its alternative awkward; removing a project's membership does not delete the session. |

## Register, ambiguity and glossary proposals

All 91 pairs now use settled 已 + operation and running 正在 + the same operation stem. This matches the shipped status register (`fold.receipt.steered` 已引导; bridge verb statuses 已私信 / 已发布至, etc.) and the zh-CN guide's terse, verb-forward, punctuation-free status voice. No blanket register rewrite was needed.

The consequential ambiguities are addressed explicitly above: source-project unlink grammar (A:F4), generic stored secrets vs API keys/credentials (B:M1), and lookup completion vs finding at least one result (B:M4). No glossary file edited. Glossary-proposals: no new term needed; recommend eventually recording the already-shipped secret-tool noun **敏感信息** explicitly to distinguish it from authentication 凭据 and cryptographic/API 密钥. Network peer **网络成员** is already shipped, not newly invented here.

## Width

Measured using Unicode East Asian Width, CJK/fullwidth = 2 cells, ASCII = 1. Maximum remains **20 cells** (`described_secret.running`, 正在查看敏感信息说明), unchanged. Other wide values: `described_secret.settled` 18; `resized_console.running` 18; revised `captured_console.running` 18 (settled 16). No spaces, no five-word phrases, no hard `maxCells` supplied for these keys. Chinese has no whitespace word boundaries; all labels are compact operation phrases. The new 画面 suffix costs 4 cells and earns its width by identifying screenshot capture rather than a vague “capture console”. No rendered-fit claim is made.

## Actual validation

Executed `python3` against the written v2 file:

```text
PASS: 182 keys, exact source order, no empty values, no forbidden English-identical/Latin values, no manual bidi/control characters, 91 parallel pairs
Changed keys: 16
```

Also executed the client's relevant catalogue ledger validator from the shared PR worktree:

```text
node scripts/i18n/ledger-check.mjs
ledger-check: FAILED — 24 finding(s) across 1106 ledger entr(ies)
exit code: 1
```

The actual diagnostics name all seven locale `ui.chat.canonical` files: each still lacks these 182 staged verb keys and has stale English-source/auditor receipt hashes. The zh-CN diagnostics specifically report missing 182 keys, source hash `38f767d08ff0…` versus on-disk `a385671b988e…`, and two auditor receipt source mismatches. Revisions are intentionally only in `_l1-prep/zh-CN.v2.json`, not applied to shipped catalogues or certified by receipts. The validator therefore does **not** certify this staging output; the independent changed-key recheck and manager's catalogue integration/ledger update remain necessary. I did not rewrite other locales, forge passing audit status, or claim this gate passed.
