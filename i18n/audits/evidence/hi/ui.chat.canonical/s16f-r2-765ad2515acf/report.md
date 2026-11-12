# s16f — Hindi (`hi`) independent translation audit, ROUND 2 (landed bytes)

- **Auditor:** `i18n-auditor` (this run) · **Session:** `765ad2515acf` ·
  **Model:** `deepseek/deepseek-flash` (the model this session is running on —
  harness session header; no fallback, no model switch, no role/default pin).
- **Independence:** not the translator (`i18n-translator`,
  `anthropic/claude-sonnet-5-5`), and **not** the round-1 auditor of `hi`
  (session `cb317bf0f7e3`, which I did not run in and whose report I read only as
  input). This is the first independent read of the *corrected* values.
- **Date:** 2026-11-11 · **Namespace:** `ui.chat.canonical` · **Keys:** 10 (S16f)
- **PR:** #1876 · **Worktree (read-only):**
  `~/local-operator-ui/.worktrees/i18n-s16a` @
  `9931d62addf8a0606bb26d32a8bc163dc7c126b3` — `git rev-parse HEAD` matched and
  `git status --porcelain` was empty before and after this run.
- **Read-only compliance:** no edits, commits, pushes or PR posts. All commands
  ran in my own scratch mirror (`git archive HEAD` of `scripts/`, `src/`,
  `i18n/` + configs; `node_modules` **symlinked** to the shared tree, never
  installed). Nothing was written into the repository.

## Verdict

**`clean-with-findings`** — `{blocker: 0, major: 0, minor: 0, nit: 2}`.

All ten values are accurate, correctly registered, terminologically consistent
with their own namespace's precedents, and narrower than English everywhere it
matters. Both round-1 corrections (`पूरा हुआ`, `रोका गया`) are right and I accept
them. The two NITs are word-count deviations from prose budgets in the sidecar
with no fit consequence; both are accepted as-is and recorded rather than
churned. Nothing is left in English beyond ICU syntax and the mandated `$0`.

## Inputs and hashes (SHA-256)

| input | path | sha256 |
|---|---|---|
| English catalogue (whole file, 466 keys) | `src/i18n/catalogues/en/ui.chat.canonical.json` | `12ec2698434dcb39497e288af62d11d70f0fd71d494a9becf3fd611d6568bbdd` |
| Hindi catalogue (whole file, 466 keys, landed) | `src/i18n/catalogues/hi/ui.chat.canonical.json` | `37bca60d5a5ee2d1f19bbaed857e5294ecdb125f56dfd11170723341c4459063` |
| Context sidecar | `src/i18n/catalogues/en/ui.chat.canonical.context.json` | `95aa203759416c93180b7eb4967e6fcf5bce0dffe20e9d005b431c645e9e11e6` |
| **10 English pairs** (sorted-key compact UTF-8 JSON) | as above | `bdd1d9d1cfcd327c7445396ad806220fa850fe820c638a59ec6bc195f882e307` |
| **10 Hindi pairs** (same canonicalisation) | as above | `c932e7336c1f59ca0acd2aaa1effb0651de98722ed08bb7dd53db5f391471a80` |
| Glossary | `~/local-operator/i18n/glossary.md` | `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8` |
| Hindi style guide | `~/local-operator/i18n/style-guides/hi.md` | `82292dc8d13fcc93dc752457719264aed3cc20bb65ecfaba0f0e5a31f4cb40d5` |

Per-key Hindi pair hashes (sorted-key compact, single value):

| key | sha256 |
|---|---|
| `…sound.batch.item_status` | `368a777b3a4cb949436c06036724b9b88e4dec0de15491d871e634224201ffc9` |
| `…sound.batch.summary` | `092dd484f59d1d867a9c2c93ab63f01e8a96dbafbfc8aea28adb71bd47e3755e` |
| `…sound.batch.latest_update` | `126373e605306ac85212c60ea037b6349e7174ceaeb427fbae8834db8278a140` |
| `…sound.cost.unknown` | `849d676bd986619273575e06e4b234034ea7b7839cf9b7fa6b330ab1c03a2748` |
| `…sound.cost.no_charge` | `32d6bf4584a6a5c65c769bb590258e086f3011dfdf41266ff58cb56331bb3338` |
| `…sound.cost.estimated_zero` | `6135552690f8529451ccb80a8bf052762f1d80fa577d665f09441506a8e28082` |
| `…sound.cost.batch_unknown` | `b854361afbdfd705efd9c680a1dd810b9c7a96afb079b4ed95808b36622283fe` |
| `…media.image_label` | `7596eb25cec0015bc957c44e41d008fb800f95438420fd2b98bbd828e15714af` |
| `…media.sound_label` | `acfe25ff249209937c520f09410ac8b67102b15c7de9937089dd4561b9296959` |
| `…supplement.sound_fallback_label` | `2234383c7a898462e17e35564abbe65361a5ecec2c5b266adf5d930fa3573700` |

## 1. Mechanical

### Repo validators (scratch mirror of `9931d62`)

| check | ACTUAL result |
|---|---|
| `node scripts/i18n/generate.mjs --check` | `src/i18n/keys.gen.ts is byte-identical to a fresh generation.` (exit 0) |
| `node scripts/i18n/check-coverage.mjs` | `coverage-check: ok — 7 gated language(s) over 158 namespace(s); 0 allowed key(s) remain across 0 pair(s)` (exit 0) |
| `node scripts/i18n/check-duplicates.mjs` | `ok — 1428 file(s) scanned, 0 duplicate key(s)` (exit 0) |
| `node scripts/i18n/context-parity.mjs` | `ok — every English key is covered, apart from 129 allowed gap(s) in 4 namespace(s)` (exit 0) |
| `node --test scripts/i18n/locale-parity.test.mjs` | 44 pass / 0 fail (all seven locales, including the six `[hi]` rows) |
| `node --test scripts/i18n/generation-card-labels.test.mjs` | 27 pass / 0 fail |
| key parity, whole namespace | 466 hi keys vs 466 en keys — 0 missing, 0 extra, 0 empty, 0 duplicates; valid JSON |
| `…/ledger-check.mjs` (before my receipt) | 3 findings for `hi` (stale source, stale target, receipt does not name the en bytes) — integration state; fixed by the receipt below |

### My own grid (own checker, `check-hi-s16f-r2.mjs`)

Parsed with `@formatjs/icu-messageformat-parser` and rendered with
`IntlMessageFormat` — the classes `src/i18n/messages.ts` constructs.

- **Grid:** counts `0,1,2,3,5,11,21,22,100,1000,1000000` × statuses
  `failed/cancelled/other` × `has_attention yes/no` → **594 summary renders**,
  plus item rows per status (Latin and Devanagari names), `latest_update` from
  1/1 to 1000000/1000000, both media labels (`=1` and numbered, 1…999), and the
  four cost lines.
- No throw; no leftover `{`, `}`, `#`, `undefined`, `NaN`, `[object`; no stray
  FSI/`Cf`; NFC on every value; `$0` kept; `::group-off` honoured
  (`1000` renders `1000`, never `1,000`).
- **Placeholders:** names *and* types identical to English for all ten keys
  (`status`, `label`, `completed`, `failed`, `cancelled`, `unknown`,
  `has_attention`, `labels`, `name`, `item`, `total`, `count`, `position`; every
  count is `number`). Arm sets identical to English key by key
  (`item_status` `failed|cancelled|other`; `summary` `one|other` for completed and
  failed, `=0|one|other` for cancelled and unknown, `yes|other` for
  has_attention; both media labels `=1|other`).
- **CLDR:** hi resolves `one,other`; both arms are present wherever the message
  selects by category. The media labels keep the source's `=1`/`other` shape
  (there `=1` *is* the singular selector; a `one` arm added on top would make
  `count=0` render singular, which the source does not ask for).
- **Negative controls (in-memory mutants):** dropped placeholder, missing `one`
  arm, English leftover (`Failed`), broken ICU (unbalanced brace), polarity flip
  (`शुल्क लगेगा।` for "No charge.") — **5/5 caught**; the checker exits 2 if any
  mutant goes unnoticed. Run on the landed file: `PASS — … 5/5 controls caught`.

## 2. Accuracy and idiom, key by key

| key | landed hi | ruling |
|---|---|---|
| `sound.batch.item_status` | `{label} · विफल` / `· रोका गया` / `· स्थिति अज्ञात` | **pass.** State after the name with the source's ` · ` separator; `no punctuation` and "one or two words" honoured. `विफल` = `tool_row.outcome.failed`; `रोका गया` = `transcript.interrupted` **and** `tool_row.outcome.interrupted`; `स्थिति अज्ञात` = `ui.ownerAudit.unknown_status`. `other` reads as unknown, never as success or failure. |
| `sound.batch.summary` | `पूरा हुआ: N · विफल: N · रोका गया/रोके गए: N · स्थिति अज्ञात: N। ध्यान देने की ज़रूरत: {labels}` | **pass.** Completed and failed always print (0 included); cancelled/unknown hidden by the empty `=0` arms. `।` before the attention list exactly where English has `.`; the source has no trailing stop either, so parity holds. `ध्यान देने की ज़रूरत` = `ui.nativeBadge.attention`; `पूरा हुआ` = `turn_summary.completed`; the one/other pair matches `ui.shell.rail.console.aria_count`'s `{count} पूरा हुआ / पूरे हुए` agreement. |
| `sound.batch.latest_update` | `नवीनतम अपडेट: {name} (कुल {total} में से आइटम {item})।` | **pass.** Mirrors the house pattern `lightbox.show_image` = `कुल {count} में से तस्वीर {index} दिखाएँ`; `आइटम` = `image_gen.batch_summary`. Says which item reported last, not a completion count. |
| `sound.cost.unknown` | `लागत अभी पता नहीं है।` | **pass.** Only says no amount was reported yet; promises nothing. `लागत` = glossary §2 cost. |
| `sound.cost.no_charge` | `कोई शुल्क नहीं।` | **pass.** Plain zero-charge statement; no charge asserted, no polarity slip. `शुल्क` = charge (`sound.stop.warning`). NIT H2-2 on the word budget. |
| `sound.cost.estimated_zero` | `अनुमानित लागत $0; अंतिम शुल्क की पुष्टि नहीं हुई।` | **pass.** Keeps the estimate sense and the semicolon the sidecar names; `$0` verbatim, currency sign before the numeral, no space — as Hindi writes it. Not shortened to "No charge". |
| `sound.cost.batch_unknown` | `कुल लागत अभी पता नहीं है।` | **pass.** Sibling of the per-row line, distinguished by `कुल` exactly as English distinguishes "Total cost". |
| `media.image_label` | `तस्वीर` / `तस्वीर {position}` | **pass.** `तस्वीर` is the house word (95 occurrences; `lightbox.show_image`). Lone picture unnumbered; numbered branch is a label, not a count phrase, so no plural is wanted. |
| `media.sound_label` | `साउंड` / `साउंड {position}` | **pass.** `साउंड` is this surface's word (`sound.player_failed`, `image_gen.state.sound_effect`); spliced into `ui.chat.audio.play_label` it reads `साउंड 2 चलाएँ`. The notification-sound `ध्वनि` is a different namespace's established word, not a conflict to fix here. |
| `supplement.sound_fallback_label` | `बनाया गया साउंड` | **pass.** `बनाया गया` is the catalogue's own created verb (`agents.config.result.created`); the Sanskritised `निर्मित` would be the wrong register per the hi guide. NIT H2-1 on the word budget. |

### Round-1 corrections, judged on their merits

- `summary` `one` arms → `पूरा हुआ` / `रोका गया` (were copies of `other`): **accept.**
  hi `one` covers 0 and 1, so a count of 1 must print the singular, and a count of
  0 ("0 फ़ाइल" per style guide §Plurals) likewise. My grid confirms the payoff:
  `cancelled=1` renders `रोका गया: 1` — the *same word* the row above prints for
  that item (`Birdsong · रोका गया`) — where the draft said `रोके गए: 1`. The `other`
  arms (`पूरे हुए`, `रोके गए`) are the correct plural forms.
- No other `hi` correction was applied to the landed bytes; the nine other values
  are the translator's draft, which I have now read independently and accept.

### Accepted observations (not findings)

- **Clause order.** The summary writes `state: count` where English writes
  `count state`. The sidecar lets each language choose its punctuation and clause
  shape, and the uniform label-first form is what keeps `स्थिति अज्ञात: 1` from
  reading as "1 unknown-status"; `विफल` and `स्थिति अज्ञात` are invariant, so the
  arms stay identical on purpose. No change.
- **Media labels** keep `=1`/`other` rather than gaining a `one` category arm —
  matching the source and the repo parity rule; here `=1` is the singular
  selector.

## 3. Fit / width (rendered cell widths; Devanagari counts optimistically)

| key | hi (worst render) | cells | English | cells | where it renders |
|---|---|---|---|---|---|
| `sound.batch.item_status` | `Birdsong at dawn · रोका गया` | 27 | `Birdsong at dawn · Stopped` | 26 | row title, `text-body … break-words [overflow-wrap:anywhere]` (wraps) |
| `sound.batch.summary` | 4 clauses at 1000 + attention names | **112** | `1000 completed · 1000 failed · …` + names | 117 | `text-meta` paragraph, first text of the card (wraps) |
| `sound.batch.latest_update` | `नवीनतम अपडेट: {name} (कुल 1000 में से आइटम 1000)।` | 59 | `Latest update: {name} (item 1000 of 1000).` | 52 | live note under the state line (wraps) |
| `sound.cost.unknown` | `लागत अभी पता नहीं है।` | 21 | `Cost not yet known.` | 19 | per-row `text-meta` |
| `sound.cost.no_charge` | `कोई शुल्क नहीं।` | 15 | `No charge.` | 10 | per-row `text-meta` |
| `sound.cost.estimated_zero` | `अनुमानित लागत $0; अंतिम शुल्क की पुष्टि नहीं हुई।` | 49 | `Estimated cost $0; final charge not confirmed.` | 46 | per-row `text-meta`, batch caption |
| `sound.cost.batch_unknown` | `कुल लागत अभी पता नहीं है।` | 25 | `Total cost not yet known.` | 25 | batch total line |
| `media.image_label` | `तस्वीर 999` | 10 | `Image 999` | 9 | `<img alt>`, tile name, lightbox label |
| `media.sound_label` | `साउंड 999` | 9 | `Sound 999` | 9 | player play/pause accessible name |
| `supplement.sound_fallback_label` | `बनाया गया साउंड` | 15 | `Generated sound` | 15 | player control line (`truncate`) |

The sidecar declares no `maxCells` for this group, only prose budgets; the summary
paragraph — the widest string — is 5 cells *narrower* than English, and every
other line either matches English or is a short one-liner that wraps or
truncates. No wide-glyph or combining-mark risk: Latin digits, no `Cf`, no
joiners.

**RTL:** not applicable (`hi` is LTR). The name in `item_status` and
`latest_update` is user data spliced as an argument and isolated by the runtime
(`src/i18n/bidi.ts`), so no bidi control belongs in the copy — none is present.

## 4. Nothing left English

No Latin letters in any of the ten values outside ICU syntax (`status, select,
failed, label, …`) and the mandated `$0`. No named exceptions beyond `$0`.
`identicalToEn` is false for all ten.

## 5. Findings

### H2-1 — NIT — `ui.chat.canonical.supplement.sound_fallback_label`

Current `बनाया गया साउंड`. The sidecar asks for "Two words"; this is three. It
measures 15 cells — exactly the English width — on a `truncate` control line, so
there is no overflow. The only two-word alternatives are worse: `निर्मित साउंड`
(13 cells) is the Sanskritised register the hi guide tells us to avoid, and
`जनरेट किया गया साउंड` is longer. `बनाया गया` is the catalogue's own created verb.
**Disposition: accepted as-is; recorded so the deviation is visible.** (Carried
from round 1, independently re-measured.)

### H2-2 — NIT — `ui.chat.canonical.sound.cost.no_charge`

Current `कोई शुल्क नहीं।`. The sidecar asks for "One or two words"; this is three,
15 cells against English 10. It is the house negation pattern for a zero charge
(`ui.providers…use_your_claude_pro_or_max_plan` = `कोई अतिरिक्त शुल्क नहीं।`); the
two-word `शुल्क नहीं` is clipped and reads as a fragment. This also **corrects the
round-1 fit table**, which listed this string as 10 cells — it is 15. No fit
consequence on a one-line meta caption.
**Disposition: accepted as-is.**

## 6. Receipt (ledger-ready) and the command the integrator runs

Receipt written to my scratchpad: `receipt-hi-s16f-r2.json`
(`instance` `765ad2515acf-hi-s16f-r2`; binds the **landed** en
`12ec2698434d…` and hi `37bca60d5a5e…` bytes plus the sidecar; `status: passed`,
findings: 2 × NIT; scope names all ten keys).

Proven by running the repo's own writer against the scratch mirror:

```
ledger-assemble: hi/ui.chat.canonical -> status audited (prior audits were of older bytes: moved to superseded) | clean-with-findings, 0 blocker, 0 major, 0 minor, 2 nit
```

and afterwards `ledger-check.mjs` reports **0 findings for `hi/ui.chat.canonical`**
(was 3; the remaining 18 findings belong to the six other locales).

Exact command line for the integrator (run from the repo root, with the receipt
copied in from my scratchpad first):

```sh
node scripts/i18n/ledger-assemble.mjs \
  --locale hi \
  --file src/i18n/catalogues/hi/ui.chat.canonical.json \
  --auditor-instance 765ad2515acf-hi-s16f-r2 \
  --auditor-model deepseek/deepseek-flash \
  --result clean-with-findings \
  --receipt ~/.local-operator/sessions/765ad2515acf/scratchpad/receipt-hi-s16f-r2.json \
  --scope "Round 2 independent re-audit of the 10 S16f generation-card keys on the landed bytes at 9931d62 (sound.batch.*, sound.cost.*, media.image_label, media.sound_label, supplement.sound_fallback_label); the other 456 values are unchanged and out of scope." \
  --note "R2 on landed bytes; record i18n/audits/evidence/hi/ui.chat.canonical/s16f-r2-765ad2515acf/. 10 S16f keys re-judged; nothing left English; 0 blocker/major, 2 nit accepted as-is (word budgets)."
```

Then `node scripts/i18n/ledger-check.mjs` (green for `hi`), and commit
`i18n/receipts/765ad2515acf-hi-s16f-r2.json` with the ledger row.

## 7. Evidence to retain (I cannot write into the repo — read-only brief)

Intended tracked bundle:
`i18n/audits/evidence/hi/ui.chat.canonical/s16f-r2-765ad2515acf/`
— `record.json`, `report.md` (this file), `check-hi-s16f-r2.mjs`,
`receipt-hi-s16f-r2.json`, `audit.log`. All of them currently sit **untracked in
my session scratchpad**; the implementer or manager must commit them with the
ledger row. An `audit_notes_not_execution_log`/`audit.log` distinction applies:
`audit.log` holds the actual command transcripts recorded during this run.

## 8. Limits

- Judgement is by reading plus the mechanical checks above; no rendered frame was
  captured (this lane is read-only; a frame needs the app built).
- Rendered fit for the summary paragraph and the player control line remains
  QA/design territory; the cell-width figures above are the measurement I can
  stand behind.
- I audited the ten landed pairs and the namespace's parity; the other 456 values
  were not re-read (unchanged bytes, out of scope).
