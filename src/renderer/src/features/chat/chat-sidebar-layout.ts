/**
 * The one sidebar's geometry: how wide it is, whether it is docked, and when it
 * yields temporarily so a canvas or ask drawer can fit beside the chat.
 *
 * WHY THIS IS A MODULE. The same reason `sidebar-split.ts` and
 * `sidebar-catalogue-gate.ts` beside it give: a decision written as a JSX
 * condition is a decision no test can reach, because `pnpm test:desktop`
 * bundles the shipped TypeScript in memory rather than rendering components.
 * `scripts/chat-sidebar-layout.test.mjs` therefore drives the SHIPPED module
 * rather than a description of the layout.
 *
 * DOCKED VERSUS STRIP IS THE USER'S CHOICE AT EVERY WINDOW WIDTH (#1077).
 * Expanding docks the full sidebar; collapsing draws the 56px icon strip.
 * Resizing the window changes only how much of the stored width can be drawn,
 * never the open/closed preference. There is no viewport-triggered overlay
 * sheet: both the keyboard shortcut and the strip control change the same
 * persisted preference.
 *
 * THE CANVAS/ASK FIT-YIELD IS SEPARATE AND INTENTIONAL. When docking the sidebar
 * would prevent an open canvas-family pane from fitting, but the strip would let
 * it fit, `sidebarYieldsToCanvas` temporarily chooses the strip without
 * rewriting the preference. Closing that pane restores the user's dock.
 *
 * 56 for the collapsed strip is 48 (the VS Code activity bar's width, and what
 * today's rail collapses to) plus 8, so a 16px glyph keeps an 8px step on each
 * side and a 28px hit target fits.
 */

/** The width a sidebar the user has never resized opens at. */
export const SIDEBAR_DEFAULT_WIDTH = 260;

/**
 * The resize range, and it is the range the message list pane already occupied
 * (240-360 before this change): 220 is three 30px rows plus their gutters, and
 * 320 is where a row's title, its relative time and its hover controls still
 * fit without the title ellipsising to nothing.
 */
export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 320;

/** The icon strip's width. */
export const SIDEBAR_COLLAPSED_WIDTH = 56;

/**
 * The chat pane's own floor, in pixels: the redesign's §B1, and the first of §I's
 * three yielding steps.
 *
 * APPLIED on the column itself (`chat-content.tsx`: `w-0 min-w-[480px] flex-1`) and
 * read back from that element by the right pane's capacity arithmetic, which is the
 * one place the number is allowed to live twice - the constant here is the fallback
 * for a computed style that cannot be parsed, and
 * `scripts/chat-pane-floors.test.mjs` fails if the two drift apart.
 *
 * WHY THE FLOOR IS THE MECHANISM rather than a `max-width` on the canvas: 480 is a
 * promise about the pane the user READS, so it belongs on that column and the row's
 * other occupants yield against it - first the sidebar when the independent
 * canvas/ask fit-yield applies (`sidebarYieldsToCanvas`), then the canvas
 * (`canvasPaneMode`). A cap on the canvas instead would leave the chat column
 * free to be squeezed by anything else that joined the row.
 */
export const CHAT_PANE_MIN_PX = 480;

/**
 * The clearance the chat column keeps at its right seam while a separator is
 * drawn there, in pixels.
 *
 * THE NUMBER IS THE SCROLLBAR'S OWN WIDTH (8px, `global-scrollbar-styles.tsx`),
 * and it exists because the separator's hit band is 12px wide and CENTRED on the
 * seam (`resizable-divider.tsx`: `w-3` at `-left-1.5`/`-right-1.5`), so it
 * reaches 6px into this column. The transcript's scrollbar sat flush against
 * that seam, so the band covered 6 of its 8px: a drag started on the bar
 * resized the pane instead of scrolling, and 2px was left to grab (operator
 * report, 2026-10-23).
 *
 * WHY IT CANNOT GO ON THE PANE SIDE INSTEAD: the pane beside this column hosts a
 * native `WebContentsView`, and a native view paints above ALL DOM
 * (`browser-view-policy.ts`), so the pane-side 6px is dead wherever a page is
 * showing. The live half has to be on the chat side, which is why the bar moves
 * off it rather than the band moving over.
 *
 * 8 > 6, so the band can never reach the bar; measured, the scroller then ends
 * 2px clear of the band. `scripts/chat-pane-floors.test.mjs` fails if this
 * falls to or below the band's reach.
 */
export const CHAT_SEAM_INSET_PX = 8;

/**
 * The width of the right-edge panel rail, in pixels (#872): the column of four
 * triggers (Run details, Browser, Console, Canvas) at the window's trailing edge.
 *
 * 44 IS A 32px CONTROL IN A 6px GUTTER EACH SIDE, the same box the chat header's
 * `icon` buttons occupy, so a trigger moving from the header to the rail changes
 * neither its size nor its hit target. The rail is a SIBLING of the measured
 * content column (`chat-layout.tsx`), not a child, which is why this constant has
 * exactly two readers: the shell, which gives the host this width while a chat
 * surface is mounted, and `sidebarYieldsToCanvas`, which has to predict the
 * measured row from the window alone and so must know the rail is taken out of it.
 * The width resolver, `canvasDockWidth` and `CHAT_PANE_MIN_PX` need no edit - they
 * are handed the measured column, which the rail has already narrowed.
 */
export const PANEL_RAIL_WIDTH_PX = 44;

/**
 * The narrowest a DOCKED canvas may be, in pixels: §I's "if there is still not room
 * for a 400px pane, the canvas overlays the chat pane instead of docking".
 *
 * It is the dock's own contract floor, and it matches the drag divider's `minWidth`
 * in `chat-content.tsx` for that reason: a pane narrower than this cannot render its
 * toolbar and a document side by side, so the mode changes rather than the pane
 * shrinking further.
 */
export const CANVAS_PANE_MIN_PX = 400;

/**
 * The widest any right-slot pane may be DRAGGED to, in pixels: one ceiling for the
 * whole slot rather than one per pane.
 *
 * WHY ONE NUMBER. Until it, the panes announced three ceilings - the canvas and
 * the asks drawer were capped at 560 by the dock (`canvasDockWidth`), the run
 * panel and the code review pane at 640, the browser and the console at 1200 - so
 * "the slot's one width" (#677) held for a DRAGGED value only up to the
 * narrowest pane's cap: one 1000px drag drew 1000 in the browser and 560 in the
 * canvas, and the separators offered 400..560 on the canvas, 320..640 on the run
 * pane and the code review pane, and 480..1200 on the browser and the console.
 * The operator's rule is one column, so the band is one band.
 *
 * WHY 1200 AS THE CEILING. It is the largest ceiling that existed (the browser's
 * and console's own, since their dividers existed), so no pane loses a width it
 * could already reach while the narrower panes gain the range their siblings had.
 * It is still bounded by the ROW, which is what keeps `min(ceiling, ...)` from
 * being a promise the layout cannot keep: every pane's capacity subtracts the
 * conversation's `CHAT_PANE_MIN_PX`, so at a 1600px window the row leaves 816 and
 * no pane draws its 1200 there.
 *
 * THE FLOORS STAY PER PANE (`CANVAS_PANE_MIN_PX` here, the run/browser/console
 * floors in the store): a minimum is a property of what a pane holds, a maximum
 * is a property of the slot.
 */
export const RIGHT_SLOT_MAX_PX = 1200;

/**
 * The width the canvas docks at, given the row it shares with the chat column.
 *
 * `min(RIGHT_SLOT_MAX_PX, available - 480)`, and it is a function rather than a
 * constant because the second term is the one that moves: the row is the work
 * area after the sidebar has taken its own width, and §B1's 480 is subtracted
 * from it so the chat column keeps its floor whatever the canvas asks for.
 *
 * THE SAME LEFTOVER EVERY OTHER PANE GETS. This used to cap the dock at 560 - "the
 * width the layout offers it by itself" rather than the drag ceiling - which is
 * what made an unset canvas open at 560 while an unset run panel opened at 640,
 * the mismatch `RIGHT_SLOT_MAX_PX` removes. The cap here is the slot's one ceiling,
 * so the canvas's offering and a sibling pane's capacity are the same subtraction
 * with the same number over it. The MODE is still decided by the floor alone
 * (`canvasPaneMode`): 400 is far below 1200, so the ceiling never decides
 * docked-versus-overlay.
 *
 * `Math.max(0, ...)` because the subtraction must not go negative on a window
 * narrower than the floor itself - the caller's mode decides what to do there
 * (`canvasPaneMode`), and a negative width would render as a zero-width pane with
 * its divider still drawn.
 */
export function canvasDockWidth(rowWidth: number): number {
	return Math.max(0, Math.min(RIGHT_SLOT_MAX_PX, rowWidth - CHAT_PANE_MIN_PX));
}

/**
 * How the canvas occupies the row at this width: docked beside the chat, or
 * stopped docking - the mode the `overlay` literal names.
 *
 * WHAT `overlay` DRAWS TODAY, stated once and here, because several comments had
 * drifted into describing it as a pane that covers the conversation: the mode
 * withholds the divider and writes `data-canvas-mode`/`data-ask-mode`; it does NOT
 * position the pane over the chat. `f0f974ef0a3` drew one (`absolute inset-y-0
 * right-0 z-20`), but `1e88f7fc167` (#564, the PaneSlot refactor) removed that
 * class without its message saying so, and the pane is a flex dock beside the
 * 480px conversation at the row's leftover. Restoring a true overlay is an OPEN
 * design decision, not an accident to fix here: it needs positioning; a width
 * rule that does not fight the one-width resolver; Escape/focus handling (there
 * is no scrim); a lane-gradient stop; and - for the Browser - main-process bounds
 * for the native view.
 *
 * §I's order of yielding, in one predicate. The sidebar yields first (§B1: below
 * 1024 it is the 56px strip, which `resolveSidebarLayout` already does), and if
 * the canvas's own 400px floor still does not fit beside the chat's 480 the canvas
 * stops docking and switches to the `overlay` literal.
 *
 * The run panel has no such mode: §I says it "is never an overlay (it is a reading
 * pane, not a document); it obeys the same 480 floor and closes itself rather than
 * squeezing the chat below it" - which is what the run pane's own separator
 * contract does against the measured capacity. With the positioning
 * removed above, "never an overlay" is no longer a contrast between it and the
 * canvas: no pane covers the conversation today, and the mode is the withheld
 * divider and the data attribute.
 */
export function canvasPaneMode(rowWidth: number): "docked" | "overlay" {
	return canvasDockWidth(rowWidth) >= CANVAS_PANE_MIN_PX ? "docked" : "overlay";
}

/**
 * The separator's contract for a right-slot pane, in one function so the run
 * panel, the browser and the console cannot drift into three spellings (this
 * change's D4 - the browser and console separators used to be handed the
 * PREFERENCE with `minWidth={480} maxWidth={1200}`, so at rows that cannot host
 * the pane's floor the separator announced aria-valuenow=640 while the pane was
 * drawn at 220).
 *
 * THE PROPERTY IT ENCODES: what the separator announces and accepts is what the
 * pane renders. `capacity` is what the ROW can give the pane (the measured row
 * minus the conversation's floor - the run panel measures it from its own
 * elements, the browser and console derive it from `paneRowWidth`); `drawn` is
 * the width the pane draws; `min`/`max` are the pane's own drag range. Where the
 * row cannot host the pane's FLOOR, resizing is not a no-op that lies, it is not
 * offered: the value and both range ends collapse onto the drawn width, and the
 * call sites refuse the write so a stored preference survives intact for a
 * window that can honour it.
 *
 * `value` IS NOT CLAMPED TO `maxWidth`, and that is deliberate: clamping it would
 * announce a width the pane is not drawn at. It was reachable once - the run
 * panel at a 1600px window drew 816 against its own 640 ceiling - and the
 * slot's one ceiling (`RIGHT_SLOT_MAX_PX`) closed that class, because every
 * caller now hands in a width held to the same ceiling the separator announces.
 * The function still refuses to reshape `value`, so a caller that ever hands it a
 * wider drawing pane gets the truthful pair rather than a second lie; the
 * property is pinned in `scripts/chat-pane-floors.test.mjs`.
 */
export function rightSlotDividerContract({
	capacity,
	min,
	max,
	drawn,
}: {
	capacity: number;
	min: number;
	max: number;
	drawn: number;
}): { resizable: boolean; value: number; minWidth: number; maxWidth: number } {
	const resizable = capacity >= min;
	if (!resizable) {
		return { resizable, value: drawn, minWidth: drawn, maxWidth: drawn };
	}
	return {
		resizable,
		value: Math.min(Math.max(drawn, min), capacity),
		minWidth: min,
		maxWidth: Math.min(max, capacity),
	};
}

/**
 * Whether the DOCKED sidebar must yield to an open canvas (design round 2, D24).
 *
 * §I's order of yielding is a SEQUENCE: "(1) the sidebar collapses to the 56px
 * strip (it yields first, because it is re-openable over the pane), (2) if there
 * is still not room for a 400px pane, the canvas OVERLAYS the chat pane instead
 * of docking". Before this fit-yield existed, the sidebar followed only the
 * window's width, so at 1024 with the user's 260px sidebar the module went
 * straight to step 2: the pane floated over the conversation, with no scrim, no
 * edge and no sliver, which is round 1's D2 impression ("it looks like the app
 * has lost its content") on the other pane. This function is now the ONLY
 * automatic collapse; the viewport no longer overrides the preference by itself.
 *
 * The arithmetic at 1024 is the whole argument: the docked row is
 * `1024 - 260 - 44 = 720`, and `canvasDockWidth(720)` is
 * `min(1200, 720 - 480) = 240`, below the pane's own 400px floor, so the canvas
 * stops docking. Had the sidebar taken step 1 the row would be
 * `1024 - 56 - 44 = 924` and the canvas would dock at 444 with the chat keeping
 * its 480 beside it.
 *
 * ONE ROW ARITHMETIC, NOT THE MEASURED ROW, and that is deliberate: the yield
 * decides the sidebar's width, so deciding it from a measurement of the row the
 * sidebar has already taken would be a feedback loop. Both terms here are a
 * function of the window and the user's stored width, exactly as
 * `resolveSidebarLayout`'s other branches are.
 *
 * The yield is REVERSIBLE and it does not rewrite the preference: closing the
 * canvas puts the docked sidebar back where the user left it. This fit-driven
 * override is independent of the user's open/closed choice, which otherwise
 * applies at every viewport width (#1077).
 *
 * True only where the sidebar's shape decides the canvas's mode. With the 44px
 * chat rail that is `[980, 924 + width)` at the default 260, or 980-1183; above
 * it the dock already leaves the canvas its floor, and below it even the strip
 * cannot let the canvas dock.
 */
export function sidebarYieldsToCanvas(
	viewportWidth: number,
	storedWidth: number = SIDEBAR_DEFAULT_WIDTH,
	railWidth: number = PANEL_RAIL_WIDTH_PX,
): boolean {
	/*
	 * THE RAIL IS PART OF THE ROW'S DEFICIT (#872). The measured row the canvas
	 * actually docks in is the window minus the sidebar MINUS the 44px panel rail
	 * at its right edge (`PANEL_RAIL_WIDTH_PX`), and this function exists to
	 * predict that row's mode from the window alone. Left on the rail-less
	 * arithmetic it would be wrong for the 44px band just above the old boundary
	 * (1140-1183 at the default 260): the sidebar would stay docked, the real row
	 * would be 44px short of the canvas's floor, and the canvas would stop docking -
	 * the D24 defect, re-opened by a sum. The rail is subtracted from both
	 * rows because it is present beside both sidebar shapes. `railWidth` is a
	 * parameter only because the rail exists solely while a chat surface is
	 * mounted: the fleet asks pane also docks on settings and agents, where no
	 * rail stands, and the shell passes 0 there so the sidebar does not collapse
	 * for 44px that are not taken.
	 */
	return (
		canvasPaneMode(
			viewportWidth - clampSidebarWidth(storedWidth) - railWidth,
		) === "overlay" &&
		canvasPaneMode(viewportWidth - SIDEBAR_COLLAPSED_WIDTH - railWidth) ===
			"docked"
	);
}

/**
 * The §I fit budget for the chat's 480px floor beside a docked 400px canvas:
 * 880px, their sum. It is recorded for the canvas/ask fit arithmetic and is NOT
 * a sidebar docking threshold: the user's preference decides that at every
 * width, with `sidebarDockCapacity` preserving the chat floor at 800px (#1077).
 */
export const CHAT_PANE_WITH_DOCK_MIN_PX = 880;

/** How the sidebar is drawn from the user's persisted open/closed choice. */
export type SidebarMode = "docked" | "strip";

export type SidebarLayout = {
	mode: SidebarMode;
	/** The width the sidebar column occupies in the flow. */
	width: number;
	/** Whether only the 56px icon strip is drawn. */
	collapsed: boolean;
	/** Whether the drag divider is offered. */
	resizable: boolean;
};

/**
 * The width a stored value is drawn at.
 *
 * Clamped rather than refused, and at the render boundary rather than at the
 * write: `localStorage` can hand back anything, and a width the store accepted
 * from an older build has to render rather than throw. `NaN` is the one value
 * clamping cannot answer - `Math.min` propagates it - so it takes the default,
 * which is the same treatment `chat-layout.tsx` gave the number before this
 * module existed.
 */
export function clampSidebarWidth(width: number): number {
	if (Number.isNaN(width)) return SIDEBAR_DEFAULT_WIDTH;
	return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

/**
 * The most width the dock may draw without pushing the chat's 480px floor and
 * the right-edge rail beyond the viewport.
 *
 * This is a RENDER-ONLY cap, not a preference write. The app's 800px minimum
 * window with the 44px chat rail leaves 276px, inside the sidebar's 220-320px
 * drag range, so even a stored 320px dock fits without horizontal overflow.
 * Widening the window restores the stored width; narrowing it never rewrites
 * that stored choice (#1077).
 */
export function sidebarDockCapacity(
	viewportWidth: number,
	railWidth: number = PANEL_RAIL_WIDTH_PX,
): number {
	return Math.max(
		0,
		Math.min(SIDEBAR_MAX_WIDTH, viewportWidth - CHAT_PANE_MIN_PX - railWidth),
	);
}

/**
 * Where the sidebar sits in this window.
 *
 * `collapsedPref` decides docked versus strip at every width. `canvasOpen` is
 * the one independent fit-yield: if the strip, and only the strip, lets an open
 * canvas-family pane dock, the sidebar yields temporarily without rewriting
 * that preference (`sidebarYieldsToCanvas` carries the arithmetic).
 */
export function resolveSidebarLayout(
	viewportWidth: number,
	collapsedPref: boolean,
	storedWidth: number = SIDEBAR_DEFAULT_WIDTH,
	canvasOpen = false,
	railWidth: number = PANEL_RAIL_WIDTH_PX,
): SidebarLayout {
	const yields =
		!collapsedPref &&
		canvasOpen &&
		sidebarYieldsToCanvas(viewportWidth, storedWidth, railWidth);
	const collapsed = collapsedPref || yields;
	const capacity = sidebarDockCapacity(viewportWidth, railWidth);
	return {
		mode: collapsed ? "strip" : "docked",
		width: collapsed
			? SIDEBAR_COLLAPSED_WIDTH
			: Math.min(clampSidebarWidth(storedWidth), capacity),
		collapsed,
		// A strip has nothing to resize; neither does a dock below its drag floor.
		resizable: !collapsed && capacity >= SIDEBAR_MIN_WIDTH,
	};
}

/**
 * The `⌘B` / `Ctrl+B` press, as a predicate, so the chord the sidebar prints
 * and the chord the shell answers cannot drift.
 *
 * `shift`/`alt` are refused rather than ignored: `⌘⇧B` is a different chord and
 * belongs to whoever binds it next, and answering it here would take it away
 * silently.
 */
export function isSidebarTogglePress(event: {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
}): boolean {
	if (event.shiftKey || event.altKey) return false;
	if (!(event.metaKey || event.ctrlKey)) return false;
	/*
	 * `event.key` is the character the layout produced, so the shift check above
	 * is what refuses `⌘⇧B`; a meta-modified press arrives as `"b"` on this app's
	 * layouts, and the uppercase spelling is accepted for the layouts that do not
	 * separate the two.
	 */
	return event.key.toLowerCase() === "b";
}

/**
 * The caption the sidebar prints for that chord: `⌘B` on macOS, `Ctrl+B`
 * elsewhere. Named here rather than derived at the call site so the key cap on
 * the control and the handler that answers it share one string.
 */
export const sidebarToggleCap = (isMac: boolean): string =>
	isMac ? "⌘B" : "Ctrl+B";
