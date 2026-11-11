# hi · ui.browser.media_permission · independent audit `mp1843-a1-hi`

- Audit date: 2026-11-10 · PR #1843 head `4f0df27743eecae09ccc8c3e69838faa616a3eb2` (scope `7385893f87a..4f0df27743e`)
- Auditor: agent `task` (team lopdev, label i18n-audit-1843), session `d1da94af17b7`, model `anthropic/claude-opus-5-5` (harness session header; no fallback observed, no role/model pin). Translator: agent `coder`, same model family — independence is by agent instance.
- Scope: all 8 keys of the new namespace (Hindi). References: `i18n/glossary.md` and `i18n/style-guides/hi.md` (local-operator origin/main `9372a3a42d0e`), the English catalogue and context sidecar, sibling `ui.browser.*` hi copy, core `cli.permissions` hi rendering of the macOS labels. No MT service, translation API or SDK used.

## Verdict: PASSED — 0 BLOCKER, 0 MAJOR, 0 MINOR, 3 NIT on the audited bytes

## Corrected in the audit patch (auditor-authored values — disclose to reviewers)

- **HI-M1** (MINOR, `ui.browser.media_permission.system_blocked_hint`): Context requires official macOS names where Apple localizes them; macOS ships Hindi and Apple hi Mac help (support.apple.com/hi-in/guide/mac-help/mchl211c911f) writes सिस्टम सेटिंग्ज़ > गोपनीयता और सुरक्षा. Core hi cli.permissions also localizes these labels.
  - before: `इसे System Settings › Privacy & Security में चालू करें, फिर पेज दोबारा लोड करें।`
  - after: `इसे सिस्टम सेटिंग्ज़ › गोपनीयता और सुरक्षा में चालू करें, फिर पेज दोबारा लोड करें।`
- **HI-M2** (MINOR, `ui.browser.media_permission.dismiss`): hi style guide: keep nukta consistently; खारिज → ख़ारिज.
  - before: `कैमरा और माइक्रोफ़ोन अनुरोध खारिज करें`
  - after: `कैमरा और माइक्रोफ़ोन अनुरोध ख़ारिज करें`

The translator's bytes (sha256 `0995f84fbd461a04c85665cf1cc3801c04e9e6a3d0c66a1a4e9af781e0bc87fa`) are recorded under the ledger row's `superseded`; the audit covers the corrected bytes (`ff7fe290a3b2b8ae051b636744a3d7b47674239ed010a5d26aad04d42ca1e428`).

## Residual findings (not gating)

- **HI-N1** NIT `ui.browser.media_permission.system_blocked` — ऐक्सेस vs UI corpus एक्सेस (21 vs 0). Apple hi Mac help itself spells ऐक्सेस, so no change.
- **HI-N2** NIT `ui.browser.media_permission.message` — Feminine चाहती (implied साइट) vs masculine sibling ui.browser.browser_consent_request.wants_to_open (चाहता). Both grammatical; no change.
- **HI-N3** NIT `ui.browser.media_permission.agent_tab_hint` — Button name अनुमति दें is unquoted; “अनुमति दें” would read clearer. Optional, no change.

## Observations (INFO)

- none

## Mechanical checks

- `verify.mjs` (this bundle) parses every value with the repo's `@formatjs/icu-messageformat-parser`: key set equals English (8/8); argument names and `devices` select arms (`audio|other|video`) identical to English in `message` and `system_blocked`; NFC; no manual bidi/format controls; no padding; `Local Operator` and `macOS` kept verbatim; each select arm formatted with `intl-messageformat` (`site=meet.google.com`), no unresolved braces. Its actual stdout is `audit.log` (run on an export of the PR head with this patch's catalogue corrections applied).
- `negative-control.log`: the same script against a deliberately broken es copy (one select arm dropped) exits 1 with `ICU shape differs` — the check can fail. (The product-name check is per value, so it did not trip on the second mutation; recorded as a limit.)
- `node scripts/i18n/ledger-check.mjs` on that export, with this patch applied: `ok — 1092 entr(ies) complete, fresh and independently audited` (before the patch: 14 failures, all on this namespace).
- Not done here: rendered-frame/fit evidence of the band in this locale (design/QA streams own it); no width budget (`maxCells`) is declared for these keys.
