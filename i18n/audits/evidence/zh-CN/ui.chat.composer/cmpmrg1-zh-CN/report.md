# Audit cmpmrg1-zh-CN — ui.chat.composer (zh-CN), delta on merged bytes

Auditor: i18n-auditor, session aa5cc6461961, model anthropic/claude-sonnet-5-5 (from session header; not independently verifiable). Independent of all translators. HEAD 801b1ad29d47.
Hashes: en `1abe3bc2730635d6eae484b49bfafa1743dee3be1f0ca60863576632acb95f14` · context `de9e346489f6df64bc3ff08abd1f8e0550e95e54e44b7c0ddda47897ff50e2dc` · zh-CN `fe9428ec142e4fb8100c2b525caed8e1467d616aa3b1a2d411e72e096d9a3846`.
Verdict: **passed** — 0 BLOCKER, 0 MAJOR, 2 MINOR, 2 NIT. Receipt instance `aa5cc6461961-cmpmrg1-zh-CN`.

## Mechanical
Keys 72 = 72 (en = zh-CN). None of the six values has placeholders, ICU, markup or code. Key names Enter/Esc are kept byte-exact, with the parenthetical `（Enter）` that the sidecar asks for. NFC, no format/control characters, no edge or double spaces. Widths (CJK=2): insert_transcript 12/24, insert_transcript_hint 29/48, send_recording 8/24, send_recording_hint 24/48, steer_hint 36/64. `secret_closure_notice` has no maxCells (82 cells; a notice sentence). The merge is a clean disjoint union (HEAD^1 lacked only the five main keys, HEAD^2 lacked only secret_closure_notice).

## Per key
| key | zh-CN | verdict |
|---|---|---|
| secret_closure_notice | 请在请求面板中回复这条敏感信息请求——在它得到答复前，此输入框暂停使用，草稿已保留。 | Accurate. Both clauses, order, em dash (——) and 'draft kept' are preserved. No security promise added. See Z2/Z3. |
| insert_transcript | 插入转写文字 | OK. Not 'confirm'. 转写文字 is the recorded exception to the glossary's 记录 (audit 54ec32ab1ef8); 记录 would read as 'log'. |
| insert_transcript_hint | 插入转写文字以供查看（Enter） | OK. Same exception. |
| send_recording | 发送录音 | OK. See Z4. |
| send_recording_hint | 转写并立即发送，无需查看 | Accurate; wording could be firmer (Z1). |
| steer_hint | 立即引导智能体（Enter）· Esc停止本轮 | OK. 引导智能体 and 'Esc停止' match placeholder.waiting; no space between CJK and Latin per the style guide; 本轮 consistent with 轮次 in siblings. |

## Findings
- **Z1 MINOR** `ui.chat.composer.send_recording_hint` — current: 转写并立即发送，无需查看 — proposed: 转写并立即发送，不经查看 — Context sidecar: 'no chance to review them ... say plainly that there is no review step'. 无需查看 means 'no need to look' (optional); 不经查看 states that the review step is absent. Meaning is not inverted, so not MAJOR.
- **Z2 MINOR** `ui.chat.composer.secret_closure_notice` — current: 请在请求面板中回复这条敏感信息请求——在它得到答复前，此输入框暂停使用，草稿已保留。 — proposed: 在请求面板中回复这条敏感信息请求——在它得到回复前，此输入框暂停使用，草稿已保留。 — zh-CN style guide, Formality & tone: '请' only where the English says 'please'; the English is a bare imperative. Sibling secret_ask_notice / secret_fill_* already use 请 for non-'please' source, so this is consistent with shipped copy; the notice is not a dialog. Drop 请 if the guide is applied strictly.
- **Z3 NIT** `ui.chat.composer.secret_closure_notice` — current: 回复 ... 得到答复 — proposed: 回复 ... 得到回复 — Same English word 'answered' rendered 回复 then 答复 in one sentence; the whole secret_* family uses 回复/填写. Optional unification (included in the Z2 wording).
- **Z4 NIT** `ui.chat.composer.send_recording` — current: 发送录音 — proposed: KEEP — 录音 alone can read as sending the audio file; this faithfully mirrors the English 'Send recording' and the adjacent hint 转写并立即发送 disambiguates. No change required.

No findings gate. Not claimed: rendered-fit or screenshots; native-reader judgement beyond reading the files.
