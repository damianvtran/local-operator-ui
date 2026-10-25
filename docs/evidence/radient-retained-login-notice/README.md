# Radient retained-login notice — evidence

This additive UI companion displays trusted recovery copy returned by successful Radient auth operations. It does not change the verdict, forward generic diagnostics, parse HTML/Markdown, adopt drafts, or implement the full onramp.

## Provenance

- Base: `2eaf19928b2b7b26c67b690fbe2a013308584d63`.
- Exact production/test/story blob identities and artifact SHA256 values are in `proof.json`.
- The real ProviderGrid/ProviderDetail, sign-in hook/session/poller, and repository preview/decorators/fonts/Tailwind styles were used. Only desktop IPC replies were scripted.
- Baseline uses the exact base production component with the same future-wire fixture, not an old fixture. Its positive notice assertion fails because the notice is absent. Fixed production source was restored and hash-verified between comparisons.
- UI snapshots use the exact trusted backend template with synthetic record IDs101/202. Preserved-disabled failure is an internal RadientLoginDisabled(LoginError) translated to a failed snapshot with its exact message and null notice; no wire error_code was added.

## Actual automated results

- `node --test scripts/provider-detail-remount.test.mjs`: **23/23 passed**.
- `node --test scripts/provider-sign-in-flow.test.mjs`: **21/21 passed**.
- Renderer `tsc --noEmit -p tsconfig.app.json`: **exit0**.
- Scoped Biome over the four files: **exit0, 11 warnings, including two newly added story regex warnings**. See the Q1 provenance correction below.
- Old-production baseline witness: **expected exit1**, notice missing under the same successful future-wire fixture.
- Original authored-fixture failures are retained: deferred helper scope, an incorrect Done expectation for a still-signed-out Radient row, and mismatched story harness/type APIs. Remediation corrected fixtures, not production readiness behavior.
- No local full-suite pass is claimed; CI and normal publication hooks remain outstanding.

## Viewed screenshots

Pixels live outside tracked source, following `.gitignore`'s evidence split, at `docs/evidence-frames/radient-retained-login-notice/` in the separately supplied packet. Do not force-add PNGs. The README and proof JSON are suitable for the tracked `docs/evidence/` tree after publication authorization.

| File | What was actually viewed |
|---|---|
| baseline-normal-direct.png | Base success with default receipt and controls, but no recovery notice. |
| fixed-normal.png | Fixed success with exact multiline notice, separate indented101/202 references, default receipt/Change/Done. |
| clean-baseline-320.png | Base at320x568, addons hidden and whole canvas contained. |
| clean-fixed-320-first.png | Fixed at320x568, whole notice visible with soft wrapping. |
| clean-fixed-320-settled.png | Byte-identical to first sampled frame; no observed reflow between samples. |
| old-core-absence.png | Normal-width old-core success with no notice element or extra notice gap. |
| preserved-disabled.png | Normal-width existing failure surface with exact preserved-disabled message, no success notice. |
| cancel-late-first.png / cancel-late-settled.png | Normal-width idle after actual cancellation and deferred late success resolution, no leaked notice; byte-identical. |

Earlier `baseline-narrow.png` and `fixed-narrow-*.png` retain the **manager-clipping caveat**. They are historical artifacts, superseded by clean320 screenshots for narrow baseline/success, not silently relabelled as clean.

## Geometry and limits

Normal notice:864x117px, white-space:pre-wrap, overflow-wrap:anywhere, min-width:0px, font13px and line-height19.5px.

Clean baseline iframe top96/bottom664 within preview40–720. Clean fixed iframe top76/bottom644 within preview20–700; both320x568. The full narrow notice is visible. Done reaches the natural canvas bottom edge; the full provider page is not claimed to fit in568px.

No numeric narrow paragraph scrollWidth/clientWidth read was collected. No narrow absence/failure/cancel captures, pre-cancel waiting still, or alternate-theme sweep. Normal success lacks a distinct first/settled pair. These are not whole-onramp, native runtime, JWT, real OAuth or phone-connector validation.

## Failed setup and resource attribution

The initial full-index Storybook process group exceeded the enforced2GiB cap (reported2.1GB) and was killed. Its No Preview failure was not treated as a pixel pass. Scoped retries changed configuration materially: one story module, reactDocgen:false, same real preview/styles/decorators, old-space1024MiB and GOMAXPROCS2. They stayed under the enforced guard; exact peak RSS was not measured.

The initial functional phase checked RAM/load but **omitted a fresh Data-volume df guard**. That omission is preserved in the validation receipt. Subsequent capture leases included fresh Data/RAM guards and parent-attributed capacity history. All servers/tabs were closed; temporary config and production swaps were restored and hash-verified. No permanent Storybook config change remains.

## Review reachability

Story IDs share prefix `provider-sign-in-onboarding--`: `panel-radient-retained-notice`, `panel-radient-old-backend-no-notice`, `panel-radient-preserved-disabled`, `panel-radient-late-notice-after-cancel`. The accepted scoped-start/capture/restore procedure is in the packet's preflight and receipts. A live review run needs its own resource lease; no server is left running.

Code, QA and design rounds must target the eventual published commit. Local file/blob provenance is not a substituted reviewed-head SHA. No reviewers are added or people notified automatically in this repository.

## Q1 provenance correction — review round 1

The original summary described all 11 scoped lint warnings as existing. That attribution was incorrect: `scoped-lint-final.log` reports two `useTopLevelRegex` warnings on the newly added `openRow(/^Manage /i)` calls in `sign-in-states.stories.tsx`, at lines 1034 and 1126 in the reviewed source. The correct result is **11 warnings total, including two new story regex warnings**; the exit status remains 0.

This addendum answers [QA finding Q1](https://github.com/damianvtran/local-operator-ui/pull/1374#issuecomment-6379130538). The original logs, historical receipts, their hashes, all four source blobs and every captured pixel are unchanged. `proof.json` retains its original `scoped_lint_existing_warnings` field as historical metadata and appends an explicit correction superseding that attribution. This is a metadata-only correction, not a source cleanup or a new test run. The separately recorded normal push hooks passed; no broader CI, native, OAuth or onramp claim is added.
