import {
	chatRegionOf,
	chatRegionStep,
	enterChatRegion,
	nextChatRegion,
} from "@features/chat/chat-regions";
import {
	CANVAS_PANE_MIN_PX,
	PANEL_RAIL_WIDTH_PX,
	SIDEBAR_COLLAPSED_WIDTH,
	SIDEBAR_DOCK_MIN_PX,
	SIDEBAR_MAX_WIDTH,
	SIDEBAR_MIN_WIDTH,
	type SidebarLayout,
	canvasDockWidth,
	canvasPaneMode,
	isSidebarTogglePress,
	resolveSidebarLayout,
	sidebarToggleCap,
} from "@features/chat/chat-sidebar-layout";
import { FleetAskDrawer } from "@features/chat/components/asks/fleet-ask-drawer";
import { pressLandsOnOverlay } from "@features/chat/keyboard-scopes";
import { UpdateQuietIndicator } from "@shared/components/common/update-quiet-indicator";
import { Sheet, SheetContent, SheetTitle } from "@shared/components/ui/sheet";
import { useTextDirection } from "@shared/i18n/use-document-direction";
import { cn } from "@shared/lib/utils";
import {
	resolveRightSlotWidth,
	resolveRightSlotYieldsSidebar,
	useUiPreferencesStore,
} from "@shared/store/ui-preferences-store";
import {
	type CSSProperties,
	type FC,
	type ReactNode,
	type RefObject,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { PanelRailHostContext } from "../navigation/panel-rail-host";
import { PaneSlot } from "./pane-slot";
import { ResizableDivider } from "./resizable-divider";

/**
 * The measured box of one element - width and left edge - 0/0 until the first
 * layout effect runs.
 *
 * The one-frame rule `chat-content.tsx` states for its own row measurement:
 * 0 means NOT MEASURED YET, not zero pixels, and the caller has to answer for
 * that frame rather than render from it (`resolveRightSlotWidth` returns the
 * pane's preference there, and the lane's last stop collapses).
 */
function useMeasuredBox(
	ref: RefObject<HTMLElement | null>,
	direction: "ltr" | "rtl",
): {
	width: number;
	left: number;
} {
	const [box, setBox] = useState({ width: 0, left: 0 });
	// biome-ignore lint/correctness/useExhaustiveDependencies: `direction` is a re-measure TRIGGER, not a value the body reads. Flipping the document moves this column to the other side of the window without changing its width, which a ResizeObserver cannot see: the lane's stops kept the previous side's `left` and painted a surface band on the wrong edge (measured on a live en->ur switch, 2026-10-19).
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		const measure = () => {
			const rect = element.getBoundingClientRect();
			setBox({ width: rect.width, left: rect.left });
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [direction, ref]);
	return box;
}

/**
 * The app shell's sidebar column and the content beside it.
 *
 * ONE SIDEBAR, and this component is the column that holds it. It used to be
 * the chat ROUTE's layout - the app drew a 220px icon rail of its own
 * (`sidebar-navigation.tsx`, mounted in `app.tsx`) and this held a second 280px
 * list pane beside the chat, which is 500px of chrome at 1380 and at 1024 alike
 * and a chat list that started below the fold's midpoint
 * (`docs/evidence`'s baseline `geometry.json`: nav 220, list 280). It is now
 * the shell's column at 260, mounted once in `app.tsx`, wrapping the sidebar
 * and `<main>` - so every route sees one sidebar, and the destinations reachable
 * from the chat are reachable from settings and back.
 *
 * THE WIDTH is a continuously dragged pixel value from the preferences store,
 * so it stays an inline `style` rather than becoming a class: Tailwind cannot
 * express a number that does not exist until the user lets go of the divider.
 * The old `styled` wrapper's `width: 280` was dead for the same reason - the
 * inline style always overrode it.
 *
 * WHERE IT SITS AT NARROW WIDTHS is `resolveSidebarLayout`'s decision and not
 * this component's: docked at >= 1024, the 56px icon strip from 880 to 1023,
 * and below 1024 with the sheet asked for, a 260px overlay over the pane. The
 * module carries the arithmetic; what lives here is the three things that need
 * a DOM - the measurement, the divider, and the two ways the sheet is opened
 * and closed.
 *
 * THE AUTO-COLLAPSE BAND IS AN OVERRIDE, NOT A WRITE. Below 1024 the module
 * returns a strip whatever `isSidebarCollapsed` says, and the preference is
 * left alone: closing a window must not be how a user loses the sidebar they
 * had open on the monitor next to it.
 */
type ChatLayoutProps = {
	sidebar: ReactNode;
	content: ReactNode;
};

/**
 * The sheet's own scope marker.
 *
 * The ⌘B handler below asks `pressLandsOnOverlay` whether a press belongs to a
 * dialog before the shell answers it - and the shell's OWN sheet is a dialog,
 * which would make the chord that closed it the one chord it could not hear.
 * The marker is how a press from inside this sheet is told apart from a press
 * inside somebody else's menu, so the toggle still works while the sheet has
 * focus and a Radix menu keeps its own keys.
 */
const SIDEBAR_SHEET_SCOPE = "data-sidebar-sheet";

/**
 * What the sidebar itself needs to know about where it is drawn.
 *
 * The sidebar's shape follows the layout, and the layout is decided ALREADY -
 * so it is handed down rather than re-derived. A second `window.innerWidth`
 * listener with its own threshold table is exactly the "two ways of doing one
 * thing" this codebase removes: the two would agree on the day they were
 * written and drift on the first edit to one of them.
 */
type SidebarFrame = {
	/** Whether the full sidebar is drawn (docked, or the sheet's contents). */
	expanded: boolean;
	/**
	 * WHERE it is drawn, because the one toggle's glyph depends on it (design
	 * round 1, D3): a docked column collapses (`‹`), a sheet closes (`×`), and a
	 * strip expands (`›`). Deriving the glyph from `expanded` alone is what drew
	 * the docked chevron inside the sheet beside the primitive's own close.
	 */
	mode: "docked" | "strip" | "overlay";
	/**
	 * The one control that changes the sidebar's shape: collapse the dock, close
	 * the sheet, or - from the strip - expand (the dock at >=1024, the sheet below).
	 */
	onCollapse: () => void;
};

const SidebarFrameContext = createContext<SidebarFrame | null>(null);

/**
 * The sidebar's own view of the layout. Throws rather than defaulting: a
 * sidebar rendered outside this shell has no width and no sheet, and a silent
 * fallback would draw a docked column inside whatever else mounted it.
 */
export const useSidebarFrame = (): SidebarFrame => {
	const frame = useContext(SidebarFrameContext);
	if (!frame) {
		throw new Error(
			"useSidebarFrame: the sidebar must be rendered inside ChatLayout (app.tsx)",
		);
	}
	return frame;
};

export const ChatLayout: FC<ChatLayoutProps> = ({ sidebar, content }) => {
	/*
	 * The sidebar's sheet edge is LOGICAL: it is the sidebar, so it enters from
	 * the inline-start edge — left in LTR, right in RTL. Radix names the edge
	 * physically, hence the one translation here rather than a flipped class.
	 * The docked column needs none: it is a flex child, and the row follows
	 * `dir` by itself.
	 */
	const direction = useTextDirection();
	// Clamp pre-redesign saved widths through the module rather than rewriting
	// persisted sessions or discarding the rest of the user preferences.
	const savedWidth = useUiPreferencesStore((s) => s.chatSidebarWidth);
	const setSidebarWidth = useUiPreferencesStore((s) => s.setChatSidebarWidth);
	const restoreDefaultSidebarWidth = useUiPreferencesStore(
		(s) => s.restoreDefaultChatSidebarWidth,
	);
	const collapsedPref = useUiPreferencesStore((s) => s.isSidebarCollapsed);
	const toggleSidebar = useUiPreferencesStore((s) => s.toggleSidebar);
	const [viewportWidth, setViewportWidth] = useState(() =>
		typeof window === "undefined" ? 1380 : window.innerWidth,
	);
	/*
	 * The sheet is TRANSIENT state and deliberately not a preference: it is the
	 * narrow window's way of seeing the list for a moment, not a shape the user
	 * chose the app in. Reopening the window does not reopen it.
	 */
	const [sheetRequested, setSheetRequested] = useState(false);
	/* The strip the OS's controls sit over. It is an OVERLAY for every route, so
	   the columns behind it keep y0 and paint their own grounds through it. */
	const laneRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const onResize = () => setViewportWidth(window.innerWidth);
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	/*
	 * §I's FIRST YIELDING STEP IS THE SIDEBAR'S, and the canvas's own open state is
	 * what raises it (design round 2, D24): at 1024 with the sidebar at the user's
	 * 260px and the canvas open, the two panes cannot both have their floors, and
	 * §I's order gives up the SIDEBAR first - so the canvas docks beside the chat
	 * instead of covering it with the pane's whole width. Read from the store the
	 * canvas's own toggle writes, so the choice of pane and the shape of the
	 * sidebar are one decision and not two that can disagree. (The boolean is
	 * `slotYieldsSidebar` below, which reads the same claim through the route.)
	 */
	/*
	 * THE FLEET ASKS PANE, which the SHELL owns where the ask drawer's other scope
	 * is owned by the chat route.
	 *
	 * WHY THE TWO SCOPES SIT IN DIFFERENT HOMES. The session-scoped drawer belongs
	 * to a conversation: its rows arrive on that session's frame and its answers go
	 * to that session, so it is mounted beside the composer by the route that has
	 * one. The FLEET scope has no such route - it spans conversations by definition,
	 * and the affordance that opens it (the top-level row beside the sessions list)
	 * is drawn on EVERY route - so it is mounted HERE, in the shell's own right slot,
	 * and is therefore reachable wherever the user is when they press it. That is
	 * what makes the top-level entry point real rather than a control that silently
	 * does nothing until the user happens to navigate to `/chat`.
	 *
	 * IT IS STILL ONE SLOT AND ONE PANE. The exclusivity is the store's
	 * (`claimRightSlot`), so this block and every route-mounted occupant can never be
	 * drawn together; and it is the SAME container - the family's chrome bar, its X,
	 * its own scroller and the family's width arithmetic - because the occupant below
	 * is the same `AskDrawer` component the session scope uses (see `FleetAskDrawer`
	 * for the half that differs: which conversations it shows and where its answers
	 * land).
	 */
	const askDrawerOpen = useUiPreferencesStore((s) => s.isAskDrawerOpen);
	const askDrawerScope = useUiPreferencesStore((s) => s.askDrawerScope);
	const setAskDrawerOpen = useUiPreferencesStore((s) => s.setAskDrawerOpen);
	const setRightSlotWidth = useUiPreferencesStore((s) => s.setRightSlotWidth);
	const restoreDefaultRightSlotWidth = useUiPreferencesStore(
		(s) => s.restoreDefaultRightSlotWidth,
	);
	const fleetAsksOpen = askDrawerOpen && askDrawerScope === "fleet";
	/*
	 * WHETHER A CANVAS-FAMILY PANE IS ACTUALLY DRAWN, not whether its flag is up
	 * (#868, agent review round 1 R2): the flags outlive the route that can draw
	 * them, and the bare `isCanvasOpen || isAskDrawerOpen` this used to be handed
	 * to the sidebar still collapsed it to the strip at 1024-1139px for a pane
	 * that was not on screen. The store answers from the claim AND the route facts
	 * `chat-content` publishes, the same two inputs the width and the header read.
	 */
	const slotYieldsSidebar = useUiPreferencesStore(
		resolveRightSlotYieldsSidebar,
	);

	/*
	 * THE PANEL RAIL'S WIDTH (#872): 44 while a chat surface is mounted, 0 on every
	 * other route. It comes from #868's `mounted` fact - the one fact that says the
	 * chat surface (which owns the rail's inputs and portals the rail in) is on
	 * screen - and it is a LAYOUT-EFFECT fact, so a chat route gets its rail before
	 * the first paint and settings/agents never get one. It is read HERE, above the
	 * sidebar's layout, because the sidebar's yield to the canvas has to predict the
	 * measured row (window minus sidebar minus rail) from the window alone.
	 */
	const railMounted = useUiPreferencesStore((s) => s.rightSlotRoute.mounted);
	const railWidth = railMounted ? PANEL_RAIL_WIDTH_PX : 0;
	const [railHost, setRailHost] = useState<HTMLElement | null>(null);

	const layout: SidebarLayout = resolveSidebarLayout(
		viewportWidth,
		collapsedPref,
		sheetRequested,
		savedWidth,
		/*
		 * THE SIDEBAR YIELDS TO THE ASK DRAWER AS IT DOES TO THE CANVAS, in EITHER
		 * scope. §I's order gives up the sidebar before the pane, and the drawer is one
		 * container whichever queue it shows - so a rule that held for the canvas and
		 * for the fleet pane but not for the session one would make the two scopes of
		 * one surface lay the window out differently, which is precisely the "which one
		 * am I looking at" confusion this feature removes.
		 */
		slotYieldsSidebar,
		railWidth,
	);

	/*
	 * A sheet request that the layout refuses (the window was widened while the
	 * sheet was up, or the sidebar was docked from the settings route) is cleared
	 * rather than remembered: otherwise widening the window and narrowing it again
	 * would spring a sheet open on a press the user made minutes ago.
	 */
	useEffect(() => {
		if (sheetRequested && !layout.sheetOpen) setSheetRequested(false);
	}, [sheetRequested, layout.sheetOpen]);

	const onToggle = useCallback(
		(event: KeyboardEvent) => {
			if (!isSidebarTogglePress(event)) return;
			const target = event.target as Element | null;
			const ownSheet = Boolean(
				typeof target?.closest === "function" &&
					target.closest(`[${SIDEBAR_SHEET_SCOPE}]`),
			);
			// A foreign overlay - a dialog, a menu, a listbox - owns its own keys.
			if (!ownSheet && pressLandsOnOverlay(event.target)) return;
			event.preventDefault();
			/*
			 * ONE SPELLING OF THE THRESHOLD, from the module that owns it: the strip's
			 * own expand control reads the SAME constant (below), and two copies of
			 * "the width at which the dock is free" is how a chord and a control start
			 * disagreeing about what a narrow window is.
			 */
			if (viewportWidth >= SIDEBAR_DOCK_MIN_PX) toggleSidebar();
			else setSheetRequested((open) => !open);
		},
		[toggleSidebar, viewportWidth],
	);

	useEffect(() => {
		document.addEventListener("keydown", onToggle);
		return () => document.removeEventListener("keydown", onToggle);
	}, [onToggle]);

	/*
	 * THE REGION WALK (§C4; UX-BASELINE U2's ~70 presses and U6's stop order).
	 *
	 * `F6` and `⌘⌥↓` move focus between the chat surface's four regions in reading
	 * order: the sidebar, the top row, the transcript, the composer. Before this,
	 * neither chord did anything, and the only route from the bottom of the surface
	 * to its top was Tab through every stop between - which is the walk the finding
	 * counted.
	 *
	 * IT IS INSTALLED BY THE SHELL RATHER THAN BY THE ROUTE. The sidebar is this
	 * component's and the other three regions are the route's, so a listener owned
	 * by either one would be reaching outside its own tree. It is on `document` for
	 * the reason the `⌘B` toggle above is: the chord has to work from inside a row, a
	 * field and the transcript alike, and a bubbling listener on one subtree cannot.
	 *
	 * THE TWO GUARDS ARE THE TOGGLE'S, with one difference. A press that landed on a
	 * dialog, an alert dialog, a menu or a listbox is that overlay's (see
	 * `pressLandsOnOverlay` for what it deliberately does not catch). And a press is
	 * answered even when `document.activeElement` is `<body>` - which is the point
	 * rather than an edge case: `body` is where focus lands when the app has just
	 * mounted or when a control unmounted under the user, and it is exactly the state
	 * a reader most needs the walk from.
	 */
	const onRegionKey = useCallback((event: KeyboardEvent) => {
		const step = chatRegionStep(event);
		if (step === null) return;
		if (pressLandsOnOverlay(event.target)) return;
		const next = nextChatRegion(
			document,
			chatRegionOf(document.activeElement),
			step,
		);
		if (next === null) return;
		event.preventDefault();
		enterChatRegion(document, next);
	}, []);

	useEffect(() => {
		document.addEventListener("keydown", onRegionKey);
		return () => document.removeEventListener("keydown", onRegionKey);
	}, [onRegionKey]);

	/*
	 * ONE TREE FOR ALL THREE MODES, and that is the fix for a measured bug rather
	 * than tidiness (design round 1, D2). The overlay used to be its own `return`,
	 * which rendered the sheet and NOTHING ELSE: no strip and no `content` - so
	 * opening the list below 1024 unmounted the conversation, and the frame right
	 * of the 260px sheet was one flat colour (std-dev 0.0 over 800x900 device px,
	 * with header, transcript and composer all measuring `null`). A sheet is a
	 * layer OVER the pane (§B1/§C1): the strip and the conversation stay mounted
	 * exactly as they were, and the sheet is drawn on top of them, dimmed by the
	 * scrim, with the pane itself as the outside press that closes it.
	 *
	 * THE LANE PAINTS NOTHING ANY MORE. It used to be a reserved row carrying a
	 * hard-stop gradient that mirrored the columns' grounds - the sidebar's
	 * `surface`, the conversation's `canvas`, the slot's `elevated` - because a
	 * column clipped below the row could not paint above its own top edge. That
	 * mirror was always one column behind the route: a route-owned leading
	 * column, the Library dock and the right slot each started below a band of
	 * the wrong tone, and the opt-in that lifted the columns left every other
	 * route 32px down. The lane is now a TRANSPARENT overlay and the
	 * columns paint through it (the panel contract in `styles/index.css`); what
	 * remains here is the drag surface and `data-slot-edge`, the geometry handle
	 * the evidence rigs read the pane's leading edge from.
	 */
	const columnWidth =
		layout.mode === "docked" ? layout.width : SIDEBAR_COLLAPSED_WIDTH;
	/*
	/*
	 * THE SLOT'S LEADING EDGE, EXPOSED ONCE (design round, D3). `slotRowWidth` is
	 * the row the pane shares with the conversation — the content column's own
	 * width, measured rather than derived from the window, because the sidebar is
	 * draggable and the strip is a different width from the dock — and `slotWidth`
	 * is what the ONE resolver in `ui-preferences-store` answers for it. Both this
	 * lane and `chat-content.tsx` call that resolver; a second derivation here is
	 * the drift the resolver exists to prevent (`resolveRightSlotWidth` states
	 * the whole argument, including the canvas's overlay mode).
	 */
	const contentColumnRef = useRef<HTMLDivElement | null>(null);
	const contentBox = useMeasuredBox(contentColumnRef, direction);
	const slotWidth = useUiPreferencesStore((state) =>
		resolveRightSlotWidth(contentBox.width, state),
	);
	/*
	 * The slot's DOCKED/OVERLAY mode, from the same measured box the width comes
	 * from: the width resolver above answers where the pane STOPS, and this answers
	 * whether it is docked or has stopped docking (the `overlay` literal;
	 * `canvasPaneMode` states what it draws today) - §I's one pair of rules, read
	 * through the same `canvasPaneMode` the route-mounted occupants call.
	 */
	const fleetDocked =
		canvasPaneMode(contentBox.width || Number.MAX_SAFE_INTEGER) === "docked";
	/*
	 * THE STOP IS THE PANE'S LEADING EDGE. The pane hugs the slot's trailing edge,
	 * so its leading edge sits `slotWidth` px LEFT of the content column's right
	 * edge - not `columnWidth + slotWidth` px from the window's left, which is
	 * where a first cut of this stop landed, and a captured frame showed exactly
	 * what that arithmetic costs: the lane's band changed ground 60px right of the
	 * pane's own edge, a `canvas` sliver over an `elevated` pane - the y32 band
	 * this pass exists to remove, reintroduced by a sum. `left` is the measured
	 * box's own offset, so the sidebar's drag and the divider between the columns
	 * are inside the number rather than assumed, and the app and the shell story
	 * compute the same edge from the same measurement.
	 *
	 * No pane open answers 0 width, which puts the last stop pair on the content
	 * column's right edge - a zero-width band, so the lane is the two-stop gradient
	 * it was. Unmeasured (0/0) collapses the pair at the left, which is also a
	 * zero-width band and never reaches a paint: the layout effect's re-render
	 * flushes before the frame.
	 */
	const slotEdge =
		contentBox.width > 0
			? (direction === "rtl"
					? viewportWidth - contentBox.left
					: contentBox.left + contentBox.width) - slotWidth
			: 0;
	return (
		<div
			className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
			/*
			 * THE RAIL'S WIDTH, PUBLISHED FOR THE CSS THAT HAS TO SUBTRACT IT (#872).
			 * On Windows and Linux the OS caption buttons are ~138px wide
			 * (`--chrome-inset-end`) and the rail is 44, so the rail covers only the
			 * buttons' trailing part: whatever row reaches the rail's left edge at the
			 * top (the chat header, or an open pane's toolbar) still has to clear the
			 * rest. `--chrome-inset-end-pane` is that remainder, and it is declared
			 * HERE rather than at `:root` because a custom property resolves its
			 * `var()`s where it is declared: only an element that knows the rail's
			 * width can subtract it. Routes with no rail (settings, agents) get the
			 * full inset - the fleet asks drawer is the row that reaches the edge there.
			 */
			style={
				{
					"--panel-rail-w": `${railWidth}px`,
					"--chrome-inset-end-pane": `max(0px, calc(var(--chrome-inset-end) - ${railWidth}px))`,
				} as CSSProperties
			}
		>
			{/*
			 * THE macOS LANE: ONE TRANSPARENT OVERLAY, FOR EVERY ROUTE.
			 *
			 * Electron leaves the native traffic lights over the renderer once the
			 * title bar is hidden (`src/main/titlebar-options.ts`), so the window has
			 * to keep their 32px clear and provide a drag surface there. The lane is
			 * the ONE element that does both - spanning the window, so the sidebar's
			 * brand row and the conversation title are the same row.
			 *
			 * IT RESERVES NO HEIGHT. A reserved row put every column 32px down and
			 * forced the shell to paint a mirror of their grounds above them; the
			 * mirror could not know about a route-owned panel and the opt-in that
			 * lifted the columns left every other route inset (the operator's third
			 * report of the same seam, 2026-10-20). The columns now reach y0 and
			 * paint their own ground through the strip - the panel contract in
			 * `styles/index.css` - and this element is only the drag surface.
			 * Nothing interactive stands above y32 (each panel pads its own content
			 * by `--panel-top-pad`), so the overlay has no press to steal.
			 *
			 * It is `display: none` outside the mac/leading gate (the rule in
			 * `styles/index.css`, keyed on the chrome attributes), so a platform
			 * whose OS is not drawing over the app loses nothing to it.
			 *
			 * `data-slot-edge` STAYS: it is the geometry handle the evidence rigs
			 * read the pane's leading edge from, not a paint stop.
			 */}
			<div
				ref={laneRef}
				data-titlebar-lane=""
				data-titlebar-drag=""
				data-slot-edge={slotEdge}
				className="absolute inset-x-0 top-0 z-30 h-[var(--chrome-strip-h)]"
			/>
			<div className="flex min-h-0 flex-1 overflow-hidden">
				<div className={cn("h-full shrink-0")} style={{ width: columnWidth }}>
					<SidebarFrameContext.Provider
						value={{
							expanded: layout.mode === "docked",
							mode: layout.mode === "docked" ? "docked" : "strip",
							onCollapse:
								viewportWidth >= SIDEBAR_DOCK_MIN_PX
									? toggleSidebar
									: () => setSheetRequested(true),
						}}
					>
						{/*
						 * While the sheet is up the sheet holds the ONE render of the sidebar,
						 * and this column keeps the strip's ground in its place. Nothing here
						 * needs to be taken out of the tab order by hand: the sheet is a Radix
						 * modal, which already hides everything outside it from assistive tech
						 * and traps focus inside it.
						 */}
						{layout.sheetOpen ? <SidebarStripOnly /> : sidebar}
					</SidebarFrameContext.Provider>
				</div>
				{layout.resizable && (
					<ResizableDivider
						sidebarWidth={layout.width}
						onSidebarWidthChange={setSidebarWidth}
						minWidth={SIDEBAR_MIN_WIDTH}
						maxWidth={SIDEBAR_MAX_WIDTH}
						onDoubleClick={restoreDefaultSidebarWidth}
						label={`Resize the sidebar (${sidebarToggleCap(isMacPlatform())})`}
					/>
				)}
				{/*
				 * THE CONTENT COLUMN IS A FLEX COLUMN, and that is load-bearing rather
				 * than tidy. What this wraps is the route (`<main>`), and `<main>` carries
				 * `grow` - a flex property, which does nothing at all unless its parent is a
				 * flex container. As a plain block this wrapper left `<main>`'s height AUTO,
				 * so the whole chain below it resolved to auto as well: the transcript grew
				 * to its CONTENT height instead of being the scroller, and the composer sat
				 * below the fold with a real conversation in it - measured on the AFTER rig's
				 * own dump at `b-qa`, `transcript.h` 1084 with `composer.y` 1164 in a 768px
				 * viewport. `<main>`'s own `overflow-hidden` is what then makes its automatic
				 * minimum size ZERO (a flex item's `min-height: auto` is the content-based
				 * size only while its overflow is visible), so the column can be SHORTER than
				 * its content and the transcript can scroll inside it.
				 *
				 * Before the one-sidebar merge `<main>` was a direct child of the app's own
				 * flex row, where `align-items: stretch` gave it a definite height for free;
				 * that is the property this wrapper has to reproduce, not replace.
				 */}
				<div
					ref={contentColumnRef}
					className="flex h-full min-w-0 grow flex-col overflow-hidden"
					style={
						{
							"--panel-top-pad": "var(--chrome-strip-h)",
						} as CSSProperties
					}
				>
					<PanelRailHostContext.Provider value={railHost}>
						{/*
						 * THE CONTENT COLUMN IS A ROW INSIDE, so the shell can dock its own
						 * pane BESIDE the route rather than over it. The measured box stays the
						 * COLUMN (`contentColumnRef`, above): a flex item's width here is
						 * resolved by the row it sits in, not by its own content, so adding a
						 * pane inside cannot feed back into the number `resolveRightSlotWidth`
						 * is called with — the column is the same width with the pane open as
						 * with it closed, which is exactly what keeps the lane's stop and the
						 * pane's leading edge one number.
						 */}
						<div className="flex h-full min-h-0 w-full overflow-hidden">
							{content}
							{/*
							 * THE FLEET ASKS PANE: the same three pieces the route's occupants
							 * use (the divider, the slot, the pane), so the column is one idiom in
							 * both homes. The divider exists only while it DOCKS, for the reason
							 * the canvas's own states: in the overlay mode there is no flow
							 * boundary to drag.
							 */}
							{fleetAsksOpen && (
								<>
									{fleetDocked && (
										<ResizableDivider
											sidebarWidth={slotWidth}
											onSidebarWidthChange={setRightSlotWidth}
											minWidth={CANVAS_PANE_MIN_PX}
											maxWidth={Math.max(
												CANVAS_PANE_MIN_PX,
												canvasDockWidth(contentBox.width),
											)}
											side="left"
											onDoubleClick={restoreDefaultRightSlotWidth}
											label="Resize asks. Double-click resets the shared pane width."
										/>
									)}
									<PaneSlot
										width={slotWidth}
										tourTag="ask-fleet-slot"
										data-ask-mode={fleetDocked ? "docked" : "overlay"}
									>
										<FleetAskDrawer
											/*
											 * THE KIND OF CLOSE IS FORWARDED, NOT DECIDED HERE (#1079): the pane's X
											 * asks for an empty slot and passes `dismissSlot`, while its own Escape
											 * listener (and the queue emptying) withdraw and pass nothing.
											 */
											onClose={(options) =>
												setAskDrawerOpen(false, "fleet", options)
											}
										/>
									</PaneSlot>
								</>
							)}
						</div>
					</PanelRailHostContext.Provider>
				</div>
				{/*
				 * THE PANEL RAIL'S HOST (#872): a 44px sibling AFTER the measured column,
				 * on the window's trailing edge, present while a chat surface is mounted.
				 *
				 * OUTSIDE `contentColumnRef` ON PURPOSE. The column's box is what every
				 * width reader measures (the lane's stop here, the chat surface's own row),
				 * so a sibling narrows that one number for all of them and the resolver, the
				 * canvas's dock arithmetic and the chat floor need no edit; `data-slot-edge`
				 * keeps meaning "the pane's leading edge". Inside the column it would sit
				 * LEFT of the fleet asks pane, which is a shell-level sibling of the route.
				 *
				 * The CONTENT is the chat surface's (`InPanelRailHost`), portaled in: the
				 * rail's inputs live below the shell. The host's own ground is `surface`
				 * (chrome, the sidebar's rung) so the strip is never a hole while the
				 * portal is empty; the rail draws no rule of its own - its leading edge is
				 * the tone step, pinned by `scripts/pane-slot-ground.test.mjs`.
				 */}
				<div
					ref={setRailHost}
					data-panel-rail-host=""
					data-glass-region="sidebar"
					/*
					 * `panel-top-pad` because this is the shell's other full-height
					 * panel: the rail paints `surface` from y0 and its first item must
					 * clear the OS controls. The host's ground is the panel; the pad
					 * moves only what the portal puts inside it.
					 */
					className="panel-top-pad h-full shrink-0 bg-surface"
					style={{ width: railWidth }}
				/>
			</div>
			{/*
			 * THE UNSOLICITED UPDATE NOTICE LIVES HERE (issue #672), at the bottom edge of
			 * the window's own column and in flow.
			 *
			 * In the SHELL rather than in a route: the updater's events arrive wherever the
			 * window happens to be, and `UpdateNotification` is mounted at the app root for
			 * the same reason - so a notice that only existed on the chat route would be
			 * silent on Settings, which is where a person who wants to act on it usually is.
			 *
			 * It DRAWS no band with nothing waiting — the live region is mounted empty and
			 * only the box's own classes are conditional (review R4, so a populated region
			 * is never inserted whole) — so it costs no height and no pixels for a user who
			 * is not being offered anything. Its reasoning, and why it is a band rather
			 * than a corner chip, are in the component's own header.
			 *
			 * BELOW the lane and the two columns, and above nothing: the sheet below is a
			 * portal, so in flow this row is the column's last child and the band reads as
			 * the window's own status row rather than as part of either column.
			 */}
			<UpdateQuietIndicator />
			<Sheet
				open={layout.sheetOpen}
				onOpenChange={(open) => {
					if (!open) setSheetRequested(false);
				}}
			>
				<SheetContent
					side={direction === "rtl" ? "right" : "left"}
					data-sidebar-sheet=""
					/*
					 * The sidebar draws its own `×` (the one control that closes it, D3), so
					 * the primitive's corner close is off: two close glyphs in one 40px corner
					 * were the `‹`-over-`×` the design round photographed.
					 */
					showClose={false}
					/*
					 * `w-[260px] max-w-none` overrides the primitive's own left-edge width
					 * (`w-3/4 max-w-sm`): 3/4 of an 880px window is 660 and `max-w-sm` is 384,
					 * so neither number is the sheet this column wants, and both would make the
					 * overlay wider than the dock it replaces. `bg-surface` because the sheet
					 * IS the sidebar, on the sidebar's own ground, not a dialog on `elevated`.
					 */
					className={cn(
						"w-[260px] max-w-none gap-0 border-0 bg-surface p-0",
						/*
						 * The lane's height, so the sheet's brand row sits on the line the
						 * docked one does and the OS's controls keep their clear band.
						 *
						 * Applied UNCONDITIONALLY now, where it used to be behind a
						 * `navigator.platform` read: the chrome attributes live on the
						 * document element, so the rule reaches a PORTALED element - and the
						 * sheet is portal to `<body>`, which is why it needed its own
						 * platform read before. `--chrome-strip-h` is 0 wherever the OS is
						 * not drawing over the app (every `native` launch, and Windows and
						 * Linux with trailing buttons), so the padding is absent exactly
						 * where it should be.
						 */
						"panel-top-pad",
					)}
					aria-describedby={undefined}
				>
					{/*
					 * The sheet needs a name, and the sidebar's own `<nav>` is already
					 * labelled inside it - so the title is the sheet's, `sr-only` rather
					 * than drawn, because a visible "Sidebar" heading above a brand row
					 * that already says who the app is would be a third name for one
					 * thing.
					 */}
					<SheetTitle className="sr-only">Chats and destinations</SheetTitle>
					<SidebarFrameContext.Provider
						value={{
							expanded: true,
							mode: "overlay",
							onCollapse: () => setSheetRequested(false),
						}}
					>
						{sidebar}
					</SidebarFrameContext.Provider>
				</SheetContent>
			</Sheet>
		</div>
	);
};

/**
 * The strip, drawn BEHIND an open sheet.
 *
 * The sheet renders the one full sidebar, and the list inside it must be the
 * only mounted copy (the rig and the driver find `[data-sidebar-region="chats"]`
 * as exactly one region, and the list owns stores and timers a second mount
 * would duplicate). So while the sheet is up the column keeps a quiet 56px
 * ground in its place: the strip's own width and colour, with nothing in it
 * that could take a press or a focus the scrim above it would hide anyway.
 */
const SidebarStripOnly: FC = () => (
	<div
		aria-hidden="true"
		data-glass-region="sidebar"
		className="h-full bg-surface"
	/>
);

/**
 * Whether this is macOS, for the one caption the divider prints.
 *
 * `navigator.platform` rather than a chrome attribute, because this is a key cap
 * and not a chrome decision: the chrome gates (`data-chrome-*`) say where the
 * OS DRAWS, and the cap says which modifier the handler here answers.
 */
const isMacPlatform = (): boolean =>
	typeof navigator !== "undefined" &&
	navigator.platform.toUpperCase().indexOf("MAC") >= 0;
