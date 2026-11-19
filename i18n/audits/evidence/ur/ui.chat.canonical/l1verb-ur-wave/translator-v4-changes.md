# Urdu L1 v4 — targeted translation remediation

Translator: i18n-translator · session c46d8ce2059a · actual served model openai/gpt-6.1-sol (session header; no fallback observed).

- listed_network_peers.settled: نیٹ ورک ڈیوائسز دکھائے → ڈیوائسز کی فہرست بنائی (22 cells).
- listed_network_peers.running: نیٹ ورک ڈیوائسز دکھا رہا → ڈیوائسز کی فہرست بنا رہا (24 cells).

## Reasoning

Choose the shorter device-list pair. Feminine singular فہرست takes بنائی; this avoids both the prior masculine-plural agreement defect and the دکھائیں imperative homograph. Both states use بنانا, matching listed_networks and the slice’s listed family. Devices (ڈیوائسز) remain distinct from networks (نیٹ ورکس). Omitting the redundant network qualifier follows invited_device and removed_device, and avoids the qualified alternative’s 30/32-cell width exception.

Checked the supplied existing Urdu catalogue: ui.mesh.mesh_drop.network_not_destination uses ڈیوائسز ہوتی ہیں; ui.notices.chat.mark_all_read_deferred uses feminine-plural جائیں گی. Existing ui.chat.canonical bridge channels/shared_conversations labels use فہرست بنائی. The eight new network-operation sibling values are absent from that existing Urdu catalogue; their English source/context and prep values were checked separately.

## Python3 mechanical validation — executed

PASS: valid UTF-8 JSON; 182 nonempty string values; exact keys.json source-slice order and original v3 order; exactly two authorized values changed; other 180 values identical; source placeholder/backtick/markup token parity; no manual bidi controls; changed widths 22/24 cells.

The first validation assertion against the whole English catalogue’s order failed: that file is ordered differently from the supplied keys.json slice. Follow-up confirmed v4 preserves exactly keys.json and v3 order. No values outside the requested pair changed.

SHA-256 ur.v4.json: `ac12a8b3cf6714df3f041ca3cfac82f3f1671730e0e639f4ab9efecd2c7cec0c`

Full repository pnpm check-i18n not run: these are prep-only files outside integrated catalogues. This is translation remediation, not a self-audit; independent audit remains required. No ledger modified or passed status claimed. Glossary proposals: none added by this delta; peer → ڈیوائس is the slice’s existing choice, consistent with glossary device → ڈیوائس.
