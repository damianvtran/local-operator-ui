# Audit report — `vi` · `ui.chat.canonical` · slice S16e-renderer (PR #1884)

**Verdict: PASSED** — 0 BLOCKER, 0 MAJOR, 2 MINOR, 1 NIT.
Ledger consequence: `clean-with-findings` (no blocker/major).

| Field | Value |
|---|---|
| Locale | `vi` |
| Namespace | `ui.chat.canonical` (12 keys: generation-card stop / settlement / failure-class copy) |
| Audited draft | `/Users/damian/.local-operator/sessions/3ef6295a5545/scratchpad/s16e/vi/draft-vi-s16e.json` |
| Draft SHA-256 | `c0e8df525f0324921dd849634e1a83d6e9d4de53db0e1f38d68c3a2b217f10a9` (matches the manifest entry, verified on both the named file and the copy I ran) |
| English source SHA-256 | `b967adc33296c5ef0264a8a3ffd698fdfc5a50e4a3ebc8de99114a599b837e17` — independently confirmed as the sha256 of `src/i18n/catalogues/en/ui.chat.canonical.json` in the worktree |
| Context sidecar SHA-256 | `ec598772089552ace910c857a38b364bdfa83a32c76c62b752b761527531e7b7` |
| Shipped `vi` catalogue (authority) | `a37a5690412c841379ea44d6d63f4a5314579f4a157ff3c7f67be2ee872fe750` (467 keys; English 479 — the 12-key gap is exactly this slice) |
| Glossary | `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8` |
| Style guide `vi` | `e4901497ed553e2b2ae4a2660bf776adb787b89e11d7eb0f8d08f3da4b227888` |
| Worktree | `~/local-operator-ui/.worktrees/i18n-s16e @ bd8e90542506e8bec4a98862b868095409b28329` (read-only; nothing written, committed, built or installed) |
| Auditor | `i18n-auditor`, session/instance `462e1eb39290`, model **deepseek/deepseek-flash** (actual, from the session runtime header; no fallback) |
| Independence | Translator is a separate instance (`i18n-translator`, per its notes). I formed my view of all 12 keys **before** opening the translator's notes; no translation or MT service used, no back-translation |
| Values hash | `3bf4596f5a2c5b135d35323835c2e0151c8edaaf19b31e9562eaeb18a398ff93` — use it after application to prove the shipped catalogue carries these 12 values byte-for-byte |

## Findings

| ID | Sev | Key(s) | Current | Problem | Suggested |
|---|---|---|---|---|---|
| F1 | MINOR | `cancel.checking`, `settlement.pending` | “Đang xác nhận khoản phí.” / “Đang chờ quyết toán — khoản phí cuối cùng sẽ xuất hiện khi nhà cung cấp báo cáo.” | One English concept (*settlement*) is written with two words inside one slice (“xác nhận khoản phí” vs “quyết toán”). The checking clause also directly follows “sẽ bị tính phí **nếu** tạo ra âm thanh” and presupposes a charge exists, while “Checking for settlement” stays neutral about whether one results — the conditional and the presupposition sit badly together. | One word family. Preferred: `cancel.checking` → **“Đang chờ quyết toán.”** (same term as the pending note, no presupposition). Alternative: keep “xác nhận” in both and open the pending note with “Đang chờ xác nhận khoản phí — …”. |
| F2 | MINOR | `error.audio_rate_limited` | “Tạo âm thanh đang bận. Hãy thử lại sau giây lát.” | A bare verb phrase is the subject of “đang bận”, so “Tạo âm thanh” can be read as an imperative (“generate audio”), and the shipped catalogue always puts a noun there: “Tác nhân đang bận”, “Trung tâm đang bận”. This is the one line that reads translated rather than native. | **“Dịch vụ tạo âm thanh đang bận. Hãy thử lại sau giây lát.”** (or “Trình tạo âm thanh đang bận.”). Keeps two sentences, no wait time, no promised success. |
| F3 | NIT | `error_class.duplicate_id` | “Trùng id” | Label-position labels in the shipped catalogue capitalise the token (“ID tác nhân”, “ID người dùng”); lowercase “id” is that catalogue's *prose* form. English is lowercase “id”, so the current form is defensible. | “Trùng ID” |

None of the three gates the slice.

## Per-axis result

1. **Mechanical — pass.** Valid JSON, no BOM, 12 keys, no key added/dropped, none pre-existing in the shipped catalogue. ICU compared against English with `@formatjs/icu-messageformat-parser` (the parser behind `intl-messageformat@12.1.3`, which `src/i18n/messages.ts:148-152` instantiates as `new IntlMessageFormat(message, locale)` — my renderer is that same call with locale `vi`): `state.cancelled_batch` keeps argument `material` and the keyword set `video|voiceover|sound_effect|other`; every branch is a complete sentence; every other value carries no placeholders, exactly as English. No brace leaks, no double spaces, no space before punctuation, no ASCII "...", full-stop parity true for all 12 (labels stop nowhere, sentences stop everywhere).
   **Negative controls, all four caught** so the pass is not vacuous: dropped `video` branch → BLOCKER; `{material}`→`{media}` → BLOCKER; trailing `{` → ICU parse BLOCKER (`EXPECT_ARGUMENT_CLOSING_BRACE`); dropped key → key-set fatal.
2. **Accuracy — pass except F1's coherence note.** `cancel.queued` keeps the *and only the* no-charge promise (“sẽ không bị tính phí”). `cancel.running` promises nothing: “Đã gửi yêu cầu dừng” states the request, “không có endpoint hủy” the refusal, “vẫn tiếp tục và sẽ bị tính phí nếu tạo ra âm thanh” the consequence — and it is near-verbatim the already-shipped `sound.stop.warning`, which is the strongest possible consistency evidence. `settlement.pending` states no amount and never a zero. All six failure classes stay distinguishable pairwise: denied “Bị từ chối” ≠ gate_failed “Bị cổng chặn”; unknown_tool “Công cụ không xác định” ≠ invalid_arguments “Đối số không hợp lệ”; audio_rate_limited “Giới hạn tần suất âm thanh” distinct from both.
3. **Idiom and register — pass except F2.** No “bạn” anywhere (the guide asks for pronoun-free copy); no “Vui lòng” (English has no “please”; “Hãy” is the direct form); no “!”; sentence case; terse labels. Verified NFC on every value (combining-mark form would break TUI width).
4. **Terminology — pass.** Every content term matches the shipped catalogue: batch → *loạt* (done_batch/failed_batch), provider → *nhà cung cấp*, cancellation endpoint → *endpoint hủy*, charge → *khoản phí / bị tính phí*, stopped → *đã dừng* (deliberately not *đã hủy*), material nouns → *video / lời thuyết minh / hiệu ứng âm thanh / hình ảnh*, rate limit → *giới hạn tần suất*, gate → *cổng*. Only *endpoint*, *id*, *video* remain Latin — each covered by the glossary wave-2 kept-English set, §1 identifiers, or Vietnamese loanword status, all with shipped precedent. No value is byte-identical to English.
5. **Fit — pass.** The English context sidecar carries no `maxCells`/`maxChars` for these keys (word-count hints only), so fit is judged on the real containers: the state line is a wrapping flex `<p>` and the failure-class label is its own full-width `<p className="text-meta text-ink-dim">` — nothing truncates, no button/tab/status slot. Longest label, `error_class.audio_rate_limited` at 26 cells against English 18, is therefore safe. **This answers the translator's open question**: 26 cells is acceptable here and the recorded fallback “Chạm giới hạn tần suất” is not needed. Every sentence stays at or below its English length except that one label.
6. **RTL — n/a** for `vi`.

## Second pass (high-visibility, errors)

Errors are in this group, so I re-read all 12 values from scratch after the first pass, without the notes. The re-read found no new defect and confirmed both MINORs; it also confirmed the pair that matters most — the queued/no-charge sentence is used **only** for the queued case, and the running sentence does not borrow it. This is a second *pass*, not a second auditor; if the manager wants a second *auditor* on errors, that is a separate dispatch.

## What I did not run, and why

- No `pnpm check-i18n`, `check-strings`, `ledger-check` or build: read-only audit, no installs, and the draft is not on disk in a catalogue yet, so the repo validators have nothing to read for these keys. Mechanical checking used the same parser library the runtime wraps, with negative controls.
- No rendered frame or locale-switch check: the draft is unapplied, so there is no UI state to render.
- No translation/MT service and no back-translation, per the gate.

## Handoff

- Ledger row: `node scripts/i18n/ledger-assemble.mjs --locale vi` **after** the coder applies the draft. It binds the catalogue hash on disk; running it now would record a hash the application step immediately supersedes. Before running it, confirm the applied 12 values reproduce values hash `3bf4596f5a2c5b135d35323835c2e0151c8edaaf19b31e9562eaeb18a398ff93`; `ledger-assemble` will then write `clean-with-findings`.
- `receipt.json` is already in that CLI's contract shape (`auditor`, `model`, `instance`, `status`, `namespace`, `sha256 {vi,en}`, `findings`); only the target hash needs replacing with the applied catalogue's hash, and the file belongs (byte-for-byte) at `i18n/receipts/462e1eb39290.json`.
- Canonical evidence destination: `i18n/audits/evidence/vi/ui.chat.canonical/s16e-vi-au/` with `record.json` (this receipt), `report.md` and `audit.log`.

## Artifacts (all in `/Users/damian/.local-operator/sessions/462e1eb39290/scratchpad/s16e-au-vi/`)

| File | SHA-256 |
|---|---|
| `receipt.json` | `(self-hash not recorded; see report)` |
| `report.md` | `(this file)` |
| `audit.log` | real `set -x` transcript of every command run |
| `check.mjs` | `f02b92a6e29ae2b07fa7ceb97bc59cdd391e29b301fb5dd2d062b10599738bf0` |
| `render.mjs` | `f61a0228130bdbc5f0638a35b4e59f2bb8004601a0c717bbce994b63a13b37ab` |
| `run-audit.sh` | `53382b6bb5623a21c7b5027f48eb65f40a52e6de1be5dc72220a33495f4731a1` |
| `draft-vi-s16e.json` (copy audited) | `c0e8df525f0324921dd849634e1a83d6e9d4de53db0e1f38d68c3a2b217f10a9` |
| `artifacts.sha256` | hash list of every artifact incl. this report and the receipt |
| `ctrl-drop-branch.json` / `ctrl-rename-arg.json` / `ctrl-brace-leak.json` / `ctrl-drop-key.json` | negative controls; their hashes are in `audit.log` |
