# zh-CN audit — `ui.agents.upload` (15-key upload-agent-dialog delta)

- Locale: **zh-CN** · Namespace: `ui.agents.upload` · Round: **1**
- Head: `2b72db6a56ad8204ec7f30a0ba6ffbc941be3b82` · Base: `origin/main` `e9fef11640364c9e55e68fc84eac89af45886279`
- Instance: `04d006c51d21` · Date: 2026-11-08
- Auditor: i18n-auditor (session `04d006c51d21`, lopdev reviewer role) — did not translate these values, did not write the dialog.
- Served model: **deepseek/deepseek-flash**, after three consecutive provider-quota fallbacks from anthropic/claude-sonnet-5-5 (→ opus-5-5 → gpt-6.1-sol → deepseek-flash). No verdict was formed before the fallbacks settled.

## Verdict: clean-with-findings — 0 blocker, 0 major, 1 minor, 2 nit

## The structural decision (the question this audit was asked to settle)

The translator collapsed the English `one` arm's `{org}` into the single zh `other` arm:

    {count, plural, other {{org}或上方标记的任何其他组织}}

**Verdict: CORRECT. The sentence is right Chinese at both count=1 and count=12, and it does not misstate plurality.**

Rendered through the repo's own engine (`intl-messageformat` 12.1.3, `new IntlMessageFormat(msg, "zh-CN")` — the exact construction at `src/i18n/messages.ts:152`), `Intl.PluralRules('zh-CN').select()` returns `other` for 1, 2 and 12, so all three counts render identically:

| count | rendered (org = 此组织) |
|---|---|
| 1 | 在组织内共享智能体属于Team套餐的功能。此组织或上方标记的任何其他组织的所有者可以在Radient控制台中启用。 |
| 2 | (identical) |
| 12 | (identical) |

- **At count=1** the second disjunct is *vacuous* — no other organization is marked above — while the named organization is exact (`blockedTargets[0]`, which the picker renders disabled in view). Nothing false is asserted; the cost is redundancy, recorded as N1.
- **At count=12** the sentence names `blockedTargets[0]` — a genuinely marked, disabled org in the same picker — and generalises to 任何其他组织. True, and more informative than the English "any of the organizations marked above".
- The call site always supplies a real name at every count: `org: blockedTargets[0].tenant_name || t("ui.hub.pages.scope.org_unnamed")` (`upload-agent-dialog.tsx:1040-1046`). There is **no** path where `{org}` is empty or stale, so naming it at count>=2 cannot mislead.
- The binding locale rule requires exactly this shape — zh-CN style guide, *Plurals*: "`other` only — Chinese has no plural agreement; never add one/other branches." A `one` arm would itself be the defect. The English sidecar's `plural_guidance` ("the `one` arm names the organization the reader has to ask") is therefore honoured *inside* `other`, which is what was done.
- The fold also avoids the shape that *would* be wrong: `{org}` alone, which at count=12 would wrongly imply the named organization is the only one that can enable the feature. It was not used.

## Terminology (translator's claims, verified)

| claim | value | evidence | verdict |
|---|---|---|---|
| Agent Hub = 智能体中心 | 智能体中心 | matches `ui.hub.pages.header.title` = 智能体中心; `intro.public`, `published.listed` | ✅ |
| listing = 条目 | 条目 | `update_listing` = 更新条目; pre-existing `action.open_listing` 打开条目, `ui.agents.publication.action.update_listing` 更新现有条目, `title.republished` …条目 | ✅ |
| instruction set = 指令集 | 指令集 | pre-existing `ui.common.errors.publish_unsupported`, `ui.agents.publication.*`, `ui.onboarding.tour.upload_agent_hub_dialog.body.1` | ✅ |
| short "hub" stays short (receipt.title_hub) | 中心 | en context says use the shipped short hub, not "Agent Hub"; pre-existing `availability.taken` 此名称已在中心发布。 | ✅ |
| Team plan | Team套餐 | shipped zh already carries "Team Bridge是Radient Team套餐的一部分" / "需要Radient Team套餐" | ✅ |
| Radient console | Radient控制台 | shipped "前往Radient控制台" | ✅ |

## Mechanically verified

1. **Key parity** — en 46 / zh 46; nothing in en missing from zh and vice versa. 15 added, 31 pre-existing **byte-identical to `origin/main` (0 changed)**.
2. **Placeholders** — identical per key, 0 mismatches across all 15. `target.blocked_hint` keeps exactly `{count}` (plural selector, never printed) + `{org}`; `{destination}` in intro.org / not_leaving.org / published.org_listed / receipt.title_org; `{name}` in reserved_named / published.org_listed. The generator agrees: `keys.gen.ts` types it `{ count: number; org: string }`.
3. **Dependent keys exist in all 7 locales** — `ui.hub.pages.scope.org_unnamed` and `org_label` are present in en/es/fr/hi/ru/ur/vi/zh-CN, so the diff's two new `t()` call sites cannot fall back to English in any shipped locale.
4. **Typography** — NFC; no ZWSP/BOM/NBSP/U+3000/double space/edge whitespace; full-width ，。：；（） in prose; " " quotes (mainland convention, no 「」); no space between CJK and Latin runs per the guide ("Team套餐", "Radient控制台"); no sentence-final 。 on the six labels/statuses, 。 kept on all nine full sentences, matching the pre-existing siblings.
5. **No English** beyond product names/tokens — the only Latin runs are `{name}`/`{destination}` placeholders plus `Team` and `Radient`, both explicitly licensed by the en context.
6. **Register** — 你 throughout (no 您), terse verb-forward actions, and `not_leaving.*` reproduces the pre-existing `sign_in.nothing_left` frame exactly (没有其他内容离开本机：…) while keeping its own longer item list (记忆或学习所得、计划 vs 记忆、计划), as the en note demands ("do not merge the two"). No item added, dropped or reordered.
7. **Width** — every value is narrower than its English source in 2-cell-adjusted width; longest are `not_leaving.org` 144 cells vs 217 en chars and `blocked_hint` 122 vs 146.
8. **Ellipsis** — the one deviation, M1.

## Findings

### M1 — minor — `zh-CN/ui.agents.upload.json:5` single-mark ellipsis

`ui.agents.upload.action.publishing` = `正在发布…` uses a single U+2026. The binding zh-CN style guide (*Punctuation & typography*) says "Ellipsis is …… (two marks)"; shipped zh practice is 234 two-mark occurrences against 11 single, and the *same file's* pending-status sibling at line 8 is `正在检查此名称是否可用……` — same pattern, eight lines above. The en sidecar's "U+2026, never three periods" governs the English source and forbids `...`; the repo's own precedent translates that same instruction as …… (that sibling's en context says "U+2026 rather than three periods" too, and shipped zh is ……).

**Fix:** `"正在发布……"`.

### N1 — nit — `zh-CN/ui.agents.upload.json:32` empty referent at count=1

At count=1, 任何其他组织 refers to an empty set. Not a misstatement and not a plurality defect (see the structural section) — purely redundant. Optional: drop 任何 → `{org}或上方标记的其他组织`.

### N2 — nit — `zh-CN/ui.agents.upload.json:24` 加入 reads mechanical

`"{name}"已作为指令集加入{destination}的共享智能体` renders "is in {destination}'s shared agents"; 加入 ("has joined") is slightly mechanical for a receipt. Optional: `已作为指令集出现在{destination}的共享智能体中`. Meaning and audience are correct.

## Method

Diff-first: `git diff origin/main..2b72db6a56ad8204ec7f30a0ba6ffbc941be3b82`; en source and en `.context.json` read for the constraints; the shipped zh catalogue and the `origin/main` blob compared key by key; `IntlMessageFormat` render at count 1/2/12; placeholder, key, typography and width checks scripted; `ui.hub.pages.scope.*` checked in all 7 locales. No catalogue, ledger, allowance, generator or component edit; nothing committed.

## Not checked

- The other six locales (separate auditors on this branch).
- A rendered screenshot of the dialog (no browser tool in this role) — the render claim above is the ICU engine driven through the app's own constructor call, not a pixel capture.
