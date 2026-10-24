# S6b approvals card frames

**Frames are pending re-capture at the round-1 remediation head.** The four
document-only captures that landed with the first head were taken before the
layout was reworked (single request sentence, broad-grant label, sticky footer,
single gloss line); keeping them beside the new head would misrepresent the
surface.

The hidden-window probe that produces them is
`scripts/browser-approvals-s6b-probe.mjs`. In the current environment it is
blocked before the card can paint: a minimal `WebContentsView` fails to load any
URL (`ERR_FAILED -2`) while a `BrowserWindow` in the same Electron 44.3.0 process
loads `file://` and `data:` URLs and exits normally. The negative control is
recorded in the PR thread; the frames and the driven rows will be re-captured on
a healthy rig. Native composite, transparency over the live page, ring hit
routing and VoiceOver remain **BLOCKED** and are not claimed.
