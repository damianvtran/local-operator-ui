# Census five-key translation and audit provenance

Date: 2026-11-03. Catalogue revision: `c44e9e8be8e`.

## Scope and limits

This addendum covers only these new keys, in seven locales:

- `ui.chat.session_status.effort_level.low`
- `ui.chat.session_status.effort_level.medium`
- `ui.chat.session_status.effort_level.high`
- `ui.chat.run_details.wake.armed_count`
- `ui.chat.run_details.wake.cadence_once`

The ledger writer binds receipts to whole-file source and target hashes, but
these receipts are **five-key delta audits, not whole-namespace linguistic
reapproval**. Previously unchanged messages retain their prior provenance.
The existing namespace translator fields describe baseline translators; they do
not identify the new agents who translated these five keys. Baseline translator
fields remain intact, and the writer preserves older audits in `superseded`.
This addendum records the delta translators separately rather than rewriting
history or inventing missing identities.

## Translation provenance

The translation session IDs and actual model below come from the coordinator's
source reports, as supplied in this task brief. This assembly session did **not**
independently verify the translation sessions or their model execution.
All seven translations were reported as substantively completed using
`openai/gpt-6.1-sol` after provider quota fallback; a configured role model is
not evidence of the model that actually translated the keys.

| Locale | Delta translation session | Actual model, coordinator-reported |
| --- | --- | --- |
| zh-CN | `7fce46e29bee` | `openai/gpt-6.1-sol` |
| fr | `7b2ba4ed501d` | `openai/gpt-6.1-sol` |
| es | Not recovered; no Spanish translator session report available to this assembly session | `openai/gpt-6.1-sol` |
| ru | Not recovered | `openai/gpt-6.1-sol` |
| vi | `15986c0af719` | `openai/gpt-6.1-sol` |
| ur | Not recovered | `openai/gpt-6.1-sol` |
| hi | `b60b4bdc8c47` | `openai/gpt-6.1-sol` |

## Independent delta audit receipts

Auditor instance and model were read from each auditor-written receipt, not
inferred from role defaults. All receipts derive a clean result with zero
findings for both namespaces. Their source and target hashes were validated
against the committed catalogue bytes at `c44e9e8be8e`, and those bytes were
verified identical to the working catalogue files before assembly.

Each locale uses the **same byte-identical multi-namespace receipt and auditor
instance** for both `ui.chat` and `ui.chat.run_details`; this is one audit per
namespace, not two independent audits of either namespace.

| Locale | Auditor instance | Receipt | Actual model recorded in receipt |
| --- | --- | --- | --- |
| zh-CN | `e55f54b6a26e` | [`e55f54b6a26e.json`](../../i18n/receipts/e55f54b6a26e.json) | `openai/gpt-6.1-sol` |
| fr | `c44e0f808e48` | [`c44e0f808e48.json`](../../i18n/receipts/c44e0f808e48.json) | `openai/gpt-6.1-sol` |
| es | `f50d87966867` | [`f50d87966867.json`](../../i18n/receipts/f50d87966867.json) | `openai/gpt-6.1-sol` |
| ru | `917e940202d4` | [`917e940202d4.json`](../../i18n/receipts/917e940202d4.json) | `openai/gpt-6.1-sol` |
| vi | `54cb9d3782eb` | [`54cb9d3782eb.json`](../../i18n/receipts/54cb9d3782eb.json) | `openai/gpt-6.1-sol` |
| ur | `1b7a2a90c876` | [`1b7a2a90c876.json`](../../i18n/receipts/1b7a2a90c876.json) | `openai/gpt-6.1-sol` |
| hi | `b858f6df97a0` | [`b858f6df97a0.json`](../../i18n/receipts/b858f6df97a0.json) | `openai/gpt-6.1-sol` |

Ledger rows and portable receipt copies were produced only by
`scripts/i18n/ledger-assemble.mjs`, with date `2026-11-03` and scope:

> five-key delta at c44e9e8be8e, previous unchanged messages retained; static linguistic/mechanical audit only, no native/pseudo-frame fit sign-off

The coordinator reports that all seven audits substantively completed on the
quota-fallback model recorded above. Receipt validation establishes internal
identity/hash consistency; it does not independently prove authorship.

## Open gates: not locale clearance

**High-visibility second independent audits and native/pseudo-rendered QA remain
open gates.** These receipts provide static linguistic/mechanical evidence only;
they do not establish measured fit, native rendering, pseudo-frame fit, or
whole-namespace linguistic reapproval. Passing ledger validation, including a
mechanically derived `audited` status, is not locale clearance and does not close
those outstanding gates.

Assembly was performed by session `9cb61d8c4e27`, actually running
`openai/gpt-6.1-sol` after provider-quota fallback from the configured
`anthropic/claude-sonnet-5-5` (with an intervening
`anthropic/claude-opus-5-5` switch). This assembly session is not an additional
translation or independent linguistic audit.
