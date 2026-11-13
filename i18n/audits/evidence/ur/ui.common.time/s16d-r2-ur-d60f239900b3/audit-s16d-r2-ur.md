# Audit — `ur` (Urdu, RTL) · namespace `ui.common.time` · S16d round 2

**Verdict: CLEAN** — 0 BLOCKER · 0 MAJOR · 0 MINOR · 0 NIT (5 keys, 4 new).
Ledger result `clean`; row status `audited`.

- PR: damianvtran/local-operator-ui **#1877** — `feat(i18n): dates, times, numbers and percents follow the live locale (S16d)`
- Head: `b2110ea9cd9fd0c103891a4a77b65ba741012cf4` (verified = worktree `~/local-operator-ui/.worktrees/i18n-s16d`, clean) · Base: `7c2b6af66486c9e7ec0603141fb4529e10204c7f` (= `origin/main`)
- Auditor: **i18n-auditor**, model **deepseek/deepseek-flash**, session/instance `d60f239900b3`, independent (not the translator `i18n-translator`/`anthropic/claude-sonnet-5-5`, not the round-1 `ur` auditor). No fallback observed.

## Landed bytes audited (sha256)

| Input | Path | sha256 |
|---|---|---|
| English source | `src/i18n/catalogues/en/ui.common.time.json` | `bb0b3aa1a71679cc73cb40d73616b5e22057c7dcbc86705c2ec4425984971e13` |
| Context sidecar | `src/i18n/catalogues/en/ui.common.time.context.json` | `a9069037edc11c59288a7c2d3171496b1ef44a0982fc28e6a0edb4bcae0f98d2` |
| Urdu target | `src/i18n/catalogues/ur/ui.common.time.json` | `ebd748bc470d8e649715afa0e6d7dc82d84754f61e6d1f33d9b919b02d319d95` |

## Composed output (real formatter arguments, `intl-messageformat` + live-`ur` `Intl`)

| Key | Urdu value | Composed (2026‑11‑05 15:45) |
|---|---|---|
| `today_at` | `آج {time}` | `آج 3:45 PM` |
| `yesterday_at` | `گزشتہ روز {time}` | `گزشتہ روز 3:45 PM` |
| `weekday_at` | `{weekday} {time}` | `جمعرات 3:45 PM` |
| `date_at` | `{date} کو {time}` | `5 نومبر، 2026 کو 3:45 PM` |
| `yesterday` | `گزشتہ روز` | `گزشتہ روز` |

`{date}` = `formatDate(LONG_DATE)` → `5 نومبر، 2026`; `{time}` = `formatTime({hour:"numeric",minute:"2-digit"})` → `3:45 PM` (ur CLDR resolves h12 with **Latin** day periods — a named exception).

## Judgement

**`date_at` — round‑1 correction ACCEPTED.** The old `{date}، {time}` doubled the comma the CLDR ur long date already carries inside it (`5 نومبر، 2026`). `کو` is the ordinary temporal postposition after a date (`5 نومبر 2026 کو …` = "on 5 November 2026"), so the label now carries exactly one `،`, no punctuation doubling, and reads `on 5 Nov 2026 at 3:45 PM`. Consistent with the `hi` sibling (`{date} को {time}`) and with the sidecar's "the joiner is yours to choose".

**`weekday_at` — bare juxtaposition is correct, not a calque.** The value is identical to English only as a *pattern*: ICU supplies `جمعرات`, no English word survives, and the scoped `IDENTICAL_OK` row states exactly that. The catalogue's own precedent is bare day‑word + clock (`ui.schedules.scheduled_task_dialog.tomorrow_at_9_00_am` «کل صبح 9:00 بجے»), so no `کو` is needed for a weekday, and none is needed for `آج` either (nobody says «آج کو»). Only a full date takes the postposition — a grammatical split, not an inconsistency.

**`today_at` / `yesterday_at` / `yesterday` — native and consistent.** `گزشتہ روز` matches `ui.notifications.group.yesterday` and the whole `گزشتہ …` family (`ui.projects.project_model.last_7_days`, `ui.chat.pickers.analytics_model.last_days`); تیر is avoided because it also means tomorrow. Register neutral, terse, no honorifics, no `!` — style guide §Formality satisfied.

**RTL / bidi — clean.** Render layer: `use-document-direction.ts` sets `document.documentElement.dir` from `i18n/languages.json` (`ur` → `dir:"rtl"`), so the label is laid out in an RTL paragraph. `fribidi --rtl --verbose` on the composed `date_at` gives levels `2 1…1 2 2 2 2 1…1 2 2 2 2 1 2 2` (base R) and visual reading order **5 → نومبر، → 2026 → کو → 3:45 → PM**: the two EN date islands never merge, the `،` sits between month and year, and `3:45 PM` is one LTR island whose `PM` lands to the left of the digits — the correct RTL reading order (the same arrangement CLDR `ar` produces with «م»). Wrapping the same string in FSI/PDI (the render layer's isolation) yields identical levels; the string's first strong character is `نومبر`, so FSI resolves RTL as intended. No problem case here — note the hazard would appear only if a label *began* with Latin. No manual bidi controls in any value (`ur-activation.test.mjs` also enforces 0 of them across 9 107 bundled values).

**English left in the interface: none** in these labels apart from the ICU day period `PM` and Latin digits, both named exceptions.

**Width.** date_at 24 chars ≈ 24 cells, yesterday_at 17, weekday_at 14, today_at 10 — a thin divider line, no `maxCells` hint in the sidecar; no overflow risk.

## Mechanical gates (scratch mirror: `git archive` of `src/i18n`, `scripts/i18n`, `i18n`, `package.json`, `node_modules` symlinked — nothing installed)

| Gate | Result |
|---|---|
| `generate.mjs --check` | `keys.gen.ts` byte-identical to a fresh generation |
| `check-duplicates.mjs` | ok — 1428 files, 0 duplicate keys |
| `context-parity.mjs` | ok — every English key covered, 129 allowed gaps in 4 namespaces |
| `check-coverage.mjs` | ok — 7 gated languages over 158 namespaces, 0 allowed keys remain |
| `locale-parity.test.mjs` | **44 pass / 0 fail** (key set, placeholders, stub guard, per‑locale row scoping) |
| `ur-activation.test.mjs` | **3 pass / 0 fail** (9 107 bundled values; no manual bidi controls/forbidden script) |
| Own ICU grid | argument sets identical to English for all 5 keys (`intl-messageformat` AST); no plural/select (source has none); all values NFC; no bidi controls; no doubled punctuation |

**Negative controls (in-memory mutants in the mirror, then restored → 44/44 pass):** removing the `ur:ui.common.time.weekday_at` `IDENTICAL_OK` row ✖ *"[ur] is not an English stub"*; `today_at` → `آج {tmie}` ✖ *"[ur] preserves every ICU placeholder"*; `today_at` → `Today {time}` ✖ *"[ur] is not an English stub"*. The guards are live, not vacuous.

## Ledger (command run inside the mirror; receipt kept outside the repo)

```
node scripts/i18n/ledger-assemble.mjs \
  --locale ur --file src/i18n/catalogues/ur/ui.common.time.json \
  --auditor-instance d60f239900b3 --auditor-model deepseek/deepseek-flash \
  --result clean --receipt <scratch>/receipt-ur-s16d-r2.json \
  --scope "S16d round-2 independent re-audit of the landed ur values for all 5 ui.common.time keys (4 new: today_at, yesterday_at, weekday_at, date_at), composing real formatter output; judged the round-1 date_at correction on its merits." \
  --note "ur ui.common.time round 2 (S16d): 5 keys, 0 blocker/major/minor/nit. date_at {date} کو {time} accepted; weekday_at stays pure-placeholder under its scoped IDENTICAL_OK row." \
  --date 2026-11-12 --repo <mirror>
```

Output: `ur/ui.common.time -> status audited (prior audits were of older bytes: moved to superseded) | clean, 0 blocker, 0 major, 0 minor, 0 nit`. Receipt `receipt-ur-s16d-r2.json`, sha256 `8fa87b89c6b0d4b492bab5dab605ae16c42283ed38505ebee85f3f4960ee7c4e`; the tool copies it to `i18n/receipts/d60f239900b3.json` (immutable, embedded in the row).

`ledger-check` in the mirror: **0 findings for `ur`** (repo‑wide 21 → 18; the rest are the other locales, each awaiting its own round‑2 receipt).

**Translator provenance gap + verified fix.** A stale row keeps its old translator block, so after the assemble above the row still claimed `translator/kimi-k3.1-pro` (2026‑10‑24) for bytes it did not translate. `--update-translator` refuses stale rows and refuses without it, so it must be a **second** call after the rebind — verified working in the mirror, leaving status `audited` and 0 `ur` findings:

```
node scripts/i18n/ledger-assemble.mjs ... --update-translator \
  --translator-agent i18n-translator --translator-model anthropic/claude-sonnet-5-5 ...
```
→ `translator: {"agent":"i18n-translator","model":"anthropic/claude-sonnet-5-5","date":"2026-11-12"}`, status `audited`.

## Limits

Mirror-contained mechanical run (no whole suite, no installation, no browser paint). Widths and ordering measured on the composed strings via `Intl` + `fribidi`, not on a screenshot. Only `ur` and only `ui.common.time` were re-judged; other locales/namespaces untouched. The five entries under `observations` in `record.json` are notes about what was accepted and why — none is a finding.
