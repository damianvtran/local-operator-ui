# Audit — S16d `ui.common.time` (fr)

- **Locale:** `fr` · **Namespace:** `ui.common.time` · **Keys:** 4 (new) + 1 sibling read for consistency
- **Audited head:** `dcdcb6a9d8c4a80d239fc56498765c2b64417d38` (worktree `~/local-operator-ui/.worktrees/i18n-s16d`, verified clean, branch `feat/i18n-s16d-live-locale-formatting`)
- **Auditor:** agent `i18n-auditor`, fresh independent instance, session `51f78513d13c`, model **`deepseek/deepseek-flash`**
  (`actual_model_source`: session system header `Model: deepseek/deepseek-flash`; **no fallback observed**; independent of translator session / `anthropic/claude-sonnet-5-5`)
- **Candidate:** `~/.local-operator/sessions/3ef6295a5545/scratchpad/s16d-drafts/fr-s16d.json` (translator notes alongside)
- **Verdict: `clean`** — counts `{blocker: 0, major: 0, minor: 0, nit: 0}` (catalogue). Two app-side observations, severity `info`, not defects of these keys (below).
- Second independent pass done on all four values (re-read against style guide + catalogue precedent, not against the first pass's notes).

## 1. Input hashes (sha256)

| Input | Path | sha256 |
|---|---|---|
| candidate (file) | `…/s16d-drafts/fr-s16d.json` | `21aca4f1b31585aa0d5f2e16c94c54198945181b1f0d40d43a4004344f5f3294` |
| candidate (sorted-key compact UTF-8, content) | " | `263069ffcecb4a0fdda89001350b9de46d42a3062010da5a7422d2aa4551b3ef` — **matches the manager's recorded `263069ff`** |
| notes | `…/s16d-drafts/fr-s16d-notes.md` | read (765 B) |
| English | `src/i18n/catalogues/en/ui.common.time.json` | `bb0b3aa1a71679cc73cb40d73616b5e22057c7dcbc86705c2ec4425984971e13` |
| English sidecar | `src/i18n/catalogues/en/ui.common.time.context.json` | `a9069037edc11c59288a7c2d3171496b1ef44a0982fc28e6a0edb4bcae0f98d2` |
| fr catalogue (pre-landing) | `src/i18n/catalogues/fr/ui.common.time.json` | `acde397f72b34b71035c3bda3ce2214dd883556452d9b84968d96c018fb59a97` |
| glossary | `~/local-operator i18n/glossary.md @ origin/main` | `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8` |
| fr style guide | `~/local-operator i18n/style-guides/fr.md @ origin/main` | `5315e1ac10c2ce57aac631ba653d08de680ee70c9a022ed3a8345ce2f9902ee7` |

Per-value sha256 (lets the integrator prove the landed **values** are byte-identical to these, whatever key order the generator writes):

```
ui.common.time.today_at   d393e65581522d8b5caf4f11bb19c9dc4385c039153f35bbcfd1a1ee14a31d3d
ui.common.time.yesterday  477a18d2c0f6cf2b814bf5afa44cd1da6ba83c0a0fe3f972899750f9af8b18d6
ui.common.time.weekday_at 4bba8cf8dc63bf51dd88b6f32fb79c20b82648ff54be0c720d7967acf3356360
ui.common.time.date_at    95c67b754f8e8bd7f2f66b8430a9c8d4c0faa2aeac154d9c14abc467a57a4cb0
```

## 2. Mechanical (all PASS — log in `audit-run.log`)

Run through **the app's own path**, not a regex: `esbuild` bundled `src/i18n/messages.ts` (`t()` + `intl-messageformat`), `src/i18n/format.ts`, `message-grouping.ts`, `date-utils.ts` from the audited head (`write:false`, imported from a `data:` URL); the candidate values were registered as the `fr` catalogue and the locale set to `fr`.

- **Placeholders identical to English**, compared from the ICU AST (`@formatjs/icu-messageformat-parser`), not string matching — `today_at` `[#time]`/`[#time]`, `yesterday` `[]`/`[]`, `weekday_at` `[#time,#weekday]`/same, `date_at` `[#date,#time]`/same. No renames, no reordering, no added/dropped arguments.
- **No plural/select** in any of the four, so no CLDR-category obligation; had one existed, fr requires `one`/`many`/`other` and never `few`.
- **No throws** rendering each key with the real argument values (see §3 grid).
- **Encoding:** all four NFC; no bidi controls (`U+2066–U+2069`, `U+200E/F`); no double spaces; apostrophe is `U+2019` as the fr guide requires (`d393e…` verified against `U+0027`).
- **Key set:** exactly the 4 keys English adds over the landed fr file; nothing extra, nothing missing; valid JSON; no markup, backticks, code spans, flags or identifiers in these values (nothing to keep byte-identical).
- **Negative controls (3/3 caught, in-memory mutants only):** dropped placeholder (`Aujourd’hui à` → `[]` ≠ `[#time]`), renamed placeholder (`{heure}`), added placeholder (`{date} à {time} le {weekday}`); plus text controls for an English word left behind, a `U+0027` apostrophe, and an NFD-decomposed `à`.
- **LTR untouched:** none of the four is bidi-wrapped for `fr` (`isolateArguments`/`isolateSigils` fire only for an RTL-answered message).

## 3. Composed output — real app formatter, fr (measured, not assumed)

Inputs from the app's own call sites: clock `{hour:"numeric",minute:"2-digit"}`, weekday `{weekday:"long"}`, date `{day:"numeric",month:"long",year:"numeric"}` — `Intl` under `fr` at node 24.22.1 (ICU):

- `{time}` → **`14:30`** (`hourCycle: h23`), `{weekday}` → **`lundi`**, `{date}` → **`9 novembre 2026`**

| Surface | Call | Actual string |
|---|---|---|
| today | `formatDividerLabel` | **`Aujourd’hui à 14:30`** |
| today, single-digit hour | " | `Aujourd’hui à 9:05` |
| yesterday | `formatDividerLabel` | **`Hier à 18:07`** (sibling key `yesterday_at`) |
| 2 days ago | `formatDividerLabel` | **`mardi à 14:30`** |
| 5 days ago | `formatDividerLabel` | `samedi à 14:30` |
| 8 days ago | `formatDividerLabel` | **`4 novembre 2026 à 14:30`** |
| 40 days ago | `formatDividerLabel` | `3 octobre 2026 à 14:30` |
| yesterday, hover row | `formatMessageDateTime` | **`Hier`** |
| today, hover row | `formatMessageDateTime` | `14:30` |

No English in any composed label (`Today|Yesterday|Monday|November|AM|PM` all absent; no 12-hour cycle).

## 4. Judgement, key by key

`today_at` **`Aujourd’hui à {time}`** — correct. Sentence-initial capital (French lowercases the word only mid-sentence: the locale already writes `aujourd’hui` mid-sentence in `ui.teamBridge.threadRow.last`), `U+2019` apostrophe, and the `à` joiner is the same one the shipped `ui.common.time.yesterday_at` (`Hier à {time}`) and `ui.teamBridge.threadRow.last` (`aujourd’hui à {time}`) use. No comma/parenthesis variant reads better.

`yesterday` **`Hier`** — correct, and the right call vs the clock-bearing sibling. Standalone it must match the one-word day labels the locale already ships: `ui.teamBridge.thread.yesterday` `Hier`, `ui.notifications.group.yesterday` `Hier`, `ui.projects.project_model.yesterday` `Hier` (and `Aujourd’hui` in `ui.notifications.group.today`, `ui.chat.sidebar_view.section.today`, `ui.chat.pickers.analytics_panel.today`). Capital `H` is right for a standalone label; the lowercase `hier` in `ui.teamBridge.threadRow.last` is a mid-sentence form and correctly different. The sidecar's role ("short date label … previous calendar day … stands alone") is satisfied exactly.

`weekday_at` **`{weekday} à {time}`** — correct. Weekday-first is the natural French order and the sidecar explicitly leaves the position to the language; `à` is the locale's established day/hour joiner (`ui.teamBridge.replies.last` `dernière réponse à {time}`, `ui.chat.asks.context.messages_since` `dernier message à {time}`). A comma (`lundi, 14:30`) would be a calque of the English comma and less idiomatic. See OBS-1 for the app-supplied case artifact.

`date_at` **`{date} à {time}`** — correct: `4 novembre 2026 à 14:30` is the standard French date+clock form, and `à` keeps the four keys uniform. Rejected alternatives: the English comma (calque), and a leading article (`le 9 novembre 2026 à 14:30`) — which would make a divider label open on a lowercase `le` and grow the line for no gain, where the source itself is a bare date+time. Existing fr `{date}` copy uses `le {date}` only after a verb or in a sentence (`ui.chat.user_turn.stamp.sent` `Envoyé le {date}`, `ui.teamBridge.archive.list.meta_on` `Archivé le {date}`), so the bare form here is not an inconsistency.

Cross-key consistency: all four joiners are `à`, all day words match the locale's existing standalone forms, and `yesterday` is the exact word its `_at` sibling opens with.

## 5. Findings

**None.** `blocker 0 · major 0 · minor 0 · nit 0` for the four catalogue values.

## 6. Observations — app-side, severity `info`, no catalogue fix possible

**OBS-1 — `weekday_at` composes a sentence-initial lowercase weekday in fr.**
Measured: `mardi à 14:30`. `{weekday}` comes from `formatDate(date, {weekday:"long"})`, i.e. CLDR `fr`, which is lowercase by definition (`lundi`); French typography capitalises a day name only at the start of a sentence/label, which is exactly where this value lands. No catalogue spelling can fix it — the placeholder must be inserted unchanged, and no `text-transform: capitalize` exists in the chat components (it would also wrongly give `Lundi À 14:30`). Belongs to the formatter/component layer (capitalise the composed line's first character; harmless for `en`, whose weekdays are already capitalised). Scope note, checked: `formatDividerLabel` is currently consumed by the trace storybook stories plus the S16d test, while the same lowercase weekday **does** reach production through `formatMessageDateTime`'s within-the-week branch (`date-utils.ts`), which is outside this key group. Not a blocker for these four values.

**OBS-2 — the clock prints a single-digit hour in fr (`9:05`, not `09:05`).**
`{hour:"numeric"}` is pinned so English stays byte-identical (`3:42 PM`, the S16d lock), and `Intl` fr with that option gives `9:05`, while the locale's own `timeStyle:"short"` gives `09:05`. French time-of-day notation does tolerate a one-digit hour (`9 h 05`), so this is a preference rather than an error, and it is not a property of these keys (the already-landed `yesterday_at` inherits it). If the window wants CLDR's `09:05`, the fix is locale-conditional 2-digit hours in `src/i18n/format.ts`, not a catalogue change.

## 7. Nothing English left

Within this group: no English words, no 12-hour cycle, no English date order. The only Latin tokens in the composed output are digits and `:` — locale-neutral by design. (`ur`/`hi` English-left risks do not apply to fr.)

## 8. Fit

No `maxCells`/`maxChars` hint exists for `ui.common.time` in the English sidecar, so no budget can be violated; measured against the English line for the same clock:

| key | fr | en | delta |
|---|---|---|---|
| `today_at` | 19 ch (`Aujourd’hui à 14:30`) | 13 ch (`Today 3:42 PM`) | +6 (46%, above the guide's usual 15–25% — inherent to the word, and no declared cap) |
| `yesterday` | 4 ch | 9 ch | −5 |
| `weekday_at` | 13 ch | 14 ch | −1 |
| `date_at` | 23 ch | 25 ch | −2 |

Only `today_at` grows; the other three are shorter than English. All are single-line labels in a chat column, no truncation risk observed. `Hier` fits the narrow hover meta row better than English does.

## 9. Receipt — not bindable pre-landing

The ledger's `target_sha256` is the **raw bytes of the landed** `src/i18n/catalogues/fr/ui.common.time.json`, which does not exist yet (the file currently holds only `yesterday_at`; the generator's key order for the merged file is not observable, so a predicted file hash could silently be wrong). I therefore deliver **`receipt-s16d-fr.TEMPLATE.json`** (English hash real and verified; `sha256.fr` marked `__LANDED_BYTES__`) plus the exact command; the integrator fills the landed fr hash and runs:

```bash
cd ~/local-operator-ui   # worktree root, after the 4 values land
# 1) fill sha256.fr in the evidence receipt with the landed bytes:
shasum -a 256 src/i18n/catalogues/fr/ui.common.time.json
# 2) (optional but recommended) prove the landed VALUES equal the audited ones:
#    compare each value's sha256 against §1's per-value list.
# 3) assemble the row — existing row, stale bytes: translator flags must be OMITTED
#    (ledger-assemble refuses them on an existing row without --update-translator):
node scripts/i18n/ledger-assemble.mjs \
  --locale fr \
  --file src/i18n/catalogues/fr/ui.common.time.json \
  --auditor-instance 51f78513d13c \
  --auditor-model deepseek/deepseek-flash \
  --result clean \
  --date 2026-11-12 \
  --receipt i18n/audits/evidence/fr/ui.common.time/s16dfr1/audit-receipt.json \
  --scope "ui.common.time, 4 new keys (today_at, yesterday, weekday_at, date_at) at dcdcb6a9: ICU AST placeholder parity, real app formatter end to end under fr Intl, typography, glossary, sibling yesterday_at consistency." \
  --note "0 blocker/major/minor/nit; 2 app-side info OBS (lowercase weekday at label start, 9:05 hour) — report: i18n/audits/evidence/fr/ui.common.time/s16dfr1/report.md"
```

`--result clean` is exactly what `[]` findings support (`ledger-rules.mjs`: only minors/nits ⇒ `clean-with-findings`; nothing ⇒ `clean`). `--note` is 159 chars (≤280, measured) and names the tracked record. No human/model contradiction: the receipt's `model` must stay `deepseek/deepseek-flash` to match `--auditor-model`.

## 10. Retention

Evidence root `i18n/audits/evidence/<locale>/<namespace>/<audit-id>/` exists on this branch (`i18n/audits/evidence/fr/…`); there is no `i18n/audits/evidence/README.md` in this worktree, so the contract is taken from the RFC clause and the sibling `record.json` files, whose shape `record-s16d-fr.TEMPLATE.json` mirrors. **I am read-only**: neither the evidence bundle nor the ledger row is committed by me — the manager lands them (extend the catalogue-only commit scope for these records, per the audit-records rule). My working files live in this session's scratchpad only and are the served artifacts of record until that commit exists:

- `audit-s16d-fr.md` (this report)
- `check-s16d-fr.mjs` (the checker)
- `audit-run.log` (actual execution log, `exit=0`, `== SUMMARY: ALL PASS ==`)
- `receipt-s16d-fr.TEMPLATE.json`, `record-s16d-fr.TEMPLATE.json`

## 11. Landed-bytes confirmation (PR #1877 @ `b2110ea9`) — not a new audit

Worktree `~/local-operator-ui/.worktrees/i18n-s16d` verified at **`b2110ea9cd9fd0c103891a4a77b65ba741012cf4`**, `git status` empty. Landed `src/i18n/catalogues/fr/ui.common.time.json` sha256 **`61934e35bbc1451f100d5935e061d3ad869b3c5cf679dd23f933c6ac5c5684b4`** — equal to the manager's recorded value.

**Nothing differs from what I audited.** Each of the four values re-hashes to exactly the audited per-value sha256, and the 4-pair sorted-key compact hash is `263069ffcecb4a0fdda89001350b9de46d42a3062010da5a7422d2aa4551b3ef` pre-landing **and** landed. The English file (`bb0b3aa1…`) and sidecar (`a9069037…`) are unchanged since the audit. The landed file carries the 5 keys in generation order (`yesterday_at`, then the four new ones).

Checker re-run against the **file on disk** (`check-s16d-fr-landed.mjs`, log `audit.log`): key set 5/5 = English, ICU AST placeholder parity per key, NFC, no bidi controls, no `U+0027`, and exact composed strings `Aujourd’hui à 14:30` / `Hier à 18:07` / `mardi à 14:30` / `4 novembre 2026 à 14:30`, standalone `Hier`, sibling `Hier à 14:30` — **ALL PASS**. Negative controls (dropped, renamed, added placeholder, English left, NFD) all caught.

Repository validators, in a scratch mirror of the head (`git archive` + symlinked `node_modules`; nothing installed):

| Validator | Actual output |
|---|---|
| `generate.mjs --check` | `keys.gen.ts is byte-identical to a fresh generation`, exit 0 |
| `check-coverage.mjs` | `ok — 7 gated language(s) over 158 namespace(s); 0 allowed key(s)`, exit 0 |
| `locale-parity.test.mjs` | `tests 44 … pass 44 … fail 0` |
| `context-parity.test.mjs` | `tests 8 … pass 8 … fail 0` |
| `activation.test.mjs` | `tests 8 … pass 8`, incl. *the shipped fr catalogue renders the report's strings in French*. No `fr-activation.test.mjs` exists — fr is covered by this generic test. |
| `ledger-check.mjs` **pre-assemble** | `FAILED — 21 finding(s)`, exactly 3 for fr: stale `source_sha256`, stale `target_sha256`, receipt names other bytes |
| `ledger-assemble.mjs` (mirror) | `fr/ui.common.time -> status audited (prior audits were of older bytes: moved to superseded) | clean, 0 blocker, 0 major, 0 minor, 0 nit` |
| `ledger-check.mjs` **post-assemble** | **0 findings for `fr`** (the 18 remaining are es/hi/ru/ur/vi/zh-CN, other auditors' lanes — I audited fr only) |

Landed receipt: `audit-receipt.json`, sha256 `2cf6c89fc4ced57455ada786575d04774146817bc0709830a9d0ce3afe5cc041` — the assembler copies it byte-identically to `i18n/receipts/51f78513d13c.json`, so the row's `receipt_sha256` is stable. Assembled row: `status: audited`, `result: clean`, findings all 0, `source_sha256` `bb0b3aa1…`, `target_sha256` `61934e35…`, prior `d94011de0dc0` audit moved to `superseded`.

**Command to run in the repo/worktree** (nothing else needed; the row exists, its old audits are superseded and its translator metadata is kept, so **no translator flags may be passed** — `ledger-assemble` refuses `--translator-agent`/`--translator-model` on an existing row without `--update-translator`, and `--update-translator` is neither needed nor allowed here because the bytes are stale):

```bash
node scripts/i18n/ledger-assemble.mjs \
  --locale fr \
  --file src/i18n/catalogues/fr/ui.common.time.json \
  --auditor-instance 51f78513d13c \
  --auditor-model deepseek/deepseek-flash \
  --result clean \
  --date 2026-11-12 \
  --receipt i18n/audits/evidence/fr/ui.common.time/s16dfr1/audit-receipt.json \
  --scope "ui.common.time, 4 landed keys (today_at, yesterday, weekday_at, date_at) at b2110ea9: placeholder parity, real app formatter end to end under fr Intl, typography, glossary, sibling yesterday_at." \
  --note "0 blocker/major/minor/nit on the 4 landed fr keys; values byte-identical to the pre-landing audit (canonical 263069ff); 2 app-side info OBS. Record: i18n/audits/evidence/fr/ui.common.time/s16dfr1/record.json"
```

`--note` is 207 chars (≤280, measured) and names the tracked record. This exact command was executed in the mirror and produced the row above; `--auditor-model` must stay `deepseek/deepseek-flash` to match the receipt's `model`, or the assembler refuses.

**Landing set** (all in this session's scratchpad, laid out as the repo path it belongs at; `record.json` binds their hashes):

```
evidence/fr/ui.common.time/s16dfr1/report.md          (= this document)
evidence/fr/ui.common.time/s16dfr1/audit.log          (= audit-landed.log, landed run)
evidence/fr/ui.common.time/s16dfr1/audit-pre-landing.log
evidence/fr/ui.common.time/s16dfr1/audit-receipt.json (= receipt-fr-s16d-landed.json)
evidence/fr/ui.common.time/s16dfr1/record.json
```
