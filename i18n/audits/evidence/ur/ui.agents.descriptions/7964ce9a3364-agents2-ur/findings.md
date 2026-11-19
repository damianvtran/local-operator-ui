# Independent re-audit — ur — Agents page card blurbs and install labels (round 2)

- **Instance:** `7964ce9a3364-agents2-ur`
- **Auditor:** `i18n-auditor` · session `7964ce9a3364` · model `radient/auto`
  (primary `anthropic/claude-sonnet-5-5` failed on provider quota; the session fell back
  `openai/gpt-6-astra` → `kimi/k3.1-pro` → `radient/auto` before this audit ran)
- **Translator:** session `3ef6295a5545` — a different session; this auditor wrote none of the values.
- **Round 1:** session `6e52b52fd913`, CHANGES_REQUESTED. Its receipt was the claim list, not evidence:
  every claim was re-verified against the current bytes.
- **Date:** 2026-10-30
- **Scope:** `ui.agents.descriptions` (12 values), `ui.agents.detail.install` (2 values)
- **Verdict: PASS** — 0 BLOCKER, 0 MAJOR, 3 MINOR, 1 NIT. All 16 round-1 findings fixed; one new
  MINOR was introduced by the correction itself.

Judged against `i18n/glossary.md`, `i18n/style-guides/ur.md`, the English source and its
`*.context.json` sidecars (role, tone, width: "one roster line at 256 px, truncated with an
ellipsis; the detail page wraps the same sentence").

## Mechanical (run, not assumed)

| Check | Result |
|---|---|
| ICU parse, both targets and both English sources | `@formatjs/icu-messageformat-parser` from the repo's own `node_modules`: 12 + 2 keys parsed, exit 0, zero ICU arguments (none in English either) |
| ICU arguments / placeholders | none in any value, English or Urdu — placeholder parity is vacuous, not unchecked |
| Key parity and order | 12/12 and 2/2, order identical to English |
| JSON valid | both files |
| NFC | all 14 values |
| Literal bidi controls (RLM/LRM/FSI/PDI) | none — the render layer inserts isolation; a literal one would be applied twice |
| Arabic-form letters (U+064A, U+0643, U+0649, U+0629, U+0640) | none; Urdu ی/ک throughout |
| Terminal punctuation | ۔ on all 12 descriptions, … (U+2026) on `installing`, ؛ and ، where the source has them, no ASCII full stop or comma |
| Latin tokens | AI · C · D · T · U · UX · QA · MR · PR · diff · Unicode — none added, none lost |
| Identical to English | 0 |
| Line endings / indent | LF, tab, trailing newline |

Exact commands: `shasum -a 256` on the four handed-over files;
`node --input-type=module -e '… @formatjs/icu-messageformat-parser'` from the repo root over
`ui.agents.descriptions.json`, `ui.agents.detail.install.json` and the two repo English files
(exit 0); a python pass over key parity, NFC, bidi controls, letter forms, punctuation, token
inventory and cell counts; and `json.load(repo en) == json.load(handed-over en)` → True for both
(the copies are re-indented, not rewritten).

**Not run, and why:** `generate.mjs --check`, `check-strings`, `ledger-check` and
`ledger-assemble` would report on other files, because the ur catalogues are not in
`src/i18n/catalogues/ur` yet — ledger assembly belongs to the requesting session once they land.
No rendered capture: a two-namespace copy audit does not draw them; fit below is measured in
characters, not pixels.

## Findings

### G1 · MINOR · reviewer + qa_tester — "independent" now has two forms
`diff، MR یا PR کا آزادانہ کوڈ جائزہ:…` against `تبدیلی کے اجرا کا آزاد ثبوت:…`.
The F2 correction changed qa_tester from `آزادانہ` to `آزاد`; reviewer kept `آزادانہ`. The one
attributive precedent in the ur catalogues is `آزاد` (`ui.settings.integrations.json:36`,
«…جو اپنے کرالر کے ساتھ ایک آزاد ویب انڈیکس ہے»); `آزادانہ` occurs nowhere else.
**Fix:** `diff، MR یا PR کا آزاد کوڈ جائزہ` — or revert qa_tester; one form across the roster.
*Introduced by this round's correction.*

### G2 · MINOR · ux_reviewer — کو with an intransitive verb
`تبدیلی کے حقیقی فلو کو شروع سے آخر تک چلتا ہے:…`
چلنا is intransitive and کو marks a direct object, so the clause is ungrammatical. Every
`کو + چل` form in the catalogue is چلانا (running an app or job) or a dative subject
(«کام کو … چاہیے»), never "walks X". The meaning survives, so this is polish, not a claim error.
Fix: `تبدیلی کے حقیقی فلو میں شروع سے آخر تک چلتا ہے` (154 chars, ratio 1.14), or
`…فلو سے شروع سے آخر تک گزرتا ہے`.
*Pre-existing; round 1 did not report it.*

*Pre-existing; round 1 did not report it.*

### G3 · MINOR · librarian — نام بنانا is the reputation idiom
`آپ کے رکھے اثاثوں کے نام، تفصیل اور ٹیگ بناتا ہے،…`
`نام بنانا` means "to make a name for oneself"; naming is `نام دینا` or `نام رکھنا`. Compressing
"names, describes and tags" under one بنانا puts a reputation phrase where a metadata action
belongs — the defect class round 1 raised for کاپی, in milder form.
Fix: `آپ کے رکھے اثاثوں کو نام اور تفصیل دیتا ہے اور ٹیگ لگاتا ہے` (166 chars, ratio 1.11), or the
fuller `…کے نام رکھتا ہے، ان کی تفصیل لکھتا ہے اور ٹیگ لگاتا ہے` (ratio 1.18).
*Pre-existing; round 1 did not report it.*

### Why G2 and G3 are MINOR, not MAJOR
Both are comprehension-preserving. Round 1 graded the same class (F7 noun/pronoun agreement, F11
idiom) as MINOR, and this round keeps that ladder: a grammar or collocation slip that does not
mislead the reader is MINOR, a term that misleads them (F1 کاپی, F2 اجرائی) is MAJOR.

### G4 · NIT · scout — صرف پڑھنے والی can read "worth reading"
`صرف پڑھنے والی تحقیق:…` — `پڑھنے والی` also marks something worth reading (پڑھنے والی کتاب), so
the head term flickers before `کچھ نہیں بدلتا` settles it.
Fix: `صرف پڑھنے تک محدود تحقیق:…` — the head grows 20 → 24 chars and the whole value still lands
at ratio 0.99.

## Fit (characters, English → Urdu)

| Key | en | ur | ratio |
|---|---|---|---|
| aida | 122 | 117 | 0.96 |
| architect | 136 | 149 | 1.10 |
| coder | 121 | 120 | 0.99 |
| copy_reviewer | 177 | 182 | 1.03 |
| designer | 123 | 135 | 1.10 |
| librarian | 150 | 155 | 1.03 |
| manager | 115 | 113 | 0.98 |
| qa_tester | 165 | 171 | 1.04 |
| reviewer | 126 | 150 | 1.19 |
| scout | 133 | 128 | 0.96 |
| tui_designer | 178 | 185 | 1.04 |
| ux_reviewer | 135 | 153 | 1.13 |
| install_to_edit | 15 | 24 | 1.6 |
| installing | 11 | 17 | 1.55 |

No description exceeds the roster's 256 px single-line budget by a margin that would break the
card: reviewer at 150 cells is the widest and truncates with the ellipsis the sidecar specifies.
`install_to_edit` at 24 cells is a secondary button label in a header, and the swap to
`installing` (17) shrinks the row rather than pushing it.

## Round-1 verification

All 16 findings are fixed on the bytes; none remain open. Per-finding evidence:
`round1-claims.md` beside this report.
