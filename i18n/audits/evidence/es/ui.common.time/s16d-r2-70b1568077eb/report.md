# S16d round-2 independent audit — `es` / `ui.common.time`

- **Auditor**: `i18n-auditor` · model **deepseek/deepseek-flash** · session `70b1568077eb`
  (model as served for this run; no provider fallback occurred, none is claimed)
- **Round**: 2 (fresh instance — not the translator `i18n-translator`/anthropic/claude-sonnet-5-5,
  not the round-1 auditor of this locale)
- **Head audited**: `b2110ea9cd9fd0c103891a4a77b65ba741012cf4` (worktree clean; verified this run)
- **Base**: `7c2b6af66486c9e7ec0603141fb4529e10204c7f` (merge-base with `origin/main`)
- **Namespace**: `ui.common.time` — 5 keys, all of them: the four S16d keys plus the
  untouched `yesterday_at` sibling that the new keys sit beside
- **Mode**: read-only. No repo edit, commit, push or PR post. Validators ran in a
  scratch mirror (`git archive` of `src/i18n`, `scripts/i18n`, `i18n`, `package.json`;
  `node_modules` symlinked); the mutation controls ran only in that mirror.

## Verdict

| | |
|---|---|
| **Verdict** | **clean-with-findings** |
| BLOCKER | 0 |
| MAJOR | 0 |
| MINOR | 0 |
| NIT | 1 (`ES-1`, on the parity guard's exemption row — not on the Spanish copy) |
| Catalogue findings on the five landed values | **none** |

The four landed keys are correct Spanish, idiomatic for a divider label, and reach
the screen with no English left. The round-1 correction (`weekday_at` → `{weekday}, {time}`)
is **right**, and for a stronger reason than the one recorded for it.

## Inputs (hashes)

| | path | sha256 |
|---|---|---|
| en | `src/i18n/catalogues/en/ui.common.time.json` | `bb0b3aa1a71679cc73cb40d73616b5e22057c7dcbc86705c2ec4425984971e13` |
| context | `src/i18n/catalogues/en/ui.common.time.context.json` | `a9069037edc11c59288a7c2d3171496b1ef44a0982fc28e6a0edb4bcae0f98d2` |
| es (landed) | `src/i18n/catalogues/es/ui.common.time.json` | `ca96efc391c6c880900485d02da2d93011056565a49128391e77ce97fc5396b3` |

Per-key compact UTF-8 hashes (`[[key, value]]`, sorted key), es · en:

| key | es value | es sha256 | en sha256 |
|---|---|---|---|
| `ui.common.time.today_at` | `Hoy {time}` | `11eec25726a707cf73968d2642eb18c906365f94ea8b48e96f89a73ed13e5f64` | `d8a5619c331c9d3aa6de00bb5c1e9753fe53b989ba048d6f3777170943bd4846` |
| `ui.common.time.yesterday` | `Ayer` | `870fed0e7dd877501b73ecbbf66bb4668438257c816a6503de717fb28aaa63b8` | `6f8ff3faff42fc2c09be64b375050ea192d49bfa1235e857ac84eb1810b35cc5` |
| `ui.common.time.weekday_at` | `{weekday}, {time}` | `ce19c890bdacf048f4a72243f4ddd774d5501225b9b681d6337d8d5e37e1dd4e` | `8b0e07916d34e297405fa4179980b735e9e1a2f6fec26bcda728837e3e6ce4e0` |
| `ui.common.time.date_at` | `{date}, {time}` | `66adc508522fe70ad1baec159c07a7a06be3b46d220aea4ca18ba28bad74a998` | `66adc508522fe70ad1baec159c07a7a06be3b46d220aea4ca18ba28bad74a998` |

The last row is the identical-value pair the `es:ui.common.time.date_at` exemption
covers; `yesterday_at` (`Ayer {time}`) is unchanged from the audited corpus and is
carried here as the sibling the new keys must agree with.

## 1. Mechanical — all green, run this session

| check | command | result |
|---|---|---|
| generator freshness | `node scripts/i18n/generate.mjs --check` | byte-identical to a fresh generation |
| coverage | `node scripts/i18n/check-coverage.mjs` | ok — 7 gated languages, 158 namespaces, 0 allowance left |
| key uniqueness | `node scripts/i18n/check-duplicates.mjs` | ok — 1428 files, 0 duplicate keys |
| context sidecars | `node scripts/i18n/context-parity.mjs` | ok — 129 allowed gaps in 4 namespaces (shrink-only) |
| locale parity (`[es]` cases) | `node --test --test-name-pattern '\[es\]' scripts/i18n/locale-parity.test.mjs` | 6/6 pass — keys carry, no unknown keys, placeholders identical, **not an English stub** |
| activation | `node --test scripts/i18n/es-activation.test.mjs` | 3/3 pass |
| formatting | `biome check src/i18n/catalogues/es/ui.common.time.json` | clean, LF-terminated, tab-indented as the catalogue set |
| encoding | own scan | NFC-normalised; no bidi control characters (correct for `es`); valid JSON; key set identical to `en` (5/5) |
| ICU structure | own parse via `@formatjs/icu-messageformat-parser` | no plural/select in these keys, so no CLDR category risk; argument names and types identical to `en` (`time` string; `weekday`+`time`; `date`+`time`; `yesterday` takes none) |
| markup / code spans / flags | own scan | none present; nothing to preserve |

## 2. Composed output — real formatter, real ICU arguments

Not read off templates: `formatDividerLabel` / `formatMessageDateTime`
(`src/renderer/src/features/chat/utils/message-grouping.ts`,
`src/renderer/src/shared/utils/date-utils.ts`) bundled with esbuild `write:false`
and driven under `setLocale("es")` with the landed catalogue registered, plus an
`intl-messageformat` grid using the formatter's actual arguments.

`now = 2026-11-12 15:05`

| case | divider | hover meta |
|---|---|---|
| today 14:30 | `Hoy 14:30` | `14:30` |
| yesterday 09:05 | `Ayer 9:05` | `Ayer` |
| Mon 9 Nov 14:30 | `lunes, 14:30` | `lunes` |
| 5 Nov 2026 14:30 | `5 de noviembre de 2026, 14:30` | `jueves` |

Clock grid (00:05 / 09:05 / 12:00 / 14:30 / 23:59) and weekday grid
(jueves / domingo / lunes / miércoles) render the same shapes with no failure,
no stray brace, no English token. **Nothing English is left** in any of the five
rendered strings; there is no ICU am/pm to except here because `es` renders a
24-hour clock, and digits are Latin per the style guide.

Width against English (character count, the guide's ~1 cell/char proxy):
`Today 14:30` 13→9, `Ayer 9:05` 17→9, `lunes, 14:30` 14→12,
`5 de noviembre de 2026, 14:30` 25→**29 (+16 %)**. The 24-hour clock buys back
length in three of four shapes; only the long-date label runs longer than English,
inside the guide's 15–25 % expectation and in a full-width divider line, so no
fit finding. Neither key carries a `maxCells` hint.

## 3. Judgement on the round-1 correction — `weekday_at` = `{weekday}, {time}`

**Upheld, and strengthened.** The recorded reason was series consistency with
`date_at`. The stronger reason is that the comma is what the locale's own
composition does:

```
Intl.DateTimeFormat("es", {weekday:"long", hour:"numeric", minute:"2-digit"})
  → "lunes, 14:30"          (measured, bundled Node ICU)
```

So `{weekday} {time}` (the pre-round-1 value) would have printed `lunes 14:30`,
which is **not** the Spanish rendering of a weekday-and-time datum; the landed
form matches the platform's es pattern exactly. Two independent mechanical facts
agree: (a) the stub guard would have caught the old value anyway — `{weekday} {time}`
is byte-identical to English and there is no `es:` exemption for it, so the guard
fails on it (control M1 below proves that it does); (b) the placeholder check is
indifferent to the joiner, so no mechanical gate could have caught a *wrong but
different* separator — the Intl reading is the substantive evidence here.

Register: lowercase `lunes` is correct Spanish (weekday names are not capitalised
mid-string; the label is not sentence-initial because it is the whole string —
Spanish typography keeps the lowercase form here, and the casing precedent is the
whole es catalogue). Comma + ASCII space, no space before the comma, no NBSP.

## 4. Judgement on the `es:ui.common.time.date_at` exemption row

Row under review:
`"Spanish long date + clock joined by the same comma as English; pure placeholder pattern, no words"`.

- **The reason is true.** `{date}, {time}` contains no lexical English at all —
  only two arguments and a comma — so the stub guard has nothing to catch there.
  The rendered Spanish is `5 de noviembre de 2026, 14:30`; every word comes from
  `Intl`, already localised.
- **The row is load-bearing, not a silencer.** Control M3 disables it and the stub
  guard fails (`[es] is not an English stub`); nothing else in the locale needed
  it. Control M1 shows the guard fires on a neighbouring English-identical value
  that has no row, so the table is not blanket-exempting `es`.
- **It is correctly scoped.** The row is `es:`-prefixed, and the suite's own case
  *"a locale-scoped identical-value exemption does not exempt another locale"*
  passes — the same value in `fr`/`ur`/… would not inherit it.
- **The joiner itself is a legitimate choice.** The sidecar hands the joiner to
  the translator ("comma, space, 'at'"), and comma-separated date-time is ordinary
  Spanish in labels and headers (calendar/message-header register). For the record,
  the platform's own `dateStyle:"long" + timeStyle:"short"` composition for es
  yields `5 de noviembre de 2026 a las 14:30` (measured) — so `{date} a las {time}`
  was the alternative. I do **not** raise it as a finding: both are idiomatic, the
  comma form is terser and is what the round-1 audit settled, and re-opening a
  settled joiner would churn bytes for taste. It is recorded here so the choice is
  visible rather than implied.

## 5. Series consistency (the manager's question)

`Hoy 14:30` / `Ayer 9:05` / `lunes, 14:30` / `5 de noviembre de 2026, 14:30`

The series is **consistent, and the asymmetry is grammatical, not accidental**:
`hoy`/`ayer` are adverbs of time, which in Spanish join a clock reading by
juxtaposition (`Hoy 14:30`), and `Intl` has no relative-day composition to
compare against; `lunes` and `5 de noviembre de 2026` are nominal date elements,
which Spanish separates with a comma, and there the platform's own es composition
(`lunes, 14:30`) confirms it. `date_at` and `weekday_at` therefore share one
shape (`<date element>, <clock>`), `today_at`/`yesterday_at` share another —
each internally uniform. Making the adverbs take a comma would produce `Hoy, 14:30`,
which reads like an address header and is not what Spanish UIs do.

## 6. Negative controls (mirror only; repo untouched)

| control | mutant | expected | measured |
|---|---|---|---|
| M1 | `es` `weekday_at` reverted to `{weekday} {time}` (pre-round-1, English-identical) | stub guard fails | **fails** — `[es] is not an English stub` |
| M2 | `es` `today_at` → `Hoy {hora}` | placeholder guard fails | **fails** — `missing placeholder(s) time` (and stub, since it diverged) |
| M3 | `es:ui.common.time.date_at` row disabled | stub guard fails | **fails** — `[es] is not an English stub` |
| restore | both mirror files back from the worktree | byte-identical | `cmp` silent; `[es]` parity 6/6 pass |

`audit.log` holds these runs and their actual output.

## 7. Findings

### ES-1 — NIT — the exemption row carries no audit provenance

- **Where**: `scripts/i18n/locale-parity.test.mjs`, `IDENTICAL_OK`, the
  `es:ui.common.time.date_at` entry — not the Spanish copy (which has no finding).
- **Current**: `"Spanish long date + clock joined by the same comma as English; pure placeholder pattern, no words"`
- **Problem**: every neighbouring row in that table ends with who audited it and on
  which revision ("independently audited in D2 r2 (b5bf3a7c1761)"), and the table's
  own comment calls an entry "a claim that gets reviewed, not a silencer". These two
  S16d rows sit without that citation, so a later reader cannot tell the claim was
  ever reviewed.
- **Suggested wording** (append): `; independently audited in S16d round 1 and round 2 (b2110ea9cd9f)`.
- **Gating**: no.

## 8. Receipt and ledger

Receipt: `receipt-es-s16d-r2.json` (bytes copied by the tool into the repo as
`i18n/receipts/70b1568077eb.json`, sha256 `637d48adc95205633bf9e658433ac5e405f174801994d0ba1ce1eeae309bdb47`).

Exact command, validated in the mirror against the pristine ledger:

```
node scripts/i18n/ledger-assemble.mjs \
  --locale es \
  --file src/i18n/catalogues/es/ui.common.time.json \
  --auditor-instance 70b1568077eb \
  --auditor-model deepseek/deepseek-flash \
  --result clean-with-findings \
  --receipt <scratch>/receipt-es-s16d-r2.json \
  --scope "es ui.common.time round 2: the four S16d keys (today_at, yesterday, weekday_at, date_at) plus the unchanged yesterday_at sibling, on b2110ea9cd9f" \
  --note "R2 es on b2110ea9cd9f: 0 blocker/major on all 5 time words; weekday_at comma = Intl es own composition; date_at IDENTICAL_OK row verified load-bearing and es-scoped. ES-1 nit: row lacks provenance. Record: i18n/audits/evidence/es/ui.common.time/s16d-r2-70b1568077eb/record.json"
```

Result: `es/ui.common.time -> status audited (prior audits were of older bytes: moved to superseded) | clean-with-findings, 0 blocker, 0 major, 0 minor, 1 nit`, row hashes now equal the landed bytes, `ledger-check` reports **0 findings for `es`**.

- **No translator flags needed.** The row already exists, so `--translator-agent/-model`
  are not required and the translator block keeps its recorded `translator` /
  `openrouter/moonshotai/kimi-k3.1-pro` / 2026-10-24.
- **`--update-translator` is *not* needed to pass**; I also ran it to check. It
  passes and rewrites the translator block to `i18n-translator` /
  `anthropic/claude-sonnet-5-5`, but the tool copies `--note` into `translator.note`,
  which would put an *audit* note in the translator field. Recommend the command above;
  refresh translator provenance separately only if the team wants it.
- The other 18 `ledger-check` findings are the six sibling locales
  (`fr`, `hi`, `ru`, `ur`, `vi`, `zh-CN`) on `ui.common.time`, whose rows still
  describe pre-S16d bytes — their own round-2 receipts close them, not this one.

## 9. Honest gaps

- I am not a native Spanish speaker. Idiom, register and the comma judgement above
  are reasoned from the locale style guide, the glossary, the shipped es corpus and
  the platform's own `Intl` es output — not from native intuition.
- No rendered frame: this namespace is a text label and the change is copy-only, so
  fit is argued from composed strings and character counts, not from painted geometry.
  I did not verify the divider's column width in a live window.
- `es` has no plural categories in play (no `plural`/`select` in these values), so
  the CLDR-category check is vacuous here rather than passed by evidence.
- This audit binds the bytes at `b2110ea9cd9f`; any later edit to the es file
  requires a fresh receipt.
