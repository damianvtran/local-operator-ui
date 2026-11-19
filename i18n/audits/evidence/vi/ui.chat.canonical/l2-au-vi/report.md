# Audit — vi, ui.chat.canonical (2 keys: tool.never_sent_composed / never_sent_empty)
Auditor: i18n-auditor (l2-au-vi), independent of translator openai/gpt-6.1-sol. Model: anthropic/claude-sonnet-5-5.

Verdict: CLEAN. Counts: blocker 0, major 0, minor 0, nit 0.

## Mechanical (python3)
- Key set == keys.json (minus `_no_unit_keys`); no extras/missing.
- {size} exactly once in never_sent_composed, absent in never_sent_empty; no other placeholders.
- U+00B7 present in both (with surrounding spaces, same as shipped `fold.unit_separator` " · ").
- NFC-normalised, no leading/trailing whitespace, non-empty, differs from English. Lengths 31/29 chars (en 33/28) — fits the truncating one-row summary.

## Accuracy / idiom
- "không được gửi · đã soạn {size}" / "không được gửi · chưa soạn gì".
- "không được gửi" = "was not sent" (not delivered). Correctly NOT "chưa được gửi" (= not yet sent, wrong: the call never will be). Terse lower-case, no punctuation, consistent with shipped tool_row outcomes ("không chạy", "bị ngắt", "thất bại").
- "soạn" = write/draft; matches how vi shipped copy uses it ("soạn tin") and fits "how much of the request the model had written". Not the music sense. "đã soạn {size}" = "{size} drafted"; natural.
- "chưa soạn gì" = "nothing drafted yet": "chưa" is the idiomatic negative-perfective here; "không soạn gì" would read as a refusal. Slight tense difference vs en is natural.
- Lines are parallel (same prefix, same verb "soạn", đã/chưa pair). Register per style guide: terse, no pronoun, no "!", sentence case.
- No English remains (only the {size} value, produced by Intl; vi uses Latin B/kB/MB per CLDR).

## Fit / RTL
Short; no wide glyphs; precomposed diacritics (NFC). RTL n/a.

## Commands run
python3 key/placeholder/NFC/empty/English-identity check; read style guide vi.md, keys.json, vi.json; python3 scan of shipped vi ui.chat.canonical.json for tool_row terms; grep of glossary and vi catalogues for "soạn".
(No audit-ledger command was run; the task scoped this to a report only.)
