# LOH-11 — PROPOSED after artifacts

**Static design proposals, not production implementation or interaction proof.** Source of truth: [`../../../design/sidebar-tags.md`](../../../design/sidebar-tags.md). Every PNG was obtained through the harness browser at1280×720 CSS px / DPR2. The browser tab was closed after final corrections.

## Final sheets

Each `*-{light,dark}.html` has matching PNG:

- `off`: exact before-image crops at220/260/320; baseline reference, not a tested implementation toggle.
- `groups`: groups inside Today/This week, no chips, no row indentation and **no disclosure chevrons**.
- `chips`: later-slice, full-label-or-none arithmetic; explicitly illustrative Running-row assignment, not final every-row algorithm.
- `chips-acts`: that eligible row with chip replaced by the52px action pair. Actual proposed title143.367→145.391, +2.023px.
- `context`: one new Tags… item, not one menu item per category.
- `drag`: later-slice target-state drawing only; no drag/autoscroll claim.
- `view`: one40px Tags row above Sections; panel240×640, content678/interior638. `view-scrolled` shows the proposed last controls after scroll.

## Corrected modal sheets

`{picker,manage}-{220,260,320}-{light,dark}.{html,png}` show a **420px modal over the app**, independent of sidebar width. Picker is420×436; management420×420, in all six sidebar/theme scenarios. Data: `modal-geometry.json`. Picker has buffered checks, inline Group under radios, Cancel/Apply. Management has name/add/rename/up/down/delete, no chip preference or colour picker. Short aliases `picker-light`, `picker-dark`, `manage-light`, `manage-dark` reproduce the220 scenario; their PNGs are copies of the same final browser capture.

These replace the rejected sidebar-width popover proposal. No old narrow modal frame should be used as final design evidence. Rejected narrow picker/manage geometry has been removed from `geometry-records.json`; **use `modal-geometry.json`** for the corrected modal dimensions.

## Tokens, fonts and measurements

CSS role values are copied from the generated `styles/themes.generated.css` mappings for the two brand themes; they are not new colour choices. Fonts are the app's system-ui stack. HTML readouts measure actual rectangles, glyph advances and scroll extents after rendering; raw harness responses are in `geometry-records.json` and `modal-geometry.json`. There is no scripted browser engine.

- Review label glyph40.023 +12pad +2border =54.023 badge; +4gap =58.023 allocation.
- Row widths180/220/280; groups28px tall, no row indentation. First pinned/running title widths match the live base fixture.
- Chip selection is per-row, after mandatory status/locality/qualifiers and actual action state; title floor120. Full label or absent, no rail, no label ellipsis. Chip placements in comparison sheets are explicitly illustrative; production must evaluate every tagged row.
- `contrast-pairs.txt` and `contrast-results.txt`:531 source-role checks across59 themes. Treat border ratios against3:1, text against4.5:1; the generic text script's large-only labels on borders are not failed control contrast.
- `token-audit.txt`, `copy-audit.txt`: static gate outputs with fixture/snapshot false positives; see brief for limitations. Prototype copies of palette hex and checkbox glyphs are not new production tokens/copy.
- `capture-receipts.json`: initial comparison-sheet capture receipts; final corrections are documented here and in final filenames/modal measurements, not inferred from that initial receipt set.
- `chips-dark-first.png`, `chips-dark-settled.png`, `stability.txt`: historical consecutive static frame check (pixel-identical), **before final chevron/modal corrections**. This is not current-head motion or interaction sign-off.

## Limits

No tags mutation, persistence, physical keyboard walk, screen-reader behaviour, loading/error flow, short viewport,59-theme pixel sweep, real hover animation or drag gesture is proven by static mockups. Dialog width is a preferred420px with a viewport−32px maximum, not a hard minimum that may overflow. App-stage comparison coordinates are evidence framing, not a prescribed window position.
