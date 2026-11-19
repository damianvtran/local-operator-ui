# PR #1554 — legacy inline image data as a bounded receipt

Rendered evidence for the attachments lane's reproduction shape: a one-line
legacy header followed on the SAME line by the data URI,
`[image 1/1: photo.jpg; jpeg 1600x1200; 452118 bytes; sha256 …] data:image/jpeg;base64,<~600 KB>`.
Synthetic bytes only (`/9j/` JPEG magic, then `Qk+/x9Zp` × 75,000, `AB==`; 600,045
characters of URI); no operator message bytes.

Captured 2026-11-02 with the harness browser tool against source Storybook
(`scripts/with-storybook.mjs`, `VITE_PUBLIC_POSTHOG_KEY=''`), dark theme, 1280×720 CSS px
viewport at device scale 2. Both Storybooks were torn down by the helper
("pid gone, port … closed").

| Frame | Tree | Story | Row height (CSS px, `li[data-message-id]`) |
| --- | --- | --- | --- |
| `before-audit.png` | origin/main `aff584da018` + this PR's two story files only | Team Bridge/Owner audit › OperatorReproReceipt | 122,260 and 122,258 |
| `after-audit.png` | PR branch `dd834f414ec` (review round 1 remediation) | same | 104.2 and 102.2; receipt summary 343.46×20 (`w-fit`, design D3) |
| `after-audit-inspect.png` | same, first receipt opened | same | bounded `<pre>` 892×208 incl. `my-1`, content 876×192 (`max-h-48`), `bg-sunken` rgb(29,27,25), 8 px padding, 0 px border, 10 px radius (design D2); "Part 1 of 293" in an `aria-live="polite"` span (R1-4) |
| `before-thread.png` | origin/main + story files | Team Bridge/Attachments › BubbleLegacyInlineDataReceipt | 161,634 |
| `after-thread.png` | PR branch `dd834f414ec` | same | 102.49 |
| `after-thread-code.png` | PR branch `dd834f414ec` | Team Bridge/Attachments › BubbleDataUriInCode | 143.29 (short URIs: one `<pre>` 672×44.8 holding the `<img src="data:…">` line, inline `code` intact, prose after the fence a paragraph, no `<details>`) and 76.80 (20,022-character URI in a fence: ONE receipt for the whole block, no empty code block, prose after it) |

Round-1 (2026-11-02, `dd834f414ec`) frames were captured the same way, through the
bare preview `iframe.html?id=…&globals=theme:dark` so the geometry reads reach the
DOM. The before state of the code case is QA round 1's frames 19/20 (branch
`qa-evidence/1554-r1`): on `6cbfe9f05e5` the fence split around a 22-character
"receipt" and the prose after it rendered as code. Counts are grouped by the
locale (`600,045`, design D1).

The audit's rejected row reads its text inline under the verdict chip, with no
expand step: #1533's shipped behaviour is kept, and the receipt stands in only for
the data URI.

SHA-256:

```
06d8ef24c756d234ac3827d0ee0c15310bf8fc10defccee355413f876d36325f  after-audit-inspect.png
6dc1d3e112eacd7dc1a40c52db87c1e33f56b58cc9aa4e044c74928d460e19eb  after-audit.png
b16be07bc579080c6d75a97e8405afb6f994558c13159e2df74f3a342ec9e2e2  after-thread-code.png
d2c488ea3e9efeabed060136c58d7f8c5a81dd6ccb44c8e38593d80d32d50824  after-thread.png
f11837e7327185e0ea1ab2291d21b7864e2edb361ceaa29c33e09ad1a4c13eb5  before-audit.png
ee7805b16484550484b065d7928012b8732470bc3eeb55f9517cb4948d6d36eb  before-thread.png
```
