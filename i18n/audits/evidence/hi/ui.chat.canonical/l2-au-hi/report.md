# Audit hi — L2 file sizes (2 keys) — verdict: clean

Auditor: i18n-auditor (l2-au-hi), anthropic/claude-sonnet-5-5. Translator: openai/gpt-6.1-sol.

Mechanical: key set identical (2/2); `{size}` exactly once in never_sent_composed, none in empty; one U+00B7 per key, plain U+0020 around it; no empties, none English-identical, no ZWJ/ZWNJ/NBSP; valid JSON; no trailing punctuation.

Findings: none (0 blocker / 0 major / 0 minor / 0 nit).

- never_sent_composed "नहीं भेजा गया · {size} लिखा गया" — accurate: "not sent" (passive, matches shipped send_failure.* "नहीं भेजा गया"); "लिखा गया" = written by the model; reads right with "12.4 kB" or "340 बाइट" before it.
- never_sent_empty "नहीं भेजा गया · कुछ नहीं लिखा गया" — parallel to line 1 (identical frame, only the detail differs).
- Register: terse, impersonal passive, no आप needed; no danda (status line, no punctuation) per style guide. No English left (kB/MB Latin symbols come from CLDR per policy).
- Width: ~23 / 22 base cells (31 / 33 code points) — short, comfortable for the row.
- Optional, not a finding: shipped outcome.never_ran uses "कभी नहीं चला"; "नहीं भेजा गया" is consistent with send_failure copy and fine.
