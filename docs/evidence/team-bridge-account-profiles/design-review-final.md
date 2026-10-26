# Avatar/profile design review — final rendered round

**Verdict: TERMINAL for the reviewed Storybook avatar/profile surfaces. D1 MAJOR was reproduced, remediated, and independently verified fixed. No remaining BLOCKER or MAJOR finding in the reviewed scope.** This is not production-auth validation or thread root/reply sign-off; those exclusions remain explicit below.

Reviewer: independent designer agent, anthropic/claude-opus-5-5.
Scope: working tree in `~/local-operator-ui/.worktrees/account-profile`, atop merged #1427 (`acc6a5bc9c`). Final source identities: `review-source-sha256.json`; profile-card SHA256 `a6644e695a4c0e3a58ee8b68b9409ee7cda525b7e3e1a084ac17e20a0191018e`.

No code edits, commits, PR comments, dependency installations, fake UI, Electron launches, or scripted browser engines. All web frames came through the harness browser tool, reusing one owned tab.

## D1 — MAJOR, FIXED: narrow profile clipped its identity and Close control

Before remediation, `ProfileLongNarrow` in a real Storybook **320×568 CSS-pixel iframe** opened above its trigger with the avatar, name, and Close control clipped beyond the iframe top. Fullscreen/remount reproduced it, excluding Storybook add-on-panel clipping as the explanation. Evidence: `profile-long-narrow-final.png`.

After the scoped profile-card change, `profile-narrow-fixed-first.png` and `profile-narrow-fixed-settled.png` show avatar/name/Close visible, with a real inner scrollbar. The consecutive image files are **byte-identical**. The actual browser-run `ProfileLongNarrowScrolled` play reached Message by scrolling the real card, and the Storybook Interactions panel displayed **PASS, 17 steps**.

Actual values displayed in that interaction log:
- Viewport: **320×568**.
- Card: left **16**, top **16**, width **288**, height **287.8984375**, right **304**, bottom **303.8984375** CSS px.
- Scroll content **417px** versus client height **286px**, confirming the negative-control overflow case was real.
- Scrolled position **130.5px**.
- Message: height **32px**, top **255.09375**, bottom **287.09375**, within inner vertical bounds **17…302.8984375**; horizontal bounds **33…272** within **17…303**.
- `profile-narrow-scrolled.png` visibly shows the Message action reached at the bottom.

This closes D1; no further remediation round is needed for it.

## Rendered state and interaction coverage

All story IDs below have prefix `team-bridge-page--`. Direct-frame URLs used `http://localhost:6017/iframe.html?id=<ID>&viewMode=story`. Narrow stories used the actual Storybook manager viewport, `http://localhost:6017/?path=/story/<ID>&globals=viewport:mobile1`, fullscreen/remount where needed.

| Story | Observed result |
|---|---|
| `profile-full` | Full profile: bundled fixture image, name, pronouns, title, Person badge, description, localized clock and Message. Corrected play starts on a different channel, opens on focus, dismisses with Escape, opens by synthetic hover, selects Message, and reopens. Actual resulting DOM matched person `acc_bea`, tenant/scope `tnt_1`, and `aria-current=page` on Bea. |
| `profile-merged-tenant-message` | Actual DOM reached conversation `bcv_profile_northwind`, tenant `tnt_2`, scope `all`; rendered destination is Bea Northwind with merged scope retained. No console errors. |
| `profile-empty` | Fallback initial, name and Person badge; optional profile fields absent without empty placeholders. |
| `profile-avatar-loading` | Pending media shows fallback initial in a fixed box, no broken-image glyph. |
| `profile-avatar-error` | Request failure shows fallback initial in the same box. |
| `profile-avatar-decode-error` | Invalid image bytes show fallback initial, not broken image chrome. |
| `profile-self` | Card renders; Message absent. |
| `profile-unavailable` | Card renders; Message absent. |
| `profile-chief` | Aida (Bea), Agent badge and “Bea’s agent” affiliation render with profile content. |
| `profile-read-only-history` | Profile remains reachable in read-only history; Message is present in this fixture. No claim that history disables every other messaging route. |
| `profile-long-narrow` | After D1 fix, header and Close visible at 320×568. |
| `profile-long-narrow-scrolled` | Real overflow/scroll assertions PASS; Message visibly reachable. |

After D1, affected empty/loading/request-error/decode-error/self/unavailable/chief/read-only cards were recaptured and visually reviewed in `final-state-sheet-01.png` and `final-state-sheet-02.png`.

### Avatar geometry and stability

Browser `styles` measured matching ready, pending, and decode-failed avatar containers:
- Rail: **20×20px**, radius **5px**, border **0px**.
- Profile card: **64×64px**, radius **10px**, border **0px**.

The card's thin decorative boundary is separate from the borderless avatar requirement. The box measurements and inspected images show rounded-square avatar geometry retained across these fixtures. Consecutive full-profile settled frames were also byte-identical. This is not an instrumented trace of a real production image download.

### Keyboard and hover evidence boundary

The actual Storybook `ProfileFull` play executed focus-open, Escape-dismiss, synthetic hover, Message activation and focus-reopen against the rendered component. These are Storybook DOM events, **not trusted native keyboard/pointer input**. Browser click actions independently opened cards in non-play states. No independently timed 400ms hover-delay measurement or physical pointer-transit trajectory is claimed.

## Theme and translation review

- **All 59 theme variants** were actually rendered with `args=theme:<name>;locale:en`, captured, and visually inspected as card crops of the browser screenshots. Full paths, actual URLs and measured bounds are in `theme-render-results.json`; corrected contact sheets are `final-theme-sheet-01.png` through `final-theme-sheet-10.png`.
- One early Macchiato capture raced the play's close/reopen; it was discarded as evidence and recaptured settled in `theme-catppuccinMacchiato.png`. The corrected contact sheets contain that settled frame.
- English plus **fr, es, hi, ru, ur, vi, zh-CN** were rendered and visually inspected. French/light and Urdu/Dracula screenshots are separate; remaining locales are in `locale-sheet-01.png`. Labels and clocks localize without observed clipping. Profile names/title/pronouns/description are fixture user content, not untranslated app copy. This is visual localization coverage, not a native-language linguistic audit or full 59×8 Cartesian sweep.

## Measurable gate

- `token_audit.py` over eight affected renderer files after the fix: **8 files; 1 raw colour; 9 font-size values; 0 raw spacing values; 1 raw radius value; no anomalies reported**. See `token-audit-final.txt`. Whole-file inventory includes existing values; this is not a claim that all values are newly introduced.
- Actual initial dark card ink **#f1eee6** on elevated **#322d22**: **11.81:1**. Muted **#c2bcaf** on the same elevated surface: **7.24:1**.
- Source table: `src/renderer/src/styles/themes.generated.css`, the committed shared role mapping. `contrast_pairs.py` measured **295 text pairs** over 59 themes (`ink/elevated`, `ink-muted/elevated`, `ink-muted/media-surface`, `ink/surface`, `ink-muted/surface`): **0 AA failures**, minimum **5.25:1**, kanagawaLotus muted/media-surface. Results: `theme-contrast.json`.
- **118 control-boundary pairs** (`border-control/surface`, `border-control/elevated`) measured against the 3:1 meaningful-control floor: **0 failures**, minimum **3.01:1**. Results: `theme-border-contrast.json`.
- Generic `dom_audit.mjs` was **not launched**: its separate scripted-browser path conflicts with this task's browser-tool-only rule. Actual browser geometry reads, frames and the browser-run narrow geometry assertions supplied the scoped DOM evidence. No full generic DOM audit is claimed.
- Pattern reference consulted: W3C WCAG 1.4.13, Content on Hover or Focus, https://www.w3.org/WAI/WCAG21/Understanding/content-on-hover-or-focus.html. It informs dismissibility/hoverability/persistence expectations; it is not evidence of a defect by itself.

## Explicit limits / remaining integration gates

1. **Thread root/replies remain held and unreviewed.** The existing build-thread hold was not bypassed. This terminal verdict cannot be used as thread integration sign-off.
2. **Private-avatar real authentication remains unvalidated.** Fixtures seed authority and exercise the desktop.media seam with a bundled PNG or deterministic failure. They do not prove a production portrait, credentials, authorization, or companion-core deployment.
3. No safe merged-#1427 baseline screenshot was captured. The genuine before/after pair is the D1 narrow-card defect and fix, not a fabricated pre-feature baseline.
4. No new font-density/personalization scaling controls were exercised beyond supported theme, locale and narrow/default viewport fixtures.

## Evidence directory and cleanup

All evidence resides in `/Users/damian/.local-operator/sessions/b261491b2c63/scratchpad/`. Useful entry points: this report, final state/theme contact sheets, locale sheet, D1 before/after frames and machine-readable geometry/contrast manifests.

Cleanup verified: owned browser surface closed. Cancelling owned server job `acce587b182e` left its detached Storybook child (PID/PGID 63933) listening on 6017; command, cwd and start time identified it as this review's server. Its exact process group was terminated, and a final `lsof` confirmed **no listener on 6017**. No other server or browser tab was stopped.
