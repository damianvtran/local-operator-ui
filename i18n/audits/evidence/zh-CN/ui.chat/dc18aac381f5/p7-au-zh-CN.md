# i18n audit — P7 / zh-CN — ROUND 1

- Locale: **zh-CN** (Simplified Chinese)
- File group / namespace: `ui.library` (5 keys) + `ui.chat` (1 key) — P7 slice: "organized by actor" sentences + audio slider position value
- Candidate: `~/local-operator-ui/.worktrees/_p7-prep/zh-CN.json` (6 values, notes)
- Translator (not me): `anthropic/claude-sonnet-5-5` (per candidate `model` field)
- Auditor: `i18n-auditor` agent, session `dc18aac381f5`, **served model `deepseek/deepseek-flash`** (source: this session's header, no fallback observed/reported)
- `independent_from_translator_session`: true (different agent, different session, different model)
- Date: 2026-11-11
- Base: `origin/main` = `3e48d8acb98` (local-operator-ui worktree `.worktrees/_p7-prep`); `keys.json`/callsites built from `a0464af9e0a8d13e87409a4e2fd410e87b6bcdcc`

## Verdict: **CLEAN** — 0 findings

| Severity | Count |
|---|---|
| BLOCKER | 0 |
| MAJOR | 0 |
| MINOR | 0 |
| NIT | 0 |

No BLOCKER/MAJOR ⇒ status equivalent to `passed` for `zh-CN` / `ui.library`+`ui.chat`. (Task says do not touch repo or ledger, so no ledger row was written by me — see "Retention" below.)

## Input hashes (sha256)

| Input | Path | sha256 |
|---|---|---|
| en source + context (P7 sidecar) | `.worktrees/_p7-prep/keys.json` | `c2b57addb849fb35720fac74c79b59c1c47078534c0c50cf9e8b58c368c0a35a` |
| target candidate | `.worktrees/_p7-prep/zh-CN.json` | `ad62b5117420bd127d1db128e88e4a0a1fedb4bb97821635e0240f20c5117f17` |
| shipped zh-CN lib (origin/main) | `src/i18n/catalogues/zh-CN/ui.library.json` | `180a39dfac22bc99603310ce1636212dd1b915551cfbfb782c138911b7c35b89` |
| shipped zh-CN chat (origin/main) | `src/i18n/catalogues/zh-CN/ui.chat.json` | `6c28931de502a5fd821f9bd9ff779a55599681804575a8a2ba4cdc3346c1e1b9` |
| shipped en lib (origin/main) | `src/i18n/catalogues/en/ui.library.json` | `065ac47c67e2a82867070f9df0e33d25c0d96aedd77438b584114147db07fd71` |
| shipped en chat (origin/main) | `src/i18n/catalogues/en/ui.chat.json` | `ee4e2a9eeb841750244e94a681e33eda92f87cb9727439779b77809c1628ea15` |
| style guide | `~/local-operator/i18n/style-guides/zh-CN.md` | `8f95d89debbd0af848e72e4805e256ef9566632e520a5c6d9b37928cd617142c` |
| glossary | `~/local-operator/i18n/glossary.md` | `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8` |

## 1. Mechanical — PASS

Ran (read-only, no repo writes):
- `python3` parity pass over candidate vs `keys.json` (key set, order, placeholders, empties, English-identical, NFC, control/format chars, cell widths).
- The repo's own ICU parser and formatter from the checkout's `node_modules`:
  `@formatjs/icu-messageformat-parser` (`parse(..., {ignoreTag:false, requiresOtherClause:true})`) for AST/argument parity, then `intl-messageformat` `new IntlMessageFormat(value, "zh-CN").format(sample)` with the real dynamic values.
- Not run: `scripts/i18n/check-coverage.mjs` / `locale-parity.test.mjs` / `check-strings.mjs` in full — they resolve committed catalogues; the P7 candidate is a 6-key sidecar and merging/editing is out of my scope. The checks they would perform on these 6 strings (key presence vs en, argument-name parity, non-empty, ICU validity, English-identical, plural-category set) were each executed directly above.

| Check | Result |
|---|---|
| Valid JSON | PASS (`json.load` + node `JSON.parse`) |
| Key set vs source | PASS — 6/6, none missing, none extra |
| Key order vs source | PASS — identical order |
| Placeholder names/types (AST) | PASS — each key: en `["at"]` / zh `["at"]`; position_value en `["current","total"]` / zh `["current","total"]` |
| ICU structure | PASS — all six parse with `requiresOtherClause:true`; no plural/select in source, none added; no CLDR category question arises (zh-CN `other`-only rule respected — no plural added) |
| Markup / backticks / commands / identifiers | PASS — none present, none invented; no Latin token added or dropped |
| Empties | PASS — none |
| English-identical | PASS — none identical |
| NFC | PASS — all normalized; no ZWNJ/ZWJ/LRM/RLM/bidi controls (checked `Cf`/`Cc`) |
| Cell width vs English | PASS — 16/20/12/12/8 cells vs en 26/31/28/21/14; `position_value` 20 vs 20. No `maxCells` budget is recorded for these keys in the sidecar. |
| Render with real values | PASS — `3天前由智能体整理`, `刚刚由资源管理员整理`, `0:05，共0:12`, `0:00，共0:00` (no ICU errors) |

## 2. Accuracy — PASS

| Key | English | zh-CN | Judgement |
|---|---|---|---|
| `ui.library.preview.organized_by_agent` | Organized by an agent {at} | `{at}由智能体整理` | actor = an agent ✓; indefinite "an" correctly unmarked in Chinese; no exclusion of the Librarian added (source does not say 其他) |
| `..._by_librarian` | Organized by the Librarian {at} | `{at}由资源管理员整理` | same term as `ui.library.librarian.title` ✓ |
| `..._by_system` | Organized automatically {at} | `{at}自动整理` | "automatically", no person/agent named ✓ (source's "the catalog itself" is a note, not copy — correctly not added) |
| `..._by_user` | Organized by you {at} | `{at}由你整理` | second person, 你 per guide ✓ |
| `organized_unattributed` | Organized {at} | `{at}整理` | makes no actor claim ✓ (the branch this replaces rendered a bare `librarian` id) |
| `ui.chat.audio.position_value` | {current} of {total} | `{current}，共{total}` | elapsed/total relation preserved, no polarity/quantity error, no "position" repeated (accessible name already carries it) ✓ |

No omission, addition or negation error. No destructive/permission/error text in this group, so no safety-relevant wording to judge.

## 3. Idiom, register, punctuation — PASS

- **The `{at}`-first order is correct, and better than the shipped frame.** `relativeTime()` (`library-model.ts:432-450`, origin/main) returns `刚刚` / `N分钟前` / `N小时前` / `N天前` / `N个月前` / `N年前`. Appending those to the shipped `于`-frame (`ui.library.preview.organized_by` = `由{by}整理于{at}`, `librarian.last_organized` = `上次整理于{at}`) yields `由你整理于刚刚`, which is ungrammatical, and `于3天前`, which is stiff/archaic for UI copy. Time-adverb-first (`3天前由你整理`) is the natural Chinese order; the translator's note says exactly this and the note is right.
- `由 + agent` passive is the established register in this catalogue: `由你附加，保存在此会话中` (ui.canvas), `由智能体打开` / `由{agent}打开` (ui.chat.sidebar_notes), `由{name}管理` (ui.chat.run_details) — the new sentences read as native product copy, not calque.
- Register: 你, no 您, no pronouns where Chinese drops them, terse, no exclamation marks, no 啦/哦.
- Punctuation: no sentence-final 。 on these fragments ✓ (guide); full-width `，` in `position_value` ✓; no space introduced between CJK and Latin/digit runs ✓.
- `刚刚由你整理` / `刚刚整理` read naturally (checked the just-now boundary, the case a literal 于-frame breaks on).

## 4. Terminology — PASS (recounted against shipped usage)

| Term | Shipped zh-CN | Candidate | Verdict |
|---|---|---|---|
| Librarian | `ui.library.librarian.title` = `资源管理员`; sole spelling in the catalogue (`librarian.control_failed` also `资源管理员`); no `图书馆*`/`图书管理员` competitor found across all zh-CN namespaces | `资源管理员` | consistent ✓ |
| organize(d) family | `sort.organized` `上次整理`, `status.unorganized` `未整理`, `preview.unorganized` `尚未整理`, `librarian.organize_now` `立即整理`, `librarian.last_organized` `上次整理于{at}` | `整理` ×5 | consistent ✓ |
| agent | glossary §2 → `智能体` | `智能体` | ✓ |
| "of" idiom | `preview.slide_of` `第{index}张，共{count}张`; `checkpoint.turn` `第{turn}轮（共{total}轮）` | `{current}，共{total}` | consistent ✓ |
| kept-English | none needed here (no product name, flag, path, identifier in source) | none introduced | ✓ |

## 5. Fit / width — PASS

Longest string is 20 cells (`2小时前由资源管理员整理` ≈ 30 cells with a typical `{at}`) against 31 English cells; the metadata line sits beside size and kind in a `<span>` (library-preview.tsx:521-526), so it is shorter than the English it replaces. `position_value` is announced, not displayed — width irrelevant, and it equals the English cell count anyway.

## 6. RTL — n/a (zh-CN is LTR); no bidi/mirroring concern in this group.

## Second independent pass (high-visibility group: Library preview metadata)

Requested by the manager; performed as a re-derivation from `callsites.md` + the real `relativeTime` values rather than a re-read of the candidate. Re-checked specifically:
1. Does each actor sentence still distinguish the four actors after translation? Yes — `智能体` (generic) vs `资源管理员` (the Library's named agent) vs `你` vs `自动`; the null branch claims no actor.
2. Is the "definite article" of English "the Librarian" lost harmfully? No — Chinese does not mark definiteness, and the shipped term already carries the persona (`control_failed` `资源管理员没有响应。`).
3. Would `总长` be clearer than `共` for a duration aria-valuetext? Checked and rejected: `共` matches the shipped `slide_of`/`checkpoint` idiom and is shorter; `总长` would be a defensible variant, not a correction. Not raised as even a NIT, since the announcement `0:05，共0:12` is unambiguous for a seek slider with the accessible name "…的播放位置".
4. Could `{at}整理` (unattributed) be misread as an imperative `整理`? Only if the time adverb were absent; `3天前整理` / `刚刚整理` parse as statements. No change proposed.
5. Bidi/invisible characters, double spaces, half-width comma — none present.
Second pass found nothing the first missed; verdict unchanged. This is one auditor doing two passes, not two independent auditors — recorded honestly.

## Not addressed (out of candidate scope, reported not fixed)

- Shipped `ui.library.librarian.last_organized` = `上次整理于{at}` renders `上次整理于刚刚` for assets organized under a minute ago (`relativeTime` `just_now`). This is the same `于`-frame defect the P7 candidate correctly avoids; it is a pre-existing shipped string in `zh-CN` (and structurally the same trap for any locale whose relative age is a bare adverb). Not a finding against this candidate — flagged for the manager as a separate small copy fix, no issue filed.

## Retention

Per the task instruction ("Do not touch repo or ledger"), this report is the deliverable and lives in session scratch; no `i18n/audits/evidence/zh-CN/...` bundle and no `i18n/ledger.json` row were created by me. Hashes and identities above are sufficient for the manager to mint the tracked record. Everything in §1 is command output I actually ran in this session, not reconstructed notes.
