# PR #1928 evidence frames

Storybook renders of the real components, captured with the harness browser
tool at 2560x1440 in `localOperatorLight` and `localOperatorDark`.

- `before-sender-*`: origin/main's delivery model and component (sender sees
  "Refused by moderation." and the moderation/rephrase tip).
- `after-sender-*`: this PR (sender sees "Not delivered to {recipient}." and a
  neutral tip).
- `after-owner-*`: the recipient owner's classed line, classless line and tip,
  unchanged by this PR.
- `after-screening-*`: Settings > Agent messages > Screening model: default
  (Automatic), list open, a chosen model, no models listed, and a refused save.

Stories: `Team Bridge/Delivery annotation` (NotDeliveredSenderSingleOpen,
NotDeliveredSenderGroupOpen, NotDeliveredSenderTooltipOpen, RefusedWithClass,
RefusedWithoutClass, RefusedTooltipOpen) and `Agent messages/Settings`
(ScreeningModelAutomatic, ScreeningModelOpen, ScreeningModelChosen,
ScreeningModelUnavailable, ScreeningModelSaveFailed).

## Round 1 remediation (`r1-*`)

Captured from Storybook on 480734f6c0 with the harness browser tool, 2560x1440,
theme driven by `?args=theme:<id>`. Theme verified by pixel: every `-dark`
frame's corners read rgb(29,27,23), every `-light` frame's rgb(241,237,228).

- `r1-sender-group-{light,dark}`, `r1-sender-single-{light,dark}`: the sender's
  details panel open. "Not delivered to Aida (Sam Rivera)." with no info glyph
  (S-1/D1/C1/R3, D2/C2; D3 dark recapture).
- `r1-owner-class-open-*`, `r1-owner-classless-open-*`: the owner's classed and
  classless lines with the panel open, glyph kept (D4). Stories
  RefusedWithClassOpen, RefusedWithoutClassOpen.
- `r1-screening-paused-dark`: the Screening row on a paused endpoint this
  machine holds, with the revised help copy and the mono model id inside
  Automatic (D4, S-5/C3, N1). Story ScreeningModelPaused.

Not captured (the harness tab was paused by a password-manager prompt waiting
for the operator): ScreeningModelPaused light, ScreeningModelNotEnrolledHere
(row hidden), ScreeningModelOpen (route labels, D5), ScreeningModelAutomatic and
ScreeningModelUnavailable (C4), light and dark. The hidden-row and route-label
states are pinned by `scripts/agent-messages-settings.test.mjs`.
