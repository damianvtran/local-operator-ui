# vi · ui.chat.composer · merged-file delta audit (cmpmrg1-vi)

Verdict: **passed** (0 BLOCKER, 0 MAJOR, 1 MINOR, 0 NIT; 1 INFO)
Auditor: i18n-auditor, session 23222fa5deec, model anthropic/claude-sonnet-5-5 (session system header; no fallback observed)
HEAD: 801b1ad29d47bbb89a0768e0ea1f193892db953d (worktree clean at start apart from sibling untracked evidence bundles; nothing but this bundle written)
Date: 2026-11-04
Independence: did not translate, edit or read the commit text of any vi catalogue byte; read en source, context sidecar, glossary, vi style guide and sibling keys.

## Hashes (computed from the files on disk at HEAD; `git show HEAD:<path>` bytes equal disk)
- en  src/i18n/catalogues/en/ui.chat.composer.json: 1abe3bc2730635d6eae484b49bfafa1743dee3be1f0ca60863576632acb95f14
- ctx src/i18n/catalogues/en/ui.chat.composer.context.json: de9e346489f6df64bc3ff08abd1f8e0550e95e54e44b7c0ddda47897ff50e2dc
- vi  src/i18n/catalogues/vi/ui.chat.composer.json: fdf0b4669e2145757db34286fe415d957bf5d0bdc71007d2f57a535d677313fb
- glossary ~/local-operator/i18n/glossary.md: 0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8
- style guide ~/local-operator/i18n/style-guides/vi.md: e4901497ed553e2b2ae4a2660bf776adb787b89e11d7eb0f8d08f3da4b227888

## Mechanical
- Key sets en = vi = 72. The six delta values are NFC, have no edge/double spaces, no control/format (bidi, zero-width) characters.
- None of the six English strings has a placeholder, ICU plural/select or markup; none introduced in vi. `other`-only plural policy is moot (no plurals in the six).
- Key names kept verbatim: `(Enter)` and `Esc` stay Latin, as the sidecar and the vi siblings (`confirm_recording_hint`, `cancel_recording_hint`, `placeholder.waiting`) do.
- Fit (character = cell: no wide glyphs; precomposed Vietnamese is 1 cell each) vs sidecar advisory maxCells: insert_transcript 17/24, insert_transcript_hint 36/48, send_recording 14/24, send_recording_hint 35/48, steer_hint 52/64; secret_closure_notice has no cap (124 chars, a wrapping notice).
- `context-parity.test.mjs` 8/8 and `catalogue-union-parity.test.mjs` 9/9 pass. `locale-parity.test.mjs` 43 pass / 1 fail: the fr "not an English stub" check on three ui.chat.pickers keys (out of scope, fr, not vi); every vi check passes.
- `ledger-check.mjs` (read-only) reports exactly the 3 expected vi/ui.chat.composer findings (stale source, stale target, receipt does not name English bytes).

## Per-key reading
| key | EN | vi | read |
|---|---|---|---|
| secret_closure_notice | Answer the secret request in the asks panel — this box is paused until it is answered, and your draft is kept. | Trả lời yêu cầu bí mật trong bảng câu hỏi — ô này tạm dừng cho đến khi có câu trả lời, và bản nháp của bạn vẫn được giữ lại. | Faithful: both clauses, em dash and order kept as the sidecar demands; no security/budget claim added. Opening clause is byte-equal to the shipped `placeholder.secret_answer`; "bảng câu hỏi" = the asks panel as `secret_fill_*` and `secret_ask_notice` use; "ô này" = this box as in `delivery_remedies_hint`. Natural. |
| insert_transcript | Insert transcript | Chèn bản chép lời | Imperative label, sentence case, no trailing punctuation. Not "confirm". See V1 on the term. |
| insert_transcript_hint | Insert transcript to review (Enter) | Chèn bản chép lời để xem lại (Enter) | Meaning kept (insert so the user can read before sending); key name untouched. |
| send_recording | Send recording | Gửi bản ghi âm | Same wording as the shipped `dictation_failed_transient_take_kept` ("gửi bản ghi âm đi"). Consistent. |
| send_recording_hint | Transcribe and send now, no review | Chép lời và gửi ngay, không xem lại | States plainly there is no review step, as the sidecar requires; "gửi ngay" agrees with `composer_media.sends_now` ("gửi ngay"). |
| steer_hint | Steer the agent now (Enter) · Esc stops the turn | Định hướng tác nhân ngay (Enter) · Esc dừng lượt này | "Định hướng … tác nhân" matches `placeholder.waiting` and the ui.projects / ui.mesh steer keys; Enter/Esc preserved; separator " · " kept. |

## Findings
### V1 — MINOR — ui.chat.composer.insert_transcript, insert_transcript_hint, send_recording_hint ("bản chép lời" / "Chép lời")
Current: "Chèn bản chép lời", "Chèn bản chép lời để xem lại (Enter)", "Chép lời và gửi ngay, không xem lại".
Observation: the vi style guide's locale call is `transcript → bản ghi`, used for the conversation transcript (e.g. `ui.chat.header.transcript_display` "Hiển thị bản ghi"). Here "transcript" is the speech-to-text output, and "bản ghi" would collide in the same composer with "bản ghi âm" (the recording). Choosing "bản chép lời" is idiomatic (the usual Vietnamese term for a transcript of audio) and avoids that collision, so I do not classify it MAJOR; neither dictation sibling keys ("Đọc chính tả", "chuyển giọng nói thành văn bản") nor anything else uses it, so it is the only place the term appears.
Suggested: keep the wording; record the call in the vi style guide (`dictated transcript → bản chép lời; conversation transcript → bản ghi`) in the next style-guide wave so a future translator does not "fix" it back to "bản ghi". No catalogue change needed.

### INFO — not counted
The sidecar says to keep the key name in parentheses "exactly as written (Enter)"; vi does, and like the siblings keeps `Esc` Latin. Nothing to change.

## Not audited
Unchanged keys of the namespace; rendered fit or a native-speaker pass (reasoned from character count only); runtime ICU rendering (no placeholders to render).
