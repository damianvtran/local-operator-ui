# l1-au-zh-CN-B — zh-CN audit (182 tool-row verb keys)

Auditor: i18n-auditor (second, independent pass; did not read other auditors' reports; did not translate). Model actually served: anthropic/claude-sonnet-5-5.
Inputs: keys.json, zh-CN.json (this dir); style guide zh-CN.md; glossary.md; shipped zh-CN ui.chat.canonical.json (generic_verb 已调用/正在调用, bridge.* verbs).

**Verdict: clean-with-findings** — blocker 0, major 0, minor 4, nit 3. No destructive/read-only swaps; all 91 settled/running pairs are 已X / 正在X; no English left (only `Python`, allowed, no-space per guide, matching shipped `已使用Team Bridge`).

## Mechanical (python3, actually run)
- key list == keys.json, same order, 182/182, no extra/missing: True
- empty values: none; English-identical values: none
- Latin letters in values: only `Python` (ran_python.settled/.running)
- bidi/format/control chars (Unicode Cf/Cc): none; spaces/ASCII punctuation/。 in values: none
- duplicate values across different English ops: none
- pair check (settled = 已+X, running = 正在+X): all OK except found_definition / found_references (see M4)
- max width (CJK=2 cells): 20 (described_secret.running), then 18 (resized_console.running, described_secret.settled); everything else ≤16; all ≤ 4 "words"; English equivalents are comparably long (Describing secret = 18 cells) so no relative overflow regression, but 正在 prefix costs 4 cells on every running row vs shipped generic 正在调用 (8).

## Findings
### MINOR
- **M1 secret family** (stored/retrieved/listed/described/updated/deleted_secret, 14 keys): 已存储/已列出/已删除/… **敏感信息**. "敏感信息" = "sensitive information" (data-classification term), not "a stored secret/credential"; reads as if the agent handled personal data. Glossary has no `secret` row and zh-CN `credentials`/`job` cells are still "—" (not recorded), and shipped copy renders credentials as 凭据. Suggest 密钥 (common for "secrets" in dev tools) or 凭据 consistently: 已存储密钥 / 已列出密钥 / 已更新密钥 / 已删除密钥. Also `retrieved_secret` 已调取敏感信息 → 已获取密钥 ("调取" has an official-records-pull flavour); `described_secret` 已查看敏感信息说明 → 已查看密钥说明. Record the choice in the zh-CN guide/glossary.
- **M2 network peers**: `listed_network_peers` 已列出网络设备 / 正在列出网络设备. In Chinese 网络设备 means network hardware (routers, switches) — misleading. Suggest 已列出网络成员 / 正在列出网络成员 (peers are the network's members; 成员 already used in shipped bridge.summary.members), or 已列出网络中的设备.
- **M3 steered**: `steered` 已调整方向 / 正在调整方向 — followed by a subagent id it reads as "adjusted direction <id>" with no object relation; unidiomatic for hub `steer`. Suggest 已引导 / 正在引导 (or 已转向).
- **M4 pair consistency**: `found_definition` 已找到定义 / 正在查找定义 and `found_references` 已找到引用 / 正在查找引用 use different verbs (找到 vs 查找); brief requires the pair to use the same verb. Suggest 已查找定义 / 正在查找定义 and 已查找引用 / 正在查找引用 (also true when the lookup returns nothing).

### NIT
- N1 `captured_console` 已截取控制台 → 已截取控制台画面 or 已为控制台截图 (screenshot op; 截取 alone is vague).
- N2 `listed_wakes` 已列出唤醒 — 唤醒 as a bare noun object is slightly bare while `scheduled` is 已设定定时任务 (matches shipped "定时任务" copy, OK). Optional: 已列出唤醒任务 / 正在列出唤醒任务, and 取消唤醒任务.
- N3 `unlinked_session_from` 已将会话移出 — acceptable and keeps the "from"; 移出 slightly implies deleting membership. Optional 已将会话解除关联自… (awkward) — leave as is unless the other locales prefer an explicit unlink verb.

## Checked, OK (not exhaustive)
bash 已运行; eval 已运行Python; read 已读取 (matches shipped bridge); write 已写入; edit 已编辑; glob 已列出; grep 已搜索; web_search 已搜索网页; fetched 已获取; browsed 已浏览; asked 已询问; messaged 已发送消息给 (keeps trailing "to" relation, distinct from sent 已发送); delegated 已委派; link/unlink keep prepositions (已将会话关联至 / 已将会话移出); all deleted_*/reset/removed/left rows keep destructive meaning and are not softened; raised_panic 已触发紧急封锁 (panic marks the network untrusted and disconnects — "紧急封锁" is accurate); consoles 控制台 consistent across 10 ops; sessions/agents/teams/projects/networks use glossary terms (会话/智能体/子智能体/团队/项目/设备); no 您, no particles, no 。.
