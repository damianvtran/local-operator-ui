# Second independent audit — `vi` · `ui.chat.canonical` · slice S16e-renderer

**Verdict: `passed`** — 0 BLOCKER · 0 MAJOR · 2 MINOR · 1 NIT.
PR `damianvtran/local-operator-ui#1884` (`S16e-renderer`). Second independent pass for a
high-visibility group; the first pass is a different session and was read only **after** my own
per-key judgement was written down (divergences in `divergences.md`).
Slice-wide: **84/84 values read** (12 keys × fr/es/ru/vi/zh-CN/hi/ur); this file is the `vi` row.

| | |
|---|---|
| Locale / namespace | `vi` / `ui.chat.canonical` |
| Keys audited | 12 / 12 — every key in the assigned group |
| Draft audited | `/Users/damian/.local-operator/sessions/3ef6295a5545/scratchpad/s16e/vi/draft-vi-s16e.json` · sha256 `c0e8df525f0324921dd849634e1a83d6e9d4de53db0e1f38d68c3a2b217f10a9` (matches the task manifest) |
| English source | `src/i18n/catalogues/en/ui.chat.canonical.json` @ `bd8e9054` · sha256 `b967adc33296c5ef0264a8a3ffd698fdfc5a50e4a3ebc8de99114a599b837e17` |
| Context sidecar | `src/i18n/catalogues/en/ui.chat.canonical.context.json` · sha256 `ec598772089552ace910c857a38b364bdfa83a32c76c62b752b761527531e7b7` |
| Brief (`en` + `context`) | `s16e-brief.json` · sha256 `a0326137bff43ed38fc4a1c63d4a26e1887cfd56d4826df0e615df28055bef0c` — its 12 `en` values and 12 `context` objects are byte-equal to the repo catalogue and sidecar (verified, 0 mismatches) |
| Shipped `vi` catalogue (terminology authority) | sha256 `a37a5690412c841379ea44d6d63f4a5314579f4a157ff3c7f67be2ee872fe750` (467 keys; English 479 — the 12-key gap is exactly this slice, 0 of the 12 exist yet) |
| Glossary / style guide | `0eb34437…962f8` / `e4901497ed553e2b2ae4a2660bf776adb787b89e11d7eb0f8d08f3da4b227888` |
| Worktree | `~/local-operator-ui/.worktrees/i18n-s16e` @ `bd8e90542506e8bec4a98862b868095409b28329` — read-only: no edit, commit, install, build, browser or renderer run |
| Auditor | `i18n-auditor`, session `cc045047b39e`, model **`deepseek/deepseek-flash`** (session runtime model; **no fallback** used) |
| Independence | Not the translator's instance, not the first-pass auditor's instance; I authored none of these 84 values and edited nothing. No translation/MT service, no back-translation: every judgement is a reading of the English, the sidecar, the shipped `vi` corpus, the glossary and the `vi` style guide. |

## 1. Mechanical — PASS

Run with the repository's own parser (`@formatjs/icu-messageformat-parser` 3.5.21, read-only from
`~/local-operator-ui/node_modules` — the same dependency `scripts/i18n/generate.mjs` imports), and with a
codepoint scanner. Real transcripts: `mech.log`, `typo.log`.

- 12/12 keys present, none added, none dropped; valid JSON; tab-indented with a trailing newline.
- `state.cancelled_batch` is the only structured value in the slice. Its argument name `material` and its
  option set `video / voiceover / sound_effect / other` are identical to English — no renamed, missing or
  extra branch. The callsite maps the wire's `sound-effect` onto `sound_effect`, so the option name is
  machine surface and must not be translated: it is not.
- No plural/`selectordinal` argument exists in these 12 keys, so CLDR plural categories are **n/a** here
  (the four option keys are branch names, not CLDR categories). The English `other` branch is present.
- No markup/Rich tags, no backticks, no commands, no flags, no identifiers other than the kept-English
  tokens discussed in §4; no brace leak, no double spaces, no leading/trailing whitespace.
- **Negative controls 5/5 behaved as designed** (so the pass is not vacuous): unbalanced brace throws;
  a select missing `other` is caught; a renamed/extra branch changes the option set; a dropped
  placeholder is caught; a valid nested plural parses. Logged in `mech.log`.

## 2. Accuracy and the load-bearing promises — PASS

The three values that can get a user's money wrong were read against the sidecar's own rules:

| Key | English contract | `vi` carries |
|---|---|---|
| `cancel.queued` | the ONLY place that may promise no charge; must not soften into a maybe | «Đã dừng trước khi gọi nhà cung cấp; sẽ không bị tính phí.» — flat, not a maybe |
| `cancel.running` | stop is a REQUEST; the provider may still bill; must never read as "nothing was charged" | «Đã gửi yêu cầu dừng. Nhà cung cấp không có endpoint hủy; quá trình tạo vẫn tiếp tục và sẽ bị tính phí nếu tạo ra âm thanh.» — request + conditional charge |
| `settlement.pending` | states that a charge is outstanding; never an amount, never a zero | «Đang chờ quyết toán — khoản phí cuối cùng sẽ xuất hiện khi nhà cung cấp báo cáo.» — no amount, no zero (the wording of «quyết toán» is VI-2-01) |

No value in this slice negates, weakens or converts one of these into a guarantee it should not make;
`cancel.running` and `settlement.pending` never merge into one claim, and `cancel.checking` stays a
separate sentence because the callsite joins it with its own full stop.
The six failure-class labels stay textually distinct from each other and from the prose sentence
rendered under them (no label reuses its own sentence).

## 3. Idiom, register, typography — PASS (2 MINOR, 1 NIT)

Typography: every value is NFC (checked with Unicode normalisation — no decomposed combining sequences, which the vi guide forbids because they break width counting), no space before punctuation, spaced em dash in `settlement.pending`, no double spaces.

Register checks: formality is the guide's own (bạn register, pronouns dropped where Vietnamese drops them («sẽ không bị tính phí»), no «Vui lòng» padding, no !, verbs unconjugated in labels), no exclamation marks, no padding
honorifics or politeness the English does not have, sentence case throughout, label keys carry no full
stop and prose keys do.

## 4. Terminology — PASS (1 MINOR)

Every material noun, the batch noun, and the failure-class vocabulary were compared with the shipped
`vi` catalogue rather than assumed: batch/material nouns, denial label, gate vocabulary,
rate-limit vocabulary, charge/settlement vocabulary, and `endpoint` (kept Latin and undeclined exactly
as the shipped `ui.chat.canonical.sound.stop.warning` keeps it; zh-CN keeps its own shipped 接口).
Kept-English in this slice is confined to the glossary's set — `endpoint` where the locale's sibling
copy keeps it, the documented `id`/`ID` token, and the `{material}` syntax. Nothing else Latin was
introduced, which is exactly what the operator's "no English left in the interface" requirement turns
on: the only Latin a `vi` user sees here is glossary-sanctioned.

- «Loạt» + material and the material nouns are byte-identical to the shipped `state.done_batch` and `state.failed_batch`.
- «endpoint hủy» and «sẽ bị tính phí nếu tạo ra âm thanh» mirror the shipped `sound.stop.warning`; «khoản phí cuối cùng» mirrors `sound.cost.estimated_zero`.
- «Giới hạn tần suất» matches the shipped rate-limit rendering (6 values, e.g. `error_block.rate_limit.before`); «Đã từ chối» is the shipped denial label and this draft says «Bị từ chối» (see the note in `divergences.md` — same word, different passive form).

## 5. Fit — PASS

These 12 keys carry **no `maxCells`/`maxChars` hint** in the English sidecar — length is prose only
("two to four words", "one short sentence", "keep it short enough not to wrap") — so there is no numeric
budget to violate. Measured widths (approximate terminal cells: wide CJK 2, marks/format 0, U+202F 1 per
the fr guide; measured from the draft bytes, not from a real formatter):

cancelled_batch 167 cells (en 157); cancel.checking 24 = 24; labels 8–26 cells, widest «Giới hạn tần suất âm thanh» 26 vs 18 — the only label in the slice that grows past 22 cells.

Labels render in the card's wrapping `text-meta` block and state lines wrap inside the card, so the risk
here is wrapping, not clipping. No value reaches a width that would change how the card reads.

## 6. RTL — n/a — vi is LTR; no bidi controls.

No RTL surface in this locale, so there is no bidi risk to report: no manual bidi marks and no mirrored glyphs in the copy.

## 7. Findings

| ID | Sev | Key | Current | Problem | Suggested |
|---|---|---|---|---|---|
| VI-2-01 | MINOR | …image_gen.cancel.checking + …image_gen.settlement.pending | Đang xác nhận khoản phí. / Đang chờ quyết toán — khoản phí cuối cùng sẽ xuất hiện khi nhà cung cấp báo cáo. | One English concept (settlement) carries two words inside one slice: «xác nhận khoản phí» (confirming the charge) in cancel.checking and «quyết toán» in settlement.pending. «quyết toán» has 0 occurrences in the shipped vi catalogue — it is accounting-finalisation register, which sits oddly in a consumer status line, and a reader must reconcile it with the sibling key one line above that says «khoản phí». | One family, using the shipped «khoản phí cuối cùng» (ui.chat.canonical.sound.cost.estimated_zero): cancel.checking → «Đang kiểm tra khoản phí.»; settlement.pending → «Khoản phí cuối cùng đang chờ xác nhận — sẽ hiện ra khi nhà cung cấp báo cáo.» |
| VI-2-02 | MINOR | …image_gen.error.audio_rate_limited | Tạo âm thanh đang bận. Hãy thử lại sau giây lát. | The subject of «đang bận» is a bare verb phrase («Tạo âm thanh»), which invites an imperative parse. Shipped vi always puts a noun in that slot: 7 shipped «đang bận» values, e.g. «Tác nhân đang bận» (send_failure.busy, composer.placeholder.busy), «Trung tâm đang bận» (publication.pull.busy), «Trạng thái đã đọc đang bận». This is the one line in the slice that reads translated rather than native. | «Trình tạo âm thanh đang bận. Hãy thử lại sau giây lát.» (noun subject, same two sentences, no wait time, no promised success). |
| VI-2-03 | NIT | …image_gen.error_class.gate_failed | Bị cổng chặn | «cổng» alone is also this UI's word for a network port (ui.chat.pickers.destination_pickers.ports «Cổng», info_model.control_port «Cổng điều khiển»), and the approval-gate noun is the qualified «cổng phê duyệt». A bare «cổng» therefore leaves the reader to infer which gate; the class is still distinct from «Bị từ chối» and the gate's own reason sits below. | «Bị chính sách chặn» (blocked by policy, mirroring the es label's clarity; «chính sách» ships in 8 vi values) or «Bị cổng kiểm tra chặn». |

**Checked and accepted (not findings):** `error_class.duplicate_id` «Trùng id» mirrors the English lowercase `id`, and lowercase `id` in prose is shipped vi (4 values), so no token-form finding. `error_class.denied` «Bị từ chối» is a legitimate second form of the shipped «Đã từ chối» (a state rather than a completed act); recorded as a consistency note, not a defect. «Hãy thử lại sau giây lát» is an ordinary imperative in vi, not the «Vui lòng» padding the guide forbids.

## 8. Terminal verdict

`passed` for `vi` / `ui.chat.canonical` / S16e-renderer on head `bd8e9054…`:
**0 BLOCKER, 0 MAJOR**, 2 MINOR, 1 NIT. Both MINORs are wording/register on strings whose meaning is right; they do not block the slice and can ride the next wave.
Verdict is bound to the en source (`b967adc33296c5ef0264a8a3ffd698fdfc5a50e4a3ebc8de99114a599b837e17`) and the draft (`c0e8df525f0324921dd849634e1a83d6e9d4de53db0e1f38d68c3a2b217f10a9`); if either moves, the
delta must be re-judged rather than this row re-pointed. This is a draft-slice receipt, not permission
to claim a full-file audit hash: the coder still owes post-integration byte-compatibility proof and the
`ledger.py append` binding. No rendered, browser, pseudo-localization or native-speaker evidence is
claimed by this pass — none was executed.
