# Independent i18n audit — ru · `ui.chat.canonical` (PR #1861 rebased onto #1862)

```
locale:        ru
namespace:     ui.chat.canonical
auditor_agent: i18n-auditor (independent of every translator on this namespace)
actual_served_model: deepseek/deepseek-flash
model_source:        harness session header for this run ("Model: deepseek/deepseek-flash");
                     no fallback was declared or used
session:       e8fd410766e5
audit_date:    2026-11-11
subject:       git commit 659ef7e44b7c (branch cand-rebased-unaudited), worktree
               ~/local-operator-ui/.worktrees/i18n-l2-file-sizes, read ONLY via
               `git show <commit>:<path>` — nothing checked out, nothing built
key_count:     442 (en) / 442 (ru) / 442 (context sidecar)
input_hashes:  sha256 over `git show 659ef7e44b7c:<path>` bytes
  en:       src/i18n/catalogues/en/ui.chat.canonical.json
            38f1069648c9241799bb1b316820e0530bf9445dfba3151e1c28df70153916b3
  context:  src/i18n/catalogues/en/ui.chat.canonical.context.json
            c258ab485de698eec85e81ffed506866e3b1e8caf29cb3ff434901388065b390
  ru:       src/i18n/catalogues/ru/ui.chat.canonical.json
            a84811e9c087aa79873ef756a2a268e298ebe4b6789d7dd834f4f51a127b4acb
verdict:       clean-with-findings  (ledger status: audited)
severity:      blocker 0 · major 0 · minor 2 · nit 4
finding_ids:   M1, M2, N1, N2, N3, N4
```

Reference hashes for the same three paths at `origin/main` (the pre-rebase audited
bytes): `en a385671b988e5f03df6f650beb4a06f73c9efaead2316dfa9ab15bf043798765`,
`context 2e755f12e46bb6dded6dbf950eda6402a0b7bcb05e9489fa17f7369543f3ac7f`,
`ru 75ec2986a0248f8b36bb4e34b091f83da911e45ba731551457d58a837da95e64`. The main
hashes are exactly the ones the current ledger row and receipt `l1verb-ru-r2.json`
record, so that row is bound to older bytes and this audit is the fresh
independent pass the rebased head needs.

---

## 1. Scope and method

**Read first.** Core glossary `~/local-operator/i18n/glossary.md`
(`0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8`) and the ru
style guide `~/local-operator/i18n/style-guides/ru.md`
(`f20e1cafaf70578c17ce072c71725628808d228e4be5604329f8da30386f1fb5`); there is
no `i18n/style-guides/` or glossary inside the UI repo (checked: the paths do not
exist at this commit), so the core copies are the binding ones. Then
`docs/I18N.md`, the English catalogue, its `.context.json` sidecar, and the ru
catalogue.

**What is new in the combined namespace.** Diffing the head against `origin/main`
(the #1862 merge) shows the rebased head adds exactly two keys, at the tail, in
English order:

| # | key | en | ru |
|---|---|---|---|
| 1 | `ui.chat.canonical.tool.never_sent_composed` | `never sent · {size} composed` | `не отправлено · написано {size}` |
| 2 | `ui.chat.canonical.tool.never_sent_empty` | `never sent · nothing composed` | `не отправлено · ничего не написано` |

Nothing else in the ru file or the sidecar differs from main, so #1862's
`tool_row.verb.*` batch (182 keys, audited clean on main) arrives here unchanged
and was reviewed only as a sample plus for terminology consistency with the two
new keys.

**What I actually executed** (all read-only, all tiny; see `au1861ru/audit.log`):

- `shasum -a 256` over the three `git show` outputs — the hashes above.
- `au1861ru/mech.py`, `mech2.py`, `mech3.py` — key-set/order/duplicate parity,
  empty and whitespace checks, NFC, latin-token census, backtick/markup/punctuation
  parity, BOM/CRLF.
- `au1861ru/icu2.mjs` — parses **both** sides with the repository's own pinned
  `@formatjs/icu-messageformat-parser@3.5.21` and compares argument names, plural
  and select names/types/arms, tags and number skeletons.
- `au1861ru/intl.mjs` — `Intl.NumberFormat` under this machine's **ICU 78.3 /
  CLDR 48.0 (Node v24.22.1)** to measure the ru short unit forms the app renders.

**What I did NOT run, deliberately** (memory guard + read-only mandate): no
`pnpm`, no installs, no `node scripts/i18n/generate.mjs --check`, no
`check-i18n`, no `node --test`. Every mechanical property those gates check is
replicated above by my own probes with the same parser; **CI must still run the
full `check-i18n`** — my probes are evidence of what I checked, not a substitute
for that job.

## 2. Mechanical results (all PASS)

| check | result |
|---|---|
| valid JSON, UTF-8, no BOM, LF, trailing newline | pass |
| key set identical to en (442/442), no added, dropped or duplicated keys | pass |
| key order identical to en | pass **except one pre-existing misplacement**, see O2; the two new keys are appended in en order |
| ICU argument names identical, per key | pass (0 diffs over 442 keys) |
| plural/select names, types (cardinal) and exact `=N` arms identical | pass — `au1861ru/icu2.mjs` prints 48 `NUMFMT` rows by design: ru spells `{count, number, ::group-off}` once per arm (4) where en needs 2, so the *occurrence count* of a number skeleton differs while its name, type and skeleton do not. Those rows are the four-arm expansion, not a diff. |
| CLDR categories present for ru | pass — all 58 plural messages carry `one`+`few`+`many`+`other`; no non-ru category appears |
| markup / Rich tags / backticks / code spans / flags / paths / identifiers | pass — backtick and tag counts identical; no value carries a code span |
| empty or whitespace-only values | none |
| English-identical values | 6, all meaning-neutral (see below) |
| NFC every value | pass |
| stray whitespace / NBSP / NNBSP / double space / tab / ZWSP | none beyond the two intended separator keys |
| trailing punctuation parity with en | pass (0 mismatches) |
| typography: `—` spaced, `…`, no `!`, no Title Case, no straight quotes | pass |

The six English-identical values are the ICU skeletons and separators
`tool_row.bridge.detail.headline.target` `{verb} {target}`,
`tool_row.bridge.summary.count` `({count, number, ::group-off})`,
`supplement.withheld.reason_separator` `", "`, `fold.count.named`
`{count, number, ::group-off} {name}`, `fold.unit_separator` `" · "`,
`fold.sentence.join` `{first}, {second}` — placeholders, a comma, and a spaced
middle dot, with no words to translate. Each is already covered by an entry in
`locale-parity.test.mjs`'s `IDENTICAL_OK` table (three global rows, three
`ru:`-scoped rows at lines 1664/1668/1672), so they are not stubs and the parity
gate will not fail on them.

Plural genitive control, spot-checked across all branches (ru is the locale where
a wrong `few`/`many` stem is the classic defect): `fold.count.file`
файл/файла/файлов ✓, `fold.count.sessions` сессия/сессии/сессий ✓,
`fold.receipt.incoming` входящее сообщение / входящих сообщения / входящих
сообщений ✓, `fold.count.jobs` проверка задания / проверки заданий / проверок
заданий ✓, `supplement.withheld.line` файл не показан / файла не показаны /
файлов не показано ✓, `fold.count.other_actions` `и ещё N действие/действия/
действий` ✓. `other` (fraction) arms correctly take the genitive singular
(`1,5 проверки задания`, `1,5 входящего сообщения`).

## 3. Semantic review of the two new file-size keys (focus)

**M0 — no defect found.** Both read as native, terse, lower-case status copy:

- `не отправлено · написано {size}` = "not sent · {size} written". The impersonal
  neuter short participle `написано` with a fronted quantity is standard Russian
  for a measurement without a named subject and needs no agreement with the
  inserted unit (`написано 1,5 кБ`, `написано 12 кБ`) — so the verbatim `{size}`
  insertion cannot produce a case or agreement error. Word order follows en,
  which the sidecar explicitly permits ("whole line is one message so word order
  can follow the target language"), and the middle-dot separator matches the
  file's own convention (`fold.unit_separator` `" · "`, `tool_row.bridge.outcome.*`
  `сбой · {code}`).
- `не отправлено · ничего не написано` = "not sent · nothing written": the
  correct Russian for "nothing composed"; the pair stays parallel in sense and
  verb, and neither line adds a claim the English does not make.
- Polarity is preserved (both are negative), no omission, no added reassurance —
  correct for a status line the reader may act on. No trailing punctuation, as
  the sidecar requires.
- Register: `вы`-neutral impersonal, sentence case — style-guide conformant for a
  one-line status ("terse; no '!'").

**Unit symbols — what I verified vs inferred.** These two keys contain no unit
literal at all: `{size}` is substituted by the caller, so a wrong symbol is
impossible inside the catalogue. I verified the formatter's actual ru output
rather than assuming it: with ICU 78.3 / CLDR 48.0 the ru short forms are
**`Б` / `кБ` / `МБ` / `ГБ`** with a comma decimal mark and an NBSP grouped
integer (`1,5 кБ`, `1 МБ`, `2,3 ГБ`, `1 023 Б`), which matches the pinned ru row
in `scripts/i18n/file-size.test.mjs`
(`["0 Б","1 Б","1 кБ","1 кБ","1,5 кБ","1 МБ","2,5 ГБ"]`) line for line. Note the
CLDR form is **`кБ`**, not the `КБ` in the brief's example — the app renders the
CLDR form, and this is the spelling the ru catalogue should be judged against.
I did **not** execute `formatByteQuantity` itself (no build); the equality above
is the measurement, the function's internals are inferred from
`src/i18n/format.ts` and the test.

## 4. Terminology consistency (sampled across the file group)

Glossary and style-guide terms in this namespace all follow the recorded ru
decision: сессия, агент, субагент, инструмент/`tool`, пробуждение, расписание,
задание (job), команда (team), проект, модель, промпт, сжатие (compaction),
секрет, учётные данные, разговор (conversation), `Team Bridge` kept Latin,
`endpoint` kept Latin and undeclined (`у провайдера нет endpoint для отмены`),
`Finder`/`Canvas`/`Python-код`/`diff` kept as the locale consistently does
elsewhere (`ui.common.file_actions.show_in_canvas` is also `Показать в Canvas`).
The `хаб` rendering for the hub is the dominant ru convention across
`ui.hub.*`/`ui.agents.*` and is used consistently for both of this file's hub
references.

Two genuine inconsistencies remain, both pre-existing (see findings M1, N1, N4).

## 5. Fit

The sidecar carries no `maxChars`/`maxCells` for this namespace — only a `length`
prose hint and 10 `length_hint`s — so fit was judged against those hints and the
row's documented behaviour ("shares one row with the tool name and truncates with
an ellipsis when narrow"). The two new lines grow modestly and symmetrically:
`never sent · 1.5 KB composed` (28) → `не отправлено · написано 1,5 кБ` (31);
`never sent · nothing composed` (29) → `не отправлено · ничего не написано` (34).
Median ru/en character ratio across the file is 1.21, so these two sit inside the
locale's normal growth.

Measured properly, because raw value length is the wrong yardstick here: a plural
message holds every arm, and only one renders, so the raw deltas on
`fold.images_aria` (102 → 273) are branch duplication, not width. Substituting a
number for the skeletons and taking the widest single rendered arm (probe
`au1861ru/fit.mjs`), the largest ru growths are
`supplement.preview_unavailable` 112 → 145 (+33, a wrapped body sentence),
`tool_row.bridge.delivery.awaiting_acceptance.title` 61 → 85 (+24, a `title`
attribute), `security_notice.blocked` 22 → 43 (+21, an aria sentence) and
`older_history.windowed.title_gesture` 41 → 62 (+21, a full sentence with a
`title` fallback). None of them is a chip, button, tab or status slot with a
pinned budget; the widest rendered value in the file is `sound.stop.warning` at
200 characters, a wrapped explanatory paragraph. Nothing here is a layout risk.

RTL: not applicable — ru is LTR; no bidi isolation or mirroring question arises,
and no value mixes an RTL run.

## 6. Findings

All six are **pre-existing**: each value is byte-identical to `origin/main` and
none was touched by this PR. They are recorded, not churned (the ledger's
`clean-with-findings` shape). None is a blocker or major, so none gates the merge.

### M1 — MINOR — `ui.chat.canonical.fold.count.network`

- current: `{count, plural, … {count, number, ::group-off} вызов меш-сети …}`
- en: `{count} network calls`
- problem: the English noun is `network`, but the ru value names `меш-сеть`
  (mesh), an addition the source does not make. The same file renders this tool's
  noun as plain `сеть` in four sibling keys (`joined_network` «к сети»,
  `left_network` «из сети», `read_network_log` «журнал сети»,
  `diagnosed_network` «диагностику сети»), and `ui.mesh.json` reserves
  «Меш-сеть» for *mesh* (`ui.mesh.mesh_page.mesh`) while using «сеть» for
  *network*. One concept, two words, in one row of the fold.
- suggested: `вызов сети` / `вызова сети` / `вызовов сети` / `вызова сети`.

### M2 — MINOR — `ui.chat.canonical.fold.count.lsp`

- current: `… поиск по коду` (few `поиска по коду`, many `поисков по коду`)
- en: `… code lookup`
- problem: `поиск по коду` reads as "search **by** code" (as with a promo code or
  a key). The tool looks symbols up **in** the code; a native reader can take the
  phrase for a lookup keyed by a code string.
- suggested: `поиск в коде` (few `поиска в коде`, many `поисков в коде`).

### N1 — NIT — `ui.chat.canonical.tool_row.generic_verb.running` / `.settled`

- current: `Вызывается` / `Вызван`
- en: `Calling` / `Called`
- problem: passive/past-passive, while all ~180 sibling verb keys in this file are
  active third person about the caller (`Читает`/`Прочитал`,
  `Выполняет`/`Выполнил`). The row's own voice changes only for the generic verb.
  Meaning is not wrong; if the passive is the deliberate call, record it in the
  ru style guide so a later wave does not "fix" it.
- suggested: `Вызывает` / `Вызвал`, or a recorded decision to keep the passive.

### N2 — NIT — `ui.chat.canonical.tool_row.bridge.delivery.unconfirmed.short`

- current: `под вопросом`
- en: `unconfirmed`
- problem: the same concept is named `не подтверждено` in `.word` and `.label`,
  `Не подтверждено` in `.note` and `не подтвердил` in `.title`; the narrow chip
  alone swaps in an idiom ("in question"). It reads as doubt about delivery
  rather than a specific missing confirmation.
- suggested: `не подтверждено` if the chip budget allows it (13 cells); otherwise
  keep and record it as the short spelling.

### N3 — NIT — `ui.chat.canonical.older_history.windowed.short_gesture`

- current: `Вверх — ранние сообщения`
- en: `Scroll up for earlier`
- problem: the imperative is dropped, so the narrow row reads as a label ("above —
  earlier messages") instead of the instruction the full value gives
  (`title_gesture`: «прокрутите вверх, чтобы загрузить»). In a row whose whole
  point is telling the reader the gesture, the verb is the actionable half.
- suggested: `Вверх — к ранним сообщениям` (or `Прокрутите вверх`) if the cells
  allow; this row is not in a pinned budget.

### N4 — NIT — `ui.chat.canonical.fold.receipt.steered`

- current: `Ход направлен`
- en: `Steered`
- problem: the `steer` action is rendered `Корректирует`/`Скорректировал` in
  `tool_row.verb.steered.*` in this same file, and `Ход направлен` here names the
  turn rather than the action. One concept, two renderings.
- suggested: `Скорректировано` (keeps the verb family and stays a receipt label).

## 7. Observations (not findings, not counted)

- **O1 — English still reaches the ru transcript from two sibling branches.**
  `toolRecordSummary` in `src/renderer/src/features/chat/canonical/
  canonical-transcript.tsx` returns raw template literals for the
  `composing` and `queued` phases
  (`` `composing${…}` ``, `` `queued${…}` `` — lines ~2325-2329 at this commit),
  so those two status words render in English in every locale, ru included, while
  the third branch (`never sent`) is now keyed. This PR did not introduce them
  (the diff only replaces the `never sent` literal with `t(...)`) and no gate
  flags them, but they are customer-visible untranslated English in this very
  row. Suggested key pair, mirroring the new one:
  `tool.composing_composed` / `tool.composing_empty` and
  `tool.queued_composed` / `tool.queued_empty`. Coder-lane work; out of scope for
  a translation audit and not a reason to hold this PR.
- **O2 — one pre-existing key-order mismatch.** `ui.chat.canonical.fold.count
  .actions_partial` sits at ru index 248 but en index 240, at main and at head
  alike (verified both). No gate checks order (`locale-parity` checks key sets,
  placeholders and stubs; `check-coverage` sorts only its `missing` lists), and
  JSON lookup is order-independent, so nothing is broken. Recorded because the
  ledger binds whole-file hashes, and a future hand-union should not mistake it
  for damage from this rebase.
- **O3 — new sub-namespace beside the old one.** The two new keys are
  `ui.chat.canonical.tool.*` while the 182 verbs and the status words next to
  them are `ui.chat.canonical.tool_row.*`. That is an English-side naming choice,
  outside locale scope; noted only because a later extraction pass will want one
  prefix.
- **O4 — the worktree's working tree is NOT the candidate.** `~/local-operator-ui/
  .worktrees/i18n-l2-file-sizes` is checked out at `fbecdf64fc6` on branch
  `feat/i18n-l2-file-sizes` (a pre-rebase tip), which carries **260** keys in this
  namespace, not 442 — it is the tree without #1862's 182 verb keys. The candidate
  `659ef7e44b7c` exists only as a commit on branch `cand-rebased-unaudited`
  (`git branch --contains` confirms). Anything that reads the checkout instead of
  `git show 659ef7e44b7c:…` — a validator run, a screenshot, a second auditor —
  would audit or capture the wrong bytes and report a false clean. This audit read
  the commit object throughout, so its hashes are the candidate's.
- **O5 — no repo writes, and the checkout was verified untouched.** `git status
  --porcelain` in that worktree is empty after this audit; HEAD and branch are
  unchanged. Nothing was checked out, installed, built or generated.

## 8. Verdict

**clean-with-findings** — 0 blocker, 0 major, 2 minor, 4 nit. No BLOCKER or MAJOR
remains, so the ledger row for `ru` / `ui.chat.canonical` may be recorded as
`status: audited` against the head hashes in the record block above. The two new
file-size keys — the reason this rebase needed a fresh audit — are clean, and the
namespace as a whole reads as native product copy.

Per the ledger contract, this pass is a *new* audit, not a replacement: the
older receipts (`l1verb-ru-r2`, `dd15c8ca1a91-r2`, …) describe older bytes and
belong in the row's `superseded` history, which `ledger-assemble.mjs` moves there
by itself when the on-disk hashes no longer match.

## 9. Ledger handoff (for the implementing session)

This audit is read-only, so nothing was written into the repository: no
`i18n/ledger.json` edit, no `i18n/receipts/` file, no evidence bundle. Three
artifacts are staged in this session's scratchpad and are byte-stable for copying:

| artifact | scratchpad path | destination |
|---|---|---|
| report | `audit-1861-ru.md` | `i18n/audits/evidence/ru/ui.chat.canonical/e8fd410766e5-b1861/report.md` |
| record | `au1861ru/record.json` | `i18n/audits/evidence/ru/ui.chat.canonical/e8fd410766e5-b1861/record.json` |
| execution log | `au1861ru/audit.log` | `i18n/audits/evidence/ru/ui.chat.canonical/e8fd410766e5-b1861/audit.log` |
| receipt | `au1861ru/receipt.e8fd410766e5.json` | `i18n/receipts/e8fd410766e5.json` (copy **byte-for-byte**; its `receipt_sha256` is derived from those bytes) |

Then record the row with the RFC's ledger writer:

```sh
node scripts/i18n/ledger-assemble.mjs --locale ru \
  --file src/i18n/catalogues/ru/ui.chat.canonical.json \
  --auditor-instance e8fd410766e5 --auditor-model deepseek/deepseek-flash \
  --result clean-with-findings --receipt i18n/receipts/e8fd410766e5.json \
  --scope "whole ui.chat.canonical namespace (442 keys) at 659ef7e44b7c, focused on the 2 size keys" \
  --note "see i18n/audits/evidence/ru/ui.chat.canonical/e8fd410766e5-b1861/"
```

Because the on-disk hashes differ from the row's recorded ones, the writer moves
the existing audits (`l1verb-ru-r2` and friends) to `superseded` by itself and
restarts the row from this pass — that is the intended behaviour for a rebase,
not a loss of history.

**Verified, not assumed:** I ran the repo's own `scripts/i18n/ledger-rules.mjs`
(extracted read-only from the subject commit) against the receipt draft with the
head hashes. `deriveReceiptAudit` produced
`result clean-with-findings`, `findings {blocker 0, major 0, minor 2, nit 4}`
bound to `38f10696…` (en) and `a84811e9…` (ru); with the row shape the assembler
writes (plus `date`, `receipt`, `receipt_sha256`), `validateAuditSet` returns no
failures and `supportedStatus` returns **`audited`**. Probe:
`au1861ru/check-receipt2.mjs`.
