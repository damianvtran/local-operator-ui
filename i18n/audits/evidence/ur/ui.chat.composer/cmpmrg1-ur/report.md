# ur · ui.chat.composer · delta audit `cmpmrg1-ur`

- Audit date: 2026-11-04 · HEAD `801b1ad29d47bbb89a0768e0ea1f193892db953d` (merge of origin/main into `fix/i18n-four-flow-defects`)
- Auditor: `i18n-auditor` (team lopdev), session `e95f3f697724`, model `anthropic/claude-sonnet-5-5` (harness session header; no fallback observed). Independent of every translator and of the earlier readers of these keys; no catalogue, context, ledger or existing receipt byte was edited.
- Scope: six DELTA keys of the merged `ur` file (72 keys; key set equals English): `secret_closure_notice` (branch key, value byte-identical to the earlier-audited candidate) and main's `insert_transcript`, `insert_transcript_hint`, `send_recording`, `send_recording_hint`, `steer_hint`. The other 66 keys were read only for glossary/register consistency, not re-audited.
- References read: `i18n/style-guides/ur.md`, `i18n/glossary.md` (local-operator checkout), the English file and its context sidecar at HEAD, siblings `confirm_recording*`, `cancel_recording*`, `placeholder.waiting/stopping/secret_answer`, `stop_work_hint`, `secret_fill_*`, `suggestion.last_turn`, and the ur catalogues of other namespaces for the same terms. No translation or MT service was used.

## Verdict: PASSED — 0 BLOCKER, 0 MAJOR, 1 MINOR, 2 NIT

## 1. Mechanical
- None of the six English values contains a placeholder, ICU plural/select, markup or backtick code; none of the six ur values does either (regex over `{…}`, `<…>`, backticks, quotes). Nothing to preserve, nothing introduced.
- NFC; no leading/trailing or double spaces; no bidi/format characters (RLM/LRM/FSI/PDI/ZWNJ/BOM) in any of the six — correct per the style guide (the render layer adds the isolates).
- Key set of the ur file equals English (72/72); `locale-parity.test.mjs` ur rows (6) all pass. (The `fr` stub row failing in that same run is another locale's, out of scope.)
- `Enter` and `Esc` are byte-identical Latin, spelled as in the English and as in the sibling hints.

## 2. Accuracy
- `insert_transcript` / `_hint`: "put the dictated words in the box to review (not confirm)". ur says داخل کریں (insert) with جانچنے کے لیے (to check/review) — not تصدیق, so the sidecar's "do not translate as confirm" is honoured and it differs from the sibling تصدیق کریں of `confirm_recording`.
- `send_recording_hint`: "Transcribe and send now, no review" — the sidecar requires the no-review fact stated plainly; ur says جانچے بغیر at the end. Meaning, order and polarity preserved.
- `steer_hint`: Enter steers now; Esc stops the turn. Both facts and their order kept. "turn" = باری, the term the namespace already uses (placeholder.stopping, suggestion.last_turn).
- `secret_closure_notice`: both clauses (box paused until answered; draft kept) in English order with the em dash; no security promise added, no limit implied (sidecar constraints met). راز / سوالات کا پینل / مسودہ / موقوف are the namespace's established terms.

## 3. Idiom and register
Polite imperative (…کریں, …دیں, …بھیجیں), آپ implied, terse, no "براہ کرم", no "!" — per the style guide. Urdu punctuation (۔ ، —). Natural Urdu, not Hindi-ised.

## 4. Terminology
transcript → ٹرانسکرپٹ (glossary/ur guide) used in both insert keys; agent → ایجنٹ; steer → ہدایت دیں (same as `placeholder.waiting`); stop → روکنا (same as `stop_work_hint`); Latin key names untouched. See N-1 for the verb stem.

## 5. Fit (display-width count; Arabic-script ≈ 1 cell, combining/format = 0)
| key | cells | maxCells |
|---|---|---|
| insert_transcript | 19 | 24 |
| insert_transcript_hint | 41 | 48 |
| send_recording | 15 | 24 |
| send_recording_hint | 40 | 48 |
| steer_hint | 58 | 64 |
| secret_closure_notice | 109 | (none; a wrapping notice) |
All within budget. Advisory counts only; no rendered-fit claim.

## 6. RTL / bidi (checked with `fribidi`, a Unicode bidi implementation, on the string wrapped in FSI…PDI and a forced RTL base)
- `(Enter)` ends the insert hint: it reads as one LTR island at the visual left (the logical end), parentheses resolve and mirror correctly, matching the sibling `confirm_recording_hint (Enter)`.
- `steer_hint`: `(Enter) · Esc` — two separate Latin islands separated by the middle dot; reading order right-to-left is Enter, then Esc, exactly the logical order; no run merges and nothing reverses. Same pattern as `placeholder.waiting`.
- The other four strings carry no Latin or digits: no bidi hazard. No arrows or direction-sensitive glyphs in copy.

## Findings
- **U-1 · MINOR** · `ui.chat.composer.secret_closure_notice` · current: `… جواب ملنے تک یہ خانہ موقوف ہے، …`. In this same namespace خانہ already means the secret *field* (`secret_confirm_put`, `secret_fill_*`: «راز کے خانے»), and the sentence has just named a secret request and the asks panel. «یہ خانہ» is a bare deictic, so a reader can briefly take it to be the secret field instead of the message box beneath the notice. The sidecar says "this box" (the message box). Suggested: `سوالات کے پینل میں راز کی درخواست کا جواب دیں — جواب ملنے تک پیغام کا خانہ موقوف ہے، اور آپ کا مسودہ محفوظ رہتا ہے۔` («پیغام کا خانہ» is the term `ui.chat.question_dock.hint.approval*` uses for the message box). Not gating: the notice sits directly above the box and the meaning stays recoverable; no wrong-meaning code path.
- **U-2 · NIT** · `ui.chat.composer.send_recording_hint` · «ٹرانسکرائب» (verb stem, ائ) beside «ٹرانسکرپٹ» (glossary noun, پ) in the sibling key. Both are in common use and the verb is not in the glossary; it is internally consistent only if read as two words. Optional: `ٹرانسکرپٹ بنا کر ابھی بھیجیں، جانچے بغیر`, or leave as is.
- **U-3 · NIT** · `insert_transcript_hint` / `send_recording_hint` · جانچنا is used for "review" while the rest of the catalogue renders review/reviewing as جائزہ (code review, review progress). Here the natural sense is proofreading dictated words, جانچنا is the more idiomatic verb, and the two keys agree with each other; no change needed.

Nothing found that is wrong in meaning, polarity or safety.
