# S16d round 2 — Hindi (`hi`) audit of `ui.common.time`

- PR #1877 · branch `feat/i18n-s16d-live-locale-formatting` · head **b2110ea9cd9fd0c103891a4a77b65ba741012cf4** (worktree `~/local-operator-ui/.worktrees/i18n-s16d`, verified HEAD, clean)
- Namespace `ui.common.time`, 5 keys (4 landed this PR: `today_at`, `yesterday`, `weekday_at`, `date_at`; `yesterday_at` unchanged)
- Auditor: **i18n-auditor** · model **deepseek/deepseek-flash** (harness session-state header; no fallback reported or observed) · session/instance **a6f6c27e3b4e**
- Independence: not `i18n-translator`/anthropic-sonnet-5-5, not the round-1 hi auditor; no catalogue byte edited by me (read-only, mirror + own scripts only)
- Guidance read: `~/local-operator` origin/main 5795d70 — `i18n/style-guides/hi.md`, `i18n/glossary.md`
- Verdict: **clean** — 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT (5 INFO observations below). Ledger receipt status `passed`.

## 1. The round-1 MAJOR: is `को` right for BOTH?

Composed through the app's own path (`formatDividerLabel` from
`src/renderer/src/features/chat/utils/message-grouping.ts`, bundled with esbuild
`write:false`, `setLocale("hi")`, real ICU arguments — `weekday:"long"`,
`{day:"numeric",month:"long",year:"numeric"}`, `{hour:"numeric",minute:"2-digit"}`):

| case | composed hi output |
|---|---|
| today 14:30 | `आज 2:30 pm` |
| yesterday 09:05 | `कल 9:05 am` |
| Monday 2026-11-09 14:30 | `सोमवार को 2:30 pm` |
| Tuesday 2026-11-10 09:05 | `मंगलवार को 9:05 am` |
| Sunday 2026-11-08 21:15 | `रविवार को 9:15 pm` |
| 2026-11-05 14:30 | `5 नवंबर 2026 को 2:30 pm` |
| 2026-10-30 09:05 | `30 अक्टूबर 2026 को 9:05 am` (26 code points, widest case seen) |
| 2025-01-02 23:59 | `2 जनवरी 2025 को 11:59 pm` |

**`weekday_at` — `{weekday} को {time}`: idiomatic.** `को` after a weekday name is
the standard Hindi "on <day>" (सोमवार को = on Monday), used for past and future
alike; it carries no tense. `सोमवार को 2:30 pm` reads "on Monday at 2:30 pm", which
is exactly what a divider above Monday's messages should say. It does not read as
a calque of the English comma-less `Monday 2:30 PM`.

**`date_at` — `{date} को {time}`: also idiomatic.** Day-of-month + `को` is the
normal Hindi date locative (`5 नवंबर 2026 को` = on 5 November 2026), and
date + `को` + clock is the ordinary date-time construction. The past reference is
fine: Hindi marks no tense with `को`, and `5 नवंबर को हुई बातचीत` is normal.
No replacement is needed for either key.

Alternatives considered and **rejected as no better** (not findings):

- **`{date}, {time}` / `{weekday}, {time}`** (the es/ru shape): grammatical and
  acceptable in compact labels, but a pure preference. `को` adds the natural
  "on <day>" reading; swapping would be churn, not a correction.
- **Appending `बजे`** (`… को 2:30 pm बजे`): wrong — the injected `{time}` is
  already the Intl hi clock with a day-period (`2:30 pm`), so `बजे` would double
  it. `आज {time}`/`कल {time}` (already audited) omit it for the same reason.
- **Adding `को` to `today_at`/`yesterday_at`**: wrong — `आज`/`कल` are time adverbs
  and take no postposition. The today/yesterday vs weekday/date difference is
  grammatical, not an inconsistency.

INFO observation, `yesterday` = `कल`: the word also means "tomorrow" — a property
of the language, not a translation error; the past-message meta row
(`date-utils.ts` `formatMessageDateTime`) disambiguates by context, and no better
single word exists. Not a defect.

## 2. Mechanical (scratch mirror: `git archive` of `src/i18n scripts/i18n i18n package.json` @ b2110ea, `node_modules` symlinked from `~/local-operator-ui`; nothing installed)

| gate | command | ACTUAL result |
|---|---|---|
| generated types | `node scripts/i18n/generate.mjs --check` | `keys.gen.ts is byte-identical to a fresh generation.` |
| duplicates | `node scripts/i18n/check-duplicates.mjs` | `ok — 1428 file(s) scanned, 0 duplicate key(s)` |
| sidecars | `node scripts/i18n/context-parity.mjs` | `ok — every English key is covered, apart from 129 allowed gap(s) in 4 namespace(s)` |
| coverage | `node scripts/i18n/check-coverage.mjs` | `ok — 7 gated language(s) over 158 namespace(s); 0 allowed key(s) remain` |
| parity + stub guard | `node --test scripts/i18n/locale-parity.test.mjs` | **44/44 pass**, incl. `[hi] is not an English stub (no value identical to the source)`; scoped-exemption test also passes |
| activation | `node --test scripts/i18n/hi-activation.test.mjs` | 3/3 pass |
| ICU grid (mine) | `intl-messageformat` with the formatter's real arguments | all 5 parse; placeholder sets identical to en (`time`; `weekday,time`; `date,time`; none) |
| N/A this round | `check-strings.mjs` | **not evaluable in a `src/i18n`-only mirror** (its literal allowance names renderer files the mirror omits: "lists 1 id(s) no longer found"). Not claimed as passing, not counted. |

Unicode: all 5 values NFC; no `Cf`/`Cc` control or bidi characters beyond
precedent; Devanagari nukta spelling is consistent with the locale convention
(`को`, `आज`, `कल` carry none).

Negative controls (in-memory mutants, so the checks are not vacuous): dropped
placeholder → placeholder-parity FAIL; renamed `{weekday}`→`{day}` → FAIL;
duplicated `{time}` → FAIL; unbalanced brace → `ICU-REJECTS
EXPECT_ARGUMENT_CLOSING_BRACE`; English stub → "would FAIL stub guard".

Nothing-English check on composed output: only Devanagari, Latin digits and the
ICU day-period `am`/`pm` (a named exception) — no English word remains.

## 3. Hashes (sha256)

| input | sha256 |
|---|---|
| hi `ui.common.time.json` (whole file) | `c8d0b2b8ca135938bdfc29e2f29550bb053bfd328503cc9fcf64b83cce535682` |
| en `ui.common.time.json` (whole file) | `bb0b3aa1a71679cc73cb40d73616b5e22057c7dcbc86705c2ec4425984971e13` |
| en sidecar `ui.common.time.context.json` | `a9069037edc11c59288a7c2d3171496b1ef44a0982fc28e6a0edb4bcae0f98d2` |
| pair `today_at` = sha256(key\0value) | `f26c1520215c120c045dd919f900382b223e95ac0abc56e3c8a5cbf017cb9b37` |
| pair `yesterday` | `c5663ac76a20ced09a878b01c205d073554a281752764af1257efbad90d1ace9` |
| pair `weekday_at` | `9821f486638ef52344eed5f32aa2efb08c6d1c1acc62becd6b9ab1b2dc316421` |
| pair `date_at` | `f9b383b23e2ed60874dd6fc12e04fe4fd817632c2a7c51c2d0c91031ea6971f1` |
| sorted-key compact UTF-8 JSON of the 4 pairs | `64abbab901efbafdb447b0b4ca40fa843a8a3ed6894247323007dbe672172e11` |

## 4. Receipt and ledger

Receipt: `receipt-hi-s16d-r2.json` (staged outside the repo, session scratchpad),
binding en `bb0b3aa1…` and hi `c8d0b2b8…`. Assemble then verify, both run in the
mirror (assemble rewrites the mirror's `i18n/ledger.json` and copies the receipt
to `i18n/receipts/a6f6c27e3b4e.json`; that copy must be committed with the row):

```
node scripts/i18n/ledger-assemble.mjs --locale hi \
  --file src/i18n/catalogues/hi/ui.common.time.json \
  --auditor-instance a6f6c27e3b4e --auditor-model deepseek/deepseek-flash \
  --result clean \
  --receipt <staged>/receipt-hi-s16d-r2.json \
  --scope "PR #1877 S16d r2, hi/ui.common.time, 4 landed keys after the round-1 correction, judged on composed Intl output via formatDividerLabel; head b2110ea" \
  --note "S16d r2 hi ui.common.time: को correction in weekday_at/date_at verified idiomatic on composed output ('सोमवार को 2:30 pm', '5 नवंबर 2026 को 2:30 pm'); no blocker/major on landed bytes; record i18n/audits/evidence/hi/ui.common.time/s16d-hi-r2/record.json"
```

Result: `hi/ui.common.time -> status audited (prior audits were of older bytes:
moved to superseded) | clean, 0 blocker, 0 major, 0 minor, 0 nit`. Note is 253
chars. `node scripts/i18n/ledger-check.mjs` afterwards: **0** findings for
`hi/` (`grep -c 'hi/ui.common.time'` → `0`).

The row needs **no** translator flag to pass. Recommended (optional, provenance
only — it succeeds and leaves status `audited`): a second call with
`--update-translator --translator-agent i18n-translator
--translator-model anthropic/claude-sonnet-5-5 --date 2026-11-12`, because the
existing row still credits the pre-S16d run (`translator` /
`openrouter/moonshotai/kimi-k3.1-pro`, 2026-10-24) for bytes that now carry 4
keys from the s16d lane. Verified in the mirror: status stays `audited`, hi stays
green.

Repo-wide `ledger-check` is still red on **18** findings, all in the other six
locales' `ui.common.time` rows (expected: this PR's English source and those
catalogues moved, so each awaits its own round-2 audit). None are hi's.

## 5. Scope / limits

Audited: `hi/ui.common.time` only, at b2110ea9cd9f. Not audited: other hi
namespaces, other locales, runtime rendering in a running app (the composition
above runs the app's formatter module, not the Electron UI), and `check-strings`
(not evaluable from the mirror). No file in the repo was edited by me.
