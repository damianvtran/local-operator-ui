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
	SIDEBAR_MIN_WIDTH,
	type SidebarLayout,
	askPanePresentation,
	canvasDockWidth,
	isSidebarTogglePress,
	resolveSidebarLayout,
	sidebarDockCapacity,
	sidebarToggleCap,
} from "@features/chat/chat-sidebar-layout";
import { FleetAskDrawer } from "@features/chat/components/asks/fleet-ask-drawer";
import { pressLandsOnOverlay } from "@features/chat/keyboard-scopes";
import { UpdateQuietIndicator } from "@shared/components/common/update-quiet-indicator";
import { t } from "@shared/i18n";
import { useTextDirection } from "@shared/i18n/use-document-direction";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import {
	resolveDrawnRightSlotPane,
	resolveRightSlotWidth,
	resolveRightSlotYieldsSidebar,
	rightSlotPaneWidth,
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
	useMemo,
	useRef,
	useState,
} from "react";
import { LeftSidebarHostContext } from "../navigation/left-sidebar-host";
import { PanelRailHostContext } from "../navigation/panel-rail-host";
import { PaneSlot } from "./pane-slot";
import { PanelEdge } from "./panel-edge";
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
 * DOCKED VERSUS STRIP IS `resolveSidebarLayout`'s READ OF THE USER'S
 * PREFERENCE AT EVERY WIDTH (#1077). The module also owns the render-only width
 * cap that keeps the chat's 480px floor and the right-edge rail inside an 800px
 * window. What lives here is what needs a DOM: the measurement, the divider,
 * and the keyboard/pointer controls that write the one persisted preference.
 *
 * THE CANVAS/ASK FIT-YIELD IS THE ONLY AUTOMATIC COLLAPSE. It is temporary and
 * does not rewrite `isSidebarCollapsed`; closing the canvas-family pane restores
 * the user's dock without a resize or reload changing their choice.
 */
type ChatLayoutProps = {
	sidebar: ReactNode;
	content: ReactNode;
	/**
	 * The route owns the left column (Team Bridge, operator 2026-11-03). The
	 * shell then mounts an empty host where `sidebar` would be and the route
	 * portals its own rail into it (`left-sidebar-host.tsx`); `sidebar` is NOT
	 * mounted at all, so the window has one sidebar rather than two.
	 *
	 * `keeper` is what must stay mounted in its place: whatever the unmounted
	 * sidebar was keeping alive that the rest of the app still reads (the
	 * catalogue feed - see `StripFeedKeeper`). Default off, so every other
	 * caller lays out exactly as before.
	 *
	 * `label` names the host as a region (design D1 / review R5): entry parks
	 * focus on the host itself, so a screen reader announces the route rather
	 * than nothing. The route supplies its own title, already translated.
	 */
	routeSidebar?: { keeper?: ReactNode; label?: string } | false;
};

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
	/** Whether the full sidebar is docked rather than drawn as the icon strip. */
	expanded: boolean;
	/** The one control that toggles the user's persisted open/closed preference. */
	onCollapse: () => void;
};

const SidebarFrameContext = createContext<SidebarFrame | null>(null);

/**
 * The sidebar's own view of the layout. Throws rather than defaulting: a
 * sidebar rendered outside this shell has no width, and a silent fallback would
 * draw a docked column inside whatever else mounted it.
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

export const ChatLayout: FC<ChatLayoutProps> = ({
	sidebar,
	content,
	routeSidebar = false,
}) => {
	/*
	 * The measured boxes and pane stop are physical coordinates, while the
	 * sidebar's leading edge is logical: inline-start is left in LTR and right in
	 * RTL. This one direction read keeps those geometry calculations aligned.
	 */

	useI18nLocale();
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
	const [leftHost, setLeftHost] = useState<HTMLElement | null>(null);
	const routeOwnsSidebar = routeSidebar !== false;
	const leftSlot = useMemo(
		() => (routeOwnsSidebar ? { host: leftHost } : null),
		[routeOwnsSidebar, leftHost],
	);
	const leftColumnRef = useRef<HTMLDivElement | null>(null);
	/*
	 * FOCUS FOLLOWS THE SWAP (UX round 1, U2 / QA Q3). Swapping the column's
	 * contents unmounts whatever control had focus in it - the nav row that
	 * opened the route, or the route's Back - and focus fell to `<body>`, so the
	 * next Tab started from the top of the document. Only when focus WAS in the
	 * column does the shell move it, and only to the matching control of the new
	 * contents: the route column's first control (Back) on entry, the nav's
	 * current destination row (`aria-current="page"`) on leave. Focus elsewhere
	 * (a field, the transcript) is never taken. A layout effect, so the move
	 * lands before paint and a screen reader hears one focus change, not two.
	 */
	const focusWasInColumn = useRef(false);
	const previousRouteOwns = useRef(routeOwnsSidebar);
	if (previousRouteOwns.current !== routeOwnsSidebar) {
		// Read during the render that swaps, before the commit unmounts the
		// focused control and the browser moves focus to `<body>`.
		const active =
			typeof document === "undefined" ? null : document.activeElement;
		focusWasInColumn.current = Boolean(
			active && leftColumnRef.current?.contains(active),
		);
		previousRouteOwns.current = routeOwnsSidebar;
	}
	useLayoutEffect(() => {
		if (!focusWasInColumn.current) return;
		const column = leftColumnRef.current;
		if (!column) return;
		if (routeOwnsSidebar) return; // entry is the effect below
		focusWasInColumn.current = false;
		/*
		 * THE DESTINATION ROW, NOT THE FIRST CURRENT ONE (#1660 QA Q6 / UX U6).
		 * `New chat` also wears `aria-current="page"` whenever an untargeted
		 * draft is staged - on every route - and it precedes the destination
		 * rows, so the first match parked a reader who just left for Library on
		 * a control that stages a chat. A disabled control (New chat before the
		 * catalogue is ready) cannot take focus at all, so it is skipped too.
		 * `/chat` itself has no row of its own, so New chat is still the answer
		 * there, through the second query. No current row at all (a route with
		 * no nav row): leave focus where the browser put it.
		 */
		(
			column.querySelector<HTMLElement>(
				'[aria-current="page"]:not([data-new-chat-row]):not(:disabled)',
			) ??
			column.querySelector<HTMLElement>('[aria-current="page"]:not(:disabled)')
		)?.focus();
	}, [routeOwnsSidebar]);
	/*
	 * Entry: the route's rail arrives through a portal a commit or more later
	 * (the host ref, then the lazy page), so the column is watched until its
	 * first control exists, and then focus goes to the COLUMN, not the control.
	 *
	 * WHY NOT THE FIRST CONTROL (operator, 2026-11-04: "when you click Team
	 * Bridge it has the back button highlighted and tooltip open"). Focusing Back
	 * from script is a programmatic focus Chromium can paint as `:focus-visible`
	 * (the ring), and Radix's tooltip trigger opens on any focus that did not
	 * follow a pointerdown ON it. #1660 U7 answered the tooltip half by marking
	 * that focus `data-focus-handoff` so Back suppressed its tooltip; the ring
	 * stayed. The host takes focus instead (`tabIndex={-1}`, `focusVisible:
	 * false`, named as a region): no ring and no tooltip, focus still does not
	 * fall to `<body>` (U2/Q3), and the next Tab lands on Back, where a real
	 * keyboard focus draws the ring and opens the tooltip.
	 *
	 * THE HANDOFF OUTLIVES THE FIRST COLUMN (#1660 QA Q5 / review m1) for free:
	 * a first open draws the EARLY column (Back + title) and then replaces it with
	 * the full rail, which unmounted a focused Back and dropped focus to `<body>`.
	 * The host is the shell's own element and survives that swap, so the parked
	 * focus does too; the watch only waits for the first control to exist.
	 */
	useEffect(() => {
		if (!routeOwnsSidebar || !leftHost || !focusWasInColumn.current) return;
		const focusFirst = () => {
			const first = leftHost.querySelector<HTMLElement>(
				"button, a[href], [tabindex]:not([tabindex='-1'])",
			);
			if (!first) return false;
			focusWasInColumn.current = false;
			/* `focusVisible` is a newer FocusOptions member TypeScript's DOM lib
			   may not carry yet; the panel rail's story passes it the same way. */
			leftHost.focus({
				preventScroll: true,
				focusVisible: false,
			} as FocusOptions);
			return true;
		};
		/* The host's own realm: the column is a portal target, and a static-markup
		   or jsdom host has no global `MutationObserver` of its own. */
		const Observer =
			leftHost.ownerDocument.defaultView?.MutationObserver ?? MutationObserver;
		if (focusFirst()) return;
		const observer = new Observer(() => {
			if (focusFirst()) observer.disconnect();
		});
		observer.observe(leftHost, { childList: true, subtree: true });
		return () => observer.disconnect();
	}, [routeOwnsSidebar, leftHost]);

	const layout: SidebarLayout = resolveSidebarLayout(
		viewportWidth,
		/*
		 * A ROUTE-OWNED COLUMN IS ALWAYS DOCKED. The route's rail (org switcher,
		 * titles, sections) has no 56px form, and a strip with nothing in it is the
		 * dead control this codebase removes elsewhere. The preference is NOT
		 * rewritten: ⌘B does nothing here (see `onToggle`), and the preference is
		 * untouched - the column the user comes back to is the one they chose.
		 * The capacity cap still applies, so an 800px window keeps its 480px content
		 * floor (the yield below is switched off for the same no-56px-form reason).
		 */
		routeOwnsSidebar ? false : collapsedPref,
		savedWidth,
		/*
		 * THE SIDEBAR YIELDS TO THE ASK DRAWER AS IT DOES TO THE CANVAS, in EITHER
		 * scope. §I's order gives up the sidebar before the pane, and the drawer is one
		 * container whichever queue it shows - so a rule that held for the canvas and
		 * for the fleet pane but not for the session one would make the two scopes of
		 * one surface lay the window out differently, which is precisely the "which one
		 * am I looking at" confusion this feature removes.
		 *
		 * EXCEPT ON A ROUTE-OWNED COLUMN (round 1, M1/Q2). Yielding means "drop to
		 * the 56px strip", and the route's rail has no strip form: with the fleet
		 * drawer open at ~936-1139px it was cut to 56px with its rows clipped. The
		 * drawer still lays itself out (overlay or docked) from the row's width, as
		 * it does whenever the sidebar does not yield.
		 */
		routeOwnsSidebar ? false : slotYieldsSidebar,
		railWidth,
	);

	const onToggle = useCallback(
		(event: KeyboardEvent) => {
			if (!isSidebarTogglePress(event)) return;
			// A foreign overlay - a dialog, a menu, a listbox - owns its own keys.
			if (pressLandsOnOverlay(event.target)) return;
			event.preventDefault();
			/*
			 * ⌘B IS A NO-OP ON A ROUTE-OWNED COLUMN (UX round 1, U1). The column
			 * cannot collapse there, so a toggle would change nothing visible and then
			 * surprise the reader with a different nav after Back. The chord is still
			 * claimed (`preventDefault` above) so it cannot fall through to a field.
			 */
			if (routeOwnsSidebar) return;
			/* The chord and the strip control write the same preference at every width. */
			toggleSidebar();
		},
		[toggleSidebar, routeOwnsSidebar],
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
	 * ONE TREE FOR BOTH MODES. The sidebar stays mounted while its width changes,
	 * so toggling the preference or crossing a window size cannot remount the
	 * conversation or duplicate the list's stores and timers.
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
	 * THE SLOT'S LEADING EDGE, EXPOSED ONCE (design round, D3). `slotRowWidth` is
	 * the row the pane shares with the conversation — the content column's own
	 * width, measured rather than derived from the window, because the sidebar is
	 * draggable and the strip is a different width from the dock — and `slotWidth`
	 * is what the ONE resolver in `ui-preferences-store` answers for it. Both this
	 * lane and `chat-content.tsx` call that resolver; a second derivation here is
	 * the drift the resolver exists to prevent (`resolveRightSlotWidth` states
	 * the whole argument, including the canvas's overlay mode). `drawnSlotWidth`
	 * below is what the lane actually stops at: the resolver's number for every
	 * DOCKED occupant, and the ask sheet's own width where the drawer is drawn as
	 * the overlay - the resolver's leftover (`row - 480`) is not that sheet.
	 */
	const contentColumnRef = useRef<HTMLDivElement | null>(null);
	const contentBox = useMeasuredBox(contentColumnRef, direction);
	const slotWidth = useUiPreferencesStore((state) =>
		resolveRightSlotWidth(contentBox.width, state),
	);
	/*
	 * THE ASK SHEET'S OWN GEOMETRY, from the same measured box (2026-11-03).
	 *
	 * WHY THE SHELL NEEDS IT AS WELL AS THE MOUNTS. `slotWidth` is the resolver's
	 * answer for a DOCKED pane, and below the dock breakpoint the resolver's answer
	 * for the ask pane is the row's leftover (`row - 480`) - which is not what the
	 * sheet draws. The lane's stop and `data-slot-edge` have to name the pane's
	 * leading EDGE, so where the drawn pane is the ask drawer this number replaces
	 * the resolver's one. `resolveDrawnRightSlotPane` is the same drawable-aware
	 * read the rail lights from (#868), so a claimed-but-undrawable drawer still
	 * answers no width here.
	 */
	const askPreferredWidth = useUiPreferencesStore((state) =>
		rightSlotPaneWidth(CANVAS_PANE_MIN_PX, state.rightSlotWidth),
	);
	const askPresentation = askPanePresentation(
		contentBox.width || Number.MAX_SAFE_INTEGER,
		askPreferredWidth,
	);
	const drawnPane = useUiPreferencesStore(resolveDrawnRightSlotPane);
	const drawnSlotWidth =
		drawnPane === "ask" ? askPresentation.width : slotWidth;
	/*
	 * THE COVERED CONTENT GOES INERT UNDER THE FLEET SHEET (design D4 amendment,
	 * 2026-11-03; agent review round 1, M1). The fleet sheet runs on every route,
	 * so the thing it covers is whatever the route drew - not a chat column the
	 * mount can name. The wrapper below is `display: contents`, so its child is
	 * still the flex item the row lays out; making the WRAPPER inert covers
	 * everything inside it without touching layout or either measurement
	 * (`contentColumnRef`, the lane's stop).
	 *
	 * The sidebar and the panel rail are siblings OUTSIDE this row and stay
	 * reachable: the rail's asks item is how the sheet is closed or reopened, and
	 * freezing it would leave a pointer user with only the sheet's own X.
	 */
	const fleetContentRef = useRef<HTMLDivElement | null>(null);
	useLayoutEffect(() => {
		const element = fleetContentRef.current;
		if (!element) return;
		element.inert = fleetAsksOpen && askPresentation.mode === "overlay";
	}, [fleetAsksOpen, askPresentation.mode]);
	/*
	 * The slot's DOCKED/OVERLAY mode, from the same measured box the width comes
	 * from: the width resolver above answers where the pane STOPS, and this answers
	 * whether it is docked or has stopped docking (the `overlay` literal;
	 * `canvasPaneMode` states what each occupant draws). For the ask drawer the
	 * answer is the presentation's own mode - one call, so the width, the scrim and
	 * the ground cannot disagree about which mode the sheet is in.
	 */
	const fleetDocked = askPresentation.mode === "docked";
	/*
	 * THE STOP IS THE PANE'S LEADING EDGE. The pane hugs the slot's trailing edge,
	 * so its leading edge sits `drawnSlotWidth` px LEFT of the content column's
	 * right edge - not `columnWidth + slotWidth` px from the window's left, which is
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
					: contentBox.left + contentBox.width) - drawnSlotWidth
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
				<div
					ref={leftColumnRef}
					className={cn("relative h-full shrink-0")}
					style={{ width: columnWidth }}
				>
					{routeOwnsSidebar ? (
						<>
							{routeSidebar.keeper}
							{/*
							 * THE ROUTE'S RAIL HOST. It carries what `SidebarNavigation`'s
							 * root carries - the `surface` ground from y0, `panel-top-pad`
							 * so the first row clears the OS controls, and the `sidebar`
							 * glass region - so the column reads as the same panel with
							 * different contents, and whatever is portaled in paints no
							 * ground or glass of its own (a second `page-sidebar` alpha over
							 * this one is the double layer `styles/index.css` forbids).
							 * `overflow-hidden` because the column never scrolls; the rail's
							 * own sections do.
							 */}
							<div
								ref={setLeftHost}
								/* Focusable by script only: the entry handoff above parks
								   focus here so Tab starts in the column; never a Tab stop. */
								tabIndex={-1}
								role={routeSidebar.label ? "region" : undefined}
								aria-label={routeSidebar.label}
								data-route-sidebar-host=""
								data-glass-region="sidebar"
								className="panel-top-pad flex h-full min-h-0 flex-col overflow-hidden bg-surface"
							/>
						</>
					) : (
						<SidebarFrameContext.Provider
							value={{
								expanded: layout.mode === "docked",
								onCollapse: toggleSidebar,
							}}
						>
							{sidebar}
						</SidebarFrameContext.Provider>
					)}
					{/*
					 * THE SIDEBAR'S SEAM, drawn by the shell's column rather than by either
					 * sidebar root. The column is the same box as the panel in both modes
					 * (docked and the 56px strip), so one mount covers the two, and neither
					 * root has to become a positioning context for it. `relative` here is a
					 * no-op for every descendant: the column already has the panel's exact
					 * box, so an absolute child resolves to the same pixels it did against the
					 * shell.
					 */}
					<PanelEdge side="end" />
				</div>
				{layout.resizable && (
					<ResizableDivider
						sidebarWidth={layout.width}
						onSidebarWidthChange={setSidebarWidth}
						minWidth={SIDEBAR_MIN_WIDTH}
						maxWidth={sidebarDockCapacity(viewportWidth, railWidth)}
						onDoubleClick={restoreDefaultSidebarWidth}
						/*
						 * No "(⌘B)" on a route-owned column: the chord is a no-op there
						 * (see `onToggle`), so naming it would advertise a dead key.
						 */
						label={
							routeOwnsSidebar
								? t("ui.common.layout.chat_layout.resize_the_sidebar_plain")
								: t("ui.common.layout.chat_layout.resize_the_sidebar", {
										sidebartogglecap: sidebarToggleCap(isMacPlatform()),
									})
						}
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
						<div className="relative flex h-full min-h-0 w-full overflow-hidden">
							{/*
							 * THE COVERED CONTENT, wrapped so the fleet sheet can inert it
							 * without disturbing the flex row (`display: contents`). See
							 * `fleetContentRef` above.
							 */}
							<div
								ref={fleetContentRef}
								data-ask-covered-content=""
								className="contents"
							>
								{/*
								 * THE LEFT HOST REACHES THE ROUTE, which is the portal's
								 * SOURCE: the host element lives in the column above, the
								 * rail that fills it is rendered by the route in here. Null
								 * when no route owns the column, which is what makes
								 * `InLeftSidebarHost` render inline. Memoised so a shell
								 * re-render does not re-render every consumer.
								 */}
								<LeftSidebarHostContext.Provider value={leftSlot}>
									{content}
								</LeftSidebarHostContext.Provider>
							</div>
							{/*
							 * THE FLEET ASKS PANE: the same three pieces the route's occupants
							 * use (the divider, the slot, the pane), so the column is one idiom in
							 * both homes. The divider exists only while it DOCKS, for the reason
							 * the canvas's own states: in the overlay mode there is no flow
							 * boundary to drag.
							 */}
							{fleetAsksOpen && (
								<>
									{/*
									 * THE SCRIM: the strip of conversation the sheet leaves uncovered, and the press
									 * that puts the sheet away. It covers this ROW only - the sidebar and the panel
									 * rail are siblings outside it, so the rail's asks item stays a working toggle -
									 * and it is drawn only where `askPanePresentation` says a strip remains (the
									 * sheet fills the row at or below the 416px scrim threshold - the 400px
									 * floor plus the 16px minimum - where a sliver would not be a target).
									 * Pointer-only: Escape is the keyboard door and the drawer already
									 * claims it (`ask-drawer.tsx`).
									 */}
									{askPresentation.scrimmed && (
										<div
											aria-hidden="true"
											data-ask-scrim=""
											className="absolute inset-0 z-30 bg-scrim"
											onPointerDown={() => setAskDrawerOpen(false, "fleet")}
										/>
									)}
									{fleetDocked && (
										<ResizableDivider
											sidebarWidth={drawnSlotWidth}
											onSidebarWidthChange={setRightSlotWidth}
											minWidth={CANVAS_PANE_MIN_PX}
											maxWidth={Math.max(
												CANVAS_PANE_MIN_PX,
												canvasDockWidth(contentBox.width),
											)}
											side="left"
											onDoubleClick={restoreDefaultRightSlotWidth}
											label={t(
												"ui.common.layout.chat_layout.resize_asks_double_click_resets_the_shared_pane_width",
											)}
										/>
									)}
									{/*
									 * THE ASK SHEET, in the two presentations `askPanePresentation` decides
									 * (2026-11-03). Docked it is the family's flex pane at the resolver's width;
									 * below the dock breakpoint it is a right-anchored sheet over this row -
									 * `absolute inset-y-0 end-0`, so it never takes (or measures) flow space and
									 * the row's width cannot feed back into the breakpoint that chose it.
									 * `max-w-full` resolves against the row at paint time, so the inline width
									 * cannot overrun a row number one reflow old (the over-constrained case
									 * `pane-slot.tsx`'s `width` note records).
									 */}
									<PaneSlot
										width={askPresentation.width}
										data-lo-floating={
											askPresentation.mode === "docked" ? undefined : ""
										}
										className={
											askPresentation.mode === "docked"
												? undefined
												: "absolute inset-y-0 end-0 z-40 max-w-full shadow-overlay"
										}
										tourTag="ask-fleet-slot"
										data-ask-mode={askPresentation.mode}
									>
										<FleetAskDrawer
											/*
											 * AN OPAQUE GROUND OVER THE CONVERSATION (2026-11-03): the glass
											 * marker is a TRANSLUCENT ground meant for a pane over window
											 * material, and over a transcript it lets the text show through.
											 * `ground` drops the marker in the sheet, where `bg-elevated` is
											 * then opaque.
											 */
											ground={
												askPresentation.mode === "docked" ? "glass" : "solid"
											}
											presentation={askPresentation.mode}
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
				 * portal is empty.
				 *
				 * THE SEAM IS MOUNTED HERE, ON THE HOST, NOT ON THE RAIL'S ROOT (agent
				 * review round 1, B1). `panel-top-pad` moves only the CONTENT inside the
				 * box: the host still starts at y0 while the portal's root starts at the
				 * pad (32px on macOS), so an `inset-y-0` child of the rail root began the
				 * seam at y=32 - the mid-air line this change exists to remove. An
				 * absolutely positioned child resolves against the PADDING box, so
				 * `relative` here plus `<PanelEdge side="start" />` spans y0 to the floor
				 * like the sidebar's and every pane's. `scripts/pane-slot-ground.test.mjs`
				 * pins the ground, the `relative` and the mount; `panel-rail-frame.tsx`
				 * mirrors the same two classes for the story harnesses.
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
					className="panel-top-pad relative h-full shrink-0 bg-surface"
					style={{ width: railWidth }}
				>
					<PanelEdge side="start" />
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
			 * BELOW the lane and the two columns, and above nothing: in flow this row
			 * is the column's last child and the band reads as the window's own
			 * status row rather than as part of either column.
			 */}
			<UpdateQuietIndicator />
		</div>
	);
};

/**
 * Whether this is macOS, for the one caption the divider prints.
 *
 * `navigator.platform` rather than a chrome attribute, because this is a key cap
 * and not a chrome decision: the chrome gates (`data-chrome-*`) say where the
 * OS DRAWS, and the cap says which modifier the handler here answers.
 *
 * The comparison token is a literal, never catalogue copy: a translated
 * platform word would make the same machine resolve differently per UI
 * language. The caption is `sidebarToggleCap()`'s literal keycap (`⌘B` /
 * `Ctrl+B`) — a modifier glyph, not prose, so it has no catalogue key.
 */
const MAC_PLATFORM_TOKEN = "MAC";
const isMacPlatform = (): boolean =>
	typeof navigator !== "undefined" &&
	navigator.platform.toUpperCase().indexOf(MAC_PLATFORM_TOKEN) >= 0;
