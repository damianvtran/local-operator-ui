# S6b approvals card frames

Four **document-only** captures (`Page.captureScreenshot` of the card child on a
hidden window, 2x), not a native composite: the transparent ring is alpha, not
page content. 264/248 and 900/352 content/card widths, dark and light.

The hidden-window probe that produced them is
`scripts/browser-approvals-s6b-probe.mjs`; its rows and the four cells are
recorded in `docs/evidence/browser-approvals-s6b/`. Native composite,
transparency over the live page, ring hit routing and VoiceOver stay **BLOCKED**
and are not claimed.
