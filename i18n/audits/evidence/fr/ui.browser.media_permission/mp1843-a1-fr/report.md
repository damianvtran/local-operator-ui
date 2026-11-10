# fr · ui.browser.media_permission · independent audit `mp1843-a1-fr`

- Audit date: 2026-11-10 · PR #1843 head `4f0df27743eecae09ccc8c3e69838faa616a3eb2` (scope `7385893f87a..4f0df27743e`)
- Auditor: agent `task` (team lopdev, label i18n-audit-1843), session `d1da94af17b7`, model `anthropic/claude-opus-5-5` (harness session header; no fallback observed, no role/model pin). Translator: agent `coder`, same model family — independence is by agent instance.
- Scope: all 8 keys of the new namespace (French). References: `i18n/glossary.md` and `i18n/style-guides/fr.md` (local-operator origin/main `9372a3a42d0e`), the English catalogue and context sidecar, sibling `ui.browser.*` fr copy, core `cli.permissions` fr rendering of the macOS labels. No MT service, translation API or SDK used.

## Verdict: PASSED — 0 BLOCKER, 0 MAJOR, 0 MINOR, 1 NIT on the audited bytes

## Corrected in the audit patch (auditor-authored values — disclose to reviewers)

- **FR-M1** (MINOR, `ui.browser.media_permission.agent_tab_hint`): fr style guide requires U+202F before : in prose; the value had U+0020. fr corpus: 958 U+202F vs 19 U+0020 before :;?!.
  - before: `Cet onglet est piloté par un agent : Autoriser ne vaut que pour cette demande.`
  - after: `Cet onglet est piloté par un agent : Autoriser ne vaut que pour cette demande.`

The translator's bytes (sha256 `fe9f21ca2049588a65646356fd16325ee042354323204cce0d7ab07f62b0192f`) are recorded under the ledger row's `superseded`; the audit covers the corrected bytes (`311336a7158ab1f208bfae5985d20903131b361628ad361735023440ac16f15b`).

## Residual findings (not gating)

- **FR-N1** NIT `ui.browser.media_permission.agent_tab_hint` — Button name Autoriser is unquoted; « Autoriser » would mirror ru/zh-CN. Optional, no change.

## Observations (INFO)

- FR-I1 `ui.browser.media_permission.system_blocked_hint` — Réglages Système › Confidentialité et sécurité matches core fr cli.permissions; micro matches ui.browser.extensions.permission_content_settings.

## Mechanical checks

- `verify.mjs` (this bundle) parses every value with the repo's `@formatjs/icu-messageformat-parser`: key set equals English (8/8); argument names and `devices` select arms (`audio|other|video`) identical to English in `message` and `system_blocked`; NFC; no manual bidi/format controls; no padding; `Local Operator` and `macOS` kept verbatim; each select arm formatted with `intl-messageformat` (`site=meet.google.com`), no unresolved braces. Its actual stdout is `audit.log` (run on an export of the PR head with this patch's catalogue corrections applied).
- `negative-control.log`: the same script against a deliberately broken es copy (one select arm dropped) exits 1 with `ICU shape differs` — the check can fail. (The product-name check is per value, so it did not trip on the second mutation; recorded as a limit.)
- `node scripts/i18n/ledger-check.mjs` on that export, with this patch applied: `ok — 1092 entr(ies) complete, fresh and independently audited` (before the patch: 14 failures, all on this namespace).
- Not done here: rendered-frame/fit evidence of the band in this locale (design/QA streams own it); no width budget (`maxCells`) is declared for these keys.
