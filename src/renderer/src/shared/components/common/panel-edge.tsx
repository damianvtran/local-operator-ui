import { cn } from "@shared/lib/utils";

/**
 * The seam where a full-height panel meets the plane beside it.
 *
 * WHY THIS EXISTS, AND WHY IT REVERSES A RULE THIS APP USED TO HOLD. The
 * operator asked three times for the panels' borders to go, and that removal was
 * right: `border-l border-hairline` sat on a panel's inner wrapper, and that
 * wrapper started at y=32 under the window's chrome lane, so the line stopped in
 * mid-air - "a line that did not go all the way up". The tone step was left to
 * carry the boundary. On 2026-10-30 the operator reported the other half of that
 * trade: "both right and left sidepanels do not have distinct borders or lines
 * or dividers to show where the side panels start/end. In dark theme it is a
 * little more distinct but in light theme it is harder to differentiate."
 * Measured, that is the ladder's own gap: `surface` against `canvas` is ΔE00
 * 2.32 in `localOperatorLight` (2.77 dark) - the floor for a small FIELD, not for
 * two full-height planes. So the seam is drawn again: deliberately, in one
 * place, from the theme, rather than by returning a border to each panel.
 *
 * WHY AN ELEMENT AND NOT A `border`. Three reasons, each of which the old border
 * got wrong:
 *
 *   - a border is part of the box. This is `absolute`, so the seam costs no
 *     layout: no panel loses 1px of content, no row's measure moves, and the
 *     resizable divider's 0-width gap stays 0;
 *   - these panels are scroll containers (`PaneSlot` is `overflow-hidden`, the
 *     sidebar's sections scroll themselves). An absolute child at `inset-y-0`
 *     cannot be clipped by the box it is inside; a `box-shadow` cast outside
 *     the box would be. `z-20` keeps it above the sticky rows and toolbar
 *     strips that paint their own `bg-surface` inside these panels - an inset
 *     `box-shadow` on the panel root disappeared behind the sidebar's sticky
 *     section header in exactly the rows it spans, and a seam that hides behind
 *     rows is the y=32 defect wearing a different shape;
 *   - `start-0`/`end-0` are logical, so the seam stays on the side facing the
 *     content in RTL instead of moving to the window's outer edge.
 *
 * WHY `hairline` AT 75%, AND NOT A NEW ROLE. `hairline` is this system's
 * decorative line - section rules, table separators, list dividers - and a seam
 * is exactly that: it carries no information, it says two planes meet. Its
 * per-palette values are already authored to sit apart from the grounds in the
 * direction the mode runs (darker in light themes, lighter in dark), so this
 * adapts across all 59 palettes with no new palette value and no hardcoded
 * colour. Full strength is a section rule, and a seam is quieter than one: at
 * 75% the line measures ΔE00 at least 4.6 against the ground it is drawn on, and
 * at least 2.29 against the plane it faces in EVERY palette (the floors are
 * `gruvbox`'s rail against an open pane, and `rosePineDawn`'s pane edge against
 * the conversation). Both are above the ΔE00 2 perceptual threshold
 * `docs/branding.md` § 3 states for adjacent steps; `scripts/contrast-contract.mjs`
 * asserts the pair per palette, so the value cannot drift below it in silence.
 *
 * `side` names the edge the seam SITS ON, the way `ResizableDivider`'s `side`
 * does: `start` is a panel whose content is to its right in LTR (the rail, every
 * right-slot pane), `end` is a panel whose content is to its left (the sidebar).
 */
export const PanelEdge = ({ side }: { side: "start" | "end" }) => (
	<div
		aria-hidden="true"
		data-panel-edge={side}
		className={cn(
			"pointer-events-none absolute inset-y-0 z-20 w-px bg-hairline/75",
			side === "start" ? "start-0" : "end-0",
		)}
	/>
);

PanelEdge.displayName = "PanelEdge";
