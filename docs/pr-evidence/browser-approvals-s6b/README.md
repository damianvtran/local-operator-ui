# S6b approvals card frames — round-1 remediation head

**Document-only frames.** These are screenshots of the BUILT card document
(`out/renderer/browser-approvals-overlay.html`) loaded in an iframe over a
page-coloured ground, with a model injected through `window.__approvalsCard`
(the same seam main uses). The native `WebContentsView` composite, transparency
over a live page, ring hit routing and VoiceOver are **not** shown and remain
**BLOCKED** (see the PR's blocker comment); this folder does not claim them.

Captured at head `ccd1b0a194` with the harness browser (the repo's browser
tool), from the same built document that the probe drives:

| File | Cell |
| --- | --- |
| `card-264-dark.png` | 264 view · dark · fr |
| `card-264-light.png` | 264 view · light · fr |
| `card-368-dark.png` | 368 view · dark · fr |
| `card-368-light.png` | 368 view · light · fr |
| `list-368-light.png` | the queue list (Review all), 368 · light |
| `error-264-light.png` | the failure line in the sticky footer, 264 · light |

All five decisions and the queue/back action are above the fold at 264; the
request is one sentence with the origin inline; the broad grant uses the
queue's registrable-domain key; the footer carries the hairline and no label is
cut. The native probe that produces the *native* rows is currently blocked by an
environment-level `WebContentsView` failure; those rows stay BLOCKED in
`docs/evidence/browser-approvals-s6b/`.
