# vi — s16e slice notes (12 keys, `ui.chat.canonical`)

Translator: i18n-translator (fresh instance, not an auditor; this locale is audited
separately). Locale: `vi`. Slice: S16e-renderer, generation card stop / settlement /
failure-class copy.

## Sources read (with hashes)

| File | SHA-256 | Used for |
|---|---|---|
| `~/local-operator/i18n/style-guides/vi.md` | `e4901497ed553e2b2ae4a2660bf776adb787b89e11d7eb0f8d08f3da4b227888` | register, punctuation, width rules, recorded wave-2 calls |
| `~/local-operator/i18n/glossary.md` | `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8` | §1 kept-English, §2 core terms, §3 formatting |
| `~/local-operator-ui/.worktrees/i18n-s16e/docs/I18N.md` | `d58ad473701f098b3c2c24343c3a7e7236f22db22cc871016c4cb75f25f41f5c` | translator/auditor split, retention contract |
| `src/i18n/catalogues/vi/ui.chat.canonical.json` (worktree @ `bd8e9054`) | read in place | shipped terminology for this very surface |
| `src/i18n/catalogues/en/ui.chat.canonical.json` | read in place | sibling English source, `sound.*` family |

Glossary style-guide discovery: the UI repo has no `i18n/style-guides/` (its `i18n/` holds
`allowlist.json`, `baseline.json`, `ledger.json`, `languages.json`, allowances, receipts,
audits). The core repo owns `i18n/style-guides/<locale>.md` + `i18n/glossary.md`, exactly as
`docs/design/i18n.md` §163/§607 specifies, and `docs/I18N.md` step 1 points there.

## Term choices, and the evidence for each

All choices mirror strings already shipped in the same namespace for the same card.

| Concept | vi used | Evidence in `vi/ui.chat.canonical.json` |
|---|---|---|
| batch | **loạt** | `image_gen.state.done_batch` → "Loạt video", `state.failed_batch` → "Loạt video không thành công." |
| video / voiceover / sound effect / image | **video / lời thuyết minh / hiệu ứng âm thanh / hình ảnh** | `state.running`, `state.done`, `state.failed` use exactly these four |
| provider | **nhà cung cấp** | `sound.stop.warning` → "Nhà cung cấp không có endpoint hủy."; `image_gen.control.stop_hint_queued` |
| cancellation endpoint | **endpoint hủy** | `sound.stop.warning`; `endpoint` is on the glossary §2 wave-2 kept-English set (Latin, undeclined) |
| charged / charge (verb, noun) | **bị tính phí** / **khoản phí** | "sẽ bị tính phí nếu tạo ra âm thanh" (`sound.stop.warning`); "khoản phí cuối cùng chưa được xác nhận" (`sound.cost.estimated_zero`); "Không tính phí." (`sound.cost.no_charge`) |
| stopped (state) | **đã dừng** | `sound.batch.item_status` → cancelled branch "Đã dừng"; `image_gen.control.stop` → "Dừng" |
| stop request | **yêu cầu dừng** | `sound.stop.request_stop` "Yêu cầu dừng"; `control.stop_hint_running` "Gửi yêu cầu dừng; …"; `sound.stop.confirm_label` |
| rate limit | **giới hạn tần suất** | `ui.chat.error_block.rate_limit.before` → "Bạn đã chạm giới hạn tần suất của nhà cung cấp AI." (kept distinct from **hạn mức** = allowance, `ui.chat.usage.*`) |
| busy | **đang bận** | `ui.chat.pickers.info_model.busy`, `ui.chat.canonical.send_failure.busy` |
| try again | **Hãy thử lại sau giây lát.** | `ui.agents.publication.pull.busy` → "Trung tâm đang bận nên … Hãy thử lại sau giây lát." |
| unknown | **không xác định** | `ui.canvas.spreadsheet_preview.unknown_error` "Lỗi không xác định"; `ui.chat.pickers.slash.unknown_command` |
| arguments | **đối số** | `ui.settings.integrations.add_integration_form.one_per_line` "mỗi dòng một đối số" |
| denied | **bị từ chối** | `ui.agents.publication.hub_unauthorized.*`, `ui.agents.detail.read_state.failed_meaning` |
| gate (policy) | **cổng** | `ui.chat.pickers.destination_pickers…` "Các cổng phê duyệt và câu hỏi vẫn dừng để chờ bạn" |
| id | **id** (Latin) | "id phiên", "id mới", "Tác vụ {id}" — identifiers stay per glossary §1 |
| settlement | **quyết toán** (new term, see proposals) | no prior occurrence in the catalogue |

## Register and shape

- Style guide address rule ("`bạn` only at first contact; elsewhere plain verbs carry the
  sentence") → no pronoun anywhere in these 12; `cancel.queued` reads
  "…sẽ không bị tính phí." rather than "bạn sẽ không bị tính phí", matching the
  pronoun-free `sound.cost.*` and `sound.stop.warning` family.
- Sentence case throughout; no `!`; labels carry no full stop; every statement that has a
  full stop in English has one here, including the checking clause (`.` after "khoản phí").
- Em dash kept with spaces in `settlement.pending` (" — "): the vi guide's punctuation
  section records `em dash " — " with spaces` as vi's own convention, so the English dash
  role survives as the locale's natural punctuation and needed no rewrite.
- Semicolon kept where English has one (`cancel.queued`, `cancel.running`), matching
  `sound.stop.warning`'s own semicolon.
- No bidi/ASCII/ellipsis issues: no "..." present in this slice.

## ICU

- `state.cancelled_batch` keeps `{material, select, …}` with the English keywords
  `video / voiceover / sound_effect / other` untouched and a complete translated sentence in
  each branch. No plural anywhere (vi is `other`-only; none of these 12 is plural).
- Normalising the four branches, `state.cancelled_batch` is "Loạt {material} đã dừng." — the
  same family as the shipped `failed_batch` "Loạt {material} không thành công." so the
  stopped card and the failed card read as one family, per the sidecar note.
- `cancel.running` deliberately does **not** contain the settlement clause (the callsite
  joins it with `cancel.checking`), and `cancel.checking` is a standalone sentence with its
  own full stop.
- Structural proof: all 12 values were parsed and formatted by the repo's actual parser
  (`intl-messageformat@12.1.3`, the dependency `src/i18n/messages.ts` wraps) under the `vi`
  locale; select keywords and argument names compared byte-for-byte against English; every
  `material` branch formatted. Output: `OK: all 12 parse, select keywords + argument names
  match, no brace leaks`.
  What I did **not** run: importing `src/i18n/messages.ts` itself — the review worktree has
  no `node_modules`, and importing that module drags the catalogue tree plus `./locale`
  runtime state, so it is not a cheap parse. The parser library is the same code the runtime
  uses; no `i18n check` CLI was run (the repo's checker needs installed deps and a build
  tree, both out of bounds for this read-only worktree under the machine memory guard).

## Width (measured as code points; all NFC, so cells == code points here)

| key | en | vi |
|---|---|---|
| state.cancelled_batch (longest branch) | 157 (whole msg) | 167 (whole msg) |
| cancel.queued | 64 | 57 |
| cancel.running | 125 | 122 |
| cancel.checking | 24 | 24 |
| settlement.pending | 79 | 80 |
| error.audio_rate_limited | 64 | 48 |
| error_class.audio_rate_limited | 18 | 26 |
| error_class.unknown_tool | 12 | 22 |
| error_class.invalid_arguments | 17 | 19 |
| error_class.duplicate_id | 12 | 8 |
| error_class.denied | 6 | 10 |
| error_class.gate_failed | 11 | 12 |

Sentence-width targets are met: every state/error sentence is at or below its English
length despite vi running long (the phrase-work is Vietnamese's own, e.g. "Hãy thử lại sau
giây lát." replaces a whole English clause).

One label needs a reviewer's eye: `error_class.audio_rate_limited` is 26 cells against an
18-cell English label. "Audio rate limited" is two concepts in one label, and vi's settled
term for rate limit is the two-word "giới hạn tần suất" (the catalogue never shortens it).
I kept the accurate class name "Giới hạn tần suất âm thanh" rather than truncating or
dropping "âm thanh". It is a label above a wrapping sentence, so it does not clip; if the
design budget really is 18 cells, the recorded fallback is "Chạm giới hạn tần suất"
(drops the material word — same class, 22 cells). `unknown_tool` at 22 cells is the same
kind of tension but "Công cụ không xác định" is the catalogue's own "không xác định" form
and shortening it to "Công cụ lạ" would be register-inconsistent.

## Judgement calls (one line each)

- **cancel.checking** — "Checking for settlement." rendered as "Đang xác nhận khoản phí."
  (confirming the charge): a literal "Đang kiểm tra quyết toán." reads as auditing accounts,
  and the shipped `sound.cost.estimated_zero` already says "khoản phí cuối cùng chưa được
  xác nhận", so the user-facing verb for this state is "xác nhận". Same fact, natural vi.
- **settlement.pending** — leads with "Đang chờ quyết toán" (settlement pending) and keeps
  English's dash-plus-explanation shape; states no amount and never a zero.
- **state.cancelled_batch** — "đã dừng", not "đã hủy": `cancelled` in this card's own
  `sound.batch.item_status` is "Đã dừng", while "Đã hủy" belongs to the tool-row verbs
  (`tool_row.verb.cancelled.settled`). Using "hủy" here would name a different action from
  the one the stop button performs.
- **error_class.denied** — "Bị từ chối" (passive) rather than the bare "Từ chối", because
  "Từ chối" reads as an imperative ("refuse") in a label stack; the class describes what
  happened to the call.
- **error_class.gate_failed** — "Bị cổng chặn" (blocked by the gate), not a "cổng thất bại"
  ("the gate failed") form: the sidecar says a configured policy gate stopped the call, so
  the failure is the call being blocked, not the gate erroring.
- **error_class.duplicate_id** — "Trùng id": "id" stays Latin as the identifier token; the
  catalogue writes "khóa trùng lặp" / "bản trùng" for duplicates in prose, but a two-word
  label cannot take "trùng lặp".
- Nothing in this slice is identical to English except the intentionally kept tokens
  (`endpoint`, `id`, `video`).

## Glossary proposals (append, do not silently invent)

1. **settlement → quyết toán** (vi). Proposed for glossary §2, policy *translate*. This
   slice needs the noun in `settlement.pending` and it has no prior row. "Quyết toán" is the
   established Vietnamese word for final settlement of an account/charge; "đối soát"
   (reconcile) was rejected because the catalogue already uses it once for verifying an
   outcome (`ui.hub.links.publication_pending`) and it names checking records, not the
   charge becoming final.
2. **rate limit → giới hạn tần suất** (vi) is already de facto settled by
   `ui.chat.error_block.rate_limit.*` but has no glossary row; proposing it so future waves
   do not drift to "giới hạn tốc độ" (used for quota reset windows).

## Open questions

- Is `error_class.audio_rate_limited` allowed 26 cells, or must it fit ~18? If the latter,
  take the recorded fallback "Chạm giới hạn tần suất".
- Should "charge" as a noun be a glossary row ("khoản phí")? Three shipped keys already
  agree; recording it would stop a future wave from writing "phí" alone in this card.
