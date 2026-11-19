# independent translation audit — zh-CN, S16f merged bytes (`ui.chat.canonical`) — audit au3

- **Auditor**: `i18n-auditor` (lopdev team), session `2a10c1127838`, model `deepseek/deepseek-flash`
  (harness model header for this run; no fallback, no provider substitution observed).
  Instance id `2a10c1127838-zhcn-s16f-au3`.
- **Independent of**: the translator (`i18n-translator`, `anthropic/claude-sonnet-5-5` for the 10 PR keys,
  per the ledger row) and of every earlier audit on this row (`s16a-07b0fc8f8d80`, `s16f-r2-4184f7fa45be`).
  I translated nothing, edited nothing, and used no translation API/SDK/MT service or back-translation.
- **Audited bytes**: `~/local-operator-ui/.worktrees/i18n-s16a` @ `8180eff1f705eb79d4df5123d6108c539b585b2e`
  (`git rev-parse HEAD` verified; `git status --porcelain` empty before and after every command).
  PR **#1876** head is that same SHA (`gh pr view 1876 --json headRefOid,state,isDraft` →
  `8180eff1…`, OPEN, non-draft). Parents: `origin/main` = `9ef579fe12abe99409c4ed0b52a3d125afdc1b10`;
  the audited PR base = `107ff1dd0bddd0dbefa60e27cb179ee636d923a1`.
- **Read first, in the prescribed order**: `~/local-operator/i18n/style-guides/zh-CN.md`, then
  `~/local-operator/i18n/glossary.md`, then the English catalogue + `ui.chat.canonical.context.json`,
  then the zh-CN catalogue bytes.

## Verdict: **passed** — { blocker: 0, major: 0, minor: 0, nit: 2 }

The merged file is the union of two already-audited halves: 457 values byte-identical to `origin/main` and
10 values byte-identical to the audited PR base. All 15 keys the brief names read correctly in Chinese —
no calque, no wrong branch, no lost or added meaning, no glossary or guide violation, no width risk.
The two NITs are word-choice polish on live status lines; neither blocks.

## 1. Mechanical (repo validator first, then my own grid)

Repo validator, run against the worktree (actual output in `audit.log` §4):

```
$ node scripts/i18n/context-parity.mjs
context-parity: ok — every English key is covered, apart from 129 allowed gap(s) in 4 namespace(s).  exit=0
$ node scripts/i18n/ledger-check.mjs
ledger-check: … zh-CN/ui.chat.canonical: status is "pending", not "audited" … exit=1
```

`ledger-check` fails only because **seven** canonical rows are still `pending` (14 findings = 7 locales × 2);
zh-CN is one of them and stops being one the moment the receipt is assembled (proved in §7). It reports no
hash mismatch: the row's `source_sha256`/`target_sha256` already equal the bytes on disk.

My own grid (`icu-check.cjs`, using the app's own stack — `@formatjs/icu-messageformat-parser` and
`intl-messageformat`, the pair `src/i18n/messages.ts` uses; `NODE_PATH` pointed at the shared
`node_modules`, nothing installed):

| Check (all 467 keys, not just the 15) | Result |
|---|---|
| valid JSON; key set and key order equal to English | PASS — 467 / 467, 0 added, 0 dropped |
| every zh-CN message parses; every English message parses | PASS — 467 + 467, no errors |
| ICU element skeleton identical to English | PASS |
| placeholder name/type/style sets identical | PASS |
| `select` fields and all their branches identical (8 select messages) | PASS — `failed` / `cancelled` / `other` everywhere |
| every zh-CN plural has `other`; no `one`/`few`/`many`/`two`/`zero` | PASS — 69 plurals, as many as English; exact `=0`/`=1` kept where English uses them |
| plural option contents identical for every shared option | PASS |
| English code spans / markup / printf / identifiers all present in target | PASS — none exist in this namespace, none invented |
| no manual bidi controls; NFC | PASS (zh-CN is LTR; bidi is a mechanical check only) |
| typography on the 15: no ASCII `...`, no half-width punctuation in rendered copy, no space between CJK and Latin/digit runs | PASS — 8 × U+2026 (four labels × the guide's two-mark `……`) |

Rendered the delta with the real formatter at `zh-CN` (12 combinations, `audit.log` §2 §5):

```
media.image_label  count=1              -> 图片
media.image_label  count=3 position=2   -> 第2张图片
media.sound_label  count=3 position=2   -> 第2个声音
item_status failed / cancelled / weird  -> rain · 失败 | rain · 已停止 | rain · 状态未知
latest_update      item=2 total=3       -> 最近更新：rain（第2项，共3项）。
summary  2/1/0/0 attention=yes          -> 已完成2项 · 失败1项。需要关注：rain
summary  0/0/2/1 attention=yes          -> 已完成0项 · 失败0项 · 已停止2项 · 状态未知1项。需要关注：a · b
summary  3/0/0/0 attention=no           -> 已完成3项 · 失败0项
```

No throw, no leftover `{`/`}`/`#`, `=0` hides the `已停止`/`状态未知` clauses, and the attention clause appears
only when `has_attention=yes` — the two behaviours the sidecar makes non-negotiable.

## 2. Merge integrity (the brief's §2, proved by script — `integrity.py`)

| Measurement | Count |
|---|---|
| merged zh-CN keys | **467** (English 467; key sets equal) |
| `origin/main` zh-CN keys | 457 |
| PR base `107ff1dd` zh-CN keys | 466 |
| arithmetic 466 + 5 (main's `loading.*`) − 4 (main's renames) | 467 = merged ✔ |
| non-PR keys compared against `origin/main` | 457 |
| … byte-identical to `origin/main` | **457** |
| … changed | **0** |
| non-PR keys absent from `origin/main` | 0 |
| `origin/main` keys missing from the merge | 0 |
| PR-added keys in the merge, equal to `107ff1dd` | **10 / 10** (0 drift) |
| PR-added keys that also exist in `origin/main` (would be a collision) | 0 |
| English text of non-PR keys changed since `origin/main` | 0 |
| English text of the 10 PR keys changed since `107ff1dd` | 0 |

So the merge is a clean union, not a re-translation: nothing outside the 10 new keys was touched, and the four
keys main deleted by rename (`older_history.loading`, `placeholder.loading`, `placeholder.region_label`,
`transcript.stale_caption`) are gone from both sides, not resurrected by the merge.

**Provenance of main's 5 keys, checked rather than assumed**: their zh-CN values are the pre-rename audited
strings, carried across unchanged —

```
placeholder.loading     (107ff1dd) 正在加载对话……   == loading.cold
placeholder.region_label(107ff1dd) 正在加载对话     == loading.region_label
older_history.loading   (107ff1dd) 正在加载更早的消息 == loading.older  (+ the … English itself added)
transcript.stale_caption(107ff1dd) …正在检查新消息。 == loading.revalidating 正在检查新消息……
```

## 3. The 15 keys, read one by one

Precedent below is from this locale's own catalogues; I re-derived each cited string rather than trusting a
prior report.

| # | Key | Value | Judgement |
|---|---|---|---|
| 1 | `loading.cold` | 正在加载对话…… | **Accept.** `正在` + verb + `……` is the house status form (`supplement.frame.loading` 正在加载图像……); 对话 is this namespace's word for a conversation (`this_chat` 此对话, `untitled` 未命名对话). |
| 2 | `loading.older` | 正在加载更早的消息…… | **Accept.** 更早的消息 is the idiomatic "earlier messages"; 20 cells vs English 26, so it fits the narrow row the sidecar names. |
| 3 | `loading.region_label` | 正在加载对话 | **Accept.** No trailing punctuation, as an accessible region name should be; the live region announces its visible label, which the sidecar says is what matters. |
| 4 | `loading.remote` | 正在从另一台设备同步…… | **Accept.** 从 keeps the direction ("from"); 另一台设备 is the established rendering for "another of your devices" (`ui.chat.device_move.other_device` = 另一台设备, `ui.chat.read_ack.clause.remote`, `attachment_refusal.*`); 同步 is the app's word for sync (`synced_agents.*` 正在同步智能体). Dropping 你的 matches the guide's pronoun rule. |
| 5 | `loading.revalidating` | 正在检查新消息…… | **Accept.** Same phrase the deleted `transcript.stale_caption` used, and it asserts nothing about the view being stale, as the sidecar demands. The four labels read as one family: all `正在…`, four ending `……`, the region name alone without. |
| 6 | `media.image_label` | `=1 {图片}` / `第{position}张图片` | **Accept.** `第`+number+classifier before the noun is the house numbering (`lightbox.show_image` 显示第{index}张图片（共{count}张）); a lone picture carries no number. |
| 7 | `media.sound_label` | `=1 {声音}` / `第{position}个声音` | **Accept.** 声音 is this namespace's noun for a sound artefact (`sound.player_failed` 无法播放此声音); 个 is the guide's default classifier and the natural one for 声音. The player's name becomes 播放第2个声音 (`ui.chat.audio.play_label` = 播放{label}), exactly the surface the sidecar describes. |
| 8 | `sound.batch.item_status` | {label} · 失败 / · 已停止 / · 状态未知 | **Accept.** One whole message per state, name first, no terminal punctuation; `失败` matches `tool_row.bridge.outcome.failed`, `已停止` matches `stopped_session.settled`, and the `other` branch (`状态未知`) cannot be read as success or failure, which the sidecar requires of an unrecognised outcome. |
| 9 | `sound.batch.latest_update` | 最近更新：{name}（第{item}项，共{total}项）。 | **Accept, one NIT (N1).** `第N项，共M项` is pinned by the repo's own step counter; full-width `（），。`; no space around the Latin name; not reworded into a completion count. |
| 10 | `sound.batch.summary` | 已完成{n}项 · 失败{n}项[ · 已停止…][ · 状态未知…]。需要关注：{labels} | **Accept.** Counts always shown for completed/failed and hidden at `=0` for the other two; 项 per the guide; `需要关注` for "needs attention"; a full-width `。` closes the clause list before the attention lead-in. The ` · ` separator is house style (128 occurrences across the zh-CN catalogues; `fold.unit_separator` is literally ` · `). |
| 11 | `sound.cost.batch_unknown` | 总费用尚不明确。 | **Accept.** Sibling of #13 with 总 carrying "total"; 费用 is the glossary/namespace word for cost. |
| 12 | `sound.cost.estimated_zero` | 估算费用为$0；最终计费尚未确认。 | **Accept, one NIT (N2).** `$0` kept with no CJK–Latin space; `；` full-width; the sentence keeps the sidecar's point that zero is an *estimate* and is not shortened to a no-charge claim. |
| 13 | `sound.cost.unknown` | 费用尚不明确。 | **Accept.** One short statement with `。`; says only that no amount has been reported. |
| 14 | `sound.cost.no_charge` | 未收费。 | **Accept.** Precedent `ui.chat.session_spend.plan_clause` （API等值，未收费）; four characters, right for a confirmed zero bill. |
| 15 | `supplement.sound_fallback_label` | 生成的声音 | **Accept.** Bare noun phrase, no punctuation, 10 cells; a fallback only, and the noun this namespace uses for a sound artefact. |

## 4. Judgement on the earlier rounds on these keys

Round 2 (`s16f-r2-4184f7fa45be`) passed the ten PR keys with 0 findings, after round 1's two MAJORs
(word-order calques `图片 2` / `声音 2`) and one MINOR (a space before `$0`) were corrected. Reading the landed
bytes myself: **round 2 was right on all three.** I did not take that on trust — `第{position}张图片` is
confirmed by `lightbox.show_image` and `fold.images_aria`, `个声音` by the guide's default-classifier rule and
`sound.player_failed`, and the no-space rule by the style guide's "No space inserted between Chinese text and
Latin/digit runs". Its mechanical claims also reproduce: my parse/structure/plural grid passes independently.
What round 2 could not cover, and this audit does, is the five keys main added in the same file: they read
correctly and are the audited pre-rename strings, so the merged file has no weak spot introduced by the merge.

## 5. Findings

**N1 — `ui.chat.canonical.sound.batch.latest_update` — NIT.**
Current: `最近更新：{name}（第{item}项，共{total}项）。`
Problem: 最近更新 is this app's settled label for *recently updated* (`ui.hub.pages.sort.recently_updated` = 最近更新,
`ui.projects.project_sort.most_recent_first` = 最近更新优先), i.e. a modification time. This line reports which
request spoke last, so a reader can take the colon as introducing a timestamp.
Suggestion: `最新动态：{name}（第{item}项，共{total}项）。` — same length, names the line as the newest activity.

**N2 — `ui.chat.canonical.sound.cost.estimated_zero` — NIT.**
Current: `估算费用为$0；最终计费尚未确认。`
Problem: 计费 is the billing *action* in this catalogue (`sound.stop.warning` 则会计费 / 免于计费,
`ui.chat.slash.arg.price_usage_based` 按用量计费), so 最终计费 reads as the billing run being unconfirmed,
where the English is about the final charge amount.
Suggestion: `估算费用为$0；最终收费尚未确认。` — 收费 keeps the sentence about the amount, and 未收费 is already
the noun form its sibling `sound.cost.no_charge` uses.

Both are non-blocking; the ledger result is `clean-with-findings`.

## 6. Considered and accepted (no finding)

- **声音 vs 音频.** `sound.batch_attachment_unavailable` uses 音频 for the attachment and `sound.stop.warning` for
  audio output, but `sound.player_failed` (无法播放此声音) fixes 声音 as the noun for a sound artefact — the two
  new labels follow it. Not a glossarial term, and not an inconsistency introduced here.
- **个 vs 段** for an audio clip: 个 is the guide's documented default and 段 would be an opinion, not a rule.
- **尚不明确** for "not yet known": the sibling relation (费用 / 总费用) and the "no promise an amount will arrive"
  nuance both hold; 尚不明确 is shipped phrasing for the same idea (`ui.ownerAudit.window_unconfirmed`).
- **State position.** `tool_row.bridge.outcome.failed` leads with the state because the code is that row's value;
  `item_status` appends the state after the item's own name, which is what its sidecar asks for.

## 7. Receipt and how it behaves under the repo's own gate

`receipt.json` (staged in this scratchpad) mirrors the field set of a recent `i18n/receipts/*.json`. I ran the
repo's writer and gate against a **scratch mirror** (`git archive HEAD src/i18n i18n scripts package.json`;
`node_modules` symlinked, nothing installed) so the worktree stayed byte-identical:

```
$ node scripts/i18n/ledger-assemble.mjs --repo <mirror> --locale zh-CN \
    --auditor-instance 2a10c1127838-zhcn-s16f-au3 --auditor-model deepseek/deepseek-flash \
    --result clean-with-findings --receipt i18n/receipts/2a10c1127838-zhcn-s16f-au3.json --date 2026-11-12
ledger-assemble: zh-CN/ui.chat.canonical -> status audited | clean-with-findings, 0 blocker, 0 major, 0 minor, 2 nit
$ node scripts/i18n/ledger-check.mjs      # after assembly
ledger-check: FAILED — 12 finding(s) across 1113 ledger entr(ies)   exit=1
$ grep -c "^ledger-check: zh-CN/ui.chat.canonical" …              -> 0
   (the 12 remaining = es, fr, hi, ru, ur, vi × 2, all "pending, no auditor recorded")
```

Integrator command (from the repo root, after copying the receipt in):

```
cp <scratchpad>/receipt.json i18n/receipts/2a10c1127838-zhcn-s16f-au3.json
node scripts/i18n/ledger-assemble.mjs --locale zh-CN \
  --file src/i18n/catalogues/zh-CN/ui.chat.canonical.json \
  --auditor-instance 2a10c1127838-zhcn-s16f-au3 --auditor-model deepseek/deepseek-flash \
  --result clean-with-findings --receipt i18n/receipts/2a10c1127838-zhcn-s16f-au3.json \
  --scope "S16f merged bytes @8180eff1: 5 main-added loading.* + 10 PR-added generation-card/sound keys, 15 read in full" \
  --note "zh-CN S16f au3: 15-key delta audited on merged bytes; 457 non-PR values = origin/main, 10 PR values = 107ff1dd; 0 blocker/major/minor, 2 nit; detail i18n/audits/evidence/zh-CN/ui.chat.canonical/s16f-au3-2a10c1127838/report.md" \
  --date 2026-11-12
```

The row already exists, so no `--translator-*` flags are needed; the assembler keeps the 21 superseded audits
as history and starts the row from this one. The assembler will move the audits to `superseded` only if the bytes
change again — they have not.

## 8. Hashes (SHA-256, computed here from the worktree files)

- `src/i18n/catalogues/en/ui.chat.canonical.json` — `905fb4d86bab02148e90dea09a1e7d74c628fcdeb3f40f49126b21f491a8d28e`
- `src/i18n/catalogues/en/ui.chat.canonical.context.json` — `8f56e0d2b384c6b41add57a64e6c863e565cb61d5a7c0de482d42f380be3acfe`
- `src/i18n/catalogues/zh-CN/ui.chat.canonical.json` — `35f8058839549d4a8be28792c279784c75a624b9c076fc98d359bae1fe1db12c`
- Reference: glossary `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8`,
  style guide `8f95d89debbd0af848e72e4805e256ef9566632e520a5c6d9b37928cd617142c`.

The two catalogue hashes equal the pending ledger row's `source_sha256` / `target_sha256` exactly, so the
receipt names the bytes the gate is expecting.

## 9. Honesty notes / limits

- `audit_notes_not_execution_log`: `audit.log` is the real command capture; this report and the receipt describe
  it and claim no output beyond it. Every number in §2 comes from `integrity.py`'s printed counts, not by eye.
- The worktree was never written: `git status --porcelain` was empty before and after (§8 of the log re-checks it).
- **Not exercised**: rendered UI fit (no Electron window or screenshot in this lane), activation/eligibility, and
  the whole-suite gates (`generate.mjs --check`, `check-coverage.mjs`, `locale-parity.test.mjs`) — that is CI's
  lane, and the English side is byte-identical to `origin/main`, so generation cannot have moved.
- Fit is reported as cell widths against the sidecar's prose budgets only: this namespace's context sidecar
  carries **no** numeric `maxCells`/`maxChars` (0 of 467 entries), so "overflow" here can only be reasoned about
  from the sidecar's prose ("narrow row", "one or two words") — and all 15 values are 4–22 cells except the two
  that are ICU templates and the one wrapping paragraph.
- The scratch mirror (`scratchpad/mirror/`, with the receipt copy and the assembled ledger) is temporary
  working state, not the artifact of record; the receipt and this report are.
