import type { AskScope } from "@features/chat/ask-queue";
import { canvasToggleCap } from "@features/chat/canvas-shortcut";
import { AsksScopeIcon } from "@features/chat/components/asks/asks-scope-icon";
import type {
	McpServerRow,
	RunDetails,
} from "@features/chat/components/run-details/run-detail-model";
import { RunDetailsTrigger } from "@features/chat/components/run-details/run-details-trigger";
import { Badge, countLabel } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import {
	resolveDrawnRightSlotPane,
	useUiPreferencesStore,
} from "@shared/store/ui-preferences-store";
import { FileText, Globe, SquareTerminal } from "lucide-react";
import {
	type FC,
	type KeyboardEvent as ReactKeyboardEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { PanelRailItem, PanelRailRovingContext } from "./panel-rail-item";
import {
	PANEL_RAIL_ORDER,
	askRailLabels,
	browserRailLabels,
	canvasRailLabels,
	consoleRailLabels,
} from "./panel-rail-model";

export type PanelRailProps = {
	/** The conversation, or null on a draft. The console needs one (absent without). */
	sessionId: string | null;
	/** The session's run view model; the Run details item is absent without one. */
	runDetails: RunDetails | null;
	/** The MCP rows the run panel renders: the trigger's second acknowledgement ledger. */
	mcpServers: readonly McpServerRow[];
	/** Whether the run panel is showing its list (the dot's acknowledgement rule). */
	listOnScreen: boolean;
	/** The child whose reader the run panel has open, or null. */
	readerChildId: string | null;
	/** Approvals THIS conversation's agent waits on (the browser item's badge). */
	browserAttentionCount: number;
	/**
	 * Whether a host offers the asks door (the header trigger's old "offered" rule,
	 * moved here with the control in #896): the item is PRESENT iff this is true,
	 * absent-not-disabled otherwise, exactly as the four siblings follow the route.
	 */
	askOffered: boolean;
	/**
	 * The outstanding asks the item's scope carries - what the BADGE counts.
	 *
	 * THE OUTSTANDING SET, decided rather than inherited (design round 1, D3, moved
	 * here with the mark in #896): open + moved-on rows are still the user's to act
	 * on, so the mark is an attention mark; a settled ask offers nothing and its
	 * number belongs to the drawer's filter, not a door. The number is the drawer's
	 * own view (`askQueueView.open` / `fleetAsks.outstanding`), not a second tally.
	 */
	askCount: number;
	/**
	 * Which queue the item's press opens - this conversation's or the fleet's -
	 * riding the same `setAskDrawerOpen(open, scope)` seam the drawer reads.
	 */
	askScope: AskScope;
	/** Console completions not yet looked at, and whether they still pulse. */
	consoleUnseenCount: number;
	consoleUnseenPulsing: boolean;
	/** Files the conversation has been seen to mention (the canvas item's dot). */
	fileCount: number;
};

const ROW_KEYS = new Set(["ArrowUp", "ArrowDown", "Home", "End"]);

/**
 * THE PANEL RAIL (#872, #896): the five doors to the window's right slot, as one
 * vertical column at the window's trailing edge.
 *
 * WHAT IT REPLACES. The Run details, Browser, Console and Canvas triggers lived in
 * the chat header's action cluster and followed two different open-state contracts
 * (the browser stayed and flipped its label; the console and canvas hid while their
 * pane was open), shed in a ladder as the header narrowed, and so answered "which
 * panel is this" nowhere. A rail is permanent: it never sheds, every item is always
 * where it was, and the lit item IS the answer. The header keeps its `...` menu,
 * which now carries ALL FIVE panel entries for keyboard users and narrow windows
 * (#896 gave it the asks row when the asks trigger - the last door still in the
 * header - moved onto the rail with its four siblings).
 *
 * LIT MEANS "THIS IS WHAT IS DRAWN IN THE SLOT", not "this flag is up". The store's
 * flags are preferences that outlive the route that can draw them; the selector
 * (`resolveDrawnRightSlotPane`) answers from the claim AND the route facts, so a
 * claimed-but-undrawable pane lights nothing. While the Asks drawer holds the slot
 * the answer is `"ask"` and the ASK ITEM is the lit one (#896): the drawer is what
 * is drawn, so the item that opened it says so - before the move this state lit
 * nothing on the rail and the only sign of what was open lived in the header. A
 * press on any OTHER item is a swap (`claimRightSlot` clears the ask flag and
 * forfeits the borrow); a press on the ask item itself is the same door in both
 * directions - it closes its own drawer, or replaces the other scope's open.
 *
 * A PANEL THE ROUTE CANNOT DRAW IS ABSENT, NOT DISABLED (the house rule the console
 * door already followed: "a control that cannot act is not shown"): Run details
 * without run details, Console without a conversation, the asks item when no host
 * offers a door (`askOffered`, the header trigger's old rule). Browser and Canvas
 * open on a draft today, so they are always present. The order is fixed, so the
 * only movement is those appearing.
 *
 * ONE TAB STOP. It is a vertical `toolbar`: the roving item carries `tabIndex=0`,
 * ArrowUp/ArrowDown walk the items, Home/End take the ends, and focus entering the
 * rail by any route (Tab, a click) makes that item the roving one. Bounded rather
 * than wrapping, the checkpoint rail's precedent (`checkpoint-rail.tsx`). It is NOT
 * an F6 region (`CHAT_REGIONS`): the header's `...` menu is the in-region door, and
 * adding a region is the UX round's call, not an accident of this component.
 *
 * NO NEW CHORD. The canvas item prints the existing `Cmd+Shift+C` and the header
 * keeps the listener that answers it, exactly as before.
 */
export const PanelRail: FC<PanelRailProps> = ({
	sessionId,
	runDetails,
	mcpServers,
	listOnScreen,
	readerChildId,
	browserAttentionCount,
	askOffered,
	askCount,
	askScope,
	consoleUnseenCount,
	consoleUnseenPulsing,
	fileCount,
}) => {
	const drawn = useUiPreferencesStore(resolveDrawnRightSlotPane);
	const isBrowserPaneOpen = useUiPreferencesStore((s) => s.isBrowserPaneOpen);
	const isConsolePaneOpen = useUiPreferencesStore((s) => s.isConsolePaneOpen);
	const isCanvasOpen = useUiPreferencesStore((s) => s.isCanvasOpen);
	const isAskDrawerOpen = useUiPreferencesStore((s) => s.isAskDrawerOpen);
	const askDrawerScope = useUiPreferencesStore((s) => s.askDrawerScope);
	const setBrowserPaneOpen = useUiPreferencesStore((s) => s.setBrowserPaneOpen);
	const setConsolePaneOpen = useUiPreferencesStore((s) => s.setConsolePaneOpen);
	const requestConsoleOpen = useUiPreferencesStore((s) => s.requestConsoleOpen);
	const setCanvasOpen = useUiPreferencesStore((s) => s.setCanvasOpen);
	const setAskDrawerOpen = useUiPreferencesStore((s) => s.setAskDrawerOpen);

	const rootRef = useRef<HTMLDivElement | null>(null);
	const [present, setPresent] = useState<ReadonlySet<string>>(
		() => new Set<string>(),
	);
	const [rovingId, setRovingId] = useState<string | null>(null);
	const register = useCallback((id: string) => {
		setPresent((previous) => new Set(previous).add(id));
		return () =>
			setPresent((previous) => {
				const next = new Set(previous);
				next.delete(id);
				return next;
			});
	}, []);
	/* The roving item is the last one focused while it exists, else the first in the
	   rail's fixed order - so the rail always has exactly one tab stop, including
	   after the item that held it went absent (a draft arriving). */
	const roving =
		rovingId !== null && present.has(rovingId)
			? rovingId
			: (PANEL_RAIL_ORDER.find((id) => present.has(id)) ?? null);
	const context = useMemo(() => ({ roving, register }), [roving, register]);

	const items = () =>
		Array.from(
			rootRef.current?.querySelectorAll<HTMLElement>(
				"[data-panel-rail-item]",
			) ?? [],
		);
	const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		if (!ROW_KEYS.has(event.key)) return;
		if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
			return;
		const list = items();
		const at = list.indexOf(document.activeElement as HTMLElement);
		if (at < 0) return;
		const next =
			event.key === "Home"
				? 0
				: event.key === "End"
					? list.length - 1
					: Math.max(
							0,
							Math.min(
								list.length - 1,
								at + (event.key === "ArrowUp" ? -1 : 1),
							),
						);
		event.preventDefault();
		list[next]?.focus();
	};
	const onFocus = (event: React.FocusEvent<HTMLDivElement>) => {
		const id = (event.target as HTMLElement).dataset?.panelRailItem;
		if (id) setRovingId(id);
	};

	/*
	 * FOCUS RETURNS TO THE ITEM A PANEL WAS OPENED FROM when the panel closes and
	 * took the focus with it - the three header effects (canvas, browser, console)
	 * merged into one keyed on the drawn pane. The pane's own close button unmounts
	 * under the keyboard and the browser drops focus on `<body>`; that signature, and
	 * only that, is what claims it back. Focus anywhere else means the user pressed
	 * something else on the way (the composer, another item, the command palette),
	 * and yanking it back would undo their own click. Never on first mount (the ref
	 * starts at the current answer), and only when the slot is now EMPTY: a swap to
	 * another pane or to the Asks drawer is the user choosing, not a close.
	 *
	 * RUN DETAILS IS EXCLUDED: its trigger owns the identical effect (with a second
	 * guard for focus left inside the pane) because it also owns the ledger.
	 */
	const previouslyDrawn = useRef(drawn);
	useEffect(() => {
		const before = previouslyDrawn.current;
		previouslyDrawn.current = drawn;
		if (drawn !== null || before === null || before === "run") return;
		if (document.activeElement !== document.body) return;
		rootRef.current
			?.querySelector<HTMLElement>(`[data-panel-rail-item="${before}"]`)
			?.focus();
	}, [drawn]);

	const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
	const browser = browserRailLabels(drawn === "browser", browserAttentionCount);
	const ask = askRailLabels(drawn === "ask", askScope, askCount);
	const terminal = consoleRailLabels(drawn === "console", consoleUnseenCount);
	const canvas = canvasRailLabels(
		drawn === "canvas",
		fileCount,
		canvasToggleCap(isMac),
	);

	return (
		<PanelRailRovingContext.Provider value={context}>
			<div
				ref={rootRef}
				role="toolbar"
				aria-orientation="vertical"
				aria-label="Panels"
				data-panel-rail=""
				onKeyDown={onKeyDown}
				onFocus={onFocus}
				className={cn(
					"relative flex h-full w-full flex-col items-center gap-1 bg-surface",
					/*
					 * NO RULE ON THE LEADING EDGE (the operator's ask: the rail should be
					 * borderless "like the left sidebar"). The boundary is the TONE STEP
					 * alone - `surface` against the slot's `elevated` (a pane open) or the
					 * conversation's `canvas` (no pane) - because that is how the sidebar's
					 * own edge is carried, and the rail follows it. That is a choice, not a
					 * proof of sufficiency: the ladder asserts these pairs at 2.0, the floor
					 * for small FIELDS, while `REGION_SEPARATION_FLOOR` (4.0) in
					 * `scripts/contrast-contract.mjs` is the stronger bar it sets for two
					 * full-height planes with no line between them. The measured steps over
					 * the 59 palettes are min 2.05 (`sage`, pane closed) and 2.02 (`arcade`,
					 * pane open); `localOperatorDark`/`Light` read 2.77 / 3.29 and 2.32 /
					 * 2.50 (closed / open). Its ABSENCE is pinned by `scripts/pane-slot-ground.test.mjs`, because
					 * the `border-l border-hairline` this replaced drew a line from y=32
					 * under the lane downwards - the "doesn't go all the way up" seam - and
					 * a pin is the only thing that keeps a second way of drawing the edge
					 * from quietly returning.
					 */
					/*
					 * THE FIRST ITEM'S TOP IS THE CAPTION INSET PLUS 4px, set as PADDING (design
					 * round 1, D3). It was a flex child strut of `max(4px, inset)` followed by
					 * the container's own `gap-1`, so with no inset the first item sat at 8px,
					 * not the 4px a 40px row centres a 32px control with: its glyph centred on
					 * y=56 against the `...`, the pane's close and the scope switch on y=52.
					 * Padding has no gap after it, so the item is at exactly 4px with no inset
					 * and at inset + 4px under the OS buttons (Windows/Linux: 44px, as before).
					 */
					"pt-[calc(var(--chrome-inset-end-h)+0.25rem)]",
				)}
			>
				{/*
				 * THE TOP CLEARANCE, and the drag handle with it. On Windows and Linux the
				 * OS caption buttons are drawn into the window's top-right corner, which is
				 * now this rail's top: `--chrome-inset-end-h` is the caption area's height
				 * there and 0 everywhere the OS draws nothing, and the container's padding
				 * (above) keeps the first item that far plus 4px below the top.
				 * `data-titlebar-drag` because the strip is empty chrome a frameless window
				 * must be movable by; the items opt back out. ABSOLUTE, so it is out of the
				 * flex flow and adds no gap of its own (the D3 defect was a strut IN the flow).
				 */}
				<div
					aria-hidden="true"
					data-titlebar-drag=""
					className="absolute inset-x-0 top-0 h-[calc(var(--chrome-inset-end-h)+0.25rem)]"
				/>
				{runDetails !== null && (
					<RunDetailsTrigger
						details={runDetails}
						mcpServers={mcpServers}
						listOnScreen={listOnScreen}
						readerChildId={readerChildId}
					/>
				)}
				{askOffered && (
					<PanelRailItem
						id="ask"
						label={ask.tooltip}
						ariaLabel={ask.aria}
						/*
						 * THE STATE THE HEADER COULD NOT SHOW (#896): while the drawer holds
						 * the slot the answer is `"ask"` (`resolveDrawnRightSlotPane`), and this
						 * is the item that says so. Before the move the asks door sat in the
						 * header and the rail lit nothing for this state - the defect the issue
						 * names.
						 */
						pressed={drawn === "ask"}
						/*
						 * THE HEADER'S OLD DOOR, verbatim: toggle in THIS item's scope - a press
						 * while this scope is open closes, a press while the OTHER scope is open
						 * replaces the scope (open=true for this one), and the store's
						 * `claimRightSlot` does the swap clearing. The state is read live (the
						 * file's own idiom) rather than latched when the item rendered.
						 */
						onClick={() =>
							setAskDrawerOpen(
								!(isAskDrawerOpen && askDrawerScope === askScope),
								askScope,
							)
						}
						/* The drawer's focus-return anchor and Escape door (#820/#835): the tag
						   moved with the control, value unchanged - four harnesses, the tour and
						   the driver attach to it. */
						data-tour-tag="ask-pane-trigger"
						/* WHICH QUEUE THIS DOOR OPENS, on the element, so the scope-legibility
						   claim (UX round 1, U3) is assertable rather than read off pixels: a rig
						   compares this attribute AND the glyph between the two scopes. */
						data-ask-scope={askScope}
					>
						<AsksScopeIcon scope={askScope} aria-hidden={true} />
						{askCount > 0 && (
							/*
							 * THE COUNT IN THE RAIL'S OWN REGISTER (#896, the issue's "styled like
							 * the Browser and Console counts already on the rail"). The browser
							 * item's block above states the geometry (design round 1, D4) and why
							 * the ring names `surface`; this mark is that block's numbers with the
							 * ask lane's count, capped at the glyph exactly as the browser's is.
							 * The header trigger wore the quieter `attentionQuiet`; on the rail
							 * the sibling count wears `attention`, and the issue asks this mark to
							 * match it - if the design round prefers the quiet register, this
							 * block is where the change lands.
							 */
							<span className="pointer-events-none absolute -top-0.5 -right-0.5 flex">
								<Badge
									variant="attention"
									shape="pill"
									size="count"
									className="h-3.5 min-w-3.5 px-0.75 text-meta-sm leading-none ring-2 ring-surface"
									data-tour-tag="ask-pane-badge"
								>
									{countLabel(askCount, 9)}
								</Badge>
							</span>
						)}
					</PanelRailItem>
				)}
				<PanelRailItem
					id="browser"
					label={browser.tooltip}
					ariaLabel={browser.aria}
					pressed={drawn === "browser"}
					onClick={() => setBrowserPaneOpen(!isBrowserPaneOpen)}
					data-tour-tag="browser-pane-trigger"
				>
					<Globe aria-hidden={true} />
					{browserAttentionCount > 0 && (
						/*
						 * A SMALLER MARK, ANCHORED OUT AT THE CORNER (design round 1, D4; QA Q2
						 * is the same root). The 16px mark hung 4px past a 32px control whose
						 * glyph is 16px centred, so it covered ~17% of the globe at 1-9 and ~40%
						 * at "9+", and the capped pill's ring reached the window's edge. The
						 * header's `-top-2.5 -right-2.5` is not available in a 44px rail (6px
						 * of gutter to the window: (44 - 32) / 2), so of design's three answers this takes
						 * "a smaller size": a 14px mark anchored at -2px/-2px of the control,
						 * which puts its top ON the rail's own top edge (the item is 4px below
						 * it, so the 2px ring starts at the host's edge and spills nothing into
						 * the lane) and its 2px ring 2px inside the host's trailing edge. It
						 * overlaps the glyph's box by 4px vertically only (measured in the
						 * stories: ~6% of the glyph at 1-9, ~18% at "9+", against ~17% / ~40%). The
						 * count stays whole in the accessible name and the tooltip, and the
						 * glyph's own cap ("9+") is unchanged. `ring-surface` because the ring
						 * names the ground BEHIND the badge, and that is the rail's.
						 */
						<span className="pointer-events-none absolute -top-0.5 -right-0.5 flex">
							<Badge
								variant="attention"
								shape="pill"
								size="count"
								className="h-3.5 min-w-3.5 px-0.75 text-meta-sm leading-none ring-2 ring-surface"
								data-tour-tag="browser-pane-badge"
							>
								{countLabel(browserAttentionCount, 9)}
							</Badge>
						</span>
					)}
				</PanelRailItem>
				{sessionId !== null && (
					<PanelRailItem
						id="console"
						label={terminal.tooltip}
						ariaLabel={terminal.aria}
						pressed={drawn === "console"}
						onClick={() => {
							if (isConsolePaneOpen) {
								setConsolePaneOpen(false);
								return;
							}
							/*
							 * THE ONE PLACE A USER'S OPEN IS DECLARED: claiming the slot shows the
							 * pane, and the request tells it this open came from the user (run a
							 * first surface if there is none, put the caret in the terminal). It
							 * names THIS conversation because the pane remounts on a session
							 * switch and a stale request would run a shell nobody asked for.
							 */
							setConsolePaneOpen(true);
							requestConsoleOpen(sessionId);
						}}
						data-tour-tag="console-pane-trigger"
					>
						<SquareTerminal aria-hidden={true} />
						{consoleUnseenCount > 0 && (
							<span
								aria-hidden="true"
								className={cn(
									"absolute top-1 right-1 size-1.5 rounded-full",
									consoleUnseenPulsing
										? "bg-accent animate-pulse-visible"
										: "bg-ink-muted",
								)}
								data-tour-tag="console-pane-blip"
							/>
						)}
					</PanelRailItem>
				)}
				<PanelRailItem
					id="canvas"
					label={canvas.tooltip}
					ariaLabel={canvas.aria}
					pressed={drawn === "canvas"}
					onClick={() => setCanvasOpen(!isCanvasOpen)}
					data-tour-tag="open-canvas-button"
				>
					<FileText aria-hidden={true} />
					{fileCount > 0 && (
						<span
							aria-hidden="true"
							className="absolute top-1 right-1 size-1.5 rounded-full bg-ink-muted"
						/>
					)}
				</PanelRailItem>
			</div>
		</PanelRailRovingContext.Provider>
	);
};
