# `server-update-offered` - the head's own take (design D13)

`after/settings-app-updates-section--server-update-offered--*` is the round-2 take
(pre-U12 split); design accepted it as the shipped frame. This folder is the same
story taken **at the head**, published beside it so the claim about the ✕ can be
reproduced from the branch rather than taken on trust.

- Source: the PR branch's `src/` tree `977c544d0` (`git rev-parse HEAD:src`; the
  round-3 remediation commit's), story `settings-app-updates-section--server-update-offered`,
  a PRODUCTION `storybook build` served statically (the settings button does not
  check at all under `import.meta.env.DEV`).
- Rig: `cdpshot.mjs` in this folder - one story, one theme, raw CDP, private headless
  Chrome (`--use-mock-keychain`, scratch profile, killed by process group), 1280x800,
  dpr 1, 6 s settle. Usage: `node cdpshot.mjs <story-id> <theme> <out.png>` against a
  static build on :6118.
- **Not pixel-comparable with `after/`.** That set comes from
  `scripts/capture-evidence.mjs`'s own rig; this take is a different rig at the same
  size, and the two differ in text anti-aliasing across the whole frame (49,357 / 55,810
  differing px, Dark / Light, spread over the frame - not confined to the ✕). So the
  earlier "6 px at the glyph" figure is a same-rig figure and this folder does not
  reproduce it; what it does show is the head's card box, copy, buttons and ✕
  position, with **no `:focus-visible` ring** around the card (the round-2 take's ring
  came from its rig keeping keyboard modality, as recorded in design round 3).
