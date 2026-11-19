# vi · ui.browser.media_permission · independent audit `mp1843-a1-vi`

- Audit date: 2026-11-10 · PR #1843 head `4f0df27743eecae09ccc8c3e69838faa616a3eb2` (scope `7385893f87a..4f0df27743e`)
- Auditor: agent `task` (team lopdev, label i18n-audit-1843), session `d1da94af17b7`, model `anthropic/claude-opus-5-5` (harness session header; no fallback observed, no role/model pin). Translator: agent `coder`, same model family — independence is by agent instance.
- Scope: all 8 keys of the new namespace (Vietnamese). References: `i18n/glossary.md` and `i18n/style-guides/vi.md` (local-operator origin/main `9372a3a42d0e`), the English catalogue and context sidecar, sibling `ui.browser.*` vi copy, core `cli.permissions` vi rendering of the macOS labels. No MT service, translation API or SDK used.

## Verdict: PASSED — 0 BLOCKER, 0 MAJOR, 0 MINOR, 3 NIT on the audited bytes

## Corrected in the audit patch (auditor-authored values — disclose to reviewers)

- **VI-J1** (MAJOR, `ui.browser.media_permission.agent_tab_hint`): Glossary §2 binds agent → tác nhân for vi; the value used tác tử, which appears nowhere else in the vi UI corpus (tác nhân: 683, including the sibling passkey “thẻ do tác nhân điều khiển”).
  - before: `Đây là thẻ do tác tử điều khiển, nên Cho phép chỉ áp dụng cho yêu cầu này.`
  - after: `Đây là thẻ do tác nhân điều khiển, nên Cho phép chỉ áp dụng cho yêu cầu này.`

The translator's bytes (sha256 `a277d64030f5b44d19225951e91bceb57f2c74d1be969a6c689899c8651a0881`) are recorded under the ledger row's `superseded`; the audit covers the corrected bytes (`3a03efae1d9cb8236925f7084d43598d3da13102e51871cc2817fb2f3c2b411f`).

## Residual findings (not gating)

- **VI-N1** NIT `ui.browser.media_permission.agent_tab_hint` — thẻ for tab vs predominant tab in ui.browser* vi copy (passkey notices use both). No change.
- **VI-N2** NIT `ui.browser.media_permission.label` — camera/micrô vs ui.browser.extensions máy ảnh/micrô and corpus micro (5). Readable and common; no change.
- **VI-N3** NIT `ui.browser.media_permission.agent_tab_hint` — Button name Cho phép is unquoted; “Cho phép” would read clearer. Optional, no change.

## Observations (INFO)

- VI-I1 `ui.browser.media_permission.system_blocked_hint` — Cài đặt hệ thống › Quyền riêng tư & Bảo mật matches core vi cli.permissions.

## Mechanical checks

- `verify.mjs` (this bundle) parses every value with the repo's `@formatjs/icu-messageformat-parser`: key set equals English (8/8); argument names and `devices` select arms (`audio|other|video`) identical to English in `message` and `system_blocked`; NFC; no manual bidi/format controls; no padding; `Local Operator` and `macOS` kept verbatim; each select arm formatted with `intl-messageformat` (`site=meet.google.com`), no unresolved braces. Its actual stdout is `audit.log` (run on an export of the PR head with this patch's catalogue corrections applied).
- `negative-control.log`: the same script against a deliberately broken es copy (one select arm dropped) exits 1 with `ICU shape differs` — the check can fail. (The product-name check is per value, so it did not trip on the second mutation; recorded as a limit.)
- `node scripts/i18n/ledger-check.mjs` on that export, with this patch applied: `ok — 1092 entr(ies) complete, fresh and independently audited` (before the patch: 14 failures, all on this namespace).
- Not done here: rendered-frame/fit evidence of the band in this locale (design/QA streams own it); no width budget (`maxCells`) is declared for these keys.
