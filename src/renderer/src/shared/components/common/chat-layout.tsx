import {
	chatRegionOf,
	chatRegionStep,
	enterChatRegion,
	nextChatRegion,
} from "@features/chat/chat-regions";
import {
	CANVAS_PANE_MIN_PX,
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
import { cn } from "@shared/lib/utils";
import {
	resolveRightSlotWidth,
	useUiPreferencesStore,
} from "@shared/store/ui-preferences-store";
import {
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
function useMeasuredBox(ref: RefObject<HTMLElement | null>): {
	width: number;
	left: number;
} {
	const [box, setBox] = useState({ width: 0, left: 0 });
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
	}, [ref]);
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
 * The marker a route's own leading column wears, so the lane can carry its
 * ground - and it NAMES that ground, because the lane paints what it names.
 *
 * WHY A ROUTE HAS TO SAY ANYTHING AT ALL. The lane above the two shell columns is a
 * MIRROR of their grounds: it paints the app sidebar's width in `surface` and the
 * rest in `canvas`. It has to be - a column cannot paint above its own top edge, and
 * the row that holds the columns is `overflow: hidden` with a second clipped column
 * inside it, so nothing a route renders can reach y0. The mirror is therefore the
 * only thing that can put a route-owned column's ground up there, and it has to be
 * told which column that is - and on which rung the column stands. It used to assume
 * `surface`; the settings rail's move to `elevated` (2026-09-27) is what made the
 * assumption visible, and the attribute's VALUE is the role the lane must paint
 * across the marked column's width. That rail was re-grounded flat on 2026-09-30, so
 * every column hands over `surface` today - the rung stays part of the contract
 * rather than being narrowed away, because a route on `elevated` is exactly the case
 * the argument exists for.
 *
 * WRITTEN BY `useLaneLeadingColumn` rather than spelled in the JSX, so the attribute
 * and the registration that gives it meaning cannot be separated: an element wearing
 * the attribute is exactly an element the shell was handed. It stays in the DOM as
 * the handle a rig finds the column by (`--scene route-tops`).
 */
const LANE_LEADING_COLUMN = "data-lane-leading-column";

/**
 * The rungs a route's leading column may stand on. The shell paints the one the
 * marker names, resolved off the theme's own `--lo-<role>` variable, so the value
 * is a role and never a colour.
 */
type LaneLeadingGround = "surface" | "elevated";

/** The shell's half of the contract: a route hands its leading column over. */
type LaneLeadingRegistration = (column: HTMLElement | null) => void;

const LaneLeadingContext = createContext<LaneLeadingRegistration | null>(null);

/**
 * Attach to a route's own leading column - `ref={laneLeadingColumn}` - and the shell
 * puts that column's ground behind the window's top strip.
 *
 * THE ARGUMENT IS THE COLUMN'S OWN GROUND, and it is required rather than defaulted:
 * a route added later has to say which rung it stands on for its column to be
 * mirrored, and the settings rail's round on `elevated` (2026-09-27, given up
 * 2026-09-30) is why one fixed ground is no longer enough. This hook does not
 * restate the paint - `chat-layout`'s lane reads the marker back - so the value and
 * the class on the column are one decision, pinned by the sweep:
 * `lane-leading.test.mjs` reads the painting file's `bg-<ground>` beside the handed
 * value, so `settings-sidebar.tsx`'s `bg-surface` and the rail wrapper's
 * `"surface"` fail together if only one of them moves.
 *
 * A REF RATHER THAN A QUERY, and the settings rail is why: it renders after the
 * route's config read resolves, so on a cold route it is not in the tree at the
 * commit the shell renders in, and a shell that looked for it once would find nothing
 * and never look again (measured 2026-09-27 - the settings rail stayed under the
 * strip on the run that arrived cold, while the second visit, whose store was warm,
 * was carried). Registration is an event: whatever commit the column appears in,
 * this runs in it.
 *
 * OUTSIDE THE SHELL IT IS INERT IN BOTH HALVES (review round 1, N1), which is what
 * a story rendering one of these routes on its own gets (`register` is null):
 * nothing registers and no marker is written, and only the lane's band is missing,
 * because there is no lane.
 */
export const useLaneLeadingColumn = (
	ground: LaneLeadingGround,
): LaneLeadingRegistration => {
	const register = useContext(LaneLeadingContext);
	return useCallback<LaneLeadingRegistration>(
		(column) => {
			/*
			 * GATED ON `register` (review round 1, N1): the marker's one meaning is "this
			 * element was handed to the shell", and outside the shell there is no shell to
			 * hand it to - so a story rendering the route alone must not wear it.
			 */
			if (column && register) column.setAttribute(LANE_LEADING_COLUMN, ground);
			register?.(column);
		},
		[register, ground],
	);
};

/**
 * The ground the marker names, read back off the element.
 *
 * `surface` answers for an absent or unknown value rather than throwing: the
 * shell's job on a bad hand-over is to paint something sane - the band's
 * historic shape - and not to take the window down over a route's regression.
 */
const laneGroundOf = (column: HTMLElement): LaneLeadingGround =>
	column.getAttribute(LANE_LEADING_COLUMN) === "elevated"
		? "elevated"
		: "surface";

/**
 * Where the lane's `surface` band has to end on the route that is up, and on which
 * rung the column that ends it stands.
 *
 * The right edge of the registered column, in the lane's own coordinates, or null
 * where the route has no such column - which is most of them (chat, schedules, agent
 * hub, projects), and where the band keeps the app sidebar's own width.
 *
 * MEASURED IN A LAYOUT EFFECT, so the band is right in the FIRST painted frame of a
 * route rather than one frame later: a state update from `useLayoutEffect` is flushed
 * before the browser paints. `ResizeObserver` rather than a dependency on the window
 * width is what keeps it true when the column changes size for a reason that is not a
 * React render - the rail's `min-[1040px]:` step is a media query, and a container
 * query or a font arriving would be the same shape of change.
 */
function useLaneLeadingEdge(
	lane: RefObject<HTMLDivElement | null>,
	column: HTMLElement | null,
	sidebarWidth: number,
): { edge: number; ground: LaneLeadingGround } | null {
	const [leading, setLeading] = useState<{
		edge: number;
		ground: LaneLeadingGround;
	} | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `sidebarWidth` is a re-measure TRIGGER rather than a value the body reads. The registered column's right edge moves with the sidebar it stands beside, and the observer cannot see that: dragging the divider does not change the column's own box at all, only where it sits.
	useLayoutEffect(() => {
		const laneElement = lane.current;
		if (!laneElement || !column) {
			setLeading(null);
			return;
		}
		const measure = () => {
			/* One rounding, so a fractional box does not re-render the shell on its own
			   noise: the value becomes a background stop, and a stop is a length. */
			const next = {
				edge:
					Math.round(
						(column.getBoundingClientRect().right -
							laneElement.getBoundingClientRect().left) *
							100,
					) / 100,
				ground: laneGroundOf(column),
			};
			setLeading((previous) =>
				previous !== null &&
				previous.edge === next.edge &&
				previous.ground === next.ground
					? previous
					: next,
			);
		};
		const observer = new ResizeObserver(measure);
		observer.observe(column);
		measure();
		return () => observer.disconnect();
	}, [column, lane, sidebarWidth]);
	return leading;
}

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
	/* The strip the band is painted on, and whichever leading column the route has
	   handed over through `useLaneLeadingColumn` - null on every route that draws none. */
	const laneRef = useRef<HTMLDivElement | null>(null);
	const [leadingColumn, setLeadingColumn] = useState<HTMLElement | null>(null);

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
	 * sidebar are one decision and not two that can disagree.
	 */
	const canvasOpen = useUiPreferencesStore((s) => s.isCanvasOpen);
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
		canvasOpen || askDrawerOpen,
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
	 * THE LANE TAKES EACH COLUMN'S OWN GROUND (D10). It was one window-wide strip
	 * on `canvas`, so over the sidebar's `surface` it read as a notch the sidebar
	 * hung from. It is still ONE element spanning both columns - that is what keeps
	 * the brand row and the conversation title on one line - but it paints each
	 * column's ground with a hard-stop gradient: the band's width in `surface` (the
	 * sidebar's own, or a leading column a route hands over - `laneEdge` below),
	 * the conversation's in `canvas`, and - since the slot moved to the drawer's
	 * rung (`canvas/index.tsx`) - THE SLOT'S WIDTH IN `elevated`, so the pane is
	 * continuous from y0 down. A pane-only change would leave the pane's tone
	 * meeting this band at y32: the hard horizontal cut this pass's predecessor
	 * removed, one layer up.
	 *
	 * The stop is the pane's leading edge, from the content column's own measured
	 * box (`useMeasuredBox` above states the arithmetic and the frame that caught a
	 * first version of it 60px wide), and `slotWidth` is 0 when no pane is open - a
	 * zero-width last stop, so the band is exactly the two-stop gradient it was.
	 * The canvas's `overlay` mode needs no branch here and gets none: the pane
	 * covers the row at the width the resolver measures, and the lane paints the
	 * pane's own ground from that leading edge (see the resolver's note).
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
	const contentBox = useMeasuredBox(contentColumnRef);
	const slotWidth = useUiPreferencesStore((state) =>
		resolveRightSlotWidth(contentBox.width, state),
	);
	/*
	 * The slot's DOCKED/OVERLAY mode, from the same measured box the width comes
	 * from: the width resolver above answers where the pane STOPS, and this answers
	 * whether it is beside the conversation or over it - §I's one pair of rules, read
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
		contentBox.width > 0 ? contentBox.left + contentBox.width - slotWidth : 0;
	/*
	 * THE BAND'S OWN WIDTH, which is the sidebar's UNLESS the route beside it draws a
	 * leading column of its own: settings has its rail, agents its list pane, and the
	 * saved-agent route a 280px roster. On those routes the lane has to carry the
	 * column's own ground across its width - the column cannot paint above its own top
	 * edge, and the operator's report of 2026-09-26 (and again of 2026-09-27, as still
	 * true) is the screenshot that proves it: the settings rail's ground began below a
	 * differently-toned strip. The sidebar's width is the FLOOR rather than the answer:
	 * a route column can only ever stand to the right of it, and with no marker the
	 * number is exactly what it always was.
	 *
	 * THE TWO EDGES COMPOSE RATHER THAN COMPETE, which is why both are computed here
	 * and neither replaces the other. THE FIRST PAIR - `laneEdge` - IS THE LEADING
	 * COLUMN'S RUNG (the settings-rail edge, 2026-09-27) and is read off the marker
	 * rather than assumed: the lane paints the sidebar's width in `surface`, the rung
	 * the column NAMES across its width, then `canvas`. A `surface` column keeps the
	 * old two-stop shape exactly (the band IS the column), which is also what a route
	 * with no column gets. THE LAST PAIR - `slotEdge` - IS THE SLOT'S STOP (the
	 * drawer's-rung pass): it repeats the conversation's token at the pane's leading
	 * edge, so the slot's `elevated` begins exactly where the conversation's `canvas`
	 * ends and the pane is continuous from y0 down. The chat route draws no leading
	 * column, so there the first pair collapses onto the sidebar's own width and the
	 * gradient is the one the drawer's-rung pass shipped. The sheet, the divider and
	 * the drag handling are untouched by any of this.
	 */
	const leading = useLaneLeadingEdge(laneRef, leadingColumn, columnWidth);
	const laneEdge = Math.max(columnWidth, leading?.edge ?? 0);
	const laneGround = leading?.ground ?? "surface";
	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
			{/*
			 * THE macOS LANE, and it is SHELL-LEVEL rather than the sidebar's own.
			 *
			 * Electron leaves the native traffic lights over the renderer once the
			 * title bar is hidden (`src/main/titlebar-options.ts`), so the renderer has
			 * to keep their 32px clear. Reserving it ONCE, above BOTH columns, is what
			 * lets the sidebar's brand row and the conversation title be the same row:
			 * with the lane scoped to one column, that column's first row starts 32px
			 * lower than the other's and the two only agree by accident. The lane is
			 * also the window's drag handle - every control in either first row opts
			 * back out with `data-titlebar-no-drag`.
			 *
			 * It is `display: none` outside the mac gate (the rule is in
			 * `styles/index.css`, keyed on the chrome attributes), so a platform whose
			 * OS is not drawing over the app loses nothing to it.
			 */}
			<div
				ref={laneRef}
				data-titlebar-lane=""
				data-titlebar-drag=""
				/* The stop as a fact on the element, the same reason the canvas's mode is one,
				   so a probe reads where the lane changes ground rather than reverse-engineering
				   it from a gradient string. */
				data-slot-edge={slotEdge}
				className="h-8 shrink-0"
				style={{
					background:
						laneGround === "surface"
							? `linear-gradient(to right, var(--lo-surface) ${laneEdge}px, var(--lo-canvas) ${laneEdge}px, var(--lo-canvas) ${slotEdge}px, var(--lo-elevated) ${slotEdge}px)`
							: `linear-gradient(to right, var(--lo-surface) ${columnWidth}px, var(--lo-${laneGround}) ${columnWidth}px, var(--lo-${laneGround}) ${laneEdge}px, var(--lo-canvas) ${laneEdge}px, var(--lo-canvas) ${slotEdge}px, var(--lo-elevated) ${slotEdge}px)`,
				}}
			/>
			<div className="flex min-h-0 flex-1 overflow-hidden">
				<div className="h-full shrink-0" style={{ width: columnWidth }}>
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
				>
					<LaneLeadingContext.Provider value={setLeadingColumn}>
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
											onClose={() => setAskDrawerOpen(false, "fleet")}
										/>
									</PaneSlot>
								</>
							)}
						</div>
					</LaneLeadingContext.Provider>
				</div>
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
					side="left"
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
						"pt-[var(--chrome-strip-h)]",
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
	<div aria-hidden="true" className="h-full bg-surface" />
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
