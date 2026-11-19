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

## Second independent high-visibility delta audits

All seven second-auditor receipts derive a clean result with zero findings for
both namespaces. Source and target hashes were checked against the committed
catalogue bytes at `19868532b9c`, identical to the working catalogue bytes.
Auditor instances and models below were read from the receipts, including the
instance suffixes; they were not reconstructed from session IDs.

| Locale | Second auditor instance | Canonical receipt | Model recorded in receipt |
| --- | --- | --- | --- |
| zh-CN | `6433b7a5b3e9` | [`6433b7a5b3e9.json`](../../i18n/receipts/6433b7a5b3e9.json) | `openai/gpt-6.1-sol` |
| fr | `35aac0a677bc` | [`35aac0a677bc.json`](../../i18n/receipts/35aac0a677bc.json) | `openai/gpt-6.1-sol` |
| es | `es2-ac9ef02a0918` | [`es2-ac9ef02a0918.json`](../../i18n/receipts/es2-ac9ef02a0918.json) | `openai/gpt-6.1-sol` |
| ru | `97bb3462a65c-ru-census-r2` | [`97bb3462a65c-ru-census-r2.json`](../../i18n/receipts/97bb3462a65c-ru-census-r2.json) | `openai/gpt-6.1-sol` |
| vi | `6431174917d4-vi-census-r2` | [`6431174917d4-vi-census-r2.json`](../../i18n/receipts/6431174917d4-vi-census-r2.json) | `openai/gpt-6.1-sol` |
| ur | `25304c88781e-ur-census-second` | [`25304c88781e-ur-census-second.json`](../../i18n/receipts/25304c88781e-ur-census-second.json) | `openai/gpt-6.1-sol` |
| hi | `786d3d9ff0bb-hi-census-r2` | [`786d3d9ff0bb-hi-census-r2.json`](../../i18n/receipts/786d3d9ff0bb-hi-census-r2.json) | `openai/gpt-6.1-sol` |

The same immutable multi-namespace receipt backs both rows for each locale.
The first audits, baseline translator metadata, and superseded history are
unchanged. Every affected row now has two distinct current-byte auditor
instances; this records two static delta audits, not a new whole-namespace audit.
The second audit entries were appended only by `ledger-assemble.mjs`, dated
`2026-11-03`, with scope:

> second independent high-visibility five-key delta at 19868532b9c, previous unchanged messages retained; static linguistic/mechanical audit only, no native/pseudo-frame fit sign-off

Auditor-written companion records, mechanical results, scripts and execution
logs are retained byte-for-byte under
[`i18n/audit-evidence/census-five-key-second/`](../../i18n/audit-evidence/census-five-key-second/).
The [manifest](../../i18n/audit-evidence/census-five-key-second/manifest.json)
maps each locale's canonical receipt to the original companion paths and their
SHA-256 hashes. These are preserved historical artifacts, not rewritten logs or
claims that this assembly session reran their commands. Scratch-only copies of
repository modules and catalogue inputs were not duplicated except where the
auditor supplied an aggregate input artifact.

## Open gates: not locale clearance

**The high-visibility second static audit gate is recorded; native/pseudo-rendered
QA and code/design review gates remain pending.** These receipts provide static
linguistic/mechanical evidence only; they do not establish measured fit, native
rendering, pseudo-frame fit, or whole-namespace linguistic reapproval. Passing
ledger validation, including a mechanically derived `audited` status, is not
locale clearance or language completion and does not close those outstanding
gates.

Assembly was performed by session `9cb61d8c4e27`, actually running
`openai/gpt-6.1-sol` after provider-quota fallback from the configured
`anthropic/claude-sonnet-5-5` (with an intervening
`anthropic/claude-opus-5-5` switch). This assembly session is not an additional
translation or independent linguistic audit.
