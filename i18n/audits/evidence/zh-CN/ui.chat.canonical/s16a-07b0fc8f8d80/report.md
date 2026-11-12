# s16a — zh-CN independent translation audit (14 new keys, `ui.chat.canonical`)

Auditor: `i18n-auditor`, session `07b0fc8f8d80`, model `deepseek/deepseek-flash`
(actual served model, taken from this session's model header; no fallback observed).
Date: 2026-11-11. Locale: **zh-CN**. Namespace: `ui.chat.canonical` (new-key slice only).

| | |
|---|---|
| Verdict | **passed** (clean, 3 NITs, no change required to ship) |
| Counts | blocker **0** · major **0** · minor **0** · nit **3** |
| Keys audited | 14 / 14 |
| PR / branch | local-operator-ui #1870, `feat/i18n-s16a-tool-state-words` |
| Worktree / HEAD | `~/local-operator-ui/.worktrees/i18n-s16a` @ `93a61605b059ada503d75da6e9e38e8ef14e1b67` |
| Draft (translator output) | `…/s16a-drafts/zh-CN-s16a.json`, sha256 `cbc586651c9e1f37b57a85a84701a213dad5b1761f9bab4e41b70012cfdc83cf` — **matches the hash in the brief** |
| Translator | LLM translator `anthropic/claude-sonnet-5-5` (per brief); not this agent |
| Repo changes | none — audit was read-only (no edits, no commits, no installs) |

Inputs (sha256, re-derived here; see `audit.log` §1):

```
d6d47d31667fe69448cf408f5a4fecf9948782e850506a6141217585de9db1fd  en  ui.chat.canonical.json
ef8a12dea1835c241af3a166754322ce093af88592ec625036211458a50accac  en  ui.chat.canonical.context.json
4176670606e68058e498a36006ba8c770af64489ec77d77e78d3a2754ab2ddf0  zh-CN ui.chat.canonical.json (on disk; does NOT yet carry these 14 keys)
cbc586651c9e1f37b57a85a84701a213dad5b1761f9bab4e41b70012cfdc83cf  zh-CN draft under audit
```

## Method (executed, not asserted)

`run-audit.sh` → `checks.mjs` (Node 24, `intl-messageformat` 12.1.3 from the worktree's own
`node_modules`), output captured verbatim in `audit.log`. Also ran the repo validator relevant
to my inputs: `node scripts/i18n/context-parity.mjs` → *"context-parity: ok — every English key
is covered, apart from 129 allowed gap(s) in 4 namespace(s)"*, exit 0, so all 14 sidecar entries
are the ones the en catalogue declares.

1. **Key set.** 14 en keys, 14 draft keys, none added, none dropped, no key already present on
   disk (so this audited only new copy). Both files parse as JSON.
2. **Placeholders.** Argument names/types identical to source on all 14: `{size}`, `{count}`,
   `{material}`, `{total}` — 0 mismatches.
3. **ICU.** All 14 parse under `IntlMessageFormat(msg, 'zh-CN')`. `Intl.PluralRules('zh-CN')
   .resolvedOptions().pluralCategories` = `["other"]`; every plural in the draft has exactly
   `other` (1 in `queue_ahead`, 4 nested in `running_batch`) — no `one` arm carried over from
   English. All four select branches present and named in each of the six select messages.
   `::group-off` retained on `queue_ahead` (en has it in both arms of a two-arm plural, zh in its
   single `other` arm — correct collapse). `#` inside each nested plural resolves to `total`.
   No leftover braces in any formatted output.
4. **Formatting read for grammar** (counts 0,1,2,3,5,11,21,22,100,1000000; materials
   video/voiceover/sound_effect/image). Outputs are in `audit.log` §4; samples:
   `前面还有0个`, `前面还有2个`, `前面还有1000000个`; `正在生成3个视频……`,
   `正在生成3段旁白……`, `正在生成3个音效……`, `正在生成3张图像……`; `已生成旁白`;
   `图像批次生成失败。`. No case/number/gender agreement exists in Chinese to break; the
   classifiers are the only agreement-like choice and each is right (见下).
5. **Width.** Sidecar carries no `maxCells` for this group, so I compared rendered cells against
   English (CJK/fullwidth = 2). Every zh-CN string is **narrower** than its English model
   (e.g. `queue_ahead` 12C vs 13C, `running_batch` 20C vs 51C, `failed` 14C vs 73C). No overflow
   risk for a truncating tool-row object column or a one-line state line.
6. **Checked the translator's notes claims** file:key — 9/9 exist verbatim (`audit.log` §7).

## The two questions the manager asked

**Ellipsis style (…… vs …).** The draft's `……` (two U+2026) is **correct and consistent**; not a
finding.
- Style guide `i18n/style-guides/zh-CN.md` (Punctuation & typography): *"Ellipsis is …… (two marks),
  not \"...\"."*
- Shipped zh-CN evidence: **235** values use `……`; **22** use a single `…`. Of those 22, one is a
  *leading* ellipsis in a diff-truncation prefix (`tool_row.diff.more` = `… 还有#行diff`), one is
  an identifier placeholder (`bep_…`, `acc_…`), and the rest are a mixed set of shipped statuses
  (`正在保存…`, `正在检查更新…`, `正在切换…`) that predate or ignore the guide — i.e. shipped
  drift, not a competing convention. Notably the same namespace already ships `……`
  (`supplement.frame.loading` = 正在加载图像……, `adjust_placeholder` = 调整图像……) and the
  shipped `ui.chat.checkpoint.generating_name` = 正在生成名称…… is the exact
  `正在生成{X}……` shape the draft uses again. Following the guide also keeps the three
  ellipsis-bearing keys (`writing_request`, `running`, `running_batch`) internally consistent.
  If the programme ever normalises the 22 strays, it should be to `……`, never away from it.

**`前面还有N个` construction.** Correct, and the best available phrasing; not a finding.
- Semantics: en `N ahead` counts requests in front of this one (FAL `queue_position`), never a
  1-based rank. `前面还有N个` says exactly "there are N in front", so a count of 2 does not read as
  "position 2". ✔
- Idiom: `前面还有3个人` is the canonical Chinese queue sentence; `还有` is the right verb for
  "remaining ahead". Shipped copy already uses the same `还有 + count + classifier` shape for
  "N more": `tool_row.diff.more` = `… 还有#行diff`, `diff.truncated` = `… 还有#行未记录`.
- Classifier: `个` is the guide's default (style guide, Plurals: "when in doubt, 个") and works for queued requests; the
  datum carries no noun by design ("the card already says 'Queued'"), which Chinese tolerates.
- Number handling: `{count, number, ::group-off}` is preserved from en, so a million-ahead queue
  renders `1000000` with no grouping rather than `1,000,000` — same as English. ✔
- Zero: `前面还有0个` is numerically exact and cannot read as a rank. It is slightly
  self-contradictory on the `还有`, but zh-CN has only the `other` CLDR category, so a
  zero-specific arm is not expressible in ICU, and any prose alternative (`前面没人`) would
  break the fixed-width datum beside the state word. Accepted as-is (see N3).

## Findings

### N1 — NIT — `ui.chat.canonical.image_gen.state.done_batch`
Current: `{material, select, video {视频批次} voiceover {旁白批次} sound_effect {音效批次} other {图像批次}}`
Problem: `批次` is a coinage with **0** occurrences anywhere in the shipped zh-CN catalogues
(`audit.log` §7); the more common software word for "batch" is `批量`, and `批次` in general
Chinese leans to production/shipment lots. It stays readable as "image batch" and it is consistent
with `failed_batch`, and the English is itself a bare noun phrase (`Image batch`) with no count
placeholder, so the wording cannot become `共N张图像`.
Evidence: shipped-count scan (`批次`: 0). Sibling `failed_batch` uses the same noun, and
`running_batch` correctly reaches for the classifiers `个/段/张` instead of `批次`.
Proposed corrected value (optional, only if the manager wants a "more native" register):
`other {图像批量}` etc. — **I would not change it**: `图像批量` reads as an adverb ("image bulk")
in a noun slot, which is worse. **No change requested.**

### N2 — NIT — `ui.chat.canonical.image_gen.state.already_finished`
Current: `已经完成。`
Problem: the same card's `done` branch says `已生成…`, and shipped short statuses use the bare
`已` (`已打开`, `文件已存在`, `已暂停`, `已停止`). Mixing `已经` and `已` across two state lines of the
same card is a small register inconsistency.
Evidence: the `已…`/`已经…` census in `audit.log` and §7's sibling scan; the full stop is **not**
a problem — the style guide keeps `。` on full sentences and the sidecar specifies "sentence case,
full stop", and 218 shipped short values end in `。`.
Proposed corrected value (optional): `"ui.chat.canonical.image_gen.state.already_finished": "已完成。"`
**No change requested**: `已经` is what carries the emphasis of English *already* (the card is
reporting that a stop lost the race), and `已经完成。` is grammatical, natural and safe.

### N3 — NIT — `ui.chat.canonical.image_gen.state.queue_ahead`
Current: `{count, plural, other {前面还有{count, number, ::group-off}个}}` → at 0: `前面还有0个`
Problem: `还有0个` is marginally self-contradictory in isolation ("still 0 there"), where English
`0 ahead` is terse rather than contradictory.
Evidence: `audit.log` §4, count=0 row. `Intl.PluralRules('zh-CN')` = `["other"]`, so an explicit
zero arm is impossible without inventing a category the locale does not have.
Proposed corrected value: none that is both grammatical and shape-safe. **No change requested.**

## Judged and accepted (explicitly, so it is not re-litigated)

- **`排队中` for both `queued` tool-row words and the card's `Queued`** — correct, and better than
  the `已排队` alternative the translator was unsure about: shipped state lines use the
  `V中` ongoing form and `排队中` is already shipped twice for exactly this word
  (`ui.settings.imports.state_queued`, `phase_queued`), plus `{formatcount}个排队中`
  (`ui.chat.pickers.info_model.queued`). `已排队` would read as a completed result state
  (as it does in `ui.chat.aside.adopt.queued`). The card's `pending` sibling is `等待中`, so
  `排队中` and `等待中` stay distinct — the sidecar's "not 'pending'" is honoured.
- **`正在编写` / `已编写`** — parallel to the shipped sibling pair `never_sent_composed` =
  `未发送 · 已编写{size}` and to the `正在 + verb` running register of `tool_row.verb.*`
  (`正在调用`, `正在写入`). "Keep the registers parallel" is satisfied; `正在编写请求……` is the
  same register one level up.
- **`旁白` for voiceover** (a new term: 0 shipped occurrences) — correct. `语音` is taken in
  shipped copy for speech/dictation (19 values, `ui.common.errors.speech_*`), so reusing it here
  would confuse two features; `配音` means dubbing over an existing performance; `旁白` is the
  standard word for a voice-over narration track. The translator's `语音旁白` worry is
  unfounded — `语音旁白` would be redundant (语音 = speech) and longer.
- **`音效` for sound effect** (new term, 0 shipped occurrences) — correct standard term, and it
  stays distinct from the shipped audio *category* `音频` (`ui.library.category.sounds`).
- **`图像` for the generated image** — right call, and consistent inside the namespace
  (`image_gen.progress` = 图像生成进度, `supplement.frame.*` = 图像). Shipped `图片` is the gallery
  / thumbnail word (`ui.canvas.files.images`, `library.category.images`), a different surface.
  Reusing `图片` here would have contradicted `image_gen.progress` inside the same file.
- **`正在生成X……` and `已生成X`** — match shipped `正在生成名称……` and the `已生成` receipt register.
- **`无法生成图像。` / `图像批次生成失败。`** — plain, non-blaming, no promise and no claim about
  the cause; safe for the "platform sent no error text" fallback. `无法…` does not imply user
  fault and does not read as a permission error.
- **Classifiers** — `个视频`, `段旁白` (`段` is the right classifier for a stretch of narration),
  `个音效`, `张图像` (classifier for flat images). All idiomatic; `张` is correct even though the
  noun is `图像` rather than `图片`.
- **Spacing** — `正在编写 · {size}` keeps a space either side of U+00B7 exactly as English and as
  the shipped sibling `未发送 · 已编写{size}`; no space between CJK and a Latin/digit run
  elsewhere. Both correct per the guide's width discipline.
- **Nothing English leaks** — the only non-Chinese content in the 14 values is the `{size}`
  placeholder, which the callsite fills with an already-localized size string.

## Independence and honesty

- I did not translate or edit these values. I did not run the translator's file through any
  translation/MT service, and no back-translation was used; judging was by reading, plus the
  mechanical checks above and greps of the shipped catalogues.
- I am not a certified native speaker of zh-CN: my competence for this audit is high-level
  reading by reasoning plus the shipped-copy evidence quoted here. A native mainland reviewer
  disagreeing with N2 (or preferring `配音`) would not be wrong on the facts.
- **Not checked:** rendered frames or real window widths (no screenshot, no browser frame at a
  narrow width — my width evidence is cell arithmetic against the English, not pixels); actual
  runtime resolution through the app for these keys (the `tool-state-copy.test.mjs` suite path
  belongs to coder/reviewer/QA, not to this audit); activation/eligibility; release readiness.
- **No second independent pass.** The brief did not request one; the group contains failure copy,
  so if the manager treats it as high-visibility the second pass is the manager's call. I did reread
  the six select strings and both failure strings a second time myself.

## Ledger row — NOT ASSEMBLED (and why)

`i18n/ledger.json` already holds a `zh-CN` / `ui.chat.canonical` entry (source
`38f10696…`, target `4176670606…` = the 442-key file on disk, status audited). These 14 values
are **not applied** to `src/i18n/catalogues/zh-CN/ui.chat.canonical.json`, and the English source
hash has moved (`d6d47d31…`), so `scripts/i18n/ledger-check.mjs` would either refuse on the key set
or record bytes that are not the shipped copy. Apply step for whoever lands the values:

```sh
# after the 14 zh-CN values are committed to src/i18n/catalogues/zh-CN/ui.chat.canonical.json
node scripts/i18n/ledger-assemble.mjs   # derives source/target hashes from the files on disk
node scripts/i18n/ledger-check.mjs      # must be green
# append to the existing zh-CN/ui.chat.canonical entry's `auditors` array:
#   agent i18n-auditor, model deepseek/deepseek-flash, date 2026-11-11,
#   result "passed", instance "07b0fc8f8d80",
#   findings {blocker 0, major 0, minor 0, nit 3},
#   receipt i18n/receipts/07b0fc8f8d80.json (+ receipt_sha256),
#   scope "s16a 14 new tool-state/image-gen keys at 93a61605",
#   note referencing i18n/audits/evidence/zh-CN/ui.chat.canonical/s16a-au-zh-CN/
```

## Artifacts

- `report.md` (this file), `record.json`, `receipt.json`, `checks.mjs`, `run-audit.sh`,
  `audit.log` — all in this evidence bundle.
- `audit.log` is the **real captured stdout** of `run-audit.sh` (input hashes, key-set parity,
  ICU/plural/select integrity, formatted output per count and material, width comparison,
  ellipsis census, translator-claim verification). The semantic reasoning in this report is
  audit notes, not an execution log.
