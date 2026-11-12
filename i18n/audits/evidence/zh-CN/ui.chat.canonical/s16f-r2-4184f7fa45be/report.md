# independent translation audit — zh-CN, S16f generation-card labels — round 2

- **Auditor**: `i18n-auditor` (lopdev team), session `4184f7fa45be`, model `deepseek/deepseek-flash`
  (session model header; no fallback, no provider substitution). Instance id `zh-cn-s16f-r2`.
- **Independent of**: the translator `i18n-translator` on `anthropic/claude-sonnet-5-5`, and of the round-1
  auditor (session `c69a71ac5b59`, whose record/report I read only as input). I translated nothing here and
  edited nothing here.
- **Audited bytes**: `~/local-operator-ui/.worktrees/i18n-s16a` @ `9931d62addf8a0606bb26d32a8bc163dc7c126b3`
  (`git rev-parse HEAD` verified, `git status --porcelain` empty; the worktree was never written).
  PR **#1876** head is the same SHA (`gh pr view 1876`: `headRefOid 9931d62a…`, OPEN, non-draft).
- **Read first**: `~/local-operator/i18n/style-guides/zh-CN.md` and `i18n/glossary.md`, then the English
  source + `ui.chat.canonical.context.json` sidecar, then the landed zh-CN catalogue.
- **Method**: scratch mirror via `git archive HEAD src scripts i18n package.json …` (partial: the session
  scratchpad has a 256 MiB cap and the full tree is ~350 MB) with `node_modules` **symlinked** to the shared
  checkout — no install, no dependency duplication. Mechanical checks ran the repo's own tools; the ICU grid
  ran the app's own stack (`intl-messageformat` + `@formatjs/icu-messageformat-parser`, the pair
  `src/i18n/messages.ts` uses). No translation API/SDK/MT service, no back-translation.

## Verdict: **clean** — { blocker: 0, major: 0, minor: 0, nit: 0 }

The two round-1 MAJORs were Chinese word-order calques (`图片 2`, `声音 2`); the landed values are
`第{position}张图片` / `第{position}个声音`, which is the form this namespace already uses. The round-1 MINOR
(`估算费用为 $0`) is landed as `$0` with no space. Nothing else in the ten keys is wrong, and I found no new
defect of my own.

## The round-1 corrections, judged on their merits (not deferred to)

| Key | Landed value | Round 1 said | My judgement |
|---|---|---|---|
| `media.image_label` | `=1 {图片} other {第{position}张图片}` | MAJOR: spaced calque | **Accept.** `第`+number+classifier before the noun is how this namespace numbers pictures: `lightbox.show_image` = `显示第{index}张图片（共{count}张）`; `fold.images_aria` / `lightbox.filmstrip_aria` = `{count_display}张图片`. The style guide bans a space between Chinese and digit runs, so `图片 2` was a real defect and the replacement is the house form. |
| `media.sound_label` | `=1 {声音} other {第{position}个声音}` | MAJOR: same calque | **Accept.** Noun `声音` per `sound.player_failed` = `无法播放此声音`; classifier `个` per the guide's default rule. The player's accessible name becomes `播放第3个声音`, which is exactly the surface the sidecar names. |
| `sound.cost.estimated_zero` | `估算费用为$0；最终计费尚未确认。` | MINOR: space before `$0` | **Accept.** Guide: "No space inserted between Chinese text and Latin/digit runs". `最终计费` is settled billing copy (cf. `sound.stop.warning` = `…则会计费…不保证…免于计费`), and the sentence keeps the sidecar's point that zero is an *estimate* — it is not shortened to a no-charge claim. |

## All ten values, re-read one by one

Precedent cited is from the same locale's existing catalogues (all under `src/i18n/catalogues/zh-CN/`).

1. `sound.batch.item_status` — `{label} · 失败 / · 已停止 / · 状态未知`. One whole message per state; name first,
   state appended, exactly the `失败 · {code}` order already shipped in
   `ui.chat.canonical.tool_row.bridge.outcome.failed` (there the state leads because it is the title). `失败`
   matches `tool_row.outcome.failed`; `已停止` matches `tool_row.verb.stopped_session.settled`; `状态未知` is
   "status unknown" and cannot be read as success or failure. No sentence-final punctuation, as the sidecar asks.
2. `sound.batch.summary` — `已完成3项 · 失败0项 · 已停止1项 · 状态未知3项。需要关注：{labels}`. Parallel stat
   clauses; classifier `项` (the guide's "项 for items") and the same classifier as `latest_update`; counts always
   shown for completed/failed and hidden at `=0` for the other two, structurally verified at runtime. The
   `·` separator with ASCII spaces is established house style, not a stray half-width mark: 128 occurrences across
   31 zh-CN namespace files, and `ui.chat.canonical.fold.unit_separator` is literally ` · `. `需要关注` is the
   dashboard register for "needs attention"; a full-width `。` closes the clause list before it, and `：` is
   full-width. `失败n项` / `已完成n项` mirror the stats order `成功n项、失败n项` in Chinese reporting.
3. `sound.batch.latest_update` — `最近更新：{name}（第{item}项，共{total}项）。` The `第N项，共M项` shape is pinned
   by the repo's own step counter (`scripts/i18n/zh-CN-activation.test.mjs`: `第2步，共5步`); `最近更新` as the
   heading has precedent (`ui.hub.pages.sort.recently_updated`, `ui.projects…most_recent_first`). Full-width
   `（），。`, no space around the Latin/user-data name, no re-wording into a completion count.
4. `sound.cost.unknown` — `费用尚不明确。` `费用` is the glossary/namespace word for cost (`ui.chat.pickers`
   `session_panel.cost` = `费用`); `尚不明确` is the shipped phrasing for "not yet known"
   (`ui.ownerAudit.window_unconfirmed`). Short statement with `。`, as the sidecar's tone requires.
5. `sound.cost.no_charge` — `未收费。` Precedent `ui.chat.session_spend.plan_clause` = `…（API等值，未收费）`.
   Three characters, correct for a confirmed zero bill.
6. `sound.cost.estimated_zero` — see the table above. `$0` is kept (no localisation of the currency sign), the
   `；` is full-width, and nothing promises the estimate is final.
7. `sound.cost.batch_unknown` — `总费用尚不明确。` Sibling of key 4 about the whole batch; `总` carries "total",
   which `batchItemCostCaption` only ever shows for the aggregate caption.
8. `media.image_label` — see the table. `=1` is an exact-match branch (not a CLDR category), allowed in a locale
   whose only plural category is `other`; a lone picture carries no number, per the sidecar.
9. `media.sound_label` — see the table.
10. `supplement.sound_fallback_label` — `生成的声音`. Bare noun phrase, no punctuation, one of the two words the
    sidecar budgets; `声音` stays the noun this namespace uses for a sound artefact, and the value is a fallback
    only (a producer title wins).

## Mechanical evidence (actual output, `repo-checks.log`)

```
generate.mjs --check      src/i18n/keys.gen.ts is byte-identical to a fresh generation.       exit=0
check-coverage.mjs        ok — 7 gated language(s) over 158 namespace(s); 0 allowed key(s).   exit=0
locale-parity.test.mjs    tests 44 / pass 44 / fail 0                                          exit=0
check-duplicates.mjs      ok — 1428 file(s) scanned, 0 duplicate key(s)                        exit=0
context-parity.mjs        ok — every English key covered, 129 allowed gaps in 4 namespaces      exit=0
generation-card-labels.test.mjs            27 pass / 0 fail                                     exit=0
generation-card-locale-switch.test.mjs      1 pass / 0 fail                                     exit=0
```

My own grid (`check.mjs`, `check-r2.log`): **1620 renders** at `zh-CN` — the summary over `completed`
0/1/2/3/5/11/21/22/100/1000/1000000 × `failed` 0/1/2/11/100 × `cancelled` 0/1/2/11 × `unknown` 0/1/3 ×
has_attention yes/no (1320 of the 1620), item_status over failed/cancelled/other × 3 labels, latest_update over
item 1…1000000 × total 1/3/1000000 × 2 names, the four cost lines, and both media labels at every count with
positions 1…1000000 — **no throw, no leftover
`{`/`}`/`#`/`undefined`/`NaN`, no double space**; `=0` hides `已停止`/`状态未知` in every combination; the attention clause appears
only when `has_attention=yes`. Placeholders identical to English as a `{name:type}` set; selector arguments and
types identical; every plural branch is `other` (the only CLDR category for zh-CN) plus the `=0` / `=1` exact
matches English uses; `$0` kept. NFC, no bidi controls, no ASCII ellipsis, no half-width `,`/`;`/`:`/`(`/`)` in
literal copy. **Negative controls: 5/5 in-memory mutants rejected** (English word in copy, unbalanced brace,
non-CLDR `one` branch, renamed placeholder, stray `#`).

Fit (cells, wide glyphs = 2): full summary with attention 74 vs English 99; item_status 13/17 vs 15/23;
latest_update 35 vs 37; cost lines 8–32 vs 10–46. The only strings wider than English are the two numbered media
labels — `第21张图片` 10 vs `Image 21` 8, `第3个声音` 9 vs `Sound 3` 7. Neither carries a `maxCells` hint
(the sidecar has none for this group); both are alt text and tile names in wrapping/truncating containers, so this
is not a fit defect.

RTL: not applicable (zh-CN is LTR).

## Nothing left English

The ten keys contain no Latin words at all (`$0` is the sidecar's own token). A namespace-wide scan of literal
copy found only kept-English names and machine tokens — `Local Operator`, `Team Bridge`, `Canvas`, `Finder`,
`Python`, `diff`, `shell`, `seq`, `HTML`, `Enter` — plus the ` · ` unit separator, all per glossary §1/§2.

**Out-of-scope observation (not a finding against this PR).** `soundBatchCostCaption`
(`src/renderer/src/features/chat/canonical/sound-batch-model.ts:120-127`) still builds its known-total sentence in
English at the call site (`Total cost …` / `Known total cost …` + a sliced English caption). The file's own comment
records this as deliberately unkeyed pending the structured-cost slice. It is pre-existing, outside the ten keys,
and does not gate this PR — but it is a genuine English string a zh-CN reader sees in the same card, so the
manager may want it named in the PR thread as a known gap rather than assumed covered.

## Receipt

`receipt-zh-CN-s16f-r2.json` (in this scratchpad, **not** in the repo). It is accepted by the repo's own writer:
run in the scratch mirror, `ledger-assemble` produced `zh-CN/ui.chat.canonical -> status audited | clean, 0
blocker, 0 major, 0 minor, 0 nit`, and after that `ledger-check` reports **0 findings for zh-CN** (its 18
remaining findings are the six other locales' canonical rows, still stale pending their own round-2 receipts —
not this lane).

Integrator command (from the repo root, receipt copied to the repo path first):

```
cp <scratchpad>/receipt-zh-CN-s16f-r2.json i18n/receipts/zh-cn-s16f-r2.json
node scripts/i18n/ledger-assemble.mjs --locale zh-CN \
  --file src/i18n/catalogues/zh-CN/ui.chat.canonical.json \
  --auditor-instance zh-cn-s16f-r2 --auditor-model deepseek/deepseek-flash \
  --result clean --receipt i18n/receipts/zh-cn-s16f-r2.json \
  --scope "the 10 new S16f generation-card label keys (PR #1876 @ 9931d62a)" \
  --note "S16f generation-card labels, PR #1876 @ 9931d62a, round-2 re-audit of landed bytes; detail: audit-s16f-r2-zh-CN.md" \
  --date 2026-11-11
```

The row exists already, so no `--translator-*` flags are needed; the assembler will move the S16a audit to
`superseded` (the English source and the target both changed) and start the row from this audit. The receipt's
`instance` is `zh-cn-s16f-r2` because the ledger charset is `^[a-z0-9_-]+$` and the filename must equal the
instance; the run's session id `4184f7fa45be` is recorded inside the receipt.

## Hashes (SHA-256)

10 landed pairs, sorted keys, compact separators, `ensure_ascii=false`, UTF-8:

- English pairs `bdd1d9d1cfcd327c7445396ad806220fa850fe820c638a59ec6bc195f882e307` (1503 bytes)
- zh-CN pairs `c812d30be5d1fb914fe157368ff2547c8d594b3aeae8efb499b3612e47f6a4a3` (1320 bytes)
  — **equals round 1's `candidate_pairs_with_auditor_fixes`**, so the landed values are the corrected candidate
  bytes, not a re-typed copy.

Files: `en/ui.chat.canonical.json` `12ec2698434dcb39497e288af62d11d70f0fd71d494a9becf3fd611d6568bbdd`;
`en/ui.chat.canonical.context.json` `95aa203759416c93180b7eb4967e6fcf5bce0dffe20e9d005b431c645e9e11e6`;
`zh-CN/ui.chat.canonical.json` `13bbc7ac23ef6f38a92adb0b27c1e2b5fc9593784a1bb0ab1c1a4029cdd4b708`.
References: glossary `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8` (note: the glossary has
moved since the older zh receipts, whose `ef07b44…` is stale), style guide
`8f95d89debbd0af848e72e4805e256ef9566632e520a5c6d9b37928cd617142c`.

Per-key pair hashes are in `check-r2.log` (`pair_en … / pair_zh-CN …`, one line each).

## Honesty notes

- `audit_notes_not_execution_log`: this file and the receipt describe the work; `repo-checks.log` and
  `check-r2.log` are the actual command output. The pair hashes above are reproducible from the committed bytes.
- The round-1 report named in my brief
  (`~/.local-operator/sessions/c69a71ac5b59/scratchpad/audit-s16f-zh-CN.md`) does not exist at that path; the
  round-1 bundle lives at `…/scratchpad/s16f-zh-audit/` and I read its `audit-s16f-zh-CN.md` and
  `record-s16f-zh-CN.json` there. Nothing in my verdict depends on it.
- I did not run the whole-suite or whole-directory tests (CI and the coder own those); this lane ran the seven
  checks above plus the diff's own tests.
- No repository file was created, edited or committed by me. The tracked evidence bundle
  (`i18n/audits/evidence/zh-CN/ui.chat.canonical/s16f-r2-…/`) still has to be copied in by the integrator; this
  scratchpad copy is the staging original.
