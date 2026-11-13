# Vietnamese L1 remediation — revised translation, not an audit

- Translator: i18n-translator; session `175d55eb22b6`; actual served model `openai/gpt-6.1-sol`; no fallback used.
- Date: 2026-11-11. Fix lane, bounded under two hours. Scope: only the requested 182-key prep subset and this remediation report. No commits, ledger writes, shipped catalogue edits, or audit verdicts.
- Inputs: `keys.json`, `vi.json`, `audit-vi-A.md`, `audit-vi-B.md` in this directory; core `i18n/style-guides/{vi,en}.md`, `i18n/glossary.md`; UI `docs/I18N.md`; context.role for each tool operation; shipped UI `src/i18n/catalogues/vi/*.json`.
- Result: **32 changed keys / 182 total**, **16 fixed finding entries**, **6 declined**, **0 deferred**. Report B has no IDs: `VI-B-01`…`09` follow its numbered findings; `VI-B-N1`…`N3` follow its three nit bullets. Overlapping findings are counted separately, not as extra changed keys. Contrary to B's summary of six MINORs, its numbered MINOR section actually contains seven (3–9); this report resolves all seven.
- All 91 pairs retain `Đã` / `Đang` plus the same base verb. Vietnamese guide §Formality asks unconjugated label verbs, not mandatory removal of aspect markers; the shipped `tool_row.bridge.verb.*` status column uses the exact `Đã` / `Đang` pattern. No systemic register change is warranted. `found_*` adds resultative `thấy` only to settled forms: `Đang tìm thấy` would incorrectly assert a result while still searching.

## Findings and dispositions

Key abbreviations below expand with `ui.chat.canonical.tool_row.verb.`. `Đã/Đang` means the settled/running values respectively. “fixed” describes the saved v2 bytes, not a committed remediation or independent audit.

| Finding | Decision | Verified change or reason |
|---|---|---|
| VI-A-01 | fixed | `listed_wakes.{settled,running}`: `Đã/Đang liệt kê lịch nhắc` → `Đã/Đang liệt kê lịch thức dậy`<br>`cancelled_wake.{settled,running}`: `Đã/Đang hủy lịch nhắc` → `Đã/Đang hủy lịch thức dậy` |
| VI-A-02 | fixed | `updated_secure_input.{settled,running}`: `Đã/Đang đổi chế độ nhập kín` → `Đã/Đang đổi chế độ nhập bảo mật` |
| VI-A-03 | fixed | `listed_network_peers.{settled,running}`: `Đã/Đang liệt kê nút mạng` → `Đã/Đang liệt kê thiết bị ngang hàng` |
| VI-A-04 | fixed | `stored_secret.{settled,running}`: `Đã/Đang lưu bí mật` → `Đã/Đang lưu thông tin bí mật`<br>`retrieved_secret.{settled,running}`: `Đã/Đang truy xuất bí mật` → `Đã/Đang truy xuất thông tin bí mật`<br>`listed_secrets.{settled,running}`: `Đã/Đang liệt kê bí mật` → `Đã/Đang liệt kê thông tin bí mật`<br>`described_secret.{settled,running}`: `Đã/Đang mô tả bí mật` → `Đã/Đang mô tả thông tin bí mật`<br>`updated_secret.{settled,running}`: `Đã/Đang cập nhật bí mật` → `Đã/Đang cập nhật thông tin bí mật`<br>`deleted_secret.{settled,running}`: `Đã/Đang xóa bí mật` → `Đã/Đang xóa thông tin bí mật` |
| VI-A-05 | fixed | `updated_todos.{settled,running}`: `Đã/Đang cập nhật việc` → `Đã/Đang cập nhật việc cần làm` |
| VI-A-06 | fixed | `found_definition.settled`: `Đã tìm định nghĩa` → `Đã tìm thấy định nghĩa`; running `tìm` unchanged (resultative `thấy` only after completion)<br>`found_references.settled`: `Đã tìm tham chiếu` → `Đã tìm thấy tham chiếu`; running `tìm` unchanged (resultative `thấy` only after completion) |
| VI-A-07 | fixed | `raised_panic.{settled,running}`: `Đã/Đang kích hoạt khẩn cấp` → `Đã/Đang dừng khẩn cấp` |
| VI-A-08 | fixed | `browsed.{settled,running}`: `Đã/Đang duyệt` → `Đã/Đang duyệt web` |
| VI-B-02 | fixed | `listed_wakes.{settled,running}`: `Đã/Đang liệt kê lịch nhắc` → `Đã/Đang liệt kê lịch thức dậy`<br>`cancelled_wake.{settled,running}`: `Đã/Đang hủy lịch nhắc` → `Đã/Đang hủy lịch thức dậy` |
| VI-B-03 | fixed | `updated_todos.{settled,running}`: `Đã/Đang cập nhật việc` → `Đã/Đang cập nhật việc cần làm` |
| VI-B-04 | fixed | `browsed.{settled,running}`: `Đã/Đang duyệt` → `Đã/Đang duyệt web` |
| VI-B-05 | fixed | `listed_network_peers.{settled,running}`: `Đã/Đang liệt kê nút mạng` → `Đã/Đang liệt kê thiết bị ngang hàng` |
| VI-B-06 | fixed | `removed_device.{settled,running}`: `Đã/Đang loại thiết bị` → `Đã/Đang gỡ thiết bị` |
| VI-B-07 | fixed | `checked_network_status.{settled,running}`: `Đã/Đang kiểm tra mạng` → `Đã/Đang kiểm tra trạng thái mạng` |
| VI-B-08 | fixed | `raised_panic.{settled,running}`: `Đã/Đang kích hoạt khẩn cấp` → `Đã/Đang dừng khẩn cấp` |
| VI-B-09 | fixed | `updated_secure_input.{settled,running}`: `Đã/Đang đổi chế độ nhập kín` → `Đã/Đang đổi chế độ nhập bảo mật`; choose shipped **bảo mật**, not suggested **bí mật**, because all four console secure-control strings use nhập bảo mật |
| VI-A-09 | declined | Retain `đổi cỡ`: accurate compact resize label; shipped `Đổi kích thước bảng lệnh` is a longer tooltip, not a binding glossary term. Adding a syllable would worsen the already five-syllable label without changing meaning. |
| VI-A-10 | declined | Retain `tạo phiên`: spawn creates a fresh session, as context.role confirms. No competing created-session verb; the auditor explicitly found no collision. Narrow, idiomatic, four syllables. |
| VI-B-01 | declined | Retain `bảng lệnh` across all eight console pairs. Recounted shipped console-key copy: **20** strings use bảng lệnh versus **6** bảng điều khiển (the seventh overall console-key match is the unrelated Radient console). ui.console.pane.label, ui.console.new, ui.console.pane.close and both loading labels all use bảng lệnh. The actual interactive terminal surface outweighs the six rail/header affordances. No glossary/vi-guide console mandate exists. Auditor A independently endorses this same dominant term. Palette collision and pre-existing inconsistent rail terminology are real, but changing only new verbs to the minority term does not resolve them; broader catalogue normalization is outside this slice. |
| VI-B-N1 (milestone) | declined | Retain `mốc`: shipped ui.projects.count.milestones_are, project-detail failure messages and milestone-delete copy use mốc for actual milestones, not only time anchors. Thus the claim that shipped mốc is only a time anchor is disproved. Adding cột would introduce a second term. |
| VI-B-N2 (resize) | declined | Retain `đổi cỡ` for the compact row; same width/fidelity rationale as VI-A-09. No independent terminology mandate requires the tooltip wording. |
| VI-B-N3 (send/message) | declined | Retain `Đã/Đang gửi` and `Đã/Đang nhắn tin`: both are grammatical before the monospace recipient. The finding explicitly says both are acceptable; adding tới/cho is optional. Keep existing concise valid constructions. |

## Evidence for terminology choices

- Wake: vi guide lines 32–33 explicitly requires intransitive `thức dậy`; shipped `ui.chat.run_details.wake.armed_count` uses `lịch thức dậy`. Both new wake object pairs now agree. Leave old `lịch đánh thức` strings untouched, outside scope.
- Secure input: four shipped `ui.console.secure*` values use `nhập bảo mật`. Use full `chế độ nhập bảo mật`, not the auditor B alternative `nhập bí mật` and not invented `nhập kín`.
- Peer: three shipped `ui.mesh.*` values use `thiết bị ngang hàng`; the new listing uses precisely that noun. A network “node” could legitimately be nút in general Vietnamese, but the product-specific peer noun is stronger evidence than the auditor's button-homonym argument.
- Secret: nine shipped values use `thông tin bí mật`, including `fold.count.secret` and the composer secret-ask notice. Apply to all six secret operations, preserving distinctions between storing/retrieving/listing/describing/updating/deleting.
- Todos: both sibling `read_todos` and shipped fold counts use `việc cần làm`; updated pair now matches. Jobs remain `tác vụ`, variables `biến`, milestones `mốc` and sessions `phiên`.
- Browser context.role is the browser tool, not approval; `duyệt web` disambiguates. Network panic is emergency disconnection; `dừng khẩn cấp` names the effect without an omitted noun. Network member removal uses transitive `gỡ thiết bị`; status explicitly uses `trạng thái`, distinct from diagnose.
- Console count method: count JSON values whose key contains `console` and value contains the term, excluding the unrelated Radient account console. This produces 20 bảng lệnh / 6 bảng điều khiển; not a claim that the old catalogue is internally consistent.

## Width exceptions (all >4 whitespace-separated syllables)

Vietnamese spaces separate syllables, not lexical words: `thông tin`, `bí mật`, `thức dậy`, `điều khiển`, `ngang hàng` are indivisible multi-syllable concepts. Enforcing four whitespace tokens would truncate established nouns. The following **58 keys / 29 pairs**, of which **26 changed keys**, exceed that mechanical count. They are deliberate locale exceptions: preserve exact shipped/glossary terms, aspect, operation, and following object relation instead of shortening to a different concept. No truncation introduced. Maximum is **7 syllables / 32 cells** (`listed_network_peers.running`). All characters here have width one (NFC, no combining marks or East Asian wide/fullwidth characters), so code-point counts equal terminal-cell counts; no rendered pixel-fit claim is made. Peers and secure input are the most visible outliers for independent rendered review.

| Pair | Settled / running | Syllables | Cells |
|---|---|---:|---:|
| `listed_agents` | Đã liệt kê tác nhân / Đang liệt kê tác nhân | 5/5 | 19/21 |
| `reset_agent` | Đã đặt lại tác nhân / Đang đặt lại tác nhân | 5/5 | 19/21 |
| `updated_agent` | Đã cập nhật tác nhân / Đang cập nhật tác nhân | 5/5 | 20/22 |
| `synced_agents` | Đã đồng bộ tác nhân / Đang đồng bộ tác nhân | 5/5 | 19/21 |
| `listed_subagents` | Đã liệt kê tác nhân con / Đang liệt kê tác nhân con | 6/6 | 23/25 |
| `stored_secret` | Đã lưu thông tin bí mật / Đang lưu thông tin bí mật | 6/6 | 23/25 |
| `retrieved_secret` | Đã truy xuất thông tin bí mật / Đang truy xuất thông tin bí mật | 7/7 | 29/31 |
| `listed_secrets` | Đã liệt kê thông tin bí mật / Đang liệt kê thông tin bí mật | 7/7 | 27/29 |
| `described_secret` | Đã mô tả thông tin bí mật / Đang mô tả thông tin bí mật | 7/7 | 25/27 |
| `updated_secret` | Đã cập nhật thông tin bí mật / Đang cập nhật thông tin bí mật | 7/7 | 28/30 |
| `deleted_secret` | Đã xóa thông tin bí mật / Đang xóa thông tin bí mật | 6/6 | 23/25 |
| `listed_projects` | Đã liệt kê dự án / Đang liệt kê dự án | 5/5 | 16/18 |
| `updated_project` | Đã cập nhật dự án / Đang cập nhật dự án | 5/5 | 17/19 |
| `read_todos` | Đã đọc việc cần làm / Đang đọc việc cần làm | 5/5 | 19/21 |
| `updated_todos` | Đã cập nhật việc cần làm / Đang cập nhật việc cần làm | 6/6 | 24/26 |
| `listed_wakes` | Đã liệt kê lịch thức dậy / Đang liệt kê lịch thức dậy | 6/6 | 24/26 |
| `cancelled_wake` | Đã hủy lịch thức dậy / Đang hủy lịch thức dậy | 5/5 | 20/22 |
| `listed_jobs` | Đã liệt kê tác vụ / Đang liệt kê tác vụ | 5/5 | 17/19 |
| `checked_network_status` | Đã kiểm tra trạng thái mạng / Đang kiểm tra trạng thái mạng | 6/6 | 27/29 |
| `listed_network_peers` | Đã liệt kê thiết bị ngang hàng / Đang liệt kê thiết bị ngang hàng | 7/7 | 30/32 |
| `read_network_log` | Đã đọc nhật ký mạng / Đang đọc nhật ký mạng | 5/5 | 19/21 |
| `listed_consoles` | Đã liệt kê bảng lệnh / Đang liệt kê bảng lệnh | 5/5 | 20/22 |
| `checked_console` | Đã kiểm tra bảng lệnh / Đang kiểm tra bảng lệnh | 5/5 | 21/23 |
| `typed_in_console` | Đã nhập vào bảng lệnh / Đang nhập vào bảng lệnh | 5/5 | 21/23 |
| `resized_console` | Đã đổi cỡ bảng lệnh / Đang đổi cỡ bảng lệnh | 5/5 | 19/21 |
| `updated_secure_input` | Đã đổi chế độ nhập bảo mật / Đang đổi chế độ nhập bảo mật | 7/7 | 26/28 |
| `found_definition` | Đã tìm thấy định nghĩa / Đang tìm định nghĩa | 5/4 | 22/19 |
| `found_references` | Đã tìm thấy tham chiếu / Đang tìm tham chiếu | 5/4 | 22/19 |
| `listed_symbols` | Đã liệt kê ký hiệu / Đang liệt kê ký hiệu | 5/5 | 18/20 |
| `previewed_rename` | Đã xem trước đổi tên / Đang xem trước đổi tên | 5/5 | 20/22 |

Preserved long labels include subagents, agent updates, consoles, and rename preview. Changed long labels are required by full secret/todo/wake/peer/secure-input terminology, explicit network status, or completed “found” semantics. The short `dừng khẩn cấp` alternative avoids lengthening panic; keeping `đổi cỡ` avoids unnecessary resize expansion.

## Validation actually executed

1. `python3` (explicit shell invocation, following the initial session-Python check): reloaded saved `vi.v2.json` with duplicate-aware JSON parsing, compared to `keys.json`: **PASS** — 182 unique keys in identical source order; no empty/non-string values; no case-insensitive English-identical values (Python allowed); no manual bidi controls including U+061C; all NFC; no placeholder/markup drift; all 91 pairs preserve verb stem with the two explicit completed-found resultative exceptions. Changed-key count: **32**. No MT service was used.
2. From `../i18n-l1-tool-verbs`: `pnpm check-i18n` **exit 1**. Actual output: generated keys byte-identical; `check-duplicates: ok — 1428 file(s) scanned, 0 duplicate key(s)`; `check-strings.mjs: ok — 1660 file(s) scanned, 0 literal(s) at or below the baseline; 40 literal(s) in the data shapes, all listed in i18n/literal-allowance.json (shrink-only)`; `ledger-check: FAILED — 24 finding(s) across 1106 ledger entr(ies)`. All seven locales report their 182 new keys missing and source hash stale; old ledger source `38f767d08ff0…` vs source file `a385671b988e…`; several old auditor receipts name prior English source bytes. The command stops at ledger-check, so context-parity, added-strings and coverage did **not** run. Direct JSON comparison independently confirms all **182** new keys are absent from the shipped vi catalogue. This prep-only revision cannot resolve integration/receipt failures without exceeding its scope; the manager must integrate revised locales and fresh independent receipts before a green full gate. No old receipts were rewritten and no ledger status was promoted.

## Glossary proposals / handoff

- Record existing shipped decisions: console `bảng lệnh` (separately reconcile rail/header `bảng điều khiển` and palette collision in an authorized audited scope); secure input `chế độ nhập bảo mật`; peer `thiết bị ngang hàng`; secret `thông tin bí mật`; todo `việc cần làm`; milestone `mốc`.
- These are proposals/verified existing UI terms, not changes to the binding core glossary.
- A separate auditor must re-check changed keys, the console-major rejection with the concrete catalogue counts, completed-found aspect grammar, and width exceptions. No self-audit or “passed” claim.

## Input and output hashes

- `keys.json`: `b3f3bfe3688d1461a061009e98a58802171eb181343fdb8fcfd0af07652ca419`
- `vi.json`: `c24ca242ad0483d5467ccca2033f4077634a9f52a80c1b78c379e0e3a7272cc9`
- `audit-vi-A.md`: `707437610f87db36b38beaa2181306d7f7d5b71d1218e6544162eb1012dd5d0a`
- `audit-vi-B.md`: `1d4e41c71fb21e76f5d60e852bd2be25e16989c62c7cbfdc90c9a4494757699d`
- `vi.v2.json`: `ce557af314121371a04b3ff7e522f6694bb9c9f57c8195e6a1c1de26aad82a02`
