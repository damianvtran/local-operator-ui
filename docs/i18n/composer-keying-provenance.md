# Composer surface: translation and audit provenance

Date: 2026-11-08. PR: damianvtran/local-operator-ui#1761 (branch
`i18n/composer-keying`). Catalogue revision: the commit that carries this file
plus the seven locale catalogue sets.

## What shipped

The English copy for the chat composer surface lived in 21 `ui.chat.*`
namespaces whose messages were keyed but had no translations. This change adds
all seven locales for all 21 namespaces:

- **21 namespaces, 461 English keys, 7 locales** — 147 catalogue files and
  3,227 translated values.
- `src/i18n/keys.gen.ts` regenerated so the locale bundles import the new
  catalogues (`node scripts/i18n/generate.mjs --check` is byte-identical).
- `i18n/ledger.json` gained 21 x 7 = 147 rows, every one `audited`, each bound to
  the sha256 of the English catalogue it was translated from and the sha256 of
  the translated file that was audited.
- `scripts/i18n/locale-parity.test.mjs` gained the `IDENTICAL_OK` rows this wave
  needs, in two classes: language-neutral compositions (a string that is only
  placeholders plus a separator, e.g. `ui.chat.ask_panel.filter.chip`
  `{label} · {count, number}`), and single words whose correct spelling is
  the English one in that language only (`es`/`fr` "terminal", French unit
  suffixes `h`/`s`, "Auto"/"Max"/"minimal"). Each row names its own reason.

### Namespaces and key counts

| Namespace | Keys |
| --- | --- |
| `ui.chat.approval` | 17 |
| `ui.chat.aside` | 24 |
| `ui.chat.ask_answer` | 10 |
| `ui.chat.ask_panel` | 20 |
| `ui.chat.ask_queue` | 44 |
| `ui.chat.attachment_refusal` | 15 |
| `ui.chat.composer_notes` | 14 |
| `ui.chat.credential_notice` | 15 |
| `ui.chat.device_move` | 24 |
| `ui.chat.fast_mode` | 10 |
| `ui.chat.header_menu` | 12 |
| `ui.chat.interrupt` | 6 |
| `ui.chat.message_budget` | 10 |
| `ui.chat.move_cwd` | 8 |
| `ui.chat.page_chrome` | 26 |
| `ui.chat.quota_resend` | 7 |
| `ui.chat.read_ack` | 16 |
| `ui.chat.session_readout` | 54 |
| `ui.chat.session_spend` | 32 |
| `ui.chat.sidebar_notes` | 8 |
| `ui.chat.slash` | 89 |
| **Total** | **461** |

## Audit chain

Every row is backed by an independent translation-auditor receipt, copied into
`i18n/receipts/<instance>.json`. Auditors were separate sessions from the
translators; each receipt names the English and target sha256 it read, so the
ledger gate can prove the bytes on disk are the bytes that were audited.

Where a namespace changed after its first audit (remediation rounds), the
receipt for the newer bytes is the one on the row: `s3d` (remediation) beats
`s3c` (final), which beats `s3b` (batch B1), which beats `s3a` (batch A). A
namespace whose bytes are byte-identical to an earlier wave's audit keeps that
receipt - the audit still names the bytes that ship.

### French (`fr`)

| Receipt instance | Wave | Auditor model | Namespaces covered (count) | Result |
| --- | --- | --- | --- | --- |
| `c072f24e-s3d-fr` | s3d | `deepseek/deepseek-flash` | `ask_answer`, `ask_queue`, `attachment_refusal`, `composer_notes`, `device_move`, `message_budget`, `move_cwd`, `read_ack`, `session_readout`, `session_spend`, `sidebar_notes` (11) | clean-with-findings |
| `564797e3-s3c-fr` | s3c | `deepseek/deepseek-flash` | `approval`, `aside`, `ask_panel`, `credential_notice`, `quota_resend` (5) | clean-with-findings |
| `5a82e837-s3b-fr` | s3b | `anthropic/claude-sonnet-5-5` | `fast_mode`, `header_menu`, `interrupt`, `page_chrome`, `slash` (5) | clean-with-findings |

### Spanish (`es`)

| Receipt instance | Wave | Auditor model | Namespaces covered (count) | Result |
| --- | --- | --- | --- | --- |
| `f212882f-s3d-es` | s3d | `deepseek/deepseek-flash` | `ask_panel`, `credential_notice`, `read_ack` (3) | clean-with-findings |
| `ebc5b152-s3c-es` | s3c | `anthropic/claude-sonnet-5-5` | `approval`, `aside`, `ask_answer`, `ask_queue`, `attachment_refusal`, `composer_notes`, `message_budget`, `move_cwd`, `quota_resend`, `session_readout`, `sidebar_notes`, `slash` (12) | clean |
| `aeba270e-s3b-es` | s3b | `anthropic/claude-sonnet-5-5` | `device_move`, `fast_mode`, `header_menu`, `interrupt`, `page_chrome`, `session_spend` (6) | clean |

### Simplified Chinese (`zh-CN`)

| Receipt instance | Wave | Auditor model | Namespaces covered (count) | Result |
| --- | --- | --- | --- | --- |
| `0d833311-s3d-zh-cn` | s3d | `deepseek/deepseek-flash` | `ask_panel`, `ask_queue`, `composer_notes`, `move_cwd`, `read_ack`, `sidebar_notes` (6) | clean-with-findings |
| `7c3e91d4-s3c-zh-cn` | s3c | `anthropic/claude-sonnet-5-5` | `approval`, `ask_answer`, `attachment_refusal`, `credential_notice`, `header_menu`, `message_budget`, `quota_resend` (7) | clean-with-findings |
| `950edccf-s3b-zh-cn` | s3b | `anthropic/claude-sonnet-5-5` | `aside`, `device_move`, `fast_mode`, `interrupt`, `page_chrome`, `session_readout`, `session_spend`, `slash` (8) | clean-with-findings |

### Russian (`ru`)

| Receipt instance | Wave | Auditor model | Namespaces covered (count) | Result |
| --- | --- | --- | --- | --- |
| `e6498c6d-s3d-ru` | s3d | `anthropic/claude-sonnet-5-5` | `aside`, `ask_queue`, `credential_notice`, `session_readout` (4) | clean-with-findings |
| `3a7aab10-s3c-ru` | s3c | `anthropic/claude-sonnet-5-5` | `approval`, `ask_answer`, `ask_panel`, `attachment_refusal`, `composer_notes`, `device_move`, `message_budget`, `move_cwd`, `quota_resend`, `read_ack`, `session_spend`, `sidebar_notes` (12) | clean |
| `9487efcb-s3b-ru` | s3b | `anthropic/claude-sonnet-5-5` | `fast_mode`, `header_menu`, `interrupt`, `page_chrome`, `slash` (5) | clean |

### Vietnamese (`vi`)

| Receipt instance | Wave | Auditor model | Namespaces covered (count) | Result |
| --- | --- | --- | --- | --- |
| `91291702-s3d-vi` | s3d | `deepseek/deepseek-flash` | `ask_panel`, `attachment_refusal`, `composer_notes`, `credential_notice`, `session_readout` (5) | clean-with-findings |
| `97ea8fa7-s3c-vi` | s3c | `anthropic/claude-sonnet-5-5` | `approval`, `aside`, `ask_answer`, `ask_queue`, `device_move`, `header_menu`, `message_budget`, `move_cwd`, `quota_resend`, `read_ack`, `session_spend`, `sidebar_notes` (12) | clean-with-findings |
| `6f85fce0-s3b-vi` | s3b | `anthropic/claude-sonnet-5-5` | `fast_mode`, `interrupt`, `page_chrome`, `slash` (4) | clean-with-findings |

### Urdu (`ur`)

| Receipt instance | Wave | Auditor model | Namespaces covered (count) | Result |
| --- | --- | --- | --- | --- |
| `cf2017e0-s3d-ur` | s3d | `deepseek/deepseek-flash` | `ask_panel`, `composer_notes`, `read_ack` (3) | clean-with-findings |
| `3e9c47b1-s3c-ur` | s3c | `deepseek/deepseek-flash` | `approval`, `ask_answer`, `ask_queue`, `attachment_refusal`, `credential_notice`, `message_budget`, `move_cwd`, `quota_resend`, `sidebar_notes`, `slash` (10) | clean-with-findings |
| `c4e7a91d-s3b-ur` | s3b | `anthropic/claude-sonnet-5-5` | `aside`, `device_move`, `fast_mode`, `header_menu`, `interrupt`, `page_chrome`, `session_readout`, `session_spend` (8) | clean-with-findings |

### Hindi (`hi`)

| Receipt instance | Wave | Auditor model | Namespaces covered (count) | Result |
| --- | --- | --- | --- | --- |
| `bdda47ec-s3d-hi` | s3d | `deepseek/deepseek-flash` | `device_move` (1) | clean-with-findings |
| `cbb5be6a-s3c-hi` | s3c | `deepseek/deepseek-flash` | `approval`, `aside`, `ask_answer`, `ask_panel`, `ask_queue`, `attachment_refusal`, `composer_notes`, `credential_notice`, `message_budget`, `move_cwd`, `quota_resend`, `read_ack`, `session_readout`, `session_spend`, `sidebar_notes` (15) | clean-with-findings |
| `d967d245-s3b-hi` | s3b | `anthropic/claude-sonnet-5-5` | `fast_mode`, `header_menu`, `interrupt`, `page_chrome`, `slash` (5) | clean |

Per-receipt verdicts, checks and finding counts are in the receipts themselves;
this document summarises the chain, it does not restate the evidence.

## Ledger scheme

- **translator**: agent `translator`, model `deepseek/deepseek-flash`. The note
  on each row records the real history rather than a tidy single model: the
  waves were translated by translator subagents, all wave and remediation
  findings were applied, and provider-quota fallbacks meant some turns ran as
  `anthropic/claude-opus-5-5`, `openai/gpt-6.1-sol` or `deepseek/deepseek-flash`
  — each receipt carries its own model provenance.
- **auditor**: derived from the receipt itself (agent, model, instance, receipt
  path and receipt sha256); `ledger-assemble.mjs` refuses a receipt that does
  not name the bytes on disk, so a row cannot claim an audit of an older file.
- Rows were written by `node scripts/i18n/ledger-assemble.mjs` only. No ledger
  JSON was hand-edited; every hash and every status in this change was derived
  by that tool from the files and the receipts.

## Code-side fixes that landed with the copy (commit `7540e3cbc9d`)

Translating the composer exposed two rendering faults that are not translation
defects, so they were fixed in code, once, before the catalogues shipped:

1. **Urdu bidi isolation in `translate()`** (`src/i18n/bidi.ts`). In an
   RTL paragraph a Latin token that opens with a neutral sigil paints with the
   sigil on the wrong side: `/model` reads `model/`, `$name` reads `name$`, a
   value-fed `/move <path>` reads `<move <path/`, and `⌘Z` reads `Z⌘`. The cause
   is the Unicode bidi algorithm's rule N2, not the text. `translate()` now
   wraps Latin-led string arguments in FSI/PDI and literal sigil tokens in
   LRI/PDI, for RTL-answered messages only; LTR output is byte-identical to
   before. It is fixed at this seam rather than in the catalogue because the
   `ur` values are gated against bidi controls, and a sigil arriving inside a
   placeholder value is not in the catalogue at all. `translateRaw` exists for
   text that leaves the UI as data (clipboard, file names, model prompts), where
   an invisible U+2066/U+2068/U+2069 would travel with it.
2. **Locale-aware list joiners** (`src/i18n/format.ts`). Several sentences
   spliced lists with an ASCII `", "` or `"; "` in every language.
   `formatList`/`formatClauses` now use the locale's own separators
   (`Intl.ListFormat`), and the call sites that hand-joined provider lists in the
   model picker, the status strip and the session readout use them.
3. **Effort words as copy** (`session-status/session-model.ts` and the effort
   pickers). Level labels (`auto`, `max`, `minimal`, ...) are copy keys, not wire
   values; `effortDisplay` returns the localized label for a level it knows and
   passes any other token through unchanged, so an unknown rung is not silently
   translated.

## Carried deferrals

Raised during the composer waves and deliberately not fixed here:

- `ui.chat.question_dock.hint.approval` (a key in the already-shipped `ui.chat`
  namespace, not in this wave's 21) names `Approve`/`Deny` in every locale but
  `hi`, which translates them; the hint needs a decision about which label pair
  it should match, not a translation fix.
- Effort-chip width in `ru`, `fr` and `vi` (longer localized level labels than
  the chip was measured with).
- Narrow-chip rendered checks for `zh-CN` and `vi` (the chips were checked at
  default width only).
- `hi`/`ur` oblique (case) forms are fed into shipped mesh keys from code; the
  mesh copy uses the nominative form, so a case-marked argument reads as a bare
  noun in those two languages.
- `vi` `xHigh`: the chip shows the level word while the sidecar note spells the
  rung out; the two need to agree.

## Honest gaps

- **No rendered narrow-chip pass yet.** The translations are verified against
  the English source, the ICU AST, the style guides and per-key reads; they are
  not yet verified in a rendered UI at narrow widths. Rendered per-surface
  frames (loading, empty, error, populated, narrow) are the next lane for this
  surface, and this change does not claim them.
- Width and overflow claims in this document are stated as deferrals, not as
  measurements.
