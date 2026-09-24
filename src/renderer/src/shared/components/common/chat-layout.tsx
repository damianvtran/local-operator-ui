import {
	SIDEBAR_COLLAPSED_WIDTH,
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
	/** The one control that closes the sidebar: the store's toggle, or the sheet. */
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

	const layout: SidebarLayout = resolveSidebarLayout(
		viewportWidth,
		collapsedPref,
		sheetRequested,
		savedWidth,
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
			if (viewportWidth >= 1024) toggleSidebar();
			else setSheetRequested((open) => !open);
		},
		[toggleSidebar, viewportWidth],
	);

	useEffect(() => {
		document.addEventListener("keydown", onToggle);
		return () => document.removeEventListener("keydown", onToggle);
	}, [onToggle]);

	/*
	 * The strip IS the sidebar below the dock width, and in overlay mode it is
	 * the sheet's contents at their own width - one render of the sidebar either
	 * way, so the list is never mounted twice and the rig's
	 * `[data-sidebar-region="chats"]` still finds exactly one region.
	 */
	if (layout.mode === "overlay") {
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
				 * `styles/index.css`, keyed on `data-titlebar-platform`), so Windows and
				 * Linux keep their native frame and lose nothing to it. Its height is
				 * `--chrome-strip-h`: 8 above the lights' 16px hit frame plus one 8px step,
				 * which is the number `titlebar-options.ts` measures from the OS rather than
				 * choosing.
				 */}
				<div
					data-titlebar-lane=""
					data-titlebar-drag=""
					className="h-8 shrink-0"
				/>
				<div className="flex min-h-0 flex-1 overflow-hidden">
					<Sheet
						open
						onOpenChange={(open) => {
							if (!open) setSheetRequested(false);
						}}
					>
						<SheetContent
							side="left"
							data-sidebar-sheet=""
							/*
							 * `w-[260px] max-w-none` overrides the primitive's own left-edge width
							 * (`w-3/4 max-w-sm`): 3/4 of an 880px window is 660 and `max-w-sm` is 384,
							 * so neither number is the sheet this column wants, and both would make the
							 * overlay wider than the dock it replaces. `cn` merges, so this wins.
							 */
							className={cn("w-[260px] max-w-none gap-0 border-hairline p-0")}
							aria-describedby={undefined}
						>
							{/*
							 * The sheet needs a name, and the sidebar's own `<nav>` is already
							 * labelled inside it - so the title is the sheet's, `sr-only` rather
							 * than drawn, because a visible "Sidebar" heading above a brand row
							 * that already says who the app is would be a third name for one
							 * thing.
							 */}
							<SheetTitle className="sr-only">
								Chats and destinations
							</SheetTitle>
							<SidebarFrameContext.Provider
								value={{
									expanded: true,
									onCollapse: () => setSheetRequested(false),
								}}
							>
								{sidebar}
							</SidebarFrameContext.Provider>
						</SheetContent>
					</Sheet>
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
			<div
				data-titlebar-lane=""
				data-titlebar-drag=""
				className="h-8 shrink-0"
			/>
			<div className="flex min-h-0 flex-1 overflow-hidden">
				<div
					className="h-full shrink-0"
					style={{
						width:
							layout.mode === "docked" ? layout.width : SIDEBAR_COLLAPSED_WIDTH,
					}}
				>
					<SidebarFrameContext.Provider
						value={{
							expanded: !layout.collapsed,
							onCollapse: toggleSidebar,
						}}
					>
						{sidebar}
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
		</div>
	);
};

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
