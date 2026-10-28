# Union audit — `vi` / `ui.chat` — report

* **Audit id:** `union-vi-20261028-61bc743db02b`
* **Locale / namespace:** `vi` / `ui.chat` (one catalogue, 142 keys)
* **Target bytes:** PR #1449, branch `i18n-wave-a`, head `c5e19ecec883b45e281d696f06dac86bcb0d90f3`
  (merge of `e5f7c8daeaf3` with `origin/main` `1d631be71fb7`)
* **Audit date:** 2026-10-28
* **Auditor:** `i18n-auditor`, session `61bc743db02b`, route `radient/auto`
  (no fallback, no model switch, no session incident — see `record.json`)
* **Verdict:** **passed** — `clean-with-findings`, 0 blocker, 0 major, **1 minor**, 2 nit

## Why this audit exists

Wave A (18 keys: `checkpoint.*`, `header_identity.*`, `region.*`) and wave B (9 keys:
`session_status.*`) were each audited on their own whole-file bytes and both passed
(receipts `wave-a-vi-delta-eb62f05b28e1` and `70d334e903c9`). The union file the merge
produces has never been read as a whole, so `node scripts/i18n/ledger-check.mjs` fails its
row for stale hashes. This audit binds the union bytes and asks the question the two
separate passes could not: does the merge of the two deltas hold together.

## What was audited

A **delta audit over unchanged-by-proof bytes** plus a whole-file consistency read:

1. **Delta proof (parsed JSON, not text).** Union = 142 keys = 115 base + 18 wave A + 9
   wave B, with zero shared key names. Every value is byte-identical to the earlier audit
   that read it: the 18 wave-A keys against `80ee119bbd` (the bytes receipt
   `wave-a-vi-delta-eb62f05b28e1` bound), the 9 wave-B keys against `a5356ce91c` =
   `1d631be71f` (the bytes receipt `70d334e903c9` bound), and all 115 base keys against both
   `81f286ee5c` (pre-wave) and `origin/main`. A line-level check re-read the raw JSON text of
   all 142 keys: **0 value mismatches, 0 raw-line mismatches** (the only raw-text differences
   before normalising were the file-final comma on three lines). Key order in the union is
   exactly `origin/main`'s 124 keys followed by wave A's 18, so the merge moved no base line.
2. **Whole-file read** of all 142 keys — mechanical gates, then accuracy, idiom, register,
   terminology, fit and typography, with a second pass over the error, approval and secret
   copy (same-session re-read, disclosed; not claimed as an independent second audit).
3. **Cross-wave consistency** between the A family (`region.conversation` vs
   `region.composer`, `checkpoint.*`, `header_identity.*`) and the B family
   (`session_status.*`): term, register, punctuation and terminal-stop collisions.

## Gates run (actual, in the read-only `git archive` export of `c5e19ecec8`)

| Gate | Result |
|---|---|
| `node scripts/i18n/ledger-check.mjs` | **fails exactly 7 rows / 21 findings**, all `*/ui.chat` stale-source + stale-target + receipt-vs-bytes. Expected: the union bytes have no receipt yet. This audit is the missing one for `vi`. |
| `node scripts/i18n/generate.mjs --check` | `src/i18n/keys.gen.ts is byte-identical to a fresh generation` |
| `node scripts/i18n/context-parity.mjs` | `ok` — every English key covered apart from 131 allowed gaps in 4 namespaces; all 27 wave keys carry a sidecar entry |
| `node scripts/i18n/check-coverage.mjs` | `ok` — 7 gated languages over 99 namespaces; 0 allowed keys remain |
| `node --test scripts/i18n/locale-parity.test.mjs` | 44/44 pass (vi: ships a message, one file per key, every key carried, no unknown key, placeholder parity, not an English stub) |
| `node scripts/i18n/check-duplicates.mjs` | `ok` — 889 files, 0 duplicate keys (the merge hazard specifically) |
| Independent mechanical sweep (this audit, `@formatjs/icu-messageformat-parser` + `intl-messageformat`) | 142/142 keys parsed; **153 real renders**; 0 problems |

Mechanical detail: placeholder name/type parity for all 142 keys; number/date/time
skeletons identical (14 placeholders, the 3 `::group-off` keys on both sides); ICU
`select` arms identical for every `kind` selector; the one plural key uses `other` only,
which is the only CLDR category vi has (`Intl.PluralRules('vi')` → `["other"]`) and
renders `0 lượt`, `1 lượt`, `1.000.000 lượt`; no markup/tag drift; no backtick/code/flag/
path drift; NFC on every value; no bidi controls or zero-width characters; no NBSP; no
stray whitespace except the intentional trailing space on `hint.prefix` (matches `en`); no
key added or dropped; valid JSON; **0 values identical to English** (no English stub).

## Renders (real `intl-messageformat`, locale `vi`)

```
{completed}/{total} lượt              2/10          => "2/10 lượt"
{count, plural, other {# lượt}}       0, 1, 2, 5    => "0 lượt" … "5 lượt"
                                      1000000       => "1.000.000 lượt"
Cập nhật tất cả ({count})              1234         => "Cập nhật tất cả (1234)"
update_all_label kind=agents/teams/skills/other 3  => "Cập nhật tất cả 3 bản cập nhật … từ trung tâm"
Loading kind=agents/teams/other                   => "Đang tải tác nhân…" / "Đang tải nhóm…" / "Đang tải…"
Search kind=agents/teams/other                    => "Tìm tác nhân" / "Tìm nhóm" / "Tìm"
Nothing matches {query}                Nova         => "Không có gì khớp với “Nova”."
Question {index}/{total}.              2 of 5       => "Câu hỏi 2/5. "  (trailing U+0020 kept)
Turn {turn} of {total}                 3 of 7       => "Lượt 3 trên 7"
Jump to your message … {clock}         15:42        => "Đi tới tin nhắn của bạn ở lượt 3 trên 7, 15:42"
Out of credits{status}: {body}         (HTTP 402)   => "Hết tín dụng (HTTP 402): …"
```

The clock render is the wave-A INFO closure: at `80ee119bbd` `checkpointClockLabel` still
hand-built `h:mm AM/PM`; at `c5e19ecec8` it returns
`formatTime(date, { hour: "numeric", minute: "2-digit" })`
(`src/renderer/src/features/chat/canonical/checkpoint-model.ts:220`), so vi gets its
24-hour `15:42` as the style guide requires. No finding is carried forward.

## Findings

**VI-1 — MINOR — `ui.chat.highlights.file_resolution_failed`.** The toast tells the reader
to use «Sao chép đường dẫn tệp», but the control's actual vi label is «Sao chép đường dẫn»
(`ui.common.file_actions.copy_file_path`, also `ui.chat.attachments.copy_path`). English
cites «Copy file path» because that is its label; es, fr, ur and zh-CN cite their own labels
word for word and ru/hi keep the same words in a finite verb form, so vi is the only locale
that adds a word the label does not carry («tệp»). Nothing about the meaning or the safety
of the action changes — the menu item is still identifiable — so this is a minor, not a
blocker.
*Suggested:* «… Dùng Sao chép đường dẫn để kiểm tra vị trí của tệp …».

**VI-2 — NIT — `ui.chat.aside.off_record`.** «không gì ở đây được thêm vào cuộc trò
chuyện» fronts a negated subject; Vietnamese normally fronts the place. *Suggested:*
«ngoài bản ghi — ở đây không có gì được thêm vào cuộc trò chuyện».

**VI-3 — NIT — `ui.chat.session_status.not_signed_in_description`.** «cho đến khi bạn kết
nối lại» says *reconnect*, implying an earlier connection; the English remedy is *connect
it*, and the saved-sign-in reassurance belongs to the sibling arm. *Suggested:* «… cho đến
khi bạn kết nối.».

## Observations (not findings)

* **UVI-O1 — `hub`.** `ui.chat` renders the generic noun as «trung tâm» (4 keys), while
  `ui.hub.updates` says «hub» («Cập nhật {name} từ hub»). The glossary has no `hub` row and
  the vi programme is split; `ui.chat` is internally consistent, and zh-CN likewise
  translates the generic noun (中心). Programme-level alignment is a separate call, not a
  defect of these bytes.
* **UVI-O2 — composer vs message box.** English distinguishes «Message composer»
  (`region.composer`) from «message box» (two approval hints); vi renders both «ô soạn tin»
  because both name the same widget. A deliberate 1:2 mapping, not a collision.
* **UVI-O3 — Approve/Deny and yes/no stay English.** `APPROVAL_OPTIONS` in
  `src/renderer/src/features/chat/approval-words.ts` prints those labels and submits them
  verbatim, and typed answers resolve through the English word list
  (`["y","yes","approve","ok","allow"]`). The instruction names what the reader sees and
  what the parser accepts.
* **UVI-O4 — `{reason}` stays English.** `header_identity.aria_*_closed` passes `{reason}`
  through; the sidecar records it as UI-composed text mirroring core's
  `team_owns_the_agent_slot_message` byte for byte (a cross-repo contract). The
  mixed-language utterance is intentional in every locale.
* **UVI-O5 — «lượt» / «lượt chạy» / «X trên Y».** The checkpoint «Lượt {turn} trên
  {total}» follows the programme's recorded «X trên Y» pattern (17 occurrences across the
  vi catalogues, e.g. onboarding «Bước {current} trên {total}», console tab labels, mesh
  «{shown} trên {total}») rather than calquing English word order; «lượt chạy» is the
  separate compound for a run and does not collide with «lượt» for a turn.

## Cross-wave consistency

* `region.conversation` «Khung trò chuyện» and `region.composer` «Ô soạn tin» are both
  region names; neither reuses a tab label («Trò chuyện», «Thô»), and the wave-A fix that
  replaced «Cuộc trò chuyện» is what keeps the transcript landmark distinct from the
  sidebar's nav name.
* `header_identity.*` keeps «Gán» (assign) and «Đổi» (switch) apart, and
  `no_agent`/`no_team` share one construction; the «Tác nhân: Không có tác nhân.» repetition
  is inherited from the English design.
* `session_status.*` is internally consistent: «Chưa đo được gì» twice, «chưa xác định
  được» for the unresolved model, «Chưa đăng nhập» for the missing sign-in, and the
  temporarily-unavailable arm never borrows the not-signed-in phrasing (the two states stay
  distinguishable, as the sidecars require).
* Register: bare imperatives for controls (`Mở`, `Ẩn`, `Gán`, `Đổi`, `Chọn`, `Dừng`,
  `Xóa`), «Hãy …» for sentences, the guide's «bạn» register only where a sentence addresses the
  reader, «Vui lòng» only where English says *please* (the rate-limit line). No exclamation
  marks, no Title Case, no «quý khách».
* Punctuation: curly quotes «“ ”», spaced em dash, U+2026 ellipsis (the source's one ASCII
  `...` renders `…`), no space before `:;?!`, colons on the label keys, no terminal stop on
  names and full stops on sentences exactly where the sidecars specify.

## Terminology concordance (whole file)

session→phiên · agent→tác nhân · subagent→tác nhân con · team→nhóm · model→mô hình ·
turn→lượt · run→lượt chạy · conversation→cuộc trò chuyện (prose) / khung trò chuyện
(region) · composer→ô soạn tin · job→tác vụ · wake→lịch đánh thức · monitor→mục giám sát ·
skill→kỹ năng · goal→mục tiêu · loop→vòng lặp · transcript→bản ghi · approval→phê duyệt ·
provider→nhà cung cấp · credits→tín dụng · quota→hạn mức · context→ngữ cảnh ·
secret→bí mật · aside→bên lề · diagram→biểu đồ. Glossary terms match the core glossary and
the vi guide's recorded calls; the cross-file checks (`ui.chat.run_details`, `ui.chat.pickers`,
`ui.schedules`, `ui.hub.updates`, `ui.common.*`) found no contradiction in the terms this
file uses.

## Fit

Only two keys carry a width hint: `session_status.choose_model` («Chọn mô hình», 12 ≤ 18
cells) and `session_status.last_reading` («Lần đọc trước», 13 ≤ 16 cells). No key overruns a
hint. Vietnamese runs long, so the longest sentence-style strings were read against their
sidecar roles (tooltips, prose paragraphs and toasts, not buttons); the short controls stay
short (`Ẩn`, `Xong`, `Hiện`, `Gửi`, `Tìm`, `Lỗi`, `Thô`, `Bên lề`).

## Limitations

* Catalogue-level audit: it proves the strings, their ICU structure and their rendering. It
  does not re-render the Electron UI; visual proof belongs to the design/QA lanes. No
  screenshot is claimed here.
* The vi file at this head is `origin/main`'s plus wave A's 18 appended keys (proved above),
  so the delta proof — not a fresh re-derivation — is what carries the base and wave-B keys.
  The whole-file mechanical and narrative checks were nonetheless re-run over all 142 keys.
* The error/approval/secret second pass is a same-session re-read, not a second independent
  auditor; no separate second-pass session was requested for this union.
* No translation or MT service was used to compare or back-translate anything.

## Records

* receipt: `i18n/receipts/union-vi-20261028-61bc743db02b.json`
* evidence: `i18n/audits/evidence/vi/ui.chat/union-vi-20261028-61bc743db02b/`
  (`record.json`, this report, `audit.log`, `receipt.json`)
