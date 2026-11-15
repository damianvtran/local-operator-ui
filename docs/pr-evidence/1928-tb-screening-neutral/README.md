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
