# Delta audit — ur (RTL), L1 tool-row verbs, v3 → v4

Auditor: i18n-auditor (team lopdev), session 4d2d89188e1a. Actual served model: anthropic/claude-sonnet-5-5 (session header; no fallback observed).
Date 2026-11-11. Audited bytes: .worktrees/_l1-prep/ur.v4.json sha256 ac12a8b3cf6714df3f041ca3cfac82f3f1671730e0e639f4ab9efecd2c7cec0c (matches translator's stated hash).
Independent: translated/edited nothing; no MT or back-translation.

## Verdict: clean-with-findings — {blocker 0, major 0, minor 0, nit 2}. `passed`-eligible.

## Changed keys (python3 diff v3 vs v4: exactly 2, same key order)
- listed_network_peers.settled: 'نیٹ ورک ڈیوائسز دکھائے' → 'ڈیوائسز کی فہرست بنائی' (22 cells)
- listed_network_peers.running: 'نیٹ ورک ڈیوائسز دکھا رہا' → 'ڈیوائسز کی فہرست بنا رہا' (24 cells)

## Judgement
- Grammar/agreement: head noun فہرست is feminine singular → بنائی (f.sg) agrees; ڈیوائسز is an indeclinable -ز loanword in the oblique after کی, no agreement issue. The old defect (masc. pl. دکھائے vs. f. pl. ڈیوائسز) is gone and the دکھائیں imperative homograph is avoided. Running 'بنا رہا' uses the file-wide masculine-default progressive, same as every sibling.
- Idiom: 'X کی فہرست بنائی / بنا رہا' is natural Urdu and is the file's dominant listed_* pattern (checked: 9 listed_* pairs plus listed_networks, listed_consoles, listed_symbols, listed_sessions; shipped ui.chat.canonical bridge channels/shared_conversations rows use 'گفتگوؤں کی فہرست بنائی').
- Parity: structurally identical to listed_networks ('نیٹ ورکس کی فہرست بنائی' 23 / '… بنا رہا' 25). Pair parallelism: settled/running share verb (بنانا) and object; running = settled with 'بنائی'→'بنا رہا' only, as the sidecar requires.
- Distinguishability: 'ڈیوائسز' (devices) vs 'نیٹ ورکس' (networks) differ in head word and nothing else in the family uses 'ڈیوائسز کی فہرست'; invited_device/removed_device use bare ڈیوائس in the same tool family, so the qualifier-free form is in-family. Meaning (peers of the network) is carried by the tool row's object, not unsafe. See nit N1.
- Width: 22/24 cells (rich.cells.cell_len); slice max remains 29 (listed_subagents.running); no growth vs v3 (22/ v3 running 22→24 only +2). keys.json carries no numeric maxCells; width text is 'narrow fixed-width gutter'.
- Bidi: no Cf/bidi controls anywhere; no Latin tokens in these two values, so no embedded-run hazard.

## Mechanical pass on ur.v4.json (executed, python3 from the repo .venv for rich)
- valid JSON; 182 keys; list(keys.json)==list(ur.v4) and set equal (no added/dropped, same order)
- 0 empty/whitespace-only values; 0 leading/trailing/double spaces
- 0 values identical to English (the Python row is 'Python چلایا', not identical)
- 0 bidi/format (Cf) characters, incl. LRM/RLM/FSI/PDI/ALM
- 0 placeholders/backticks/markup in en or ur (context says 'placeholders: none'); no trailing punctuation; no Urdu/Arabic-Indic digits
- No ICU plural/select in this slice.

## Nits
- N1 (NIT): the 'peers' notion is now only implied. Shipped mesh copy has 'ہم مرتبہ ڈیوائس' (ui.mesh.mesh_list…peer_read…). A faithful 'ہم مرتبہ ڈیوائسز کی فہرست بنائی' would be 31 cells and outlier-wide; keeping the 22/24 form is the right trade. No change requested.
- N2 (NIT): the 'peer → ڈیوائس' and 'ڈیوائسز' term call (and the دکھائیں homograph rule noted in round 3) is still unrecorded in i18n/style-guides/ur.md (grep for peer/device in ur.md: no hits; glossary.md row 65 only has device → ڈیوائس). Record before ship; no wording change.

## Commands actually run
cat ur.v4-changes.md; python3 diff/key-order/set check v3 vs v4 vs keys.json; ~/local-operator/.venv/bin/python mechanical pass (JSON, empties, identical-to-English, Cf categories, tokens, digits, rich cell_len); grep of ur.md/glossary.md and shipped ur catalogue (ڈیوائس, فہرست بنائی, peer). No ledger/record written (task requested report only).
