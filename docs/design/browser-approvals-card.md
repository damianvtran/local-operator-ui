# Browser approvals card — S6a

Status (2026-10-24): **S6a, inert native child. Not a product surface.**

The approvals card is one native `WebContentsView` over the live page, sized to
the card and anchored to the content rect's bottom-right corner. RTL placement
is S6b work; S6a does not claim it. It exists because the page is itself a native
child painted above the app's DOM: a DOM popup cannot appear over it without
moving or hiding the page.

## S6a scope

- One lazy child, `#00000000`, `PAD = 8`, `INSET = 8`, width
  `min(352, contentW - 16)`, and height = the card document's measured height
  rounded **up** and clamped to `[96, min(480, contentH - 16)]`. The native view
  is therefore exactly card + 16 DIP on both axes, with an 8 DIP inset on every
  side.
- The height is measured from the card at the width it will occupy, never from
  a zero-width provisional view (that view reports a wrapped 150 DIP block).
  A content-rect resize rebuilds the child at the new bounds *before* its
  document loads: Electron 44.3.0 does not propagate a width or height change
  to a child that was loaded hidden at zero size, so the document would
  otherwise keep painting at the old width.
- Auto-presented, **unfocused**, while the live queue is non-empty. It has no
  preload, no IPC, no focus call, no dismiss path and no decision path.
- Hidden (not destroyed) when the queue empties or the page stops being
  presented. A tab switch with an unchanged content rect keeps it.
- The card identifies itself as app chrome: a localized `Local Operator`
  wordmark from the catalogue (`ui.browser.browser_new_tab.wordmark`) above the
  `Approvals` heading.
- Copy is catalogued. The count is rendered by the card document through
  `ui.browser.browser_approvals_tray.header_waiting` (ICU plural); the
  controller passes only the integer through the document's `setCount`. The
  URL's `count` is a first-paint fallback and is omitted at zero.
- The queue's own expiry re-pushes the count at the earliest live `expiresAt`,
  so the card cannot outlive its queue; S6a has no dismiss path of its own.
- Opaque-square fallback (`opaque: true`, `PAD = 0`) for platforms where the
  transparent-child path is not used.

The card document is static: the first paint's count and palette are query
parameters, and its module writes catalogued copy with `textContent` only.
`card.css` uses the `--lo-*` token roles from the generated theme stylesheet; it
carries no palette of its own. S6b adds the purpose-built preload, the two
sender-pinned channels, focus handoff and the interactive views; none of that
exists here.

## Controls

S6a has no focusable control: no Close, no Escape handler, no decision. The
native child is presentation-only; S6b adds the close/escape/decision surface.
The 8 px ring's hit routing is therefore not exercised here.

## Evidence

The S6a fixture's page bounds, card bounds, the 264 → 900 → 264 resize
round-trip, zero page focus/blur events, unchanged `activeElement`, typing
result and card-document captures at 264/900 dark and light are attached to
PR #1351 as review evidence. The measured numbers and the blocked rows are
tracked in `docs/evidence/browser-approvals-s6a/`; frames are not committed
because this repository carries evidence records, not frame containers.

The native composite row is **BLOCKED** there: screen-recording capture was
unavailable in the evidence run and the probe window is kept hidden, so
transparency over a sibling page is not claimed beyond the `#00000000` native
background and the document's transparent corners. The opaque-square native
fallback is **BLOCKED** for the same reason. The 8 px ring's hit routing is also
unproven: the native view's edge sits exactly on the content rect's trailing
edge, so that unmeasured ring overlaps the page's bottom-right scrollbar
segment, and no pointer claim is made.

## Gates

`pnpm check-i18n`, `pnpm check-types`, `pnpm check-themes` (the card's surface is
in the `CONTROLS` table now), the bounds/controller suite
(`scripts/approvals-overlay.test.mjs`) and the existing browser suites the
wiring touches. Desktop CI is the terminal automated run for the full lane.
