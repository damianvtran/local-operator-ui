# Onboarding first-run refresh (PR #2090): before/after frames

- `before/`: the previous first-run dialog, captured from Storybook on base `55a32f85ef1` (dark theme) by the design-spec lane.
- `after/`: head `92e4a8260cf`, captured by QA round 2 through the harness `browser` tool against Storybook (`Onboarding/OnboardingModal/*` and the provider sign-in stories), in `localOperatorDark` and `localOperatorLight`.
  - `signin-*`: sign-in stage. `signin-waiting-dark` is the first press, with the waiting state kept open (L1). `signin-nudge-dark` is the one-line Radient nudge (L8). `signin-fr-1280x720` is the longest-locale fit.
  - `search-*`: the web search step with Free (recommended), Radient account, and own keys.
  - `radient-connected-dark`: the Radient-connected sign-in. The search step leaves the sequence ("Step 1 of 3").
  - `meet-aida-dark`: the Meet Aida bookend at display size (L3).
  - `dialog-*`: a shared Dialog on the new surface with the darker backdrop (L2). Measured dark `rgba(0,0,0,0.72)`, light α 0.545.
  - `intro-dark`: the intro final frame. Reduced motion opens on this frame.
