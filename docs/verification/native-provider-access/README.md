# Native provider-access component verification

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

The exact selected `openai/gpt-6.1-sol` and high effort remain unchanged in the fixture. Only absent access offers Connect; owner/convergence/refresh states do not. Effective borrow is a quiet access status, not a local-login or subscription/API-kind assertion. Expiry retains borrowing eligibility, while withdrawal does not promise automatic regrant. Historical expiry is explicitly not permission to reuse cached access.

## Limits

Real RemoteUI/native OAuth validation remains a separate runtime/installation-lease gate. No model-selector/controller code, auth storage, transport or core service was changed by this UI slice. Independent code, QA, design and interaction review still apply.
