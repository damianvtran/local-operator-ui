# i18n audit — ru · ui.agents.upload · round 1

- **Auditor:** i18n-auditor, session `3f08e28cd8df` (independent of the translating lane and of the PR coder)
- **Model:** `deepseek/deepseek-flash` (session began on `anthropic/claude-sonnet-5-5`; provider-quota fallbacks through `claude-opus-5-5` and `openai/gpt-6.1-sol`; the verdict of record completed on the last. Disclosed, not hidden.)
- **Branch / head:** `i18n/slice-upload-agent-dialog` @ `2b72db6a56ad8204ec7f30a0ba6ffbc941be3b82`, base `b915083bd96f5118c793d26c47d5a1f2afc1f8d9`
- **Scope:** the 15 keys this commit adds to `src/i18n/catalogues/ru/ui.agents.upload.json` (file now 46 keys, equal to en). Carried values were verified byte-identical to the parent and not re-audited. Catalogue-only: no rendered frame, activation or release claim.
- **Verdict:** **clean-with-findings** — blocker 0 · major 0 · minor 1 · nit 3. Nothing blocks; the round is terminal for this locale, the findings are recorded rather than churned.

## What was actually run

1. `probe-placeholders.mjs` — parsed all 15 values with `@formatjs/icu-messageformat-parser` and compared argument sets and plural selectors against en; scanned terminal punctuation and every Latin-script span.
2. `probe.mjs` — formatted the case-bearing keys with the app's own `intl-messageformat@12.1.3` from the worktree's shared `node_modules`, at ten counts and three organization-name shapes. Output is `renders.txt` (the real rendered strings).
3. `deriveReceiptAudit` from `scripts/i18n/ledger-rules.mjs` against the receipt — **accepted** as `clean-with-findings` with counts `{blocker:0, major:0, minor:1, nit:3}` and both catalogue hashes re-derived from bytes.

Not run: the full i18n gates (CI's) and any frame capture (see observation 4).

## The translator's case story — checked, and true

The commit message claims all four Russian plural arms are uniformly genitive because `{org}` substitutes a genitive "of this organization". Re-derived, not assumed:

- `{org}` is passed as `blockedTargets[0].tenant_name || t("ui.hub.pages.scope.org_unnamed")` (`upload-agent-dialog.tsx:1040`). The shipped ru `ui.hub.pages.scope.org_unnamed` is **«этой организации»** — genitive. Two pre-existing siblings build the same sentence with the same substitution (`ui.hub.pages.org.plan_body` at `agent-hub-page.tsx:1355`, `ui.hub.teams.org.plan_body` at `org-teams-list.tsx:325`), so this is shipped locale practice, not an invention of this lane.
- «Владелец» governs the genitive in every arm: `владелец организации`, `владелец любой из … организаций`, and a proper name as apposition (`владелец Acme Corp`). Uniform genitive is correct.
- `intro.org` uses the **directional accusative** «в организацию {destination}» — right for publishing *to* an organization, and the form the locale already ships (`target.orgs_unread` «…опубликовать в организацию», `ui.agents.publication.insufficient_role.body` «Для публикации в организацию…»).
- `not_leaving.org` («Участники организации {destination}…», governed by «участники») and `published.org_listed` («в общих агентах организации {destination}») both take **genitive apposition** — correct, and a different government from `intro.org` for a real reason.
- `receipt.title_org` keeps the locative «Опубликовано в организации {destination}»: a completed state, not a direction. Correct.
- Categories: `one` / `few` / `many` / `other`, all four present, matching the ru style guide (which requires `other`); identical `few`/`many`/`other` bodies are legitimate. `{count}` never renders as a digit, as the sidecar demands.

## Findings

### RU-UP-01 — MINOR — `target.blocked_hint` names one organization at a count of 21

`one` in Russian CLDR is 1, 21, 31, 41, 101 — not exactly 1 as in English. The Russian `one` arm names a single organization, so at 21 blocked organizations the hint names **one** owner while the picker shows 21 disabled rows. Reproduced, not inferred (`renders.txt`):

```
  1 -> … Владелец Acme Corp может включить его в консоли Radient.
 22 -> … Владелец любой из отмеченных выше организаций может включить его в консоли Radient.
 21 -> … Владелец Acme Corp может включить его в консоли Radient.      <- one arm at 21
 31 -> … Владелец Acme Corp может включить его в консоли Radient.      <- and at 31
```

The translator flagged the limitation honestly; this audit confirms it is reachable and supplies the fix:

```
{count, plural, =1 {{org}} one {любой из отмеченных выше организаций} few {любой из отмеченных выше организаций} many {любой из отмеченных выше организаций} other {любой из отмеченных выше организаций}}
```

`=1` beside `one` is already shipped in ru (`ui.chat.canonical.fold.images_aria`, `ui.chat.canonical.image_gen.batch_summary`), so it introduces nothing new. **Why MINOR and not MAJOR:** it needs 21+ blocked organizations, the sentence stays grammatical, the named organization's owner can indeed enable it, and the disabled rows carry the true scope — no wrong action follows. If the team reads the 21-state as asserting something false about scope, the fix is one line.

### RU-UP-02 — NIT — sibling tense drift

`published.org_listed` «…никто за её пределами этого не **может**» against `not_leaving.org` «…никто за её пределами этого не **сможет**». Both grammatical; the pair reads as drift. Harmonise on «не сможет» or keep both deliberately.

### RU-UP-03 — NIT — «Публикация…» reuses the listing noun

`action.publishing` = «Публикация…», while the same namespace uses «публикация» as the noun for a **listing** (`open_listing` «Открыть публикацию», `update_listing` «Обновить публикацию», `receipt.title_updated` «Публикация обновлена»). «Публикуется…» is the impersonal in-flight form the ru guide prefers and keeps «публикация» for the object. Same one-word + U+2026 shape.

### RU-UP-04 — NIT — body and title disagree, and the title is the outlier

The new `intro.org` correctly takes «в организацию {destination}»; the dialog title on the same screen still takes the locative («Опубликовать «{name}» в организации {destination}?»), which is the **still-open MINOR RU-AL2-02** from the previous ru round. Recorded so the title is fixed with it — the new copy needs no change and must not be re-churned.

## Observations (not findings)

1. **Out of scope — pre-existing, all seven locales.** `{destination}` is not always a name: `upload-agent-dialog.tsx:306` falls back to the hardcoded English literal `"this organization"` (blame `dac08d66c86`, 2026-09-27, before the English keying), not to the localized `ui.hub.pages.scope.org_unnamed`. In ru that renders «в организацию this organization». A component defect that predates this diff, so it does not gate here — but whoever fixes it must use a **nominative** fallback for `{destination}`; reusing the shipped genitive `org_unnamed` would make `intro.org` read «в организацию этой организации».
2. A declinable common-noun organization name stays uninflected after the accusative head («в организацию Служба поддержки»). Quoting would fix the morphology but collides with the genitive fallback and with the locale's shipped unquoted `{org}`/`{organization}` usage. No action.
3. Hub casing: the new copy follows the locale's implicit rule — capitalised surface name «Хаб агентов», lowercase common noun «хаб» — consistently across all five sentences that mention it. The open NIT RU-AL2-04 asks for that rule to be written down; it stays open on the record, not on this diff.
4. No frame was captured. These are catalogue values in a desktop dialog; case, plural and punctuation are exactly what the ICU runtime decides, and `renders.txt` is that runtime's output. A pixel/layout check belongs to the design stream if the dialog is re-reviewed.

## Other checks that passed

Terminology matches the locale word for word where the frame already exists — «Обмен агентами внутри организации входит в тариф Radient Team» is the sentence `ui.hub.pages.org.plan_body` already ships; «набор инструкций», «общие агенты», «усвоенное», «история выполнения», «участники», «тариф» all have shipped precedent. Placeholder sets equal en on every key; terminal punctuation matches en on every key; U+2026 ellipsis, «ёлочки», sentence case and «вы» only sentence-initial as the guide requires. No English residue: the only Latin spans are placeholders, `Radient`, `Team` and ICU keywords.

## Hashes

| Input | SHA-256 |
|---|---|
| `en/ui.agents.upload.json` | `3676c1b366cc5159b94be65acdaea925bd193d20c2524ff3f410a8a5ddff514f` |
| `en/ui.agents.upload.context.json` | `76323fe386f9b15d490c3a48feaddbd924f04148f1c893e927c2acde06f11cec` |
| `ru/ui.agents.upload.json` | `055f72e11c8c7919a3c6fbe9488b1537e18d2ad906d98a6531889bffb96f9aaf` |
| glossary | `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8` |
| ru style guide | `f20e1cafaf70578c17ce072c71725628808d228e4be5604329f8da30386f1fb5` |
| receipt `i18n/receipts/ru-upload-r1-3f08e28cd8df.json` | `913fa98e08f4bde6359e553b34efdc3cfefd1158b695752f4a3b465e066e9457` |
| this record | `f1d4fdf97dcb366d8ebd28ab6549530cd56624122f98ba7f02a437ab8f005448` |

Nothing was committed; no catalogue, ledger, allowance or generator file was touched. The ledger row is the manager's step, to be assembled from this receipt.
