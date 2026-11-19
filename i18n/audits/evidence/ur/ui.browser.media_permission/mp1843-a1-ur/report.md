# ur · ui.browser.media_permission · independent audit `mp1843-a1-ur`

- Audit date: 2026-11-10 · PR #1843 head `4f0df27743eecae09ccc8c3e69838faa616a3eb2` (scope `7385893f87a..4f0df27743e`)
- Auditor: agent `task` (team lopdev, label i18n-audit-1843), session `d1da94af17b7`, model `anthropic/claude-opus-5-5` (harness session header; no fallback observed, no role/model pin). Translator: agent `coder`, same model family — independence is by agent instance.
- Scope: all 8 keys of the new namespace (Urdu). References: `i18n/glossary.md` and `i18n/style-guides/ur.md` (local-operator origin/main `9372a3a42d0e`), the English catalogue and context sidecar, sibling `ui.browser.*` ur copy, core `cli.permissions` ur rendering of the macOS labels. No MT service, translation API or SDK used.

## Verdict: PASSED — 0 BLOCKER, 0 MAJOR, 0 MINOR, 2 NIT on the audited bytes

## Corrected in the audit patch (auditor-authored values — disclose to reviewers)

- **UR-M1** (MINOR, `ui.browser.media_permission.dismiss`): برخاست (dismissal of a person or court petition) is unidiomatic for closing a UI request and appears nowhere in the ur corpus; ur Dismiss controls use ہٹائیں (ui.agentMessages.banner.dismiss, update notice).
  - before: `کیمرے اور مائیکروفون کی درخواست برخاست کریں`
  - after: `کیمرے اور مائیکروفون کی درخواست ہٹائیں`

The translator's bytes (sha256 `176cf0d3fb4184b965493fe50c3c8031158ad183d5e4c962a91ae1776baf0af7`) are recorded under the ledger row's `superseded`; the audit covers the corrected bytes (`78b56e4204caca6a190533d31294dfc6642ac85ec3c9d9e75956b28e7a20d6bb`).

## Residual findings (not gating)

- **UR-N1** NIT `ui.browser.media_permission.message` — Feminine چاہتی vs masculine siblings (ui.browser.browser_consent_request.wants_to_open چاہتا). Grammatical with implied سائٹ; no change.
- **UR-N2** NIT `ui.browser.media_permission.agent_tab_hint` — Button name اجازت دیں is unquoted; “اجازت دیں” would read clearer. Optional, no change.

## Observations (INFO)

- UR-I1 `ui.browser.media_permission.system_blocked_hint` — System Settings › Privacy & Security kept in English, as the ur guide requires (macOS ships no Urdu UI). No manual bidi controls.

## Mechanical checks

- `verify.mjs` (this bundle) parses every value with the repo's `@formatjs/icu-messageformat-parser`: key set equals English (8/8); argument names and `devices` select arms (`audio|other|video`) identical to English in `message` and `system_blocked`; NFC; no manual bidi/format controls; no padding; `Local Operator` and `macOS` kept verbatim; each select arm formatted with `intl-messageformat` (`site=meet.google.com`), no unresolved braces. Its actual stdout is `audit.log` (run on an export of the PR head with this patch's catalogue corrections applied).
- `negative-control.log`: the same script against a deliberately broken es copy (one select arm dropped) exits 1 with `ICU shape differs` — the check can fail. (The product-name check is per value, so it did not trip on the second mutation; recorded as a limit.)
- `node scripts/i18n/ledger-check.mjs` on that export, with this patch applied: `ok — 1092 entr(ies) complete, fresh and independently audited` (before the patch: 14 failures, all on this namespace).
- Not done here: rendered-frame/fit evidence of the band in this locale (design/QA streams own it); no width budget (`maxCells`) is declared for these keys.
