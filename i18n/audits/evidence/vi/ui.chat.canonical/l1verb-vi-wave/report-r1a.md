# Audit — `vi` · `ui.chat.canonical` tool-row verbs (182 keys) · report A

- **Locale:** `vi` · **Report suffix:** A · **Date:** 2026-11-11
- **Namespace / file group:** `ui.chat.canonical`, `tool_row.verb.*` (182 keys = 91 settled/running pairs)
- **Auditor:** independent `i18n-auditor` subagent (`agent`), session `ba0acb28ca3c`, model `deepseek/deepseek-flash` (actual served model, reported by the harness; no fallback was announced to me). **Not the translator** (translator: `openai/gpt-6.1-sol`, session unknown to me).
- **Input hashes (SHA-256):**
  - en source + context sidecar `_l1-prep/keys.json` — `b3f3bfe3688d1461a061009e98a58802171eb181343fdb8fcfd0af07652ca419`
  - translated file `_l1-prep/vi.json` — `c24ca242ad0483d5467ccca2033f4077634a9f52a80c1b78c379e0e3a7272cc9`
  - `~/local-operator/i18n/style-guides/vi.md` — `e4901497ed553e2b2ae4a2660bf776adb787b89e11d7eb0f8d08f3da4b227888`
  - `~/local-operator/i18n/style-guides/en.md` — `c967c91037be79a7b184b3288b8c0326a261e4adae95b7db06d83e96f8ea6ec7`
  - `~/local-operator/i18n/glossary.md` — `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8`
- **Shipped copy read for consistency:** `src/i18n/catalogues/vi/*.json` in worktree `i18n-l1-tool-verbs` (whole `vi` catalogue set, greps below).

## Verdict

**blocked — 3 unresolved MAJOR, 0 BLOCKER** (ledger status `changes_requested`; this is a completed audit with findings, not an aborted one).

Counts: `{blocker: 0, major: 3, minor: 5, nit: 2}`

I did not edit any translation (auditor contract). I wrote no ledger row and no evidence bundle — see "Records" at the end; the reason is the target file is a prep file with no in-repo hash yet.

## Mechanical checks (run, not inferred)

All run with `python3` over `keys.json` + `vi.json` in `~/local-operator-ui/.worktrees/_l1-prep`:

| Check | Result |
|---|---|
| Key set equal to source | PASS — 182 = 182, `set(k)==set(v)` |
| Key **order** equal to source | PASS — `list(k)==list(v)`; no key added/dropped |
| Empty / non-string values | PASS — none |
| Valid JSON | PASS — `json.load` clean |
| Raw duplicate key names (the `check-duplicates` class of defect, scanned with `object_pairs_hook`) | PASS — none |
| Placeholders | PASS — 0 keys in this batch carry placeholders (`context.placeholders == "none"` on all 182); no `{ } $ %` in either side |
| ICU plural/select required | N/A — no plural/select messages in this group; nothing to break |
| Markup / backtick / command / flag / identifier integrity | PASS — no Latin tokens in the values except **Python** (`ran_python.*`), which is an allowed technology name (§1 of the glossary) |
| Stray English left in values | PASS — 0 values identical to English (case-insensitive) |
| Manual bidi/format characters (`U+200E/200F/202A-E/2066-9`) | PASS — none |
| NFC / no decomposed combining marks (vi guide "always NFC") | PASS — `NFC(v)==v` on all 182 |
| Settled/running pair stems | PASS — every pair is exactly `Đã <stem>` / `Đang <stem>` with identical `<stem>` (0 mismatches), matching the shipped `Đã …`/`Đang …` verb convention in `ui.chat.canonical.json` |
| Length | Values 8–23 cells (widest: `Đã liệt kê tác nhân con` 23; en widest `Checked network status` 21). No value exceeds the widest English verb by more than 2 cells. Column is `shrink-0 whitespace-nowrap` (`tool-row.tsx:995`), so a long verb steals width from the object — 23 cells is acceptable, see fit notes per finding |
| Style guide: no `!`, no `please`, sentence case, terse, no `bạn` over-use | PASS |
| Style guide punctuation (quotes “ ”, em dash, `…`) | PASS / N/A — no such characters appear in this group |

Repo validators (`node scripts/i18n/generate.mjs --check`, `check-duplicates.mjs`, `context-parity.mjs`, `ledger-check.mjs`) all read the **tracked** catalogues; the audited file is a prep artifact outside them, so they cannot run on it and I did not claim they did. The table above is my own equivalent, executed.

## Findings

### MAJOR

**VI-A-01 — `wake` is renamed «lịch nhắc», a third variant the glossary does not allow**
Keys: `tool_row.verb.listed_wakes.settled` «Đã liệt kê lịch nhắc» · `.running` «Đang liệt kê lịch nhắc» · `tool_row.verb.cancelled_wake.settled` «Đã hủy lịch nhắc» · `.running` «Đang hủy lịch nhắc»
Problem: glossary §2 fixes `wake` → translate, vi rendering **«thức dậy»**, and footnote 1 says "for the noun label use the table's form" — with any exception to be recorded in the locale guide by the wave that first translates `wake`. The vi guide records no such exception. The product now has **three names for one concept**: «thức dậy» (glossary/guide, and the shipped `bridge.delivery.awaiting_acceptance.note` "…trước khi tác nhân thức dậy"), «lịch đánh thức» (shipped `ui.schedules.count.wake`), and «lịch nhắc» here. Within the same tool cluster it is also self-inconsistent: the action is `Scheduled` → «Đã lên lịch» while the object it creates is called a *reminder*, and «nhắc» is the word this catalogue already uses for `mention` (`ui.teamBridge.notify.mention` "Khi được nhắc đến", `ui.shell.rail.code.mentioned`) — a wake is a scheduled self-wake, not a mention.
Suggestion: `Đã liệt kê lịch thức dậy` / `Đang liệt kê lịch thức dậy` and `Đã hủy lịch thức dậy` / `Đang hủy lịch thức dậy` (24 / 20 cells — within the file's range). `lượt thức dậy` is an acceptable synonym if the manager prefers the plain glossary noun. The pre-existing `ui.schedules` divergence («lịch đánh thức», which the guide's intransitive rule also disallows) is **not** this wave's to fix and must not be copied; it should be corrected in its own audited wave.

**VI-A-02 — `secure input` renamed «chế độ nhập kín», contradicting the shipped console term**
Keys: `tool_row.verb.updated_secure_input.settled` «Đã đổi chế độ nhập kín» · `.running` «Đang đổi chế độ nhập kín»
Problem: the console surface this op toggles is shipped as «Chế độ nhập bảo mật» — `ui.console.secure` "Chế độ nhập bảo mật đang bật…", `ui.console.secure_toggle.start` «Nhập bảo mật», `…start_tooltip` «Nhập bảo mật: ngừng ghi lại cửa sổ dòng lệnh này». «kín» (sealed/airtight/discreet) is not Vietnamese for masked input and is not a term this product uses anywhere; a user who reads «Chế độ nhập bảo mật đang bật» in the console pane then sees «Đã đổi chế độ nhập kín» in the transcript will not connect the two. Terminology drift on a security-adjacent control.
Suggestion: `Đã đổi chế độ nhập bảo mật` / `Đang đổi chế độ nhập bảo mật` (26 cells; the widest in the file, acceptable next to the 23-cell `Đã liệt kê tác nhân con` — the object still has the flexing half).

**VI-A-03 — network `peers` rendered «nút mạng»; «nút» is this UI's word for a button**
Keys: `tool_row.verb.listed_network_peers.settled` «Đã liệt kê nút mạng» · `.running` «Đang liệt kê nút mạng»
Problem: two independent defects. (a) In this catalogue «nút» means **button** — 8 shipped strings, e.g. `ui.miniView.recording` "Nhấn nút dừng khi hoàn tất", `ui.onboarding.tour.create_new_agent.body.1` "Nhấn nút “+”…" — so «liệt kê nút mạng» invites "listed the network buttons" on first read. (b) The shipped mesh copy names a peer «thiết bị ngang hàng» (`ui.mesh.mesh_reach.peer_relay_not_running` "Dịch vụ chuyển tiếp của thiết bị ngang hàng không chạy", `ui.mesh.mesh_list…` "…từ thiết bị ngang hàng…"), and one glossary row (`device` → «thiết bị») points the same way; the transcript would call the same entity something else.
Suggestion: `Đã liệt kê thiết bị ngang hàng` / `Đang liệt kê thiết bị ngang hàng` — 30 cells, the widest string in this group (en 20). If the manager judges 30 cells too costly for the gutter, the compact honest alternative is `Đã liệt kê máy ngang hàng` (25) or `Đã liệt kê thiết bị` (19, loses "peer"); please do not keep «nút» — the button collision is the part that misleads.

### MINOR

**VI-A-04 — the `secret` object is the bare noun «bí mật»; shipped copy uses «thông tin bí mật»** (12 keys: `stored_secret`, `retrieved_secret`, `listed_secrets`, `described_secret`, `updated_secret`, `deleted_secret`, both forms each)
e.g. `Đã lưu bí mật`, `Đã xóa bí mật`, `Đã liệt kê bí mật`.
Bare «bí mật» is an adjective used as a noun with no classifier, and it has an adverbial reading ("saved *secretly*", "listed *secretly*"), which matters most on the two destructive/decrypting rows. Shipped: `fold.count.secret` "…thông tin bí mật", `composer.secret_ask_notice` "…đang yêu cầu thông tin bí mật". Meaning is recoverable from the monospace object that follows, hence MINOR, not MAJOR.
Suggestion: `Đã lưu thông tin bí mật` / `Đã xóa thông tin bí mật` (23 cells); width fallback `Đã lưu mục bí mật` / `Đã xóa mục bí mật` (17).

**VI-A-05 — `todos` rendered two ways inside four adjacent keys** (`updated_todos.settled` «Đã cập nhật việc» · `.running` «Đang cập nhật việc»)
`read_todos` renders the same noun as «việc cần làm» «Đã đọc việc cần làm», and the shipped fold count uses `fold.count.todo` "…lần cập nhật việc cần làm" / `todo_read` "…lần đọc việc cần làm". «cập nhật việc» alone is vague ("updated work").
Suggestion: `Đã cập nhật việc cần làm` / `Đang cập nhật việc cần làm` (24 cells; +6 vs en 13, acceptable).

**VI-A-06 — `Found …` (lsp) rendered with the *searching* verb, collapsing it into grep's «Đã tìm»** (`found_definition.settled`, `found_references.settled`)
«Đã tìm định nghĩa» / «Đã tìm tham chiếu» read as "searched for (a) definition/reference" — the settled form loses "found", and it is the same verb the `grep` rows use for `Searched` («Đã tìm»). The English deliberately distinguishes the two.
Suggestion: `Đã tìm thấy định nghĩa` / `Đã tìm thấy tham chiếu` (22 cells), keeping the running forms as «Đang tìm …». (Pair still shares the verb stem `tìm`.)

**VI-A-07 — «Đã kích hoạt khẩn cấp» is elliptical: «khẩn cấp» is a modifier with no noun** (`raised_panic.settled` «Đã kích hoạt khẩn cấp» · `.running` «Đang kích hoạt khẩn cấp»)
"activated urgent" — the reader supplies the noun. `network panic` is an emergency disconnect, so the missing noun is the whole point of the row.
Suggestion: `Đã dừng khẩn cấp` / `Đang dừng khẩn cấp` (16 cells, names the effect) or `Đã kích hoạt chế độ khẩn cấp` (28, keeps "activate"); pick one and keep the pair.

**VI-A-08 — «Đã duyệt» for `Browsed` is ambiguous with *approve*** (`browsed.settled` «Đã duyệt» · `.running` «Đang duyệt»)
`duyệt` standing alone is the everyday verb for approving ("duyệt đơn/yêu cầu") in a harness that has a first-class approvals concept; the browsing sense needs its collocation. The browser surface elsewhere is «trình duyệt» (`fold.count.browser` "thao tác trình duyệt").
Suggestion: `Đã duyệt web` / `Đang duyệt web` (12 cells — cheaper than the current pair's neighbours).

### NIT

**VI-A-09 — `resized_console`: «đổi cỡ» vs the shipped «Đổi kích thước»** (`Đã đổi cỡ bảng lệnh`, `Đang đổi cỡ bảng lệnh`)
`ui.common.layout.chat_layout.resize_console…` ships "Đổi kích thước bảng lệnh." «cỡ» is colloquial and narrower (font/size), not "resize a pane". No action required unless the manager is already touching this cluster; `Đã đổi kích thước bảng lệnh` is 27 cells.

**VI-A-10 — `spawned_session` «Đã tạo phiên» renders `spawn` as `create`** (`Đã tạo phiên`, `Đang tạo phiên`)
No `created session` key exists, so nothing collides and the user still understands; only the "start a fresh session for delegated work" nuance is lost. `Đã khởi chạy phiên` (18) if it ever matters. Defer.

## Observations (no change requested)

- **`console` → «bảng lệnh».** These 22 keys use «bảng lệnh», which matches the dominant shipped console copy (`ui.console.empty.title` "Phiên này chưa có bảng lệnh", `ui.console.loading.create` "Đang khởi động bảng lệnh"). Note the *pre-existing* collision with the command palette, which ships as `ui.command_palette.command_palette.command_palette` = «Bảng lệnh»; I am not gating on prior-wave terminology, and swapping these keys alone would break the stronger match.
- **`source` of severity for VI-A-03:** the mesh term «thiết bị ngang hàng» is shipped copy, not a glossary row; the glossary has no `peer` row. If the manager's second auditor reads «nút mạng» as acceptable Vietnamese for a mesh node, the width argument (30 cells) may still lose, and the honest fallback is to record the alternative term in the locale guide rather than ship two names silently.
- `Đã cài tác nhân` (`installed_agent`) matches shipped «Đã cài» (`ui.agents.pages.scope.installed`) — fine, and consistent with the guide reserving «cài đặt» for settings.
- `milestone` → «mốc» matches shipped `ui.projects.count.milestones_are`; `job` → «tác vụ», `agent` → «tác nhân», `subagent` → «tác nhân con», `team` → «nhóm», `project` → «dự án», `device` → «thiết bị», `session` → «phiên» all match glossary §2 and shipped copy.
- Trailing prepositions survive correctly: `Đã gắn phiên vào` / `Đã tách phiên khỏi` keep their relation to the following object; `Đã xem nhanh` is correctly preposition-free where English needs `at`.

## Two-pass note

Pass 1: full side-by-side read of all 182 key/value pairs against `context.role` (which tool and which operation each row belongs to), then the mechanical sweep above.
Pass 2 (requested for high-visibility groups): re-read of every row that appears most often in a transcript (`ran`, `read`, `wrote`, `edited`, `listed`, `searched`, `browsed`, `sent`, `asked`) plus every row where the Vietnamese departed structurally from English (added/removed word, changed verb class, changed noun), which is how VI-A-06/07/10 were found. Cross-checked every reused entity noun against the shipped `vi` catalogues by grep; that is how VI-A-01/02/03 were confirmed rather than inferred.

## Records (honest state)

- No `i18n/ledger.json` row and no `i18n/audits/evidence/vi/ui.chat.canonical/<audit-id>/` bundle were written. Reason: the audited file is `_l1-prep/vi.json`, a 182-key prep subset that is not the tracked `src/i18n/catalogues/vi/ui.chat.canonical.json`; `ledger-check.mjs` re-derives the **target** file hash at check time, so a row written now would bind a hash that the merge changes by construction and would be stale on arrival. The hashes above are the ones to bind (en side + this audit) once the translation lands and, per the UI contract, `status` may only become `audited` after the MAJORs above are fixed and re-audited.
- No file in the repository was modified by me (`_l1-prep/` is untracked prep; this report is the only thing I wrote).
