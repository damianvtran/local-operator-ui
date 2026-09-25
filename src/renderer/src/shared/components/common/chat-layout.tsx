import {
	SIDEBAR_COLLAPSED_WIDTH,
	SIDEBAR_DOCK_MIN_PX,
	SIDEBAR_MAX_WIDTH,
	SIDEBAR_MIN_WIDTH,
	type SidebarLayout,
	isSidebarTogglePress,
	resolveSidebarLayout,
	sidebarToggleCap,
} from "@features/chat/chat-sidebar-layout";
import { pressLandsOnOverlay } from "@features/chat/keyboard-scopes";
import { Sheet, SheetContent, SheetTitle } from "@shared/components/ui/sheet";
import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import {
	type FC,
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";
import { ResizableDivider } from "./resizable-divider";

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

	const layout: SidebarLayout = resolveSidebarLayout(
		viewportWidth,
		collapsedPref,
		sheetRequested,
		savedWidth,
		canvasOpen,
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
	 * the brand row and the conversation title on one line - but it paints the
	 * sidebar's width in `surface` and the rest in `canvas` with a hard-stop
	 * gradient, so each column's ground runs to y0 the way Codex and Cursor 3 draw
	 * theirs. The stop is the column's own width, which is why it is a style.
	 */
	const columnWidth =
		layout.mode === "docked" ? layout.width : SIDEBAR_COLLAPSED_WIDTH;
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
				data-titlebar-lane=""
				data-titlebar-drag=""
				className="h-8 shrink-0"
				style={{
					background: `linear-gradient(to right, var(--lo-surface) ${columnWidth}px, var(--lo-canvas) ${columnWidth}px)`,
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
				<div className="flex h-full min-w-0 grow flex-col overflow-hidden">
					{content}
				</div>
			</div>
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
