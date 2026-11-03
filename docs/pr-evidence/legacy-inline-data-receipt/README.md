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
| `after-audit.png` | PR branch `28c4b754c13` | same | 104.2 and 102.2 |
| `after-audit-inspect.png` | PR branch, first receipt opened | same | bounded `<pre>` 892×192, "Part 1 of 293" |
| `before-thread.png` | origin/main + story files | Team Bridge/Attachments › BubbleLegacyInlineDataReceipt | 161,634 |
| `after-thread.png` | PR branch | same | 102.5 |

The audit's rejected row reads its text inline under the verdict chip, with no
expand step: #1533's shipped behaviour is kept, and the receipt stands in only for
the data URI.

SHA-256:

```
b19d13480764d52fcddf5dca91fadba028d3931d7df87349d929d0fbd223c9cf  after-audit-inspect.png
fc624252d9557e1b2912094e1a3ec634c143ba620553106378fc3b86c759d767  after-audit.png
19d62228993480c2d4a3076c080face4292077e7295e8952c0881b51eef19531  after-thread.png
f11837e7327185e0ea1ab2291d21b7864e2edb361ceaa29c33e09ad1a4c13eb5  before-audit.png
ee7805b16484550484b065d7928012b8732470bc3eeb55f9517cb4948d6d36eb  before-thread.png
```
