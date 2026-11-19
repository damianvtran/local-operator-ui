# fr · ui.browser.media_access · independent audit `mp1843-a3-fr`

- Audit date: 2026-11-10 · PR #1843 head `748f4c83caf83fb3e497b4a39defeacb85a2932e` (round-2 remediation; i18n delta `99d69f364e3..748f4c83caf` touches only `blocked_hint`)
- Auditor: agent `task` (team lopdev, label i18n-delta-audit-1843), session `73e65f3746d2`, model `anthropic/claude-opus-5-5` (harness session header; no fallback observed, no role/model pin). Translator: agent `coder`, same model family — independence is by agent instance. Not the round-1 auditor (`d1da94af17b7`).
- Scope: all 9 keys of the namespace (French). `blocked_hint` (now a `devices` select) re-read in full; the other 8 keys are byte-identical to the values this auditor read as `mp1843-a2-fr` at `99d69f364e3` (a scratch-only audit, never committed, superseded by this record) — proved by a key-by-key JSON compare of `git show` at both revisions for `en`, the context sidecar and this locale, where only `blocked_hint` differs. Those verdicts are carried and every key is re-checked mechanically below.
- References: `i18n/glossary.md` and `i18n/style-guides/fr.md` (local-operator origin/main dc167abd0ec4, byte-identical to round-1's 9372a3a42d0e), the English catalogue and context sidecar, the audited sibling `src/i18n/catalogues/fr/ui.browser.media_permission.json` (mp1843-a1-fr, unchanged) rendered in the same band, other `ui.*` fr copy for the Dismiss/notice pattern. No MT service, translation API or SDK used.
- Rendering context checked in source at `748f4c83caf`: `browser-media-permission-prompt.tsx:152` passes `{ devices }` to `blocked_hint`; the blocked band's button is `ui.browser.media_permission.allow`.

## Verdict: PASSED — 0 BLOCKER, 0 MAJOR, 0 MINOR, 2 NIT on the audited bytes

## Corrected in the audit patch

- none — the translator's bytes (sha256 `4840c44769c872e4592924acafe16f3b56519bcb3dbc4da3e11b621f28507f56`) are the audited bytes; the ledger row's `target_sha256` is unchanged.

## Residual findings (not gating)

- **FR-A3-N1** NIT `ui.browser.media_access.notice_dismiss` — Ignorer l’avis: sibling “Dismiss … notice” labels (ui.browser.browser_passkey_notice.dismiss, ui.browser.browser_file_transfer_row.dismiss_download_notice/_upload_notice, ui.common.updates.update_quiet_indicator.dismiss_update_notice, ui.settings.configuration…dismiss_this_notice) all use Masquer (Masquer l’avis de clé d’accès, …); Ignorer matches this band's prompt_dismiss and is a common fr Dismiss (ui.agentMessages.banner.dismiss). Accessible name only. Optional: Masquer l’avis. No change.
- **FR-A3-N2** NIT `ui.browser.media_access.blocked_hint` — Button name Autoriser is unquoted (every arm); « Autoriser » (U+202F inside) would mirror ru/zh-CN. Same call as round-1 FR-N1. No change.

## Observations (INFO)

- FR-A3-I1 `ui.browser.media_access.system_blocked_hint` — Réglages Système › Confidentialité et sécurité equals the audited media_permission hint; Ouvrir Réglages Système follows Apple's article-less app-name usage; no : ; ! ? in any value, so no U+202F needed; apostrophes are U+2019; vous register.
- FR-A3-I2 `ui.browser.media_access.blocked_hint` — Round-2 remediation (748f4c83caf) made blocked_hint a devices select, resolving the a2 source observation (“them” for one device); the component now passes devices (browser-media-permission-prompt.tsx:152). l’utiliser (U+2019) covers micro (m.) and caméra (f.) alike; les for both.
- FR-A3-I3 `ui.browser.media_access` — The other 8 keys are byte-identical to the values audited as mp1843-a2-fr at 99d69f364e3 (JSON key-by-key compare of git show 99d69f364e3: vs 748f4c83caf:; only blocked_hint differs in en, context and this locale); a2 verdicts on them are carried, re-run mechanically here.

## Mechanical checks

- `verify.mjs` (this bundle) parses every value with the repo's `@formatjs/icu-messageformat-parser`: key set equals English (9/9); argument names and `devices` select arms (`audio|other|video`) identical to English in every select key (now including `blocked_hint`), `site` only in `blocked`; NFC; no manual bidi/format controls; no padding; `Local Operator` and `macOS` kept verbatim; fr has no U+0020 before `: ; ! ?`; each select arm formatted with `intl-messageformat` (`site=meet.google.com`), no unresolved braces. Consistency with the audited sibling: `prompt_label`/`prompt_dismiss` “other” arms equal `ui.browser.media_permission.label`/`.dismiss`; every formatted `blocked_hint` arm names `ui.browser.media_permission.allow` verbatim; both system hints carry the same localized `System Settings › Privacy & Security` path and `open_system_settings` reuses the System Settings name. Its actual stdout is `audit.log` (run from the root of a `git archive` export of `748f4c83caf`).
- `negative-control.log`: the same script (FAIL/summary lines of its stdout, plus its exit status) against a scratch copy with four deliberate mutations — es `blocked` with its `video` arm dropped, fr `blocked_hint` with `ici : ` (U+0020), ru `blocked_hint` `video` arm with «Разрешить» removed, vi `open_system_settings` reduced to `Mở Cài đặt` — exits 1 with exactly those four failures, so the shape, French-spacing, per-arm Allow and System Settings checks can fail.
- `node scripts/i18n/ledger-check.mjs` on that export with this patch applied: `ledger-check: ok — 1099 entr(ies) complete, fresh and independently audited` (before the patch: 14 failures, all on this namespace — `status is "pending"` and `no auditor recorded` per locale).
- Not done here: rendered-frame/fit evidence of the band in this locale (design/QA streams own it); no width budget (`maxCells`) is declared for these keys.
