# Urdu (`ur`) independent audit — `ui.chat.canonical`, combined bytes after the #1862 rebase

## Record block

| field | value |
|---|---|
| locale | `ur` (RTL) |
| namespace | `ui.chat.canonical` (442 keys) |
| audit kind | independent combined-bytes audit (delta = 2 file-size keys; whole-file mechanical; sampled semantic) |
| auditor agent | `i18n-auditor` (team `lopdev`) |
| session | `4b55e20f2c31` |
| **actual served model** | **`deepseek/deepseek-flash`** (effort `high`) — read from this session's own `~/.local-operator/sessions/4b55e20f2c31/tail-anchor.v1.json`: `selection_payloads[-1].details.selector = "deepseek/deepseek-flash"`, `boot = "deepseek/deepseek-flash"`. No model-switch, fallback or provider-degradation notice appeared in this session. |
| independence | I translated none of this and edited nothing. No translation/MT service or back-translation was used. `independent_from_translator_session: true` (translator of the verb batch: `openai/gpt-6.1-sol`; translator of the size keys per the slice brief: `anthropic/claude-sonnet-5-5`; both sessions undisclosed to me, identity taken from the brief). |
| date | 2026-11-11 |
| candidate | commit `659ef7e44b7ccb4800e9853ef355ea58b49854cc` (`cand-rebased-unaudited`), read only via `git show` from `~/local-operator-ui/.worktrees/i18n-l2-file-sizes` |
| verdict | **clean-with-findings** → ledger status `passed` (0 BLOCKER, 0 MAJOR) |
| severity counts | BLOCKER 0 · MAJOR 0 · MINOR 3 (1 in delta, 2 pre-existing) · NIT 4 |

```
input_hashes:
  en      src/i18n/catalogues/en/ui.chat.canonical.json         38f1069648c9241799bb1b316820e0530bf9445dfba3151e1c28df70153916b3
  context src/i18n/catalogues/en/ui.chat.canonical.context.json c258ab485de698eec85e81ffed506866e3b1e8caf29cb3ff434901388065b390
  target  src/i18n/catalogues/ur/ui.chat.canonical.json         479f3224402071b5d31024e6b0a44400a7824b784114678f1fc4349536ee80f2
  (all three computed with python hashlib over the exact `git show 659ef7e44b7c:<path>` bytes)
reference hashes (not audited, listed for the manager):
  origin/main en    a385671b988e5f03df6f650beb4a06f73c9efaead2316dfa9ab15bf043798765  ← current ledger source_sha256
  origin/main ur    8e8828ecaad567be6e43efc8a2e34434c6f1df1460c6fb46ecdeba20ac52a83f  ← current ledger target_sha256
  origin/main ctx   2e755f12e46bb6dded6dbf950eda6402b0a7bcb05e9489fa17f7369543f3ac7f
```

The ledger row for `ur` / `ui.chat.canonical` is fresh **for main** (both hashes match `origin/main`), and stale for this candidate by construction: the candidate adds two keys to the same file, so both the source and the target hash move. That is why this audit exists; the values to write are above.

## Scope, and how the delta was found

`git show 659ef7e44b7c:...en/ui.chat.canonical.json` vs the same path at `origin/main`: exactly **two** keys added, nothing removed, order of the 440 retained keys unchanged.

| added key | English |
|---|---|
| `ui.chat.canonical.tool.never_sent_composed` | `never sent · {size} composed` |
| `ui.chat.canonical.tool.never_sent_empty` | `never sent · nothing composed` |

The 182 `tool_row.verb.*` keys were already in both trees (the #1862 merge) and their values are byte-identical between `origin/main` and this candidate, so the rebase changed nothing semantic there. Read against: `docs/I18N.md`, the `ur` style guide (`~/local-operator/i18n/style-guides/ur.md`), `i18n/glossary.md`, the English context sidecar (both new keys carry `role`/`tone`/`length`/`placeholders`; neither carries `maxCells`), the sibling locale catalogues, the consuming call site and the runtime bidi layer.

## 1. Mechanical — PASS (all checks executed in python against the candidate bytes)

The repo's own validators (`generate.mjs --check`, `check-duplicates.mjs`, `check-strings.mjs`, `ledger-check.mjs`, `context-parity.mjs`) were **NOT executed**: this brief forbids running the generator, tests or builds under the active memory guard. Their rules were replicated instead and the replication is the execution log (`au-1861-ur/audit-replication.log`). This is stated rather than implied — the ledger gate itself stays the manager's to run.

| check | result |
|---|---|
| key set equals English | PASS — 442 / 442, no key added, dropped or renamed; `list(ur) == list(en)` (same order) |
| duplicate keys in raw JSON text (replicating `check-duplicates.mjs`) | PASS — none in either file (`object_pairs_hook` over the raw bytes) |
| plain placeholder names/types | PASS — 0 mismatches over all 442 keys; `{size}` appears exactly once in `never_sent_composed` and 0 times in `never_sent_empty` |
| ICU structure (plural/select/number) | PASS — identical to English for every key: same icu argument names, same places, same arms (compared per key, arm sets equal, nested arms walked) |
| CLDR categories for `ur` | PASS — the union of plural arms used is `one`, `other` plus exact `=0`/`=1`; `other` present on every plural; no `zero`/`two`/`few`/`many` (correct for `ur`: one/other only) |
| manual bidi controls (replicating `scripts/i18n/ur-activation.test.mjs` `MANUAL_BIDI`) | PASS — 0 hits for U+200E/200F/2066–2069 anywhere |
| forbidden script (`FORBIDDEN_SCRIPT`: Devanagari, danda, Arabic-only yeh/kaf/teh-marbuta) | PASS — 0 hits |
| NFC / control characters / stray whitespace | PASS — no non-NFC value, no `Cc/Cf/Co/Cn`, only the two intentional separator values carry edge spaces (`fold.unit_separator` = `" · "`, `supplement.withheld.reason_separator` = `"، "`), both identical in intent to English |
| empty values | PASS — none |
| valid JSON / UTF-8 | PASS (json.loads on the exact `git show` bytes) |
| context sidecar parity (replicating `context-parity.mjs` point 2–3) | PASS — 442 catalogue keys / 442 sidecar entries, no missing key, no phantom entry |
| Urdu punctuation conventions | PASS — no ASCII `.`/`?`/`!` sentence terminals, no `।`, no `٫`/`٬`; Urdu `۔` `،` `؟` used where needed |

**Values identical to English (3), named with why each is legitimate:**

1. `ui.chat.canonical.tool_row.bridge.summary.count` = `"({count, number, ::group-off})"` — pure ICU number format, no words.
2. `ui.chat.canonical.fold.count.named` = `"{count, number, ::group-off} {name}"` — ICU number + placeholder only.
3. `ui.chat.canonical.fold.unit_separator` = `" · "` — a separator token, not copy.

Latin/token residue in the catalogue is limited to glossary §1 keep-English surface names and machine tokens: `Local Operator`, `Team Bridge`, `Python`, `HTML`, `Canvas`, `Finder`, `Enter`, `endpoint` (wave-2 kept-English set), `diff`/`Diff`, `seq`, and placeholder names. No untranslated English sentence remains.

## 2. RTL / bidi — PASS, and the isolation is load-bearing (measured, not assumed)

The two new values place a Latin-unit size (`12.4 kB` for `ur`, see §3) between two RTL clauses.

- Runtime path read: `src/i18n/bidi.ts` → `translate()` calls `needsIsolation(value)` per plain-splice argument; a value with a Latin letter/key glyph, no RTL character and no bidi control gets `FSI…PDI`. `"12.4 kB"` qualifies (letters `k`,`B`, no RTL char) → isolated. The catalogue correctly carries **no** marks of its own.
- I measured it rather than trusting that reading, with `fribidi --rtl --nobreak` (Homebrew 1.0.x) on the exact catalogue value:
  - without isolation the run paints `kB 12.4` (unit left of the number — wrong);
  - with `FSI…PDI` it paints `12.4 kB` intact, visual order `status → · → size → detail`.
- The top-rung symbol `پی بی` (PB, §3) contains RTL letters, so it would *not* be isolated — I checked that too: `2.4 پی بی` renders number-then-unit correctly in an RTL paragraph without isolation, so the `needsIsolation` gate is safe for every unit this formatter can emit.
- The separator is the same U+00B7 with a space each side that `fold.unit_separator`, `transcript.job_suffix` and `tool_row.bridge.outcome.failed` already use in this catalogue, so the row family stays visually consistent. No manual marks, no mirrored arrows, no path/command tokens in the new copy.

## 3. File-size unit symbols — what I verified vs inferred

**Verified** by running Node 24.22.1 (ICU 78.3 / CLDR 48.0) `Intl.NumberFormat(locale, {style:"unit", unitDisplay:"narrow"|"short"})`:

| unit | `ur` narrow | `ur` short |
|---|---|---|
| byte | `B` | `byte` (English word — correctly rejected by the code's narrow choice) |
| kilobyte / megabyte / gigabyte / terabyte | `kB` / `MB` / `GB` / `TB` | same |
| petabyte | `پی بی` | `پی بی` |

Also verified: `ur` resolves numbering system `latn` (Latin digits, as the style guide requires), and the number↔unit glue is a plain space (`formatToParts` literal). So the app prints `12.4 kB` under `ur` — Latin unit symbols are this locale's own CLDR short forms, not leftovers, and they match the formatter rather than any hand-written table (the module asks `Intl`, per its own `FILE-SIZE UNITS` note).

**Inferred, not executed:** that the *renderer* surfaces reach this helper on every size path. I read two call sites (`tool-row-model.ts::formatBytes` and `shared/lib/format-bytes.ts` both delegate to `formatByteQuantity`) and the never-sent call site (`canonical-transcript.tsx::toolRecordSummary` → `formatBytes(record.argumentBytes)` imported from `tool-row-model`). I did not build or run the app.

Observation (not a defect in this PR, NIT N2 below): CLDR mixes scripts at the top rung — `B/kB/MB/GB/TB` Latin but `PB` in Urdu script. `formatBytes`' ladder can in principle reach PB, but no call site formats above MB, so nothing in the product can paint it today.

## 4. Semantic focus — the two delta keys

| key | English | `ur` under audit | back-reading |
|---|---|---|---|
| `tool.never_sent_composed` | `never sent · {size} composed` | `نہیں بھیجا گیا · {size} لکھا گیا` | "was not sent · {size} was written" |
| `tool.never_sent_empty` | `never sent · nothing composed` | `نہیں بھیجا گیا · کچھ نہیں لکھا گیا` | "was not sent · nothing was written" |

What holds up:

- **Meaning and polarity.** No omission, addition or negation error: the first clause is negated, the second affirmative in the composed line and negated in the empty line — exactly English's polarity. `لکھا گیا` ("was written") is faithful to the context note's own gloss of *composed* ("how much of the request the model had written before it stopped"), and it matches this catalogue's own `tool_row.verb.wrote` («لکھ رہا»/«لکھا»).
- **Parallelism.** The two lines share `… گیا` + the `·` separator and differ only in the size clause, which is what the context note asks for ("keep the two lines parallel in wording"). A literal echo of English's "composed" («تیار کیا گیا» / «تحریر کیا گیا») would have broken that parallelism for no gain.
- **Register and address.** Terse status, no `آپ` needed, no trailing punctuation, no `براہ کرم`, no exclamation — matches the English `tone` field and the style guide's command/status register.
- **Fit.** 33–34 cells including a `12.4 kB` size against English's 29 (≈+14…17%), on a row the context says truncates with an ellipsis and which carries no `maxCells` hint. No overflow gate applies; the growth is comfortable.
- **Terminology.** No glossary term is involved; the size token is formatter-owned and is not translated or reformatted by the string (correct — the context says "insert verbatim").

### M1 — MINOR — `ui.chat.canonical.tool.never_sent_composed` / `…_empty` (in delta)

**Current:** `نہیں بھیجا گیا · {size} لکھا گیا` and `نہیں بھیجا گیا · کچھ نہیں لکھا گیا`
**Problem:** the bare passive is **masculine** (`بھیجا گیا`), while this catalogue's own tool-call status family agrees **feminine** with the call/request noun (`کال`, `درخواست` are both feminine): `tool_row.outcome.interrupted` «روکی گئی», `tool_row.outcome.never_ran` «کبھی نہیں چلی», `transcript.not_run` «نہیں چلائی گئی», `transcript.interrupted` «روکی گئی», `notice.stopped_with_error` «خرابی کے ساتھ رک گئی». A reader who has just read «کال جاری / کال مکمل» on the same row meets a masculine passive for the same entity.
**Suggested:** `نہیں بھیجی گئی · {size} لکھا گیا` and `نہیں بھیجی گئی · کچھ نہیں لکھا گیا` (the second clause keeps `لکھا گیا`, whose understood noun is the composed text, masculine — mixed gender inside one line is normal Urdu).
**Why only MINOR, stated honestly:** the masculine singular is the unmarked impersonal passive in Urdu and there is a real counter-reading (`پیغام`, masculine, "was not sent"), so nothing is unsafe, ambiguous or wrong-meaning. I would not block the PR on it; it is a consistency finding with an evidence path (the sibling keys above), and the fix is a two-line change if the translation lane agrees.

## 5. Sampled review of the rest (all 442 keys read; 182-key verb family read in full)

The `tool_row.verb.*` family is internally coherent: running forms carry the subject-agreement participle («… کر رہا») and settled forms switch to object agreement where the object is feminine («ٹیم بنائی», «ٹیم حذف کی», «ٹیم دیکھی», «بیداری منسوخ کی», «سیشن کی جھلک دیکھی») — a native pattern applied uniformly, not drift. Glossary decisions hold throughout: `سیشن` (never `نشست`), `بیداری`, `ایجنٹ`/`ذیلی ایجنٹ`, `تیار`/`ترتیبات` register, `محفوظ کریں` for save, `منسوخ`/`حذف`/`تصدیق` rather than Latin/English borrowings for destructive verbs, tool names (`Python`, `Team Bridge`) kept Latin. Plural inflections are correct in their slots (`بیداریوں کی فہرست` oblique vs `بیداریاں` direct). No informal `تم/تو` anywhere.

Two **pre-existing** idiom problems (identical bytes at `origin/main`, therefore not introduced by this delta and not gating it):

### M2 — MINOR — `ui.chat.canonical.older_history.windowed.title` (+ `.title_gesture`, `.unproven.long`) — pre-existing

**Current:** «اوپر پچھلی تاریخ» / «اوپر پچھلی تاریخ — لوڈ کرنے کے لیے اوپر سکرول کریں» / «پچھلی تاریخ لوڈ نہیں ہوئی»
**Problem:** `تاریخ` means both *history* and *date*; in a chat UI «پچھلی تاریخ» reads first as "the previous date". The same key family elsewhere in this file correctly says «پچھلے پیغامات» for "earlier messages", so this is internally inconsistent too.
**Suggested:** «اوپر پچھلی گفتگو» / «اوپر پچھلی گفتگو — لوڈ کرنے کے لیے اوپر سکرول کریں» / «پچھلی گفتگو لوڈ نہیں ہوئی».

### M3 — MINOR — `ui.chat.canonical.fold.count.list_variables` — pre-existing

**Current:** `{count, plural, one {{count, number, ::group-off} بار متغیرات کی فہرست} other {… same …}}`
**Problem:** the spurious `بار` ("times") turns "variable lookup" into "times the variable list", and the plural arm is identical to the singular. The sibling `fold.count.read_variable` («متغیر پڑھنا») has no `بار`.
**Suggested:** `{count, plural, one {{count, number, ::group-off} متغیرات کی فہرست} other {{count, number, ::group-off} متغیرات کی فہرستیں}}`.

### NITs (4)

- **N1** — `ui.chat.canonical.checkpoint_rail.label` «باری کے چیک پوائنٹس»: `باری` is turn-taking ("your turn"), a loose fit for an agent turn. «ہر باری کے چیک پوائنٹس» reads better; keeping `باری` is defensible. Pre-existing.
- **N2** — formatter observation, not catalogue copy: CLDR spells `ur` byte units `B/kB/MB/GB/TB` in Latin but `پی بی` for petabyte (measured §3). Unreachable from any call site today; noted for whoever owns `src/i18n/format.ts`.
- **N3** — width: the two new lines are 33–34 cells against English's 29 (+14…17%). No `maxCells` hint exists for these keys and the row truncates with an ellipsis, so this is informational.
- **N4** — `tool_row.outcome.never_ran` «کبھی نہیں چلی» vs `transcript.not_run` «نہیں چلائی گئی»: two spellings of "never ran" in one family. Both idiomatic; retained. Pre-existing.

## 6. Limits — what this audit does not prove

- Repo validators and the app were **not** run (brief: read-only, no generator/build/tests). Mechanical results come from my own re-implementation of those rules; where a rule was re-implemented the script it mirrors is named above.
- No rendered frame was captured: `ur` in the TUI is a documented best-effort RTL stance and the Electron mirroring is a renderer concern; I judged the strings and measured the bidi ordering, not a painted surface.
- I did not re-audit the 182 verb keys' decisions beyond reading them for consistency (`origin/main` carries an independent clean round for them with 2 nits); no new finding arose there.

## 7. Ledger row this audit supports

Per locale + file group, `ur` / `ui.chat.canonical`:

```
status:        passed            (0 BLOCKER, 0 MAJOR; MINOR 3, NIT 4)
source_sha256: 38f1069648c9241799bb1b316820e0530bf9445dfba3151e1c28df70153916b3
target_sha256: 479f3224402071b5d31024e6b0a44400a7824b784114678f1fc4349536ee80f2
auditor:       i18n-auditor · deepseek/deepseek-flash · 4b55e20f2c31 · 2026-11-11
verdict:       clean-with-findings (no blocker/major)
```

Suggested `note` (≤280 chars, with the evidence path as the tracked record):

`Combined-bytes audit after the #1862 rebase: 442/442 keys, order and ICU arms match en, ur one/other only, no bidi controls/forbidden script, size unit kB per CLDR (Intl measured). 0 blocker/major; 1 delta minor (passive gender), 2 pre-existing minors. Evidence: i18n/audits/evidence/ur/ui.chat.canonical/l2comb-ur-20261111/`

Artifacts in this session's scratchpad (not repo-tracked, not to be treated as the served record): `scratchpad://audit-1861-ur.md` (this report), `scratchpad://au-1861-ur/audit-replication.log` (mechanical execution log), `scratchpad://au-1861-ur/{en,ur}_ui.chat.canonical.json`, `scratchpad://au-1861-ur/en_ui.chat.canonical.context.json`, `scratchpad://au-1861-ur/ref/{en,ur}_main.json` (the exact bytes hashed above).
