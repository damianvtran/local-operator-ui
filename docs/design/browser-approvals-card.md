# Browser approvals card — S6a

Status (2026-10-23): **S6a, inert native child. Not a product surface.**

The approvals card is one native `WebContentsView` over the live page, sized to
the card and anchored to the content rect's inline-end corner (bottom-right in
LTR, bottom-left in RTL). It exists because the page is itself a native child
painted above the app's DOM: a DOM popup cannot appear over it without moving or
hiding the page.

## S6a scope

- One lazy child, `#00000000`, `PAD = 8`, `INSET = 8`, width
  `min(352, contentW - 16)`, height clamped to
  `[96, min(480, contentH - 16)]`.
- Auto-presented, **unfocused**, while the live queue is non-empty. It has no
  preload, no IPC, no focus call, no dismiss path and no decision path.
- Hidden (not destroyed) when the queue empties or the page stops being
  presented. A tab switch with an unchanged content rect keeps it.
- Opaque-square fallback (`opaque: true`, `PAD = 0`) for platforms where the
  transparent-child path is not used.

The card document is static: query parameters supply the count and theme, and
its module writes text with `textContent` only. S6b adds the purpose-built
preload, the two sender-pinned channels, focus handoff and the interactive
views; none of that exists here.

## Evidence

The S6a fixture's page bounds, card bounds, focus/typing result and separate child
captures are attached to PR #1351 as review evidence, not committed here: this
repository does not carry evidence artifacts. The native composite row is
**BLOCKED** there: screen-recording capture was unavailable in the evidence run,
so transparency over a sibling page is not claimed beyond the measured
`#00000000` input and the document's transparent corners.

## Gates

`pnpm check-i18n`, `pnpm check-types`, the bounds/controller suite
(`scripts/approvals-overlay.test.mjs`) and the existing browser suites the
wiring touches. Desktop CI is the terminal automated run for the full lane.
