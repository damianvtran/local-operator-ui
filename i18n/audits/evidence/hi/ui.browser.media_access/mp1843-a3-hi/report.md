# hi · ui.browser.media_access · independent audit `mp1843-a3-hi`

- Audit date: 2026-11-10 · PR #1843 head `748f4c83caf83fb3e497b4a39defeacb85a2932e` (round-2 remediation; i18n delta `99d69f364e3..748f4c83caf` touches only `blocked_hint`)
- Auditor: agent `task` (team lopdev, label i18n-delta-audit-1843), session `73e65f3746d2`, model `anthropic/claude-opus-5-5` (harness session header; no fallback observed, no role/model pin). Translator: agent `coder`, same model family — independence is by agent instance. Not the round-1 auditor (`d1da94af17b7`).
- Scope: all 9 keys of the namespace (Hindi). `blocked_hint` (now a `devices` select) re-read in full; the other 8 keys are byte-identical to the values this auditor read as `mp1843-a2-hi` at `99d69f364e3` (a scratch-only audit, never committed, superseded by this record) — proved by a key-by-key JSON compare of `git show` at both revisions for `en`, the context sidecar and this locale, where only `blocked_hint` differs. Those verdicts are carried and every key is re-checked mechanically below.
- References: `i18n/glossary.md` and `i18n/style-guides/hi.md` (local-operator origin/main dc167abd0ec4, byte-identical to round-1's 9372a3a42d0e), the English catalogue and context sidecar, the audited sibling `src/i18n/catalogues/hi/ui.browser.media_permission.json` (mp1843-a1-hi, unchanged) rendered in the same band, other `ui.*` hi copy for the Dismiss/notice pattern. No MT service, translation API or SDK used.
- Rendering context checked in source at `748f4c83caf`: `browser-media-permission-prompt.tsx:152` passes `{ devices }` to `blocked_hint`; the blocked band's button is `ui.browser.media_permission.allow`.

## Verdict: PASSED — 0 BLOCKER, 0 MAJOR, 0 MINOR, 2 NIT on the audited bytes

## Corrected in the audit patch

- none — the translator's bytes (sha256 `72bece022969bd0c8600406a692cf72b23ac4aee69d9affe362fbac97a591bbd`) are the audited bytes; the ledger row's `target_sha256` is unchanged.

## Residual findings (not gating)

- **HI-A3-N1** NIT `ui.browser.media_access.notice_dismiss` — सूचना ख़ारिज करें: sibling “Dismiss … notice” labels (ui.browser.browser_passkey_notice.dismiss, ui.browser.browser_file_transfer_row.dismiss_download_notice/_upload_notice, ui.common.updates.update_quiet_indicator.dismiss_update_notice, ui.settings.configuration…dismiss_this_notice) all use हटाएँ (पासकी सूचना हटाएँ, …); ख़ारिज matches this band's prompt_dismiss and ui.common.actions.dismiss. Accessible name only. Optional: सूचना हटाएँ. No change.
- **HI-A3-N2** NIT `ui.browser.media_access.blocked_hint` — Button name अनुमति दें is unquoted (every arm); “अनुमति दें” would read clearer. Same call as round-1 HI-N3. No change.

## Observations (INFO)

- HI-A3-I1 `ui.browser.media_access.system_blocked_hint` — सिस्टम सेटिंग्ज़ › गोपनीयता और सुरक्षा equals the round-1-corrected media_permission hint (Apple hi Mac help, HI-M1); ऐक्सेस matches media_permission.system_blocked; nukta kept (माइक्रोफ़ोन, ख़ारिज, सेटिंग्ज़); हैं agrees with the plural other arm.
- HI-A3-I2 `ui.browser.media_access.blocked_hint` — Round-2 remediation (748f4c83caf) made blocked_hint a devices select, resolving the a2 source observation (“them” for one device); the component now passes devices (browser-media-permission-prompt.tsx:152). इसे for one device, इन्हें for both — correct.
- HI-A3-I3 `ui.browser.media_access` — The other 8 keys are byte-identical to the values audited as mp1843-a2-hi at 99d69f364e3 (JSON key-by-key compare of git show 99d69f364e3: vs 748f4c83caf:; only blocked_hint differs in en, context and this locale); a2 verdicts on them are carried, re-run mechanically here.

## Mechanical checks

- `verify.mjs` (this bundle) parses every value with the repo's `@formatjs/icu-messageformat-parser`: key set equals English (9/9); argument names and `devices` select arms (`audio|other|video`) identical to English in every select key (now including `blocked_hint`), `site` only in `blocked`; NFC; no manual bidi/format controls; no padding; `Local Operator` and `macOS` kept verbatim; fr has no U+0020 before `: ; ! ?`; each select arm formatted with `intl-messageformat` (`site=meet.google.com`), no unresolved braces. Consistency with the audited sibling: `prompt_label`/`prompt_dismiss` “other” arms equal `ui.browser.media_permission.label`/`.dismiss`; every formatted `blocked_hint` arm names `ui.browser.media_permission.allow` verbatim; both system hints carry the same localized `System Settings › Privacy & Security` path and `open_system_settings` reuses the System Settings name. Its actual stdout is `audit.log` (run from the root of a `git archive` export of `748f4c83caf`).
- `negative-control.log`: the same script (FAIL/summary lines of its stdout, plus its exit status) against a scratch copy with four deliberate mutations — es `blocked` with its `video` arm dropped, fr `blocked_hint` with `ici : ` (U+0020), ru `blocked_hint` `video` arm with «Разрешить» removed, vi `open_system_settings` reduced to `Mở Cài đặt` — exits 1 with exactly those four failures, so the shape, French-spacing, per-arm Allow and System Settings checks can fail.
- `node scripts/i18n/ledger-check.mjs` on that export with this patch applied: `ledger-check: ok — 1099 entr(ies) complete, fresh and independently audited` (before the patch: 14 failures, all on this namespace — `status is "pending"` and `no auditor recorded` per locale).
- Not done here: rendered-frame/fit evidence of the band in this locale (design/QA streams own it); no width budget (`maxCells`) is declared for these keys.
