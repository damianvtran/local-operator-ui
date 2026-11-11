# Audit vi — slice L1 tool-row verbs — report B (l1-au-vi-B)

Auditor: i18n-auditor (l1-au-vi-B), model anthropic/claude-sonnet-5-5. Independent of translator (openai/gpt-6.1-sol).
Verdict: **clean-with-findings**-leaning-changes (0 BLOCKER, 2 MAJOR, 6 MINOR, 3 NIT). Recommend fixing the 2 MAJORs before ship (they are shipped-terminology conflicts, 20 keys); `passed` only after.

## Mechanical (python3, all run)
- key set AND order identical to keys.json: True (182 = 91 settled/running pairs). No empty values; no value identical to English; all NFC; no bidi/control chars; no `{}`/backticks; no duplicate values.
- Every `.settled` = "Đã X" and matching `.running` = "Đang X" with identical X: 0 mismatches (X is the same verb+object in all 91 pairs).
- Length: max 25 chars (`listed_subagents.running`), en max 23. 2–6 syllables (≤4 Vietnamese words). No stray English (Python / web only). Style guide: no "!", sentence case, bạn-free verb labels — OK.
- Consistency vs shipped (`ui.chat.canonical.json`): generic_verb "Đang gọi/Đã gọi" and bridge.verb.* use Đã/Đang + bare verb, same pattern; đọc/gửi/tạo/liệt kê agree. Good.

## Findings

### MAJOR
1. **console → "bảng lệnh" conflicts with shipped terminology and collides with "command palette"** — 16 keys: `verb.listed_consoles|opened_console|checked_console|read_console|captured_console|typed_in_console|resized_console|closed_console` (.settled/.running), e.g. `opened_console.settled` "Đã mở bảng lệnh". Shipped vi names the console panel «bảng điều khiển» (ui.shell.rail.console.*, ui.chat.header_menu.open_console "Mở bảng điều khiển"), while «bảng lệnh» in shipped vi is the **command palette** (ui.onboarding.tour.pre_command_palette_open_canvas: "mở bảng lệnh"). A tool row saying "Đã mở bảng lệnh" reads as opening the palette. Suggest: "Đã mở bảng điều khiển", "Đang mở bảng điều khiển", "Đã liệt kê bảng điều khiển", "Đã kiểm tra bảng điều khiển", "Đã đọc bảng điều khiển", "Đã chụp bảng điều khiển", "Đã nhập vào bảng điều khiển", "Đã đổi cỡ bảng điều khiển", "Đã đóng bảng điều khiển" (+ Đang forms). Width cost: longest becomes 29 chars ("Đang nhập vào bảng điều khiển") vs en max 23 — check the gutter; vi guide says tighten, but terminology agreement wins over the 6-char saving.
2. **wake → "lịch nhắc" conflicts with the vi style-guide locale call and shipped copy** — `verb.listed_wakes.{settled,running}` "Đã liệt kê lịch nhắc", `verb.cancelled_wake.{settled,running}` "Đã hủy lịch nhắc". Style guide: wake → «thức dậy»; shipped `ui.chat.run_details.wake.armed_count` = "{count} lịch thức dậy đã đặt". "Nhắc" (remind) changes the concept and the same object would be named two ways in the same transcript/run-details. Suggest: "Đã liệt kê lịch thức dậy" / "Đang liệt kê lịch thức dậy" / "Đã hủy lịch thức dậy" / "Đang hủy lịch thức dậy". (`verb.scheduled` "Đã lên lịch" is fine and matches style guide.)

### MINOR
3. `verb.updated_todos.*` "Đã cập nhật việc" / "Đang cập nhật việc" — truncated: bare «việc» = "work/job"; sibling `read_todos` and shipped (ui.chat.run_details.chip.todos_*) use «việc cần làm». Suggest "Đã cập nhật việc cần làm" / "Đang cập nhật việc cần làm" (6 syllables, same as read_todos).
4. `verb.browsed.*` "Đã duyệt" / "Đang duyệt" — bare «duyệt» also means "approve" (cf. glossary approvals → phê duyệt), so "Đã duyệt https://…" can read as "approved". Suggest "Đã duyệt web" / "Đang duyệt web" (searched_the_web already uses "web").
5. `verb.listed_network_peers.*` "Đã liệt kê nút mạng" — shipped mesh copy says «thiết bị ngang hàng» (ui.mesh.*), «nút» elsewhere = UI button. Suggest "Đã liệt kê thiết bị ngang hàng" / "Đang liệt kê thiết bị ngang hàng" (long: 31 chars) or shorter "…thiết bị mạng" if width forces (recorded fallback).
6. `verb.removed_device.*` "Đã loại thiết bị" / "Đang loại thiết bị" — «loại» is also the noun "type/kind" ("loại thiết bị" = device type); the op is member removal/revocation. Suggest "Đã gỡ thiết bị" / "Đang gỡ thiết bị" (shipped uses «thu hồi» for revoke; "Đã thu hồi thiết bị" also fine if revoke is the intended sense).
7. `verb.checked_network_status.*` "Đã kiểm tra mạng" omits "status" (and is identical in shape to a diagnose op; `diagnosed_network` is separate so no collision). Suggest "Đã kiểm tra trạng thái mạng" / "Đang kiểm tra trạng thái mạng" (27 chars) — or accept as-is if width is tight.
8. `verb.raised_panic.*` "Đã kích hoạt khẩn cấp" — adjective without noun ("activated urgent"). Suggest "Đã kích hoạt chế độ khẩn cấp" / "Đang kích hoạt chế độ khẩn cấp", or keep the tool word: "Đã kích hoạt panic" (lowercase, fits kept-English technical practice). Not unsafe: meaning is still an emergency action.
9. (MINOR, wording) `verb.updated_secure_input.*` "Đã đổi chế độ nhập kín" — «nhập kín» is not an idiom used elsewhere in shipped vi; secret-entry copy uses «thông tin bí mật». Suggest "Đã đổi chế độ nhập bí mật" / "Đang đổi chế độ nhập bí mật".

### NIT
- `verb.updated_milestone|removed_milestone` «mốc» alone: "cột mốc" is the fuller standard noun ("Đã cập nhật cột mốc"); shipped "mốc" only appears in the time-anchor sense, so optional.
- `verb.resized_console.*` «đổi cỡ»: "đổi kích thước" is the standard UI phrase (longer) — optional.
- `verb.sent.*` "Đã gửi" vs bridge "Đã gửi tới": bare is fine for `send` (object follows directly); `verb.messaged` "Đã nhắn tin" likewise reads acceptably before a target (could be "Đã nhắn tin cho" to mirror bridge.dm "Đã nhắn cho").

## Checked, no issue
Meaning per tool/op confirmed for ran/ran_python (bash/eval), read/wrote/edited, glob "liệt kê", grep "tìm", web search/fetch ("Đã tải" ok), variables, ask/send/wait, agents (tác nhân), subagents (tác nhân con), teams (nhóm), hub peek/steer/pause/cancel/resume (tạm dừng/hủy/tiếp tục), secrets (store/retrieve/list/describe/update/delete — destructive `deleted_secret` = "xóa bí mật", `deleted_team` = "xóa nhóm", `cancelled*` = "hủy": no destructive/read-only swaps), projects, link/unlink (trailing preposition kept: "gắn phiên vào" / "tách phiên khỏi" — the object follows naturally), sessions (phiên), lsp, network create/invite/join/leave (rời mạng), job (tác vụ), «xóa» orthography matches the guide. No English left (Python only). No bidi issue (vi LTR). Orthography NFC, tone marks on first vowel (xóa, hủy).

## Commands actually run
python3 comparisons of keys.json vs vi.json (order/set/empty/identical/NFC/bidi/placeholder/pair/duplicate/length checks → results above); read style guide vi.md, glossary.md; grep of the shipped vi catalogue for console/bảng lệnh/bảng điều khiển/lịch thức dậy/việc cần làm/ngang hàng/thu hồi (evidence for findings 1,2,3,5). No repo validator or ledger command was run (not requested for this slice).
