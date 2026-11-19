# Urdu L1 remediation — v2

Date: 2026-11-11 · Locale: `ur` · Namespace: `ui.chat.canonical.tool_row.verb.*`
Translator: `i18n-translator`, session `63cfb8a4238a`, actual served model `openai/gpt-6.1-sol` (host model header; no fallback observed).
Allocation: bounded translation remediation (<2 h). This is a translator change record, **not an independent audit or a passing audit receipt**. No MT service/API/SDK was used. No commit, catalogue integration, ledger modification or gate waiver was performed. The original audited file is preserved.

## Summary

182 keys retained in exact source order; **76 keys changed**. Dispositions: **21 fixed, 9 declined, 0 deferred** across the 30 finding IDs in audits A/B. All BLOCKER and MAJOR findings are fixed; declines concern MINOR/NIT recommendations only. Counts include overlapping findings from both auditors, not 30 distinct defects.

## Inputs and independently checked shipped evidence

- Read the full two audit reports, every source pair and context.role in `keys.json`, existing Urdu pairs, `i18n/style-guides/ur.md`, `en.md`, shared `i18n/glossary.md`, UI HOWTO and core RFC catalogue/audit sections.
- Urdu guide: polite imperatives apply to commands, not these past/progressive statuses; no manual bidi controls; settled software loanwords stay in Urdu script; session = سیشن and wake noun = بیداری.
- Recomputed substring counts across the assigned shipped `src/i18n/catalogues/ur/*.json` (counts are matching strings, not unique semantic concepts): ری سیٹ 29; بحال 57; اپ ڈیٹ 395; تازہ 58; جاب 10; کاموں کی فہرست 5; ساتھی 4; کنسول 38; سنگ میل 26; راز 25; متغیر 37. The auditor B reset/restore counts differ; the recomputed counts above agree with audit A for those terms. راز count 25 differs from A’s 23; this does not change the terminology decision.
- Independently counted the shipped bridge running family: 17 keys, all 17 ending in رہا. Read the channels running key directly: گفتگوؤں کی فہرست بنا رہا (5 whitespace words). This supports progressive status register and a documented five-word precedent, not a blanket width waiver.
- Read shipped `ui.common.errors.agent_update`: ایجنٹ {agentId} اپ ڈیٹ نہیں ہو سکا; `ui.common.errors.jobs_list` uses جابز کی فہرست; `ui.chat.canonical.fold.count.todo` uses کاموں کی فہرست اپ ڈیٹ.
- All 91 settled/running pairs were considered; the systemic bare-habitual defect affected exactly 26 running keys, all corrected. Remaining جاری forms are intentionally state predicates, not habituals (see UR-A10).

### Input/output SHA-256

| File | SHA-256 |
|---|---|
| `keys.json` | `b3f3bfe3688d1461a061009e98a58802171eb181343fdb8fcfd0af07652ca419` |
| `ur.json` | `7525521c04130f6b8182ba941850d0cbe76f0b08bd997aa8a9fe153d05dfb5fd` |
| `audit-ur-A.md` | `56c1af4ec3c7a3c7f8321d6f1e22e697c3a4b80fa407dd50e65ee76e32a15a93` |
| `audit-ur-B.md` | `412c86d1117f2195689c85925412582c8dbec353c025cb2070e2b63ae276a7c2` |
| `ur.v2.json` | `c71f5e40612dca85cee0d05ddfe4d833d3a68d05fb7c96a3e1519dbed1f904e0` |

## Findings and dispositions

Keys below omit the common `ui.chat.canonical.tool_row.verb.` prefix. Only changed key values are repeated in the finding table; unchanged siblings retain their original form. IDs without a UR-A prefix belong to audit B.

| Finding | Decision | Key, old → new / evidence-based reason |
|---|---|---|
| UR-A1 | fixed | `reset_agent.settled`: ایجنٹ بحال کیا → ایجنٹ ری سیٹ کیا; `reset_agent.running`: ایجنٹ بحال کر رہا → ایجنٹ ری سیٹ کر رہا<br>Use shipped reset term ری سیٹ, not resume/restore بحال. |
| UR-A2 | fixed | `listed_variables.settled`: متغیرات کی فہرست دی → متغیرات کی فہرست بنائی; `listed_variables.running`: متغیرات کی فہرست دیتا → متغیرات کی فہرست بنا رہا; `listed_agents.settled`: ایجنٹوں کی فہرست دی → ایجنٹوں کی فہرست بنائی; `listed_agents.running`: ایجنٹوں کی فہرست دیتا → ایجنٹوں کی فہرست بنا رہا; `synced_agents.running`: ایجنٹ ہم آہنگ کرتا → ایجنٹ ہم آہنگ کر رہا; `listed_teams.settled`: ٹیموں کی فہرست دی → ٹیموں کی فہرست بنائی; `listed_teams.running`: ٹیموں کی فہرست دیتا → ٹیموں کی فہرست بنا رہا; `paused.running`: عارضی طور پر روکتا → عارضی طور پر روک رہا; `listed_secrets.settled`: رازوں کی فہرست دی → رازوں کی فہرست بنائی; `listed_secrets.running`: رازوں کی فہرست دیتا → رازوں کی فہرست بنا رہا; `described_secret.running`: راز کی وضاحت کرتا → راز کی وضاحت کر رہا; `listed_projects.settled`: پروجیکٹس کی فہرست دی → پروجیکٹس کی فہرست بنائی; `listed_projects.running`: پروجیکٹس کی فہرست دیتا → پروجیکٹس کی فہرست بنا رہا; `linked_session_to.settled`: سیشن کا ربط جوڑا → سیشن پروجیکٹ سے جوڑا; `linked_session_to.running`: سیشن کا ربط جوڑتا → سیشن پروجیکٹ سے جوڑ رہا; `unlinked_session_from.settled`: سیشن کا ربط توڑا → سیشن پروجیکٹ سے ہٹایا; `unlinked_session_from.running`: سیشن کا ربط توڑتا → سیشن پروجیکٹ سے ہٹا رہا; `updated_milestone.settled`: سنگ میل تازہ کیا → سنگ میل اپ ڈیٹ کیا; `updated_milestone.running`: سنگ میل تازہ کرتا → سنگ میل اپ ڈیٹ کر رہا; `read_todos.running`: کاموں کی فہرست پڑھتا → کاموں کی فہرست پڑھ رہا; `updated_todos.settled`: کاموں کی فہرست بدلی → کاموں کی فہرست اپ ڈیٹ کی; `updated_todos.running`: کاموں کی فہرست بدلتا → کاموں کی فہرست اپ ڈیٹ کر رہا; `listed_wakes.settled`: بیداریوں کی فہرست دی → بیداریوں کی فہرست بنائی; `listed_wakes.running`: بیداریوں کی فہرست دیتا → بیداریوں کی فہرست بنا رہا; `listed_jobs.settled`: کاموں کی فہرست دی → جابز کی فہرست بنائی; `listed_jobs.running`: کاموں کی فہرست دیتا → جابز کی فہرست بنا رہا; `listed_network_peers.settled`: نیٹ ورک ساتھی گنوائے → نیٹ ورک ڈیوائسز دکھائیں; `listed_network_peers.running`: نیٹ ورک ساتھی گنواتا → نیٹ ورک ڈیوائسز دکھا رہا; `read_network_log.running`: نیٹ ورک لاگ پڑھتا → نیٹ ورک لاگ پڑھ رہا; `invited_device.running`: ڈیوائس کو دعوت دیتا → ڈیوائس کو دعوت دے رہا; `joined_network.running`: نیٹ ورک سے جڑتا → نیٹ ورک سے جڑ رہا; `listed_consoles.settled`: کنسولوں کی فہرست دی → کنسولوں کی فہرست بنائی; `listed_consoles.running`: کنسولوں کی فہرست دیتا → کنسولوں کی فہرست بنا رہا; `captured_console.running`: کنسول کی تصویر لیتا → کنسول کی تصویر لے رہا; `resized_console.running`: کنسول کا حجم بدلتا → کنسول کا حجم بدل رہا; `updated_secure_input.settled`: محفوظ ان پٹ بدلا → محفوظ ان پٹ اپ ڈیٹ کیا; `updated_secure_input.running`: محفوظ ان پٹ بدلتا → محفوظ ان پٹ اپ ڈیٹ کر رہا; `listed_symbols.settled`: علامتوں کی فہرست دی → علامتوں کی فہرست بنائی; `listed_symbols.running`: علامتوں کی فہرست دیتا → علامتوں کی فہرست بنا رہا; `listed_sessions.settled`: سیشنوں کی فہرست دی → سیشنوں کی فہرست بنائی; `listed_sessions.running`: سیشنوں کی فہرست دیتا → سیشنوں کی فہرست بنا رہا; `peeked_at_session.running`: سیشن کی جھلک دیکھتا → سیشن کی جھلک دیکھ رہا<br>Replace all 26 bare habitual running forms with genuine progressives; no habitual holdouts. |
| UR-A3 | fixed | `updated_agent.settled`: ایجنٹ تازہ کیا → ایجنٹ اپ ڈیٹ کیا; `updated_agent.running`: ایجنٹ تازہ کر رہا → ایجنٹ اپ ڈیٹ کر رہا; `updated_team.settled`: ٹیم تازہ کی → ٹیم اپ ڈیٹ کی; `updated_team.running`: ٹیم تازہ کر رہا → ٹیم اپ ڈیٹ کر رہا; `updated_secret.settled`: راز تازہ کیا → راز اپ ڈیٹ کیا; `updated_secret.running`: راز تازہ کر رہا → راز اپ ڈیٹ کر رہا; `updated_project.settled`: پروجیکٹ تازہ کیا → پروجیکٹ اپ ڈیٹ کیا; `updated_project.running`: پروجیکٹ تازہ کر رہا → پروجیکٹ اپ ڈیٹ کر رہا; `updated_milestone.settled`: سنگ میل تازہ کیا → سنگ میل اپ ڈیٹ کیا; `updated_milestone.running`: سنگ میل تازہ کرتا → سنگ میل اپ ڈیٹ کر رہا; `updated_todos.settled`: کاموں کی فہرست بدلی → کاموں کی فہرست اپ ڈیٹ کی; `updated_todos.running`: کاموں کی فہرست بدلتا → کاموں کی فہرست اپ ڈیٹ کر رہا; `updated_secure_input.settled`: محفوظ ان پٹ بدلا → محفوظ ان پٹ اپ ڈیٹ کیا; `updated_secure_input.running`: محفوظ ان پٹ بدلتا → محفوظ ان پٹ اپ ڈیٹ کر رہا<br>Apply shipped اپ ڈیٹ consistently to every update operation, including todos and secure input; preserve gender agreement. |
| UR-A4 | fixed | `listed_jobs.settled`: کاموں کی فہرست دی → جابز کی فہرست بنائی; `listed_jobs.running`: کاموں کی فہرست دیتا → جابز کی فہرست بنا رہا; `cancelled_job.settled`: کام منسوخ کیا → جاب منسوخ کیا; `cancelled_job.running`: کام منسوخ کر رہا → جاب منسوخ کر رہا; `waited_for_jobs.settled`: کاموں کا انتظار کیا → جابز کا انتظار کیا; `waited_for_jobs.running`: کاموں کا انتظار جاری → جابز کا انتظار کر رہا<br>Use shipped جاب/جابز for background jobs; keep todos distinct. |
| UR-A5 | declined | Decline strict one-phrase-for-every-list uniformity: twelve named list operations now use the shipped فہرست بنائی/بنا رہا family, as does glob already. Peers uses دکھائیں/دکھا رہا (show listed devices) to name devices without a seven-plus-word list label. It remains read-only and preserves the list result; no گنوانا remains. |
| UR-A6 | fixed | `found_definition.settled`: تعریف تلاش کی → تعریف ڈھونڈ لی; `found_definition.running`: تعریف تلاش کر رہا → تعریف ڈھونڈ رہا; `found_references.settled`: حوالے تلاش کیے → حوالے ڈھونڈ لیے; `found_references.running`: حوالے تلاش کر رہا → حوالے ڈھونڈ رہا<br>ڈھونڈ لی/لیے explicitly reports finding an item; paired ڈھونڈ رہا preserves the same root rather than mismatching ملی with تلاش. |
| UR-A7 | fixed | `linked_session_to.settled`: سیشن کا ربط جوڑا → سیشن پروجیکٹ سے جوڑا; `linked_session_to.running`: سیشن کا ربط جوڑتا → سیشن پروجیکٹ سے جوڑ رہا; `unlinked_session_from.settled`: سیشن کا ربط توڑا → سیشن پروجیکٹ سے ہٹایا; `unlinked_session_from.running`: سیشن کا ربط توڑتا → سیشن پروجیکٹ سے ہٹا رہا<br>Name the project relationship explicitly: پروجیکٹ سے with جوڑا (linked to) versus ہٹایا (removed from). Following monospace project ID is appositional to پروجیکٹ, not an orphan object after a preposition. |
| UR-A8 | fixed | `sent_keys.settled`: کلیدیں بھیجیں → کلیدیں بھیجی گئیں; `sent_keys.running`: کلیدیں بھیج رہا → کلیدیں بھیجی جا رہیں<br>Explicit passive past بھیجی گئیں avoids the imperative homograph; parallel running بھیجی جا رہیں agrees with feminine plural کلیدیں. |
| UR-A9 | fixed | `listed_network_peers.settled`: نیٹ ورک ساتھی گنوائے → نیٹ ورک ڈیوائسز دکھائیں; `listed_network_peers.running`: نیٹ ورک ساتھی گنواتا → نیٹ ورک ڈیوائسز دکھا رہا<br>Replace human-sounding ساتھی with network devices; network peer endpoints here are devices per context.role/network peers semantics. This is not human teammate terminology. |
| UR-A10 | declined | جاری is a natural running-status predicate, not the habitual aspect defect in A2. Shipped generic_verb.running uses کال جاری; audit B explicitly accepts both status phrases. Retain ویب پر تلاش جاری and the revised جابز کا انتظار جاری to avoid a needless extra word; the underlying search/wait operation is unchanged. |
| UR-A11 | declined | Browser actions include read/click/type/select/scroll as well as opening a page. Replacing براؤز with براؤزر میں کھولا would falsely narrow the operation to opened; keep the established browsing loanword. |
| UR-A12 | declined | sessions.spawn starts a new runnable session, not merely a stored session object. سیشن شروع کیا/کر رہا reports that action naturally and is already distinct from resume بحال; adding نیا would widen without resolving a collision. |
| UR-A13 | fixed | `previewed_rename.settled`: تبدیلیٔ نام جھلکائی → نام کی تبدیلی دکھائی; `previewed_rename.running`: تبدیلیٔ نام جھلکا رہا → نام کی تبدیلی دکھا رہا<br>Replace literary/rare جھلکانا with plain نام کی تبدیلی دکھائی/دکھا رہا; preview displays a rename without applying it. |
| UR-A14 | fixed | `checked_network_status.settled`: نیٹ ورک جانچا → نیٹ ورک کی حالت جانچی; `checked_network_status.running`: نیٹ ورک جانچ رہا → نیٹ ورک کی حالت جانچ رہا<br>Restore حالت, distinguishing status inspection from generic network assessment. |
| UR-A15 | fixed | `steered.settled`: رہنمائی کی → ہدایت دی; `steered.running`: رہنمائی کر رہا → ہدایت دے رہا<br>Use ہدایت دی/دے رہا for a concrete instruction injected into the running agent rather than general guidance. |
| B1 | fixed | `listed_subagents.settled`: ذیلی ایجنٹ گنوائے → ذیلی ایجنٹوں کی فہرست بنائی; `listed_subagents.running`: ذیلی ایجنٹ گنوا رہا → ذیلی ایجنٹوں کی فہرست بنا رہا; `listed_networks.settled`: نیٹ ورک گنوائے → نیٹ ورکس کی فہرست بنائی; `listed_networks.running`: نیٹ ورک گنوا رہا → نیٹ ورکس کی فہرست بنا رہا; `listed_network_peers.settled`: نیٹ ورک ساتھی گنوائے → نیٹ ورک ڈیوائسز دکھائیں; `listed_network_peers.running`: نیٹ ورک ساتھی گنواتا → نیٹ ورک ڈیوائسز دکھا رہا<br>Remove all گنوانا forms. Accept the destructive ambiguity even though audit A allowed that root. |
| M1 | fixed | `listed_variables.settled`: متغیرات کی فہرست دی → متغیرات کی فہرست بنائی; `listed_variables.running`: متغیرات کی فہرست دیتا → متغیرات کی فہرست بنا رہا; `listed_agents.settled`: ایجنٹوں کی فہرست دی → ایجنٹوں کی فہرست بنائی; `listed_agents.running`: ایجنٹوں کی فہرست دیتا → ایجنٹوں کی فہرست بنا رہا; `synced_agents.running`: ایجنٹ ہم آہنگ کرتا → ایجنٹ ہم آہنگ کر رہا; `listed_teams.settled`: ٹیموں کی فہرست دی → ٹیموں کی فہرست بنائی; `listed_teams.running`: ٹیموں کی فہرست دیتا → ٹیموں کی فہرست بنا رہا; `paused.running`: عارضی طور پر روکتا → عارضی طور پر روک رہا; `listed_secrets.settled`: رازوں کی فہرست دی → رازوں کی فہرست بنائی; `listed_secrets.running`: رازوں کی فہرست دیتا → رازوں کی فہرست بنا رہا; `described_secret.running`: راز کی وضاحت کرتا → راز کی وضاحت کر رہا; `listed_projects.settled`: پروجیکٹس کی فہرست دی → پروجیکٹس کی فہرست بنائی; `listed_projects.running`: پروجیکٹس کی فہرست دیتا → پروجیکٹس کی فہرست بنا رہا; `linked_session_to.settled`: سیشن کا ربط جوڑا → سیشن پروجیکٹ سے جوڑا; `linked_session_to.running`: سیشن کا ربط جوڑتا → سیشن پروجیکٹ سے جوڑ رہا; `unlinked_session_from.settled`: سیشن کا ربط توڑا → سیشن پروجیکٹ سے ہٹایا; `unlinked_session_from.running`: سیشن کا ربط توڑتا → سیشن پروجیکٹ سے ہٹا رہا; `updated_milestone.settled`: سنگ میل تازہ کیا → سنگ میل اپ ڈیٹ کیا; `updated_milestone.running`: سنگ میل تازہ کرتا → سنگ میل اپ ڈیٹ کر رہا; `read_todos.running`: کاموں کی فہرست پڑھتا → کاموں کی فہرست پڑھ رہا; `updated_todos.settled`: کاموں کی فہرست بدلی → کاموں کی فہرست اپ ڈیٹ کی; `updated_todos.running`: کاموں کی فہرست بدلتا → کاموں کی فہرست اپ ڈیٹ کر رہا; `listed_wakes.settled`: بیداریوں کی فہرست دی → بیداریوں کی فہرست بنائی; `listed_wakes.running`: بیداریوں کی فہرست دیتا → بیداریوں کی فہرست بنا رہا; `listed_jobs.settled`: کاموں کی فہرست دی → جابز کی فہرست بنائی; `listed_jobs.running`: کاموں کی فہرست دیتا → جابز کی فہرست بنا رہا; `listed_network_peers.settled`: نیٹ ورک ساتھی گنوائے → نیٹ ورک ڈیوائسز دکھائیں; `listed_network_peers.running`: نیٹ ورک ساتھی گنواتا → نیٹ ورک ڈیوائسز دکھا رہا; `read_network_log.running`: نیٹ ورک لاگ پڑھتا → نیٹ ورک لاگ پڑھ رہا; `invited_device.running`: ڈیوائس کو دعوت دیتا → ڈیوائس کو دعوت دے رہا; `joined_network.running`: نیٹ ورک سے جڑتا → نیٹ ورک سے جڑ رہا; `listed_consoles.settled`: کنسولوں کی فہرست دی → کنسولوں کی فہرست بنائی; `listed_consoles.running`: کنسولوں کی فہرست دیتا → کنسولوں کی فہرست بنا رہا; `captured_console.running`: کنسول کی تصویر لیتا → کنسول کی تصویر لے رہا; `resized_console.running`: کنسول کا حجم بدلتا → کنسول کا حجم بدل رہا; `updated_secure_input.settled`: محفوظ ان پٹ بدلا → محفوظ ان پٹ اپ ڈیٹ کیا; `updated_secure_input.running`: محفوظ ان پٹ بدلتا → محفوظ ان پٹ اپ ڈیٹ کر رہا; `listed_symbols.settled`: علامتوں کی فہرست دی → علامتوں کی فہرست بنائی; `listed_symbols.running`: علامتوں کی فہرست دیتا → علامتوں کی فہرست بنا رہا; `listed_sessions.settled`: سیشنوں کی فہرست دی → سیشنوں کی فہرست بنائی; `listed_sessions.running`: سیشنوں کی فہرست دیتا → سیشنوں کی فہرست بنا رہا; `peeked_at_session.running`: سیشن کی جھلک دیکھتا → سیشن کی جھلک دیکھ رہا<br>Same complete 26-key habitual-to-progressive correction as UR-A2. |
| M2 | fixed | `reset_agent.settled`: ایجنٹ بحال کیا → ایجنٹ ری سیٹ کیا; `reset_agent.running`: ایجنٹ بحال کر رہا → ایجنٹ ری سیٹ کر رہا<br>Same shipped reset distinction as UR-A1. |
| M3 | fixed | `previewed_rename.settled`: تبدیلیٔ نام جھلکائی → نام کی تبدیلی دکھائی; `previewed_rename.running`: تبدیلیٔ نام جھلکا رہا → نام کی تبدیلی دکھا رہا<br>Use the auditor’s plain-Urdu alternative, not ری نیم, a new loanword unsupported by the glossary. |
| m1 | declined | Decline strict one-phrase-for-every-list uniformity: twelve named list operations now use the shipped فہرست بنائی/بنا رہا family, as does glob already. Peers uses دکھائیں/دکھا رہا (show listed devices) to name devices without a seven-plus-word list label. It remains read-only and preserves the list result; no گنوانا remains. |
| m2 | fixed | `linked_session_to.settled`: سیشن کا ربط جوڑا → سیشن پروجیکٹ سے جوڑا; `linked_session_to.running`: سیشن کا ربط جوڑتا → سیشن پروجیکٹ سے جوڑ رہا; `unlinked_session_from.settled`: سیشن کا ربط توڑا → سیشن پروجیکٹ سے ہٹایا; `unlinked_session_from.running`: سیشن کا ربط توڑتا → سیشن پروجیکٹ سے ہٹا رہا<br>Name the project relationship explicitly: پروجیکٹ سے with جوڑا (linked to) versus ہٹایا (removed from). Following monospace project ID is appositional to پروجیکٹ, not an orphan object after a preposition. |
| m3 | fixed | `listed_jobs.settled`: کاموں کی فہرست دی → جابز کی فہرست بنائی; `listed_jobs.running`: کاموں کی فہرست دیتا → جابز کی فہرست بنا رہا; `cancelled_job.settled`: کام منسوخ کیا → جاب منسوخ کیا; `cancelled_job.running`: کام منسوخ کر رہا → جاب منسوخ کر رہا; `waited_for_jobs.settled`: کاموں کا انتظار کیا → جابز کا انتظار کیا; `waited_for_jobs.running`: کاموں کا انتظار جاری → جابز کا انتظار کر رہا<br>Independent shipped-corpus check finds جاب in 10 strings, including jobs_list; use it rather than the proposed longer پس منظر کے کاموں phrase. |
| m4 | fixed | `typed_in_console.settled`: کنسول میں لکھا → کنسول میں ٹائپ کیا; `typed_in_console.running`: کنسول میں لکھ رہا → کنسول میں ٹائپ کر رہا<br>Preserve typing distinction using ٹائپ کیا/کر رہا, not generic writing. |
| m5 | fixed | `checked_network_status.settled`: نیٹ ورک جانچا → نیٹ ورک کی حالت جانچی; `checked_network_status.running`: نیٹ ورک جانچ رہا → نیٹ ورک کی حالت جانچ رہا<br>Restore حالت, distinguishing status inspection from generic network assessment. |
| m6 | fixed | `diagnosed_network.settled`: نیٹ ورک پرکھا → نیٹ ورک کی تشخیص کی; `diagnosed_network.running`: نیٹ ورک پرکھ رہا → نیٹ ورک کی تشخیص کر رہا<br>تشخیص کی/کر رہا identifies the doctor operation, not generic assessment. |
| m7 | fixed | `steered.settled`: رہنمائی کی → ہدایت دی; `steered.running`: رہنمائی کر رہا → ہدایت دے رہا<br>Adopt concrete ہدایت دی/دے رہا; retain the expressly accepted جاری status phrases as explained under UR-A10. |
| n1 | declined | تعریف means definition as well as praise; the explicit lsp definitions context resolves it. Keep the native term instead of introducing ڈیفینیشن. The found-versus-searched outcome itself is fixed under UR-A6. |
| n2 | declined | Keep کلیدیں, the standard Urdu keyboard-key noun, with console keys context. Do not replace it with the unglossed کی اسٹروک. The actual past/imperative ambiguity is fixed under UR-A8. |
| n3 | declined | Keep native علامتوں, already used for symbols; no demonstrated semantic defect requires the loanword سمبلز. |
| n4 | declined | Keep ہنگامی بندش کی/کر رہا: network panic performs emergency shutdown. This is a descriptive translated action, not a literal tool identifier that must keep panic in English. |

## Complete changed-key manifest

This is the re-audit scope: 76 keys. No unchanged key needs to be translated again.

| Key | Old | Revised |
|---|---|---|
| `listed_variables.settled` | متغیرات کی فہرست دی | متغیرات کی فہرست بنائی |
| `listed_variables.running` | متغیرات کی فہرست دیتا | متغیرات کی فہرست بنا رہا |
| `waited_for_jobs.settled` | کاموں کا انتظار کیا | جابز کا انتظار کیا |
| `waited_for_jobs.running` | کاموں کا انتظار جاری | جابز کا انتظار کر رہا |
| `listed_agents.settled` | ایجنٹوں کی فہرست دی | ایجنٹوں کی فہرست بنائی |
| `listed_agents.running` | ایجنٹوں کی فہرست دیتا | ایجنٹوں کی فہرست بنا رہا |
| `reset_agent.settled` | ایجنٹ بحال کیا | ایجنٹ ری سیٹ کیا |
| `reset_agent.running` | ایجنٹ بحال کر رہا | ایجنٹ ری سیٹ کر رہا |
| `updated_agent.settled` | ایجنٹ تازہ کیا | ایجنٹ اپ ڈیٹ کیا |
| `updated_agent.running` | ایجنٹ تازہ کر رہا | ایجنٹ اپ ڈیٹ کر رہا |
| `synced_agents.running` | ایجنٹ ہم آہنگ کرتا | ایجنٹ ہم آہنگ کر رہا |
| `listed_teams.settled` | ٹیموں کی فہرست دی | ٹیموں کی فہرست بنائی |
| `listed_teams.running` | ٹیموں کی فہرست دیتا | ٹیموں کی فہرست بنا رہا |
| `updated_team.settled` | ٹیم تازہ کی | ٹیم اپ ڈیٹ کی |
| `updated_team.running` | ٹیم تازہ کر رہا | ٹیم اپ ڈیٹ کر رہا |
| `listed_subagents.settled` | ذیلی ایجنٹ گنوائے | ذیلی ایجنٹوں کی فہرست بنائی |
| `listed_subagents.running` | ذیلی ایجنٹ گنوا رہا | ذیلی ایجنٹوں کی فہرست بنا رہا |
| `steered.settled` | رہنمائی کی | ہدایت دی |
| `steered.running` | رہنمائی کر رہا | ہدایت دے رہا |
| `paused.running` | عارضی طور پر روکتا | عارضی طور پر روک رہا |
| `listed_secrets.settled` | رازوں کی فہرست دی | رازوں کی فہرست بنائی |
| `listed_secrets.running` | رازوں کی فہرست دیتا | رازوں کی فہرست بنا رہا |
| `described_secret.running` | راز کی وضاحت کرتا | راز کی وضاحت کر رہا |
| `updated_secret.settled` | راز تازہ کیا | راز اپ ڈیٹ کیا |
| `updated_secret.running` | راز تازہ کر رہا | راز اپ ڈیٹ کر رہا |
| `listed_projects.settled` | پروجیکٹس کی فہرست دی | پروجیکٹس کی فہرست بنائی |
| `listed_projects.running` | پروجیکٹس کی فہرست دیتا | پروجیکٹس کی فہرست بنا رہا |
| `updated_project.settled` | پروجیکٹ تازہ کیا | پروجیکٹ اپ ڈیٹ کیا |
| `updated_project.running` | پروجیکٹ تازہ کر رہا | پروجیکٹ اپ ڈیٹ کر رہا |
| `linked_session_to.settled` | سیشن کا ربط جوڑا | سیشن پروجیکٹ سے جوڑا |
| `linked_session_to.running` | سیشن کا ربط جوڑتا | سیشن پروجیکٹ سے جوڑ رہا |
| `unlinked_session_from.settled` | سیشن کا ربط توڑا | سیشن پروجیکٹ سے ہٹایا |
| `unlinked_session_from.running` | سیشن کا ربط توڑتا | سیشن پروجیکٹ سے ہٹا رہا |
| `updated_milestone.settled` | سنگ میل تازہ کیا | سنگ میل اپ ڈیٹ کیا |
| `updated_milestone.running` | سنگ میل تازہ کرتا | سنگ میل اپ ڈیٹ کر رہا |
| `read_todos.running` | کاموں کی فہرست پڑھتا | کاموں کی فہرست پڑھ رہا |
| `updated_todos.settled` | کاموں کی فہرست بدلی | کاموں کی فہرست اپ ڈیٹ کی |
| `updated_todos.running` | کاموں کی فہرست بدلتا | کاموں کی فہرست اپ ڈیٹ کر رہا |
| `listed_wakes.settled` | بیداریوں کی فہرست دی | بیداریوں کی فہرست بنائی |
| `listed_wakes.running` | بیداریوں کی فہرست دیتا | بیداریوں کی فہرست بنا رہا |
| `listed_jobs.settled` | کاموں کی فہرست دی | جابز کی فہرست بنائی |
| `listed_jobs.running` | کاموں کی فہرست دیتا | جابز کی فہرست بنا رہا |
| `cancelled_job.settled` | کام منسوخ کیا | جاب منسوخ کیا |
| `cancelled_job.running` | کام منسوخ کر رہا | جاب منسوخ کر رہا |
| `checked_network_status.settled` | نیٹ ورک جانچا | نیٹ ورک کی حالت جانچی |
| `checked_network_status.running` | نیٹ ورک جانچ رہا | نیٹ ورک کی حالت جانچ رہا |
| `listed_networks.settled` | نیٹ ورک گنوائے | نیٹ ورکس کی فہرست بنائی |
| `listed_networks.running` | نیٹ ورک گنوا رہا | نیٹ ورکس کی فہرست بنا رہا |
| `listed_network_peers.settled` | نیٹ ورک ساتھی گنوائے | نیٹ ورک ڈیوائسز دکھائیں |
| `listed_network_peers.running` | نیٹ ورک ساتھی گنواتا | نیٹ ورک ڈیوائسز دکھا رہا |
| `read_network_log.running` | نیٹ ورک لاگ پڑھتا | نیٹ ورک لاگ پڑھ رہا |
| `diagnosed_network.settled` | نیٹ ورک پرکھا | نیٹ ورک کی تشخیص کی |
| `diagnosed_network.running` | نیٹ ورک پرکھ رہا | نیٹ ورک کی تشخیص کر رہا |
| `invited_device.running` | ڈیوائس کو دعوت دیتا | ڈیوائس کو دعوت دے رہا |
| `joined_network.running` | نیٹ ورک سے جڑتا | نیٹ ورک سے جڑ رہا |
| `listed_consoles.settled` | کنسولوں کی فہرست دی | کنسولوں کی فہرست بنائی |
| `listed_consoles.running` | کنسولوں کی فہرست دیتا | کنسولوں کی فہرست بنا رہا |
| `captured_console.running` | کنسول کی تصویر لیتا | کنسول کی تصویر لے رہا |
| `typed_in_console.settled` | کنسول میں لکھا | کنسول میں ٹائپ کیا |
| `typed_in_console.running` | کنسول میں لکھ رہا | کنسول میں ٹائپ کر رہا |
| `sent_keys.settled` | کلیدیں بھیجیں | کلیدیں بھیجی گئیں |
| `sent_keys.running` | کلیدیں بھیج رہا | کلیدیں بھیجی جا رہیں |
| `resized_console.running` | کنسول کا حجم بدلتا | کنسول کا حجم بدل رہا |
| `updated_secure_input.settled` | محفوظ ان پٹ بدلا | محفوظ ان پٹ اپ ڈیٹ کیا |
| `updated_secure_input.running` | محفوظ ان پٹ بدلتا | محفوظ ان پٹ اپ ڈیٹ کر رہا |
| `found_definition.settled` | تعریف تلاش کی | تعریف ڈھونڈ لی |
| `found_definition.running` | تعریف تلاش کر رہا | تعریف ڈھونڈ رہا |
| `found_references.settled` | حوالے تلاش کیے | حوالے ڈھونڈ لیے |
| `found_references.running` | حوالے تلاش کر رہا | حوالے ڈھونڈ رہا |
| `listed_symbols.settled` | علامتوں کی فہرست دی | علامتوں کی فہرست بنائی |
| `listed_symbols.running` | علامتوں کی فہرست دیتا | علامتوں کی فہرست بنا رہا |
| `previewed_rename.settled` | تبدیلیٔ نام جھلکائی | نام کی تبدیلی دکھائی |
| `previewed_rename.running` | تبدیلیٔ نام جھلکا رہا | نام کی تبدیلی دکھا رہا |
| `listed_sessions.settled` | سیشنوں کی فہرست دی | سیشنوں کی فہرست بنائی |
| `listed_sessions.running` | سیشنوں کی فہرست دیتا | سیشنوں کی فہرست بنا رہا |
| `peeked_at_session.running` | سیشن کی جھلک دیکھتا | سیشن کی جھلک دیکھ رہا |

## Width exceptions — explicit, not silently waived

Word counts use Python `str.split()`; character counts below are Unicode code points, **not rendered cells/pixels**. There is no numeric maxCells/maxChars in these staged sidecars. The task gives a 1–4-word preference and says the column does not truncate. V2 has 137 labels within four words, 36 at five words, 7 at six, and 2 at seven; longest is 29 code points. **Nine labels exceed even the five-word exception mentioned in the brief**; these need the independent auditor/manager to consider the explicit trade-off below. I have not rendered or declared these width exceptions visually safe.

The choice is to preserve shipped multiword terminology and truthful progressive morphology rather than merge Urdu words artificially, reintroduce habitual forms, omit the operation, or silently rename a concept. Five-word list forms have the shipped bridge precedent above. For six/seven-word forms, the exact glossary/shipped object plus اپ ڈیٹ or the progressive is irreducible without changing terminology or losing information; no hard-cap claim is made.

| Key | Words | Code points | Revised | Justification |
|---|---|---|---|---|
| `listed_variables.running` | 5 | 24 | متغیرات کی فہرست بنا رہا | Explicit named-object list + progressive; 5-word shipped bridge precedent. Multiword ذیلی ایجنٹ/نیٹ ورک adds one word. |
| `waited_for_jobs.running` | 5 | 21 | جابز کا انتظار کر رہا | Retain the full named object, required Urdu relation, and genuine progressive rather than habitual truncation. |
| `listed_agents.running` | 5 | 24 | ایجنٹوں کی فہرست بنا رہا | Explicit named-object list + progressive; 5-word shipped bridge precedent. Multiword ذیلی ایجنٹ/نیٹ ورک adds one word. |
| `reset_agent.running` | 5 | 19 | ایجنٹ ری سیٹ کر رہا | Keep shipped two-word ری سیٹ and running کر رہا; distinguishes resume بحال. |
| `updated_agent.running` | 5 | 19 | ایجنٹ اپ ڈیٹ کر رہا | Keep shipped اپ ڈیٹ and full object term; running needs کر رہا. Todos/secure-input/milestone names are multiword; shortening would rename or omit the object. |
| `synced_agents.running` | 5 | 20 | ایجنٹ ہم آہنگ کر رہا | Retain the full named object, required Urdu relation, and genuine progressive rather than habitual truncation. |
| `listed_teams.running` | 5 | 22 | ٹیموں کی فہرست بنا رہا | Explicit named-object list + progressive; 5-word shipped bridge precedent. Multiword ذیلی ایجنٹ/نیٹ ورک adds one word. |
| `updated_team.running` | 5 | 17 | ٹیم اپ ڈیٹ کر رہا | Keep shipped اپ ڈیٹ and full object term; running needs کر رہا. Todos/secure-input/milestone names are multiword; shortening would rename or omit the object. |
| `listed_subagents.settled` | 5 | 27 | ذیلی ایجنٹوں کی فہرست بنائی | Explicit named-object list + progressive; 5-word shipped bridge precedent. Multiword ذیلی ایجنٹ/نیٹ ورک adds one word. |
| `listed_subagents.running` | 6 | 29 | ذیلی ایجنٹوں کی فہرست بنا رہا | Explicit named-object list + progressive; 5-word shipped bridge precedent. Multiword ذیلی ایجنٹ/نیٹ ورک adds one word. |
| `paused.running` | 5 | 20 | عارضی طور پر روک رہا | Retain the full named object, required Urdu relation, and genuine progressive rather than habitual truncation. |
| `listed_secrets.running` | 5 | 22 | رازوں کی فہرست بنا رہا | Explicit named-object list + progressive; 5-word shipped bridge precedent. Multiword ذیلی ایجنٹ/نیٹ ورک adds one word. |
| `described_secret.running` | 5 | 19 | راز کی وضاحت کر رہا | Retain the full named object, required Urdu relation, and genuine progressive rather than habitual truncation. |
| `updated_secret.running` | 5 | 17 | راز اپ ڈیٹ کر رہا | Keep shipped اپ ڈیٹ and full object term; running needs کر رہا. Todos/secure-input/milestone names are multiword; shortening would rename or omit the object. |
| `listed_projects.running` | 5 | 25 | پروجیکٹس کی فہرست بنا رہا | Explicit named-object list + progressive; 5-word shipped bridge precedent. Multiword ذیلی ایجنٹ/نیٹ ورک adds one word. |
| `updated_project.running` | 5 | 21 | پروجیکٹ اپ ڈیٹ کر رہا | Keep shipped اپ ڈیٹ and full object term; running needs کر رہا. Todos/secure-input/milestone names are multiword; shortening would rename or omit the object. |
| `linked_session_to.running` | 5 | 23 | سیشن پروجیکٹ سے جوڑ رہا | پروجیکٹ سے explicitly preserves the link/unlink relation; ID follows as apposition. |
| `unlinked_session_from.running` | 5 | 23 | سیشن پروجیکٹ سے ہٹا رہا | پروجیکٹ سے explicitly preserves the link/unlink relation; ID follows as apposition. |
| `updated_milestone.settled` | 5 | 18 | سنگ میل اپ ڈیٹ کیا | Keep shipped اپ ڈیٹ and full object term; running needs کر رہا. Todos/secure-input/milestone names are multiword; shortening would rename or omit the object. |
| `updated_milestone.running` | 6 | 21 | سنگ میل اپ ڈیٹ کر رہا | Keep shipped اپ ڈیٹ and full object term; running needs کر رہا. Todos/secure-input/milestone names are multiword; shortening would rename or omit the object. |
| `read_todos.running` | 5 | 22 | کاموں کی فہرست پڑھ رہا | Retain the full named object, required Urdu relation, and genuine progressive rather than habitual truncation. |
| `updated_todos.settled` | 6 | 24 | کاموں کی فہرست اپ ڈیٹ کی | Keep shipped اپ ڈیٹ and full object term; running needs کر رہا. Todos/secure-input/milestone names are multiword; shortening would rename or omit the object. |
| `updated_todos.running` | 7 | 28 | کاموں کی فہرست اپ ڈیٹ کر رہا | Keep shipped اپ ڈیٹ and full object term; running needs کر رہا. Todos/secure-input/milestone names are multiword; shortening would rename or omit the object. |
| `listed_wakes.running` | 5 | 25 | بیداریوں کی فہرست بنا رہا | Explicit named-object list + progressive; 5-word shipped bridge precedent. Multiword ذیلی ایجنٹ/نیٹ ورک adds one word. |
| `listed_jobs.running` | 5 | 21 | جابز کی فہرست بنا رہا | Explicit named-object list + progressive; 5-word shipped bridge precedent. Multiword ذیلی ایجنٹ/نیٹ ورک adds one word. |
| `checked_network_status.settled` | 5 | 21 | نیٹ ورک کی حالت جانچی | Retain both نیٹ ورک and حالت; progressive جانچ رہا must not be habitual. |
| `checked_network_status.running` | 6 | 24 | نیٹ ورک کی حالت جانچ رہا | Retain both نیٹ ورک and حالت; progressive جانچ رہا must not be habitual. |
| `listed_networks.settled` | 5 | 23 | نیٹ ورکس کی فہرست بنائی | Explicit named-object list + progressive; 5-word shipped bridge precedent. Multiword ذیلی ایجنٹ/نیٹ ورک adds one word. |
| `listed_networks.running` | 6 | 25 | نیٹ ورکس کی فہرست بنا رہا | Explicit named-object list + progressive; 5-word shipped bridge precedent. Multiword ذیلی ایجنٹ/نیٹ ورک adds one word. |
| `listed_network_peers.running` | 5 | 24 | نیٹ ورک ڈیوائسز دکھا رہا | Shortest clear device-specific peer display phrase; avoids human ساتھی and ambiguous گنوانا. |
| `read_network_log.running` | 5 | 19 | نیٹ ورک لاگ پڑھ رہا | Retain the full named object, required Urdu relation, and genuine progressive rather than habitual truncation. |
| `diagnosed_network.settled` | 5 | 19 | نیٹ ورک کی تشخیص کی | Retain نیٹ ورک + تشخیص and genuine progressive; avoids generic assessed. |
| `diagnosed_network.running` | 6 | 23 | نیٹ ورک کی تشخیص کر رہا | Retain نیٹ ورک + تشخیص and genuine progressive; avoids generic assessed. |
| `invited_device.running` | 5 | 21 | ڈیوائس کو دعوت دے رہا | Retain the full named object, required Urdu relation, and genuine progressive rather than habitual truncation. |
| `joined_network.running` | 5 | 17 | نیٹ ورک سے جڑ رہا | Retain the full named object, required Urdu relation, and genuine progressive rather than habitual truncation. |
| `listed_consoles.running` | 5 | 24 | کنسولوں کی فہرست بنا رہا | Explicit named-object list + progressive; 5-word shipped bridge precedent. Multiword ذیلی ایجنٹ/نیٹ ورک adds one word. |
| `captured_console.running` | 5 | 21 | کنسول کی تصویر لے رہا | Retain the full named object, required Urdu relation, and genuine progressive rather than habitual truncation. |
| `typed_in_console.running` | 5 | 21 | کنسول میں ٹائپ کر رہا | Keep کنسول میں and typing distinction ٹائپ; progressive needs کر رہا. |
| `resized_console.running` | 5 | 20 | کنسول کا حجم بدل رہا | Retain the full named object, required Urdu relation, and genuine progressive rather than habitual truncation. |
| `updated_secure_input.settled` | 6 | 22 | محفوظ ان پٹ اپ ڈیٹ کیا | Keep shipped اپ ڈیٹ and full object term; running needs کر رہا. Todos/secure-input/milestone names are multiword; shortening would rename or omit the object. |
| `updated_secure_input.running` | 7 | 25 | محفوظ ان پٹ اپ ڈیٹ کر رہا | Keep shipped اپ ڈیٹ and full object term; running needs کر رہا. Todos/secure-input/milestone names are multiword; shortening would rename or omit the object. |
| `listed_symbols.running` | 5 | 24 | علامتوں کی فہرست بنا رہا | Explicit named-object list + progressive; 5-word shipped bridge precedent. Multiword ذیلی ایجنٹ/نیٹ ورک adds one word. |
| `previewed_rename.running` | 5 | 22 | نام کی تبدیلی دکھا رہا | Plain نام کی تبدیلی avoids literary izafat/new ری نیم loan; progressive دکھا رہا reports preview display. |
| `listed_sessions.running` | 5 | 23 | سیشنوں کی فہرست بنا رہا | Explicit named-object list + progressive; 5-word shipped bridge precedent. Multiword ذیلی ایجنٹ/نیٹ ورک adds one word. |
| `peeked_at_session.running` | 5 | 21 | سیشن کی جھلک دیکھ رہا | Retain the full named object, required Urdu relation, and genuine progressive rather than habitual truncation. |

## Ambiguity and glossary proposals

- **Link/unlink composition:** Urdu naturally uses postpositions; do not imitate an English stranded “to/from”. V2 states سیشن پروجیکٹ سے جوڑا / ہٹایا before the project identifier, which is appositional to پروجیکٹ. This preserves the relationship without inserting bidi controls or reordering the code identifier. Independent RTL/composition review remains necessary.
- **Peers:** propose network peer → نیٹ ورک ڈیوائس (plural ڈیوائسز) for the mesh-device context, rather than human ساتھی. V2 uses the short show/display verb for that list to bound width. No glossary was edited.
- **Job:** record job → جاب, plural جابز in a future approved glossary/style-guide update; the shared Urdu job cell is still unfilled, but this is already shipped in ten strings.
- **Update/reset:** propose formally documenting the already-shipped اپ ڈیٹ / ری سیٹ versus refresh تازہ / restore-resume بحال distinction; no new term was invented.
- **Found:** ڈھونڈ لی/لیے (found, resultative) versus ڈھونڈ رہا (finding) keeps a single verb root and makes the completed result explicit.
- **Keys:** passive settled/running forms avoid the past-versus-imperative homograph without inventing an alternative keyboard noun.

## Validation actually executed

`python3` loaded `keys.json`, the preserved `ur.json`, and the written `ur.v2.json`, then asserted exact key set/order and 182 entries, nonempty strings, no English-identical values except allowed Python, no manual bidi controls (including U+061C, U+200E/F, U+202A–E, U+2066–69), and NFC. Actual stdout:

```text
PASS: 182 keys in source order; 0 empties; 0 English-identical; 0 manual bidi controls; NFC intact
Changed keys: 76
SHA-256: c71f5e40612dca85cee0d05ddfe4d833d3a68d05fb7c96a3e1519dbed1f904e0
Integration diagnosis: staged source keys absent from shipped ur catalogue: 182
Original unchanged SHA-256: 7525521c04130f6b8182ba941850d0cbe76f0b08bd997aa8a9fe153d05dfb5fd
```

Additional local Python checks on the exact written v2 bytes: no unexpected Latin outside the official technology name Python; no leading/trailing/double spaces; source code/placeholder token preservation (no tokens are present in this slice); all 26 original habitual running forms replaced. These are mechanical checks, not an independent linguistic audit.

Ran `pnpm check-i18n:catalogues` in the manager-owned `i18n-l1-tool-verbs` worktree. **Exit 1**, not a pass:

```text
keys.gen.ts is byte-identical to a fresh generation.
check-duplicates: ok — 1428 file(s) scanned, 0 duplicate key(s)
check-strings.mjs: ok — 1660 file(s) scanned, 0 literal(s) at or below the baseline; 40 allowed data-shape literals
ledger-check: FAILED — 24 finding(s) across 1106 ledger entr(ies)
```

The 24 ledger findings concern seven locales’ canonical namespace: each catalogue is missing the staged 182 keys, each source hash is stale, and existing receipts name the pre-change English bytes. Verified this diagnosis for Urdu by directly computing that all 182 source keys are absent from the shipped catalogue. V2 is intentionally only a separate staged file and cannot satisfy that integrated-catalogue gate. No ledger was marked passed, and no other locale or historical receipt was modified to conceal the failure. Integration plus fresh independent receipts belong to the manager/coder/auditor lanes.

The chained catalogue command stops at ledger-check; therefore ran `node scripts/i18n/context-parity.mjs` separately. **Exit 0**:

```text
context-parity: ok — every English key is covered, apart from 129 allowed gap(s) in 4 namespace(s) (shrink-only; see i18n/context-allowance.json).
```

No claim that committed-catalogue checks audited or validated the staged translations. No self-audit, rendered screenshot, ledger pass, commit, PR, merge or release is claimed. Independent re-audit should cover all 76 changed keys, the nine >5-word exceptions, and the explicit MINOR/NIT declines.
