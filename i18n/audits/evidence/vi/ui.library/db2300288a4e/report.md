# i18n audit — P7 slice, vi (ROUND 1, pre-landing candidate)

- Slice: `P7 / UI library organized-by actor sentences + audio position value`
- Locale: `vi` · Namespace/file group: `ui.library` (5 keys) + `ui.chat` (1 key)
- Candidate: `~/local-operator-ui/.worktrees/_p7-prep/vi.json` (model `anthropic/claude-sonnet-5-5`)
- Translator session: `i18n-translator` on anthropic/claude-sonnet-5-5 — NOT this auditor
- Auditor: `i18n-auditor`, session `db2300288a4e`, **actual served model `deepseek/deepseek-flash`**, no fallback in effect; independent of the translator session
- Source baseline read: `origin/main` = `3e48d8acb981b098bf512157ee0d1faf3f5fc3c9` (moved past the prep manifest's `a0464af9e0a8d13e87409a4e2fd410e87b6bcdcc`; checked the delta — en+vi `ui.library.json` gained only `ui.library.kind.*` (12) and `ui.library.tag_category.*` (8); the 6 audited source strings and the terminology baseline `organized_by` / `librarian.title` / `sort.organized` / `status.unorganized` are byte-identical at both shas, so the translator's source == the source audited here)
- Judged by reading; no MT/back-translation service used.

## Verdict: CLEAN-WITH-FINDINGS

0 BLOCKER · 0 MAJOR · 0 MINOR · 2 NIT → ledger status would be `passed` (nothing gating). No changes requested.
(Report only: per the task I did not write the ledger or the repo.)

## Mechanical pass (python3, own derivation)

- Valid JSON; key set == `keys.json` exactly (6/6), key ORDER identical to source sidecar; no added/dropped keys.
- Placeholder parity per key: `{at}` (5 library keys), `{current}`+`{total}` (audio) — names and types identical to source; no renamed bindings.
- No ICU (`plural`/`select`/`number`/`date`) in either side → the "no plural" call in risks.md is correct; `other`-only rule not engaged.
- No markup, Rich tags, backticks, code spans, flags, identifiers or paths on either side (regex over all 12 strings: zero `<>`/backtick).
- No empty/whitespace-only values; no leading/trailing or double spaces; no C0/C1, zero-width or bidi control characters anywhere (matters for ur, verified clean for vi too).
- All 6 values NFC-normalised; zero combining marks (guide's precomposed-form rule satisfied).
- No value byte-identical to its English source.
- Lengths (source → target, before `{at}`): 26→32, 31→27, 28→22, 21→23, 14→17; audio 20→22. Longest composed line: agent + "5 phút trước" = 40 chars vs en 29. The metadata line is `flex flex-wrap items-center gap-2` (`library-preview.tsx` ~:498) and each sentence is its own flex item, so the extra ~11 chars wrap rather than overflow; the audio string is `aria-valuetext` (announced, not laid out). No width gate engaged.

## Findings

### N1 — NIT — `ui.library.preview.organized_by_system`
- Current: `Tự động phân loại {at}` ("Tự động phân loại 2 giờ trước")
- Assessment: meaning and state reading are CORRECT — the trailing relative-age phrase disambiguates it as a completed state, and the English here deliberately names no actor ("the catalog itself did it"), which the agentless form preserves. The only residual risk is shape: in Vietnamese UI copy a bare `Tự động phân loại` is exactly how an *auto-organize action label* is written, so out of context the line can be mis-parsed as a command; and it is the only one of the five that does not sit in the `được … phân loại` frame the other four establish.
- Optional tightening (no meaning change; not required to unblock): `Được tự động phân loại {at}` — keeps the passive family and removes the imperative reading. Current wording is acceptable as shipped.

### N2 — NIT — `ui.library.preview.organized_by_agent`
- Current: `Được một tác nhân phân loại {at}`
- Assessment: grammatical and faithful ("an agent" indefinite). It is the group's longest string (40 chars composed vs en 29) and `một` is redundant in Vietnamese, where a bare noun is already indefinite — the guide's standing rule is "vi runs long; tighten".
- Optional tightening: `Được tác nhân phân loại {at}` (saves 4 chars, same meaning). Keeping `một` reads slightly more explicit; either passes.

## Points examined and accepted (no finding — recorded so the second pass need not re-derive)

1. `ui.library.preview.organized_by_librarian` = `Được Thủ thư phân loại {at}` — term is exactly the shipped `ui.library.librarian.title` ("Thủ thư"); mid-sentence capitalisation is right for a product persona name (the fr analogue capitalises "Bibliothécaire") and it matches the shipped title's form. Vietnamese has no definite article, so English "the Librarian" needs no article equivalent.
2. `ui.library.preview.organized_by_user` = `Được bạn phân loại {at}` — the guide says drop `bạn` except at first contact/blocking decisions, but the English here *names the reader as the actor*, and dropping it would collapse this key onto the unattributed one, destroying the point of the five-key split. The pronoun is required for fidelity, so the guide's rule does not bite; `bạn` is also the shipped address form (`ui.library.page.empty_title`, `ui.chat.error_block.*`). Kept.
3. `ui.library.preview.organized_unattributed` = `Đã phân loại {at}` — makes no actor claim (English "Organized {at}" makes none) and pairs exactly with the shipped `Chưa phân loại` (`ui.library.status.unorganized`, `ui.library.preview.unorganized`): the chưa/đã opposition is the established idiom in this very file. `đã` + relative time is not redundant here — it marks the state against `chưa`, which is why the agentless `Đã` is a better choice than a bare `Phân loại` that would read as a button.
4. Terminology: "phân loại" is right, not "sắp xếp" — shipped `ui.library.sort.organized` = "Phân loại gần nhất" and `ui.library.librarian.last_organized` = "Phân loại gần nhất {at}"; "tác nhân" matches the glossary row for *agent* and shipped ui.chat usage (`ui.chat.header_identity.assign_agent`, `no_agent`, `question_dock.from_agent_label`). No term invented, no kept-English item translated.
5. `{at}` final position: composes with the shipped relative-time keys (`… phút/giờ/ngày/tháng/năm trước`, `vừa xong`) and mirrors the shipped `last_organized` order, so "phân loại 2 giờ trước" / "phân loại vừa xong" read naturally at all five thresholds, including the `vừa xong` edge case ("Đã phân loại vừa xong", "Tự động phân loại vừa xong").
6. `ui.chat.audio.position_value` = `{current} trên {total}` — natural spoken ratio in Vietnamese ("0:05 trên 0:12", same construction as "3 trên 4"); placeholder order free per sidecar and unchanged here, so the `aria-valuetext` reads elapsed-then-total exactly as English; plural-free as required; the word "position" is correctly NOT repeated (the slider's name is already `ui.chat.audio.position_label` = "Vị trí phát của {label}"); ASCII clocks pass through untouched; no manual bidi controls (and vi is LTR, so no RTL work).
7. Register: terse, sentence case, no "!", no "Vui lòng", neutral product voice throughout — matches the guide. No calque or literal-translation tell in any of the six.
8. Translator's `notes` claims were each verified against the catalogues (shipped passive pattern, `phân loại` source, `Thủ thư` title, `bạn` in existing copy) — all true; no overclaim to report.

## Retention

Round-1 audit of a **candidate not yet on a branch**: nothing is tracked in `i18n/audits/evidence/` yet, and the task forbids touching the repo/ledger. This report + `record.json` live in this session's scratchpad; the coding PR that lands the 6 keys should carry the tracked record at `i18n/audits/evidence/vi/ui.library.p7-organized-by-<date>/record.json` (+ a companion for `ui.chat` audio), with these exact input hashes and this verdict — otherwise the ledger `passed` row would cite evidence that does not exist on the branch.
