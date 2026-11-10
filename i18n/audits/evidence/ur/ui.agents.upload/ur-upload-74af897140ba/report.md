# ur — ui.agents.upload — independent audit, round 1

- **Head** `2b72db6a56ad8204ec7f30a0ba6ffbc941be3b82` (branch `i18n/slice-upload-agent-dialog`, base `origin/main` `e9fef1164036`)
- **Auditor** i18n-auditor (independent; wrote none of these translations)
- **Served model** `deepseek/deepseek-flash` (fallback chain disclosed in the receipt: sonnet-5-5 → opus-5-5 → gpt-6.1-sol → deepseek-flash, each switch a provider quota failure)
- **Verdict** passed — **0 blocker / 0 major / 0 minor / 1 nit**
- **Receipt** `i18n/receipts/ur-upload-r1-74af897140ba.json`

## Scope

The 15 keys this commit adds to `src/i18n/catalogues/ur/ui.agents.upload.json`
(`git diff origin/main..2b72db6a56a -- …/ur/ui.agents.upload.json` = exactly 15 added
lines, no other ur change). Judged for naturalness, RTL word order, terminology
consistency with `ur/`, one/other plurals, placeholder identity, and English residue.

## What was executed

| Check | Command | Result |
|---|---|---|
| key + context parity, ICU parse & skeleton, manual-bidi scan, forbidden-script scan, duplicate members, hashes | `node verify-ur-upload.mjs` | 46/46 keys both catalogues, 46/46 context entries, `findings: []` |
| bidi composition | `fribidi --rtl --levels` on 9 composed values (`python3 bidi-ur-upload.py`, calibration row included) | two data islands stay separate through the shipping path; no controls in the catalogue |
| real rendering path | `node render-ur-upload.mjs` — bundles `src/i18n/messages` + `locale`, `setLocale("ur")`, calls the real `t()` | 22 renderings, 0 keys echoed back, plural correct at count=1 and count=3, runtime emits only U+2068/U+2069 |
| receipt derives | `node verify-receipt.mjs` → `deriveReceiptAudit` | `clean-with-findings {blocker:0, major:0, minor:0, nit:1}` |

No whole-suite run: the diff's own coverage is CI's, per the review-economy rule.

## The translator's four claims, each verified against `ur/`

| Claim | Evidence | Holds |
|---|---|---|
| listing → `اندراج`, matching `ui.agents.publication` | 11 ur values render an EN "listing" with `اندراج`, incl. `ui.agents.publication.action.publish_as_new` / `.action.update_listing`; the verb sense of "listing" elsewhere is `فہرست` (a different concept) | yes |
| Team plan → `Team پلان` | `ui.teamBridgeTrial.*` and `ui.agents.publication.team_plan_required.body`; the new first sentence is byte-identical to that sibling | yes |
| Radient console → `Radient کنسول` | `ui.agents.publication.team_plan_required.body` and `ui.hub.pages.org.plan_body` — the latter carries the **same clause** `{org} کا مالک اسے Radient کنسول میں فعال کر سکتا ہے` the new hint reuses | yes |
| "Agent Hub" stays Latin because the header title does | `ui.hub.pages.header.title` = `Agent Hub`; 11 ur files use it in Latin, and no `ایجنٹ ہب` spelling exists anywhere in `ur/` | yes |

The `ہب` / `Agent Hub` split is not sloppiness: it follows the English source exactly —
`ہب` where EN says "the hub" / "public hub" (`receipt.title_hub`,
`availability.reserved_*`, `target.visibility_hint_public`), `Agent Hub` where EN names
the product (`intro.public`, `title.publish_public`, `title.published_public`,
`title.republished`, `title.update_listing`).

## Bidi

The catalogue carries **no** manual bidi control: a scan for U+200E, U+200F, U+061C,
U+202A–U+202E and U+2066–U+2069 over all 46 ur values returns zero, as does the repo's
shipped gate class (`ur-activation.test.mjs`, which also forbids Devanagari and the
Arabic-only kaf/yeh/teh-marbuta/alef-maksura — zero hits).

`published.org_listed` is the one value where two data tokens sit side by side with only
a quote and a space between them. Spliced raw they merge into a single 20-byte LTR island
(`fleet-ops” Acme Corp`); through `translate()` each Latin-led argument is FSI/PDI
isolated (`src/i18n/bidi.ts` `isolateArguments`, wired in `messages.ts render`), and the
level map then shows two separate islands, so the RTL base orders them name-then-
destination as the sentence reads. The catalogue is right to add nothing of its own.

## Findings

**N1 (nit)** `target.visibility_hint_public` — EN "Public hub publications" is rendered
`عوامی ہب پر شائع ہونے والی چیزیں` ("the things published on the public hub"). Accurate
and natural, but the referent is exactly the hub listings this locale already calls
`اندراج`; the settled noun would read as the same surface the dialog is about, and the
same sentence already says `شائع`. Suggested: `عوامی ہب پر شائع شدہ اندراجات کوئی بھی
پڑھ سکتا ہے۔` (second sentence unchanged). Wording preference only.

## Observations (not counted)

- **O2** `not_leaving.org` / `.public` reuse the sibling `sign_in.nothing_left`'s
  `مشین سے مخصوص ترتیب`, which is what the context asks for ("past-tense sibling"). The
  wider locale also renders "configuration" as `کنفیگریشن` in 28 EN values — a
  pre-existing split, out of scope here.
- **O3** `action.publishing` = `شائع کیا جا رہا ہے…` is four words against the sidecar's
  "one word plus a single-character ellipsis" hint; it is 19 characters against 9 and 18
  for the other two submit states (EN spread 7/11/14), and no `maxCells` budget exists
  for these keys. U+2026 is used, never three periods.
- **O4** plural: the `one` branch is a bare `{org}` and the `other` branch is
  `اوپر نشان زدہ تنظیموں میں سے کسی ایک`; with the frame `… کا مالک` both read correctly
  ("اس تنظیم کا مالک…" / "…میں سے کسی ایک کا مالک…"), measured at count=1 and count=3.

## Not claimed

No rendered frame, screenshot, activation or release evidence; no fit measurement in the
component (no `maxCells` exists for these keys); no native-speaker review beyond this
auditor's own reading. Nothing outside `i18n/receipts/` and this evidence directory was
written, and nothing was committed.
