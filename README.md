# Evidence: damianvtran/local-operator-ui#1524 (Team Bridge reaction pills)

- `r0/`: round-0 frames (before = main, after = the first cut): 1100x360 crops of a
  2560x1440 Storybook capture (`Team Bridge/Reactions`, harness browser).
- `r1/`: design review round 1 remediation frames, at 2.5x device pixels (a 2560x1440
  capture of a 1024x576 viewport, cropped to the pills). Themes: localOperatorLight,
  localOperatorDark, tokyoNight (the operator's theme). `after-row-*` are the shipped
  `TeamBridgeMessageList` row (`RealRowReactions` / `RealRowRevealed` stories): `rest`
  has the `+` at opacity 0; `focus-reveal` has it revealed by the row's
  `group-focus-within/message` arm (a real focus; measured opacity 1).
