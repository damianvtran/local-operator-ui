# Agent tab passkey sign-in: continue in your own tab

Operator report: “The app store passkey signin failed, can you fix that”. App Store
Connect's login (`appstoreconnect.apple.com/login`, sign-in frame from
`idmsa.apple.com`) in an agent-driven tab ended `authResult=FAILED`; the notice offered
only “Open in system browser”, whose session is not shared with the app.

## Frames

Static renders of the shipped `BrowserPasskeyNotice` (`renderToStaticMarkup`) styled by
the app's own `src/renderer/src/styles/index.css` compiled with Tailwind 4.3.3, under
`data-theme="localOperatorLight"` / `"localOperatorDark"`, at 1100 px and 560 px wide,
captured with the harness browser. Storybook was attempted twice under the lane's
900 MB cap and was killed both times while compiling (peaks 1,115,344 KB and 934,768 KB
RSS for the process group), so these are not Storybook frames: app fonts are the
system fallback and no decorators run.

| State | Light | Dark |
| --- | --- | --- |
| Before: agent tab, embedded frame, NotAllowed | `before-localOperatorLight.png` | `before-localOperatorDark.png` |
| After: same notice | `after-localOperatorLight.png` | `after-localOperatorDark.png` |
| After: a USER tab's notice (unchanged: no new action) | `after-user-tab-localOperatorLight.png` | `after-user-tab-localOperatorDark.png` |
