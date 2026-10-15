# Native provider-access component verification

## Round-1 remediation delta (current)

R1-1: the real page forwards the matching canonical catalogue row's `locality` through chat content to the composer. The actual composer decision permits native absent Connect **only for explicitly local serving context**; remote and unproven context suppress the generic dialog. Credential-owner labels and mesh membership cannot establish that target. Legacy Connect is preserved. Remote/unproven Radient absence also cannot fall through to its independent local signup callout.

R1-2: `withdrawn` and `owner_unavailable` are writer vocabulary, **not proof of lost authorization or a network outage**. The updated copy says owner access or permission needs attention and does not rule out recovery. Immutable core `bc3d68bf` functions were executed here with synthetic eligible placement, an explicit scratch root and an unused status-client seam: `no_local_credential → withdrawn, eligible=true`; `refresh_failed → owner_unavailable, eligible=true`; a later grant heals both to `effective_borrow` without a permission change. The committed [producer controls](../../../scripts/fixtures/native-access-bc3d.json) contain only keyless contexts and source hashes, no bearer/kind/refresh material. The reachability flag is a synthetic control, not a new published wire field.

Only **10 new delta frames**, five scenes at narrow-dark and desktop-light, were captured in one admitted 120-second/512MiB source host. The same production stylesheet/theme/font pipeline and actual composer decision were used. HTTP 200; column layout and app font stack verified; console errors zero. The browser was closed and exact host PID/process group reaped. **No callback was clicked** and no `/model`, Connect, composer, live owner transition or native OAuth flow is claimed.

- [Known remote absent — no generic Connect](r1-absent_remote.png), compared with the historical absent cell in the round-1 sheet below.
- [Proven local absent — Connect preserved](r1-absent_local.png).
- [Unproven source — no generic Connect](r1-absent_unknown.png).
- [Eligible holder with owner credential loss](r1-no_local_credential.png).
- [Reachable owner with upstream refresh failure](r1-refresh_failed.png).

Retention was checked rather than re-rendering the whole set: the actual band/Alert/styles/themes are byte-unchanged from `5e49bf3`, and pending/unverified/borrowed/expired/device-bound reader+presentation JSON is byte-identical against that immutable head. The five captured production source/fixture SHA256 stamps still matched after capture. Older affected cells and the older modern-owner after frame below are **historical baseline only**, superseded by these delta frames; unchanged frames retain their stated component-only scope.

**UX U1 remains BLOCKED / deferred:** e915 normal-controller+UI busy-proof admission and the Aida scope lease are absent. A no-op component fixture cannot supply that evidence. No code workaround, native/app build, installation or merge is authorized by these frames.

## Original round-1 capture (historical baseline)

These are **production-component checks with synthetic keyless core frames**, not a live remote session, authenticated OAuth request, full Electron screenshot, all-theme sweep or claim of application visual parity. They are deliberately outside the canonical `docs/evidence` sweep/manifest: that dataset's capture and full-sweep claims are not made here.

## What rendered

The actual `SessionModelAccessBand`, `modelAccessReading`, application styles, generated themes, production font CSS and the same `MuiThemeProvider` / `CssBaseline` used by Storybook. Vite reused installed dependencies with an identical installed pnpm lock, a scratch cache/env directory, a 512 MiB Node heap and a 120-second process-group bound. No dependency install, Electron build, runtime update, sign-in or live backend request occurred.

A short-lived loopback gallery returned HTTP 200. The official harness browser drove one inactive owned tab. It selected eight host states at desktop and 420px-column widths in both `localOperatorDark` and `localOperatorLight`, plus matched legacy/modern and unpublished-host scenes: **44 raw frames**. The tab and exact host PID were closed/reaped afterward; no listener remained. Console errors: zero.

The initial scratch-root gallery omitted some Tailwind utilities and was **rejected**, not used below. Final capture explicitly discovers classes from the production component sources. It also imports the actual theme provider and font CSS rather than substituting styles. The Inter-first font stack below is the application's declaration; the supplied font stylesheet contains Roboto/Geist Mono faces. This does not claim an independently loaded Inter face or font parity with a different host.

## Geometry and theme proof

Viewport: 1280×720 CSS pixels; screenshots were captured at DPR 2. The owner-unavailable card measured:

| Width | Card | Actual text column | Layout |
|---|---:|---:|---|
| Desktop | 1232×116.5px | 1049.47×98.5px | `display:flex; flex-direction:column` |
| 420px fixture column | 372×233.5px | 326×215.5px | same column layout |

Computed font family: `Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`.
Dark warning wash/border: `rgb(42,34,19)` / `rgb(140,119,60)`.
Light warning wash/border: `rgb(245,236,217)` / `rgb(122,90,30)`.
Both matched before/after pairs use the same host, geometry, stylesheet and provider. “Before” is the retained legacy reading of the owner's outage, not a separately launched historical binary.

## Compact frames

The contact sheets crop **only actual screenshot pixels** from the 420px component column and normalize DPR 2 to CSS pixels; no UI content or styles were painted into them. Row-major order: pending, eligible but unverified, effective borrow, expired, withdrawn, owner unavailable, device-bound, absent. Raw desktop/narrow frames and browser geometry records remain in the task's scratch evidence for independent review.

- [Dark state sheet](states-localOperatorDark.png)
- [Light state sheet](states-localOperatorLight.png)
- [Legacy narrow before](before-narrow-dark.png)
- [Truthful narrow after](after-narrow-dark.png)
- [Unpublished/loading-host silence](empty-narrow-dark.png)

The exact selected `openai/gpt-6.1-sol` and high effort remain unchanged in the fixture. In the original capture, absent access offered Connect regardless of serving context; **that is the R1-1 defect corrected above**. Owner/convergence/refresh states did not offer it. Effective borrow is a quiet access status, not a local-login or subscription/API-kind assertion. Expiry retains borrowing eligibility, while the original withdrawal wording categorically ruled out recovery; **that overly specific cause claim is corrected above**. Historical expiry is explicitly not permission to reuse cached access.

## Limits

Real RemoteUI/native OAuth validation remains a separate runtime/installation-lease gate. No model-selector/controller code, auth storage, transport or core service was changed by this UI slice. Independent code, QA, design and interaction review still apply.
