# ur · `ui.chat.canonical` · S16f generation-card labels — round-2 independent audit

**Verdict: clean** — blocker 0 · major 0 · minor 0 · nit 0.
All 10 landed keys read on the LANDED bytes, including the three round-1 corrections, which were
re-derived rather than accepted. Nothing in this group is left English except the named exceptions.

- Locale `ur` (RTL) · namespace `ui.chat.canonical` · audit id `s16f-au2-ur`
- Repo `~/local-operator-ui` · PR #1876 · branch `feat/i18n-s16f-generation-card-labels`
- Worktree (manager-owned, shared, READ-ONLY) `~/local-operator-ui/.worktrees/i18n-s16a`
- HEAD `9931d62addf8a0606bb26d32a8bc163dc7c126b3` (re-verified before and after; `git status --porcelain` empty) · base `7c43086791f3571a20a2ab85b6e9f49365cd99c6`
- **No repo write**: no edit, commit, push or PR post. Every write in this report is in my own
  session scratchpad. The ledger run was executed against a `git archive HEAD` mirror.

## Identity (actual)

`i18n-auditor` · session **`33f0800c30f3`** · served model **`deepseek/deepseek-flash`**
(session model header; no provider fallback signalled in this run —
`actual_model_source`: session default). Not the translator (`i18n-translator`,
`anthropic/claude-sonnet-5-5`) and not the round-1 ur auditor (`65809453d7b2`), whose report I read
as input only. No translation/MT service was used for comparison or back-translation; every
judgment is reasoning over the English source, its context sidecar, the shipped `ur` corpus, and
`i18n/glossary.md` + `i18n/style-guides/ur.md`.

Guide revision: the local `~/local-operator` checkout is b42471d3935c, and its only delta from
**origin/main 27bfbdb21c3e** in these two files is the 6-line macOS-label rule (additive, and none
of these 10 values touch macOS labels). I read both and cite the origin/main hashes below.

## Style guide and glossary revision (the authority I read)

```
glossary      0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8  (origin/main 27bfbdb21c3e)
ur style guide 7276e96210fe5f23fd82a39ae4cc0c88b2c1009d3a551d914efc3f61516eddc4  (origin/main 27bfbdb21c3e)
```

## Input hashes (sha256), all computed from the bytes

| Input | Hash |
|---|---|
| `src/i18n/catalogues/en/ui.chat.canonical.json` (landed) | `12ec2698434dcb39497e288af62d11d70f0fd71d494a9becf3fd611d6568bbdd` |
| `src/i18n/catalogues/ur/ui.chat.canonical.json` (landed) | `ff384788791f2bfbde96860706123a80a98c85f20008465d4abdaa165da49f01` |
| `src/i18n/catalogues/en/ui.chat.canonical.context.json` | `95aa203759416c93180b7eb4967e6fcf5bce0dffe20e9d005b431c645e9e11e6` |
| 10 English pairs, sorted-key compact UTF-8 JSON | `bdd1d9d1cfcd327c7445396ad806220fa850fe820c638a59ec6bc195f882e307` |
| 10 landed ur pairs, same canonicalisation | `5693ac5ea7c2aa721728f454c0015f71bb2a862feb8a09e18966f7c92238cdaa` |

Per-key pair hashes (ur; each is sha256 of `{"<key>": "<value>"}`, sorted keys, compact UTF-8):

| key | pair sha256 |
|---|---|
| `sound.batch.item_status` | `144538a1a6bdf3215879b0b8848ca5251f852721630f623e47328e8c2968bf2b` |
| `sound.batch.summary` | `90913eac9a11251c1b2328630ccd9adc32692290467e72dd87fc905cdb3fb32d` |
| `sound.batch.latest_update` | `a446212f663853b2ba9082effdc1a25c4963fcccb1e2aaa945c579935d5370ba` |
| `sound.cost.unknown` | `e10a7b98e7d7554e7e98ba4713581e78cb1224cb99923e61f557c8b86ac2c67f` |
| `sound.cost.no_charge` | `8d4d9208ce97369ecd67699b4b6a4e04f12116c427531542470ecc47908dd575` |
| `sound.cost.estimated_zero` | `32cf0e7cafc66b8d074a6b32b0556bb04fb7e7a321219f314173674b43732e7e` |
| `sound.cost.batch_unknown` | `29f63b9626c7d834d2795cb4cf15ff5a7a2a129cb284f75a0241445f9af1f685` |
| `media.image_label` | `fda4dbeed929c33061436e7f60b3a025734732099e30ec9ec0169989107cc90d` |
| `media.sound_label` | `20d0aadd59e793b0c5fdc5bafa29fb7db8ee394ce57140e88f196604c17c225c` |
| `supplement.sound_fallback_label` | `94942b5f6cf37a06b87ea0982b3aabe4982b5eafd3fd759fab4833356a3e3b6e` |

Key sets: en 466, ur 466 — identical, these 10 are the last 10 in English order.

## 1. Mechanical — executed, all pass

Mirror: `git archive HEAD` of `scripts/i18n`, `src/i18n`, `i18n/{languages,coverage-allowance,baseline,ledger,context-allowance,allowlist,literal-allowance}.json`, `i18n/receipts`, `package.json`, `tsconfig.json` into my scratchpad; `node_modules` symlinked from the worktree (nothing installed, no dependency copy); `CMUX_*` unset.

| Command (mirror unless noted) | Actual result |
|---|---|
| `node scripts/i18n/generate.mjs --check` | exit 0 — `keys.gen.ts is byte-identical to a fresh generation` |
| `node scripts/i18n/check-coverage.mjs` | exit 0 — `7 gated language(s) over 158 namespace(s); 0 allowed key(s)` |
| `node --test scripts/i18n/locale-parity.test.mjs` | exit 0 — 44/44 pass |
| `node scripts/i18n/check-duplicates.mjs` | exit 0 — 1428 files, 0 duplicate keys |
| `node scripts/i18n/context-parity.mjs` | exit 0 — every English key covered, 129 allowed gaps |
| `node --test scripts/i18n/generation-card-labels.test.mjs` (worktree) | 27/27 pass (incl. the ur item-suffix, cost, summary and Latin-name isolation cases) |
| `node --test scripts/i18n/generation-card-locale-switch.test.mjs` (worktree) | 1/1 pass — a mounted batch repaints on a switch |
| `node --test scripts/i18n/ur-activation.test.mjs` (worktree) | 3/3 pass — 9113 values, no bidi controls, no forbidden script |
| `node check-ur-r2.mjs --mutant` (mine) | **PASS, 2065 render cells, 0 failures; 7/7 mutants flagged** |

My grid, through the app's own `intl-messageformat` (`new IntlMessageFormat(value, "ur")`), covering
counts `0,1,2,3,5,11,21,22,100,1000,1000000` × statuses `failed/cancelled/other/unrecognised` ×
`has_attention yes/no` × label shapes (Latin, Urdu, parenthesised), plus latest-update `item/total`
pairs and media `count/position` pairs:

- no throws; no leftover `{`, `}`, `#`, `undefined`, `NaN`, `[object`; Latin digits only; no grouping at 1000/1000000 (`::group-off` holds).
- **CLDR categories**: `one`/`other` present wherever a plural exists. The media labels use `=1`+`other` — ur's `one` is exactly n=1, so `=1` covers the category; no category missing.
- **Zero-hiding**: all-zero summary renders exactly `0 مکمل · 0 ناکام`; both `=0` arms stay empty.
- **AST parity**: argument names/types, select branch sets, plural arm sets and nesting identical to English (10/10).
- **`$0`** kept unsplit and rendered intact.
- **Typography**: NFC; `۔`/`؛` correctly; middle dot only as `" · "`; no space before Urdu punctuation; no ASCII sentence punctuation; **no manual bidi controls**; no Devanagari, danda, or `ك/ي/ة/ى`.
- **Negative control** (in-memory mutants, same checker): dropped placeholder, missing plural arm, English leftover, dropped select branch, manual bidi control, lost `$0`, danda → **all 7 flagged**.

## 2. Accuracy and idiom — the 10 values, re-judged

| key | landed ur | verdict |
|---|---|---|
| `sound.batch.item_status` | `{status, select, failed {{label} · ناکام} cancelled {{label} · منسوخ} other {{label} · حالت نامعلوم}}` | correct; one single-word state per branch; `حالت نامعلوم` = exact sibling of `ownerAudit.unknown_status` |
| `sound.batch.summary` | `… مکمل … · … ناکام … · … منسوخ … · … حالت نامعلوم …۔ توجہ درکار: {labels}` | correct; the middle-dot clause list and the `۔ توجہ درکار:` break match `mesh.approval.result_status` |
| `sound.batch.latest_update` | `تازہ ترین اپ ڈیٹ: {name} (آئٹم {item} از {total})۔` | correct; `آئٹم` is the namespace's own word (`image_gen.batch_summary`), `از` matches the neighbouring lightbox `تصویر {index} از {count}` |
| `sound.cost.unknown` | `لاگت ابھی معلوم نہیں۔` | correct; sentence shape already shipped as `destination_pickers.not_known_yet` = `ابھی معلوم نہیں۔` |
| `sound.cost.no_charge` | `کوئی چارج نہیں۔` | correct; the corpus's `کوئی اضافی چارج نہیں۔` family, minus the "extra" the English does not say |
| `sound.cost.estimated_zero` | `تخمینہ شدہ لاگت $0؛ حتمی چارج کی تصدیق نہیں ہوئی۔` | correct; `تصدیق نہیں ہوئی` is the exact corpus form (`… کی تصدیق نہیں ہوئی`); not shortened to "no charge" |
| `sound.cost.batch_unknown` | `مجموعی لاگت ابھی معلوم نہیں۔` | correct; `مجموعی` for an aggregate (`message_budget.images_size` = `مجموعی سائز`) |
| `media.image_label` | `{count, plural, =1 {تصویر} other {تصویر {position}}}` | correct; bare noun, number after the noun per the lightbox precedent |
| `media.sound_label` | `{count, plural, =1 {آواز} other {آواز {position}}}` | correct; `آواز` = the playable thing (`sound.player_failed`), distinct from `آڈیو` (the audio file) exactly as English splits sound/audio |
| `supplement.sound_fallback_label` | `تیار کردہ آواز` | correct; `تیار کردہ` is the card family's own "generated" (`image_gen.state.done` = `تیار کردہ ویڈیو/تیار کردہ تصویر`, `library.origin.generated` = `تیار کردہ`) |

Nothing omitted, added, negated or polarity-flipped. Tone is terse and polite (آپ register untouched:
no imperative appears in any of these strings). Product names, `$0` and ICU tokens are the only Latin,
as the sidecar requires.

### The round-1 corrections, judged on their merits (not echoed)

1. **`منسوخ` as the single cancelled state in *both* `item_status` and `summary`** — accept.
   It removes the slash alternative and the two-name split, and `منسوخ` is the corpus's stopped/cancelled
   state (`settings.imports.outcome_cancelled`, `state_cancelled`, `phase_cancelled`; 138 occurrences).
   `متوقف`, which round 1 rejected, has 0 occurrences in the 9113-value corpus, so its removal is right.
2. **`مجموعی لاگت` in `batch_unknown`** — accept. `کل` is valid Urdu but collides with "yesterday/
   tomorrow" and has no aggregate-amount precedent; `مجموعی` has one, and the sentence now matches the
   sibling `مجموعی سائز`.
3. **`حالت نامعلوم` kept for the unrecognised branch** — accept, and I checked the intent the sidecar
   pins ("never as success or failure"): it reads "status unknown", not a fault.

A better replacement is not available for any of the three; I would not change a word of them.

## 3. Round-1 claims I did not take on trust

- **`item_status` ordering**: `{label} · STATE` in an RTL paragraph puts the Latin label at the right
  edge and the separator between L and R resolves `R` (N1), so an Urdu reader reads label → separator
  → state. Verified for a Latin, a parenthesised-Latin and an Urdu label.
- **`latest_update` parentheses**: the ASCII pair is bidi-mirrored around the Urdu run, and the `۔`
  sits after the closing paren. Correct.
- **`summary` attention list**: `formatClauses` supplies `؛ ` for ur (`src/i18n/format.ts:405`), so the
  names read in logical order and the list is not an ASCII-`;` defect. Confirmed in the code and in
  the render, not just in round 1's prose.
- **`$0` placement**: `$`+`0` resolve as one LTR island inside the RTL sentence and the following `؛`
  resolves R; the sign does not detach or move to the wrong side.
- **`abhi` vs `abhi tak`**: I checked whether "not yet known" wanted `ابھی تک معلوم نہیں`; the corpus
  has **0** `ابھی تک معلوم` and already ships `ابھی معلوم نہیں۔` verbatim. Keeping the corpus form is
  correct — this is the one place where round 1's phrasing was right for a reason it did not state.

## 4. Fit / width

Code points (Arabic script ≈ 1 cell/char per the guide's 14→14 measurement; FSI/PDI cost 0):

| key | en | ur |
|---|---|---|
| `sound.batch.item_status` | 106 | 101 |
| `sound.batch.summary` | 579 | 534 |
| `sound.batch.latest_update` | 89 | 92 |
| `sound.cost.unknown` | 19 | 21 |
| `sound.cost.no_charge` | 10 | 15 |
| `sound.cost.estimated_zero` | 46 | 49 |
| `sound.cost.batch_unknown` | 25 | 28 |
| `media.image_label` | 73 | 73 |
| `media.sound_label` | 73 | 71 |
| `supplement.sound_fallback_label` | 15 | 14 |

The sidecar carries no `maxCells`; its budgets are qualitative ("one or two words", "one short
sentence"). Every value meets them except `no_charge` (three words, see below), and the call sites
are all full-width wrap lines (`break-words [overflow-wrap:anywhere]`) or a `text-meta` line — there
is no fixed-width button, tab or status cell among them. The two call-site shapes I checked in code:
the item row paragraph (`sound-batch.tsx`) and the summary `<p>` (first text of the card).

## 5. RTL (ur)

- No manual bidi controls (the guide forbids them; the render layer double-applies FSI/PDI).
  `src/i18n/bidi.ts` isolates a Latin-led plain argument, so `{label}`, `{name}`, `{labels}` are
  already wrapped at render time and a control in the copy would nest a second isolate.
- No directional arrows, glyph hints or mirrored-wrongly icons in any of the 10.
- Storage order is logical everywhere; the counters, `$0`, `آئٹم`/`از` numerals and the `( )` pair all
  read correctly in an RTL run.

## 6. Considered, not raised (so the manager sees the checks, not padding)

- `cost.no_charge` is three words against "one or two". **Kept**: it matches
  `providers.provider_catalog.*` `کوئی اضافی چارج نہیں۔` and there is no size consequence on a
  full-width meta line. Not a defect, and I would not change it.
- `از` vs `میں سے` for "X of Y": the positional construction is already `… از …` in the lightbox.
- `تخمینہ شدہ` vs `تخمینی`: `شدہ`/`کردہ` is productive in this corpus (`تیار کردہ`, `شائع شدہ`,
  `محفوظ شدہ`, `منسوخ شدہ`); no change.
- Count adjectives kept invariant (`مکمل`/`ناکام`): precedent `milestone_summary`
  (`{completed} مکمل`), `mesh_approvals_tray.failed_count` (`{count} ناکام`). The implicit counted
  noun has no knowable gender, so inflection would be an invented agreement.
- `آواز` vs `آڈیو` split mirrors English sound/audio and is deliberate.

## 7. Nothing left English

Checked from the parsed AST literals, so ICU keywords cannot mask a leftover. Latin appears only as:
(a) ICU structure (argument names, `select`/`plural`/`number`, `::group-off`, selectors);
(b) `{label}`, `{name}`, `{labels}` — user data the sidecar says is never translated; (c) `$0`, the
pinned dollar literal. Nothing else.

## 8. Receipt and the exact integration command

Receipt: `receipt-ur-s16f-r2.json` in my scratchpad (NOT committed), sha256
`de6e0891a9eeb107aed9602ba65f58ac65ceb358d11d7cf9daeb6d2aa1b3990d`. It binds the LANDED bytes
(`sha256.en` = `12ec2698…`, `sha256.ur` = `ff384788…`, context + glossary + style-guide hashes), the
10-pair bundle hashes, per-key pair hashes, my instance/model and `status: "passed"`, `findings: []`.

**Validated against the repo's own tooling**, in the mirror (not in the repo): the assembler accepted
it and wrote `ur/ui.chat.canonical -> status audited | clean, 0/0/0/0`, with 21 prior audits moved to
`superseded` because they described older bytes. `ledger-check.mjs` then reported **zero findings for
`ur/`** (the remaining failures are the other locales' unlanded rounds: es, fr, hi, ru, vi).

```
node scripts/i18n/ledger-assemble.mjs \
  --locale ur \
  --file src/i18n/catalogues/ur/ui.chat.canonical.json \
  --auditor-instance 33f0800c30f3-s16f-r2-ur \
  --auditor-model deepseek/deepseek-flash \
  --result clean \
  --receipt i18n/receipts/33f0800c30f3-s16f-r2-ur.json \
  --scope "S16f round 2, 10 landed generation-card label keys (sound.batch.item_status/summary/latest_update, sound.cost.unknown/no_charge/estimated_zero/batch_unknown, media.image_label/sound_label, supplement.sound_fallback_label); other 456 keys carried" \
  --note "ur S16f r2: 10 landed keys clean; round-1 fixes re-derived, not echoed; hashes+grid in evidence s16f-au2-ur" \
  --date 2026-11-11
```

(107-character note.) Place `receipt-ur-s16f-r2.json` at `i18n/receipts/33f0800c30f3-s16f-r2-ur.json`
first — the row records that repo-relative path and the gate re-hashes it. The assembler also copies
it there itself if you point `--receipt` elsewhere; the two paths must agree.

Notes for the integrator:

- The row's `translator` block still describes the S16a lane (`i18n-translator` /
  `anthropic/claude-sonnet-5-5`, 2026-11-11). Agent, model and date are accurate for S16f too; only
  the parenthetical note names S16a. If you want it to name S16f, run a separate
  `--update-translator --translator-agent i18n-translator --translator-model <m>` pass after this
  one — do not rewrite the audit evidence.
- The tracked evidence bundle belongs at
  `i18n/audits/evidence/ur/ui.chat.canonical/s16f-au2-ur/` (`record.json` + `audit.log` companions).
  I did not commit it: this role is read-only. The report and checker are in my scratchpad; copy
  them in with the record.

## 9. Verdict

**clean** — `{blocker: 0, major: 0, minor: 0, nit: 0}`. `passed` is honest for this group.

## Artifacts (my scratchpad, session `33f0800c30f3`)

`audit-s16f-r2-ur.md` (this report) · `check-ur-r2.mjs` (grid + AST + mutant checker) ·
`receipt-ur-s16f-r2.json` (ledger-ready) · `audit.log` (executed commands with exits) ·
mirror at `s16f-ur-r2/` (git-archive copy incl. the post-assemble ledger, kept only for this round).
