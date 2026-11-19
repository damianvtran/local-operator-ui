# l1-a3-vi — vi L1 tool-row verbs v2→v3 delta audit
Auditor: i18n-auditor (independent), model anthropic/claude-sonnet-5-5. Dir: ~/local-operator-ui/.worktrees/_l1-prep/
Verdict: CLEAN-WITH-FINDINGS  {blocker 0, major 0, minor 0, nit 2}

## Mechanical (python3, run here)
- keys.json 182 keys; vi.v3.json 182 keys; same set AND same order; no keys added/dropped vs v2.
- v2→v3 changed keys: exactly 6 (raised_panic, resized_console, spawned_session × settled/running) = vi.v3-changes.md.
- No empties, no non-str, all NFC, no bidi/zero-width/format chars, no leading/trailing/double spaces, no terminal punctuation, no placeholders/markup/backticks in source or target.
- English-identical values: none (Python only appears as the kept token inside "Đã chạy Python"/"Đang chạy Python").
- 91 settled/running pairs: all use Đã/Đang + identical tail EXCEPT found_definition ("Đã tìm thấy định nghĩa" / "Đang tìm định nghĩa") and found_references (same shape) — the two accepted found_* pairs. No other asymmetry.
- Longest values (32 chars, 7 syllables: "Đang liệt kê thiết bị ngang hàng") are existing; the new ones (max 29) are not outliers. No maxCells/maxChars in sidecar context (only "one to four words, narrow gutter"); vi syllable-words inflate that count throughout the file, not specific to these keys.

## The 6 values
1. raised_panic: "Đã/Đang báo động khẩn cấp" — ACCEPTABLE, and an improvement. Checked source: cli.py `_cmd_panic` (~7969) marks the local network untrusted, rotates the secret if admin, broadcasts the panic to peers; its own comment says nothing is stopped ("sessions on other devices are NOT stopped — they keep running"; tool.py:629 "raise a panic: rotate the secret for every member"). v2 "dừng khẩn cấp" (= emergency stop) asserted exactly the false effect the code warns against, so v3 is right to drop it. "báo động" = raise/sound an alarm, matches "raise panic" and the broadcast; asserts no stop/revoke outcome, and is also correct when relay doesn't answer (alarm raised locally, "sent": 0). Reads as natural verb+monospace-object ("Đã báo động khẩn cấp  <network>"). Pair parallel.
   - NIT N1: with a bare network-name object, "báo động khẩn cấp X" is slightly intransitive-looking (more natural "báo động khẩn cấp cho/trên X"), but the verb column cannot carry a preposition+object split reliably; alt if wanted: "Đã phát báo động khẩn cấp" (phát = emit, closer to "raised/broadcast"; +4 chars). Not required.
2. resized_console: "Đã/Đang đổi kích thước bảng lệnh" — CORRECT. "kích thước" is the standard UI term (replaces colloquial "cỡ"); "bảng lệnh" is the file-wide console term (listed/opened/closed/read/captured... all "bảng lệnh") — consistent. Pair parallel. 29 chars running: +2 vs v2, not an outlier.
   - NIT N2: "đổi kích thước" is 3 syllable-words vs en "Resized"; acceptable, no tighter standard alternative ("chỉnh cỡ" would reintroduce the colloquialism).
3. spawned_session: "Đã/Đang khởi chạy phiên" — CORRECT. "khởi chạy" = launch/start a process, matches `sessions` tool's `spawn`; distinct from resumed ("tiếp tục phiên") and v2's "tạo phiên" (create) which was ambiguous with other create verbs and not the spawn meaning. "phiên" per glossary. Pair parallel.

## Findings: BLOCKER 0, MAJOR 0, MINOR 0, NIT 2 (N1 optional wording, N2 informational).
## Commands run: python3 diff/validation script vs keys.json/v2; sed/grep of ~/local-operator/local_operator/network/cli.py 7940-8030 and tool.py panic refs; grep of shipped vi catalogue for panic/khẩn cấp (only unrelated "Khẩn cấp" urgent label in ask_queue/asks); read vi style guide, glossary session row.
## Not run: repo validator / audit-ledger command (delta check only; no ledger row written; nothing edited).
