/**
 * The one sidebar's geometry: how wide it is, whether it is docked, and what
 * happens to it when the window is too narrow to hold it beside the chat.
 *
 * WHY THIS IS A MODULE. The same reason `sidebar-split.ts` and
 * `sidebar-catalogue-gate.ts` beside it give: a decision written as a JSX
 * condition is a decision no test can reach, because `pnpm test:desktop`
 * bundles the shipped TypeScript in memory rather than rendering components.
 * Everything here is a pure function of three numbers/booleans, so
 * `scripts/chat-sidebar-layout.test.mjs` drives the SHIPPED module and the
 * three widths the spec pins are asserted against the same function the
 * component calls rather than against a description of it.
 *
 * THE THREE MODES, and why the widths are what they are (they are one decision
 * read at three window sizes, not three decisions):
 *
 *   docked   >= 1024px of window - 260px, user-resizable 220-320. 1024 is the
 *            FIRST width at which the dock costs nothing: it leaves 764px for
 *            the chat pane, and the reading measure plus its two 24px gutters
 *            needs 688, so the full dock still has 76px to spare. It is not a
 *            round number chosen for looks - it is where the arithmetic
 *            crosses.
 *   strip    880-1023px - the 56px icon strip, and the user's own preference is
 *            ignored rather than honoured: below 1024 a docked list steals width
 *            from the column the app exists to show, so the narrow window gets
 *            the strip whether or not they had it expanded. Their preference is
 *            NOT rewritten (`collapsedPref` is untouched) so widening the window
 *            puts the sidebar back exactly as they left it.
 *   overlay  below 1024 with the sheet asked for - a 260px sheet over the pane.
 *            The strip stays behind it, so the destinations remain one press
 *            away while the list is open.
 *
 * BELOW 880 the overlay is the only way to see the list at all: a docked 260
 * cannot coexist with the chat pane's own 480px floor (260 + 480 > 880), which
 * is why the sheet - not a dock - is what the strip opens there.
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

/** The icon strip's width, and the sheet's. */
export const SIDEBAR_COLLAPSED_WIDTH = 56;
export const SIDEBAR_SHEET_WIDTH = SIDEBAR_DEFAULT_WIDTH;

/** The first window width at which the sidebar is docked rather than a strip. */
export const SIDEBAR_DOCK_MIN_PX = 1024;

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
 * other occupants yield against it - first the sidebar (below 1024 it is the 56px
 * strip, `resolveSidebarLayout`), then the canvas (`canvasPaneMode`). A cap on the
 * canvas instead would leave the chat column free to be squeezed by anything else
 * that joined the row.
 */
export const CHAT_PANE_MIN_PX = 480;

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
 * The widest the canvas may DOCK at, in pixels: §I's other number, the ceiling on
 * `min(560, available - 480)`.
 *
 * 560 rather than the dock's own 1200 drag ceiling: the draggable range is how wide
 * the user may make the document pane WHEN THERE IS ROOM, while this is what the
 * layout offers it by itself. A dock that took its 1200 preference in a 1120px row
 * would leave the chat column its floor and nothing else, which is the sqeeze §I's
 * floor exists to forbid.
 */
export const CANVAS_PANE_MAX_PX = 560;

/**
 * The width the canvas docks at, given the row it shares with the chat column.
 *
 * `min(560, available - 480)` (§I), and it is a function rather than a constant
 * because the second term is the one that moves: the row is the work area after the
 * sidebar has taken its own width, and §B1's 480 is subtracted from it so the chat
 * column keeps its floor whatever the canvas asks for.
 *
 * `Math.max(0, ...)` because the subtraction must not go negative on a window
 * narrower than the floor itself - the caller's mode decides what to do there
 * (`canvasPaneMode`), and a negative width would render as a zero-width pane with
 * its divider still drawn.
 */
export function canvasDockWidth(rowWidth: number): number {
	return Math.max(0, Math.min(CANVAS_PANE_MAX_PX, rowWidth - CHAT_PANE_MIN_PX));
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
 * `value` CAN LEGITIMATELY EXCEED `maxWidth`: a stored shared width wider than
 * the pane's own ceiling is still drawn (the run panel at a 1600px window with a
 * stored 1000 draws 816 against its 640 ceiling), and clamping either number
 * would lie about the other. That case is measured in
 * `docs/evidence/right-slot-one-default/` and recorded on the PR as
 * found-not-fixed, not silently reshaped here.
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
 * §I's order of yielding is a SEQUENCE, and the implementation stopped at its
 * first step: "(1) the sidebar collapses to the 56px strip (it yields first,
 * because it is re-openable over the pane), (2) if there is still not room for a
 * 400px pane, the canvas OVERLAYS the chat pane instead of docking". Step 1 was
 * only ever applied by the window's own width (below 1024 the sidebar is a strip
 * whatever the user chose), so at 1024 with the sidebar the user's own 260px and
 * the canvas open, the module went straight to step 2: the pane floated over the
 * conversation, with no scrim, no edge and no sliver, which is round 1's
 * D2 impression ("it looks like the app has lost its content") on the other
 * pane.
 *
 * The arithmetic at 1024 is the whole argument: the docked row is
 * `1024 - 260 = 764`, and `canvasDockWidth(764)` is `min(560, 764 - 480) = 284`,
 * below the pane's own 400px floor, so the canvas stops docking. Had the sidebar
 * taken step 1 the row would be `1024 - 56 = 968` and the canvas would dock at
 * 488 with the chat keeping its 480 beside it.
 *
 * ONE ROW ARITHMETIC, NOT THE MEASURED ROW, and that is deliberate: the yield
 * decides the sidebar's width, so deciding it from a measurement of the row the
 * sidebar has already taken would be a feedback loop. Both terms here are a
 * function of the window and the user's stored width, exactly as
 * `resolveSidebarLayout`'s other branches are.
 *
 * The yield is REVERSIBLE and it does not rewrite the preference: it is the same
 * shape as the narrow band's override (the state they chose is still in the
 * store), so closing the canvas puts the docked sidebar back where they left it.
 *
 * True only in the band where the choice of sidebar shape is what decides the
 * canvas's mode - `[1024, 880 + width)`, i.e. 1024-1139 at the default 260. Above
 * it the docked sidebar already leaves the canvas its floor, and below 1024 the
 * sidebar is a strip for its own reasons.
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
 * The first window width at which the CHAT PANE can hold its own floor beside a
 * docked sidebar. 880 is the spec's number and it is deliberately NOT the dock's
 * own sum: 260 + 480 = 740 is the pane's floor plus the sidebar's width, and the
 * 140px between that and 880 is the gutters and the scrollbar the column
 * reserves once both panes are drawn. The constant is recorded here rather than
 * derived because it is a fact about the pane's floor that the sidebar's width
 * does not decide.
 */
export const CHAT_PANE_WITH_DOCK_MIN_PX = 880;

/** How the sidebar is drawn at the current window width. */
export type SidebarMode = "docked" | "strip" | "overlay";

export type SidebarLayout = {
	mode: SidebarMode;
	/** The width the sidebar column occupies in the flow (0 in overlay mode). */
	width: number;
	/** Whether only the 56px icon strip is drawn. */
	collapsed: boolean;
	/** Whether the overlay sheet is up (only ever true below the dock width). */
	sheetOpen: boolean;
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
 * Where the sidebar sits in this window.
 *
 * `sheetRequested` is the transient half of the state (the user pressed ⌘B or
 * the strip's toolbar button) and it is ignored where it means nothing: a sheet
 * requested while the sidebar is docked does not open a second copy of it.
 *
 * `canvasOpen` is §I's first yielding step, and it is an INPUT rather than
 * something this function can see for itself: a docked sidebar with an open
 * canvas in the band where the two cannot both have their floors collapses to
 * the strip, so the canvas DOCKS beside the chat instead of covering it (design
 * round 2, D24 - `sidebarYieldsToCanvas` carries the arithmetic and the band).
 * The user's own preference is not rewritten, which is what makes closing the
 * canvas restore the dock exactly as they left it.
 */
export function resolveSidebarLayout(
	viewportWidth: number,
	collapsedPref: boolean,
	sheetRequested: boolean,
	storedWidth: number = SIDEBAR_DEFAULT_WIDTH,
	canvasOpen = false,
	railWidth: number = PANEL_RAIL_WIDTH_PX,
): SidebarLayout {
	const docked = viewportWidth >= SIDEBAR_DOCK_MIN_PX;
	if (docked) {
		const yields =
			!collapsedPref &&
			canvasOpen &&
			sidebarYieldsToCanvas(viewportWidth, storedWidth, railWidth);
		return {
			mode: collapsedPref || yields ? "strip" : "docked",
			width:
				collapsedPref || yields
					? SIDEBAR_COLLAPSED_WIDTH
					: clampSidebarWidth(storedWidth),
			collapsed: collapsedPref || yields,
			sheetOpen: false,
			// A strip has nothing to resize: the divider is the dock's control.
			resizable: !collapsedPref && !yields,
		};
	}
	/*
	 * Narrow: the preference is overridden, not rewritten. `collapsed` is true
	 * here whatever the user chose, and that is the whole of "auto-collapse" -
	 * the state they chose is still in the store for the window that can honour
	 * it.
	 */
	return {
		mode: sheetRequested ? "overlay" : "strip",
		width: sheetRequested ? SIDEBAR_SHEET_WIDTH : SIDEBAR_COLLAPSED_WIDTH,
		collapsed: true,
		sheetOpen: sheetRequested,
		resizable: false,
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
