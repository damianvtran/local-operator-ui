# Job-result label restoration — round 5

Captured on 2026-09-14 with the Local Operator **browser tool**, after the
operator approved `http://127.0.0.1:5319`. These are production
`CanonicalTranscript` / `NoticeRow` / `TraceLine` components mounted by the
`Chat/Canonical notices/Job result messages` story, not the live Electron app.
There is no backend, transport, credential, or live session in this fixture.

## Source and reproduction

- **Before:** `canonical-transcript.tsx` at `8e86608083171428c02ecd85fa357ff186dee824`,
  with this change's synthetic story added. A frozen Vite bundle was built before
  restoring the label; `/before/index.html` serves that bundle.
- **After:** the same production story with the explicit-label restoration at
  pre-rebase source `dce5c74fca8151e4425ee0c6794400a020172a0e`. The working tree
  was modified during capture and then committed at that SHA; this is not a
  clean historical-capture claim. A later forge-required rebase onto `8d019993e`
  brought upstream disclosure tooltip/state-reporting changes. These images
  remain evidence of the pre-rebase label restoration, not a newly captured
  certification of that semantic integration; independent convergence review
  uses the current local URL.
- The isolated local harness lives at `~/workspace/incident-rows/r5-takeover`.
  It uses the existing Vite harness pattern, real fonts and production CSS, with
  an explicit Tailwind source directory so every production class is generated.
  Its initial, incompletely styled diagnostic screenshot is **not** included.
- Live review URL: `http://127.0.0.1:5319/`; narrow/light query:
  `?theme=localOperatorLight&width=560`. The server stays up for independent review.
  The browser tab used to capture these frames was closed.
- For durable reproduction, run `pnpm storybook` and open
  `chat-canonical-notices--job-result-messages`. The story includes long failed
  and completed outcomes, each with null and non-null supporting detail, plus an
  ordinary job result. Expand either detailed row using its disclosure.

## Frames and observations

All source screenshots have a **1440 × 817 CSS viewport**, DPR 2. "Narrow"
means a 560px harness column inside that viewport, not a resized browser viewport.
The committed WebPs crop the source screenshots to the relevant row region:
wide crops are `(x=170, y=40, width=1100, height=380)` CSS pixels; narrow crops
are `(x=440, y=40, width=560, height=470)`. Every before/after pair uses the same
crop. No row pixels are altered. The full PNGs remain in the isolated harness
directory. The uncropped wide before image was 98.79% background and correctly
failed the 98.50% paint-coverage guard; removing the unused viewport makes the
committed evidence about the rows rather than a mostly empty window.

| Frame | Column / row width | Observation |
| --- | --- | --- |
| `before/localOperatorDark.webp` | 1100 / 900px | Four outcomes use `Worked on the request`, code glyph, and clipped headline. |
| `after/localOperatorDark.webp` | 1100 / 900px | Every row says `job result`, uses the statement glyph, and retains the complete headline. |
| `expanded/localOperatorDark.webp` | 1100 / 900px | Clicking the failed row discloses its supporting output; the full error remains in its headline. |
| `before-narrow/localOperatorLight.webp` | 560 / 480px | The same fallback and missing tails at the narrow reading width. |
| `after-narrow/localOperatorLight.webp` | 560 / 480px | Complete failed/completed messages wrap; ordinary row remains readable. |

Browser geometry reports `scrollWidth == clientWidth` for all five rows in both
widths. The four long rows grow from 22px to 43px high in the wide pair (wrapping
rather than losing their tails); after restoration they are 65px high in the
narrow frame. The ordinary row is unchanged at 22px wide / 43px narrow. Two
consecutive settled dark after screenshots are byte-identical. The accessibility
tree contains the complete error, including `free disk space before retrying`,
for both the static row and the detailed row's button.

All five source images and the resulting row crops were inspected visually.
The crops were converted losslessly from the browser's PNGs to WebP; no capture
script, CDP, private Chromium, or alternate
browser engine was used. Only this set receives a new per-frame paint check;
manifest provenance/counts are checked separately. **The full repository image
histogram sweep was not run.** Other themes, live Electron behavior, backend
requests, selection gestures and loading/empty states are outside this label-only
remediation; prior unchanged-surface evidence is not claimed as a new run.

The duplicated `job result: background job …` wording is an accepted cosmetic
tradeoff. It preserves the existing statement path instead of introducing a new
label API or parsing the payload. Head-specific local and CI gate results live in
the PR remediation comment, not a floating "final head" assertion here.
