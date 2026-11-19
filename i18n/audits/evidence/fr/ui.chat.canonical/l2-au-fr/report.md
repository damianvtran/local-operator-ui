# i18n audit — fr, 2 keys (ui.chat.canonical.tool.never_sent_*) — l2-au-fr

Auditor: i18n-auditor (l2-au-fr), independent of translator openai/gpt-6.1-sol. Model: anthropic/claude-sonnet-5-5 (as served).
Verdict: **clean-with-findings** — blocker 0, major 0, minor 1, nit 1.

## Mechanical (python3, run here)
- Key set identical to keys.json (2/2), valid JSON, no empties, neither string equals English.
- `{size}` present exactly once in never_sent_composed, no other placeholders; never_sent_empty has none.
- Separator is U+00B7 with ordinary spaces on both sides, as in source. No trailing punctuation.
- fr rule: U+202F before ':' present in never_sent_composed (code points: 0x202f, 0x3a). PASS.
- Lengths 37 / 34 chars (en 31 / 31): +~15–20 %, in line with the guide's expectation; row truncates with ellipsis.

## Accuracy / idiom / consistency
- "jamais envoyé" = never delivered; masculine agrees with "appel", parallel to shipped `tool_row.outcome.never_ran` "jamais exécuté". Lowercase status, vous-neutral, no "Veuillez": matches style guide.
- "rédigé" (model had written) is right; avoids the music sense of "composé". Colon form `texte rédigé : {size}` sidesteps number agreement with an unknown unit ("1 o rédigé" vs "12,4 ko rédigés") — sensible given {size} is pre-localised ("12,4 ko").
- Two lines are parallel ("texte rédigé" / "aucun texte rédigé"). Good.

## Findings
- MINOR M1 — both keys: "texte" is an addition not in the English and slightly mis-describes the thing measured (a tool request: command/arguments/file payload, not prose). Not wrong, no safety impact. Suggested (shorter and closer to the source): `jamais envoyé · rédigé : {size}` / `jamais envoyé · rien rédigé`. Acceptable to ship as is.
- NIT N1 — never_sent_composed: introduces a second delimiter (`·` then ` :`) where English has none; reads a little heavy. Only an option, current wording is fine: `jamais envoyé · {size} rédigés` is rejected on purpose because of the agreement problem above, so the colon is the right trade.

No terminology/glossary violation, no English left, no overflow beyond the truncating row.

## Commands run
- read keys.json, fr.json, i18n/style-guides/fr.md (en.md size only), shipped fr ui.chat.canonical.json (grep for tool/outil/rédig/texte).
- python3 check: key-set equality, empties/English-identical, placeholder regex + count, code-point dump of non-ASCII/':'.
