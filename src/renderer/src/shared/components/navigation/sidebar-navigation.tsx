import { useAppWideApprovals } from "@features/browser/hooks/use-app-wide-approvals";
import { sidebarToggleCap } from "@features/chat/chat-sidebar-layout";
import { ChatSidebar } from "@features/chat/components/chat-sidebar";
/*
 * One decision, one spelling: the row the reader is ON is painted by the
 * sidebar's own role string rather than by a second copy of it here. A copy is
 * what drifted twice (design rounds 3 and 4, D17/D19) and both drifts landed at
 * an ELEMENT while the copied string above it stayed verbatim - so this column
 * imports the role exactly as the settings rail does, on its own import line,
 * which is the shape `chat-sidebar-selection.test.mjs` reads for.
 */
import { rowCurrent } from "@features/chat/components/chat-sidebar";
import { newChatShortcutCap } from "@features/chat/new-chat-shortcut";
import { openConversation } from "@features/chat/open-conversation";
import {
	paletteShortcutCaps,
	paletteShortcutLabel,
} from "@features/command-palette/palette-shortcut";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import type { ChatTarget } from "@shared/api/local-operator/profile-hooks";
import { useSidebarFrame } from "@shared/components/common/chat-layout";
import { KeyboardShortcut } from "@shared/components/common/keyboard-shortcut";
import { CollapsibleAppLogo } from "@shared/components/navigation/collapsible-app-logo";
import { UserProfileSidebar } from "@shared/components/navigation/user-profile-sidebar";
import { Badge, Button, Tooltip } from "@shared/components/ui";
import { useCurrentView } from "@shared/hooks/use-route-params";
import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { LucideIcon } from "lucide-react";
import {
	Bot,
	CalendarDays,
	ChevronLeft,
	ChevronRight,
	Globe,
	MessageSquarePlus,
	Search,
	Settings,
	Store,
	X,
} from "lucide-react";
import type { FC, ReactNode } from "react";
import { useNavigate } from "react-router-dom";

/*
 * THE ONE SIDEBAR.
 *
 * What this was: a 220px icon rail of destinations, drawn on EVERY route by
 * `app.tsx`, with the chat route drawing a second 280px list pane beside it.
 * That is 500px of chrome at 1380 and at 1024 alike, with the rail mostly empty
 * and the list pane's own top half carrying an agents/teams tree - so the chats
 * started below the fold's midpoint and the pane had two scrollbars (the
 * baseline's `geometry.json` records `nav 220, list 280, chat 880/524`).
 *
 * What this is: ONE column of 260px, mounted once in `app.tsx` inside
 * `chat-layout.tsx`, holding - top to bottom - the brand row, the primary
 * action, the destinations, the chat list as its body, and the account at the
 * foot. The body is `chat-sidebar.tsx`'s two SECTIONS - Agents + Teams above,
 * the chats list below - with the draggable, persisted boundary between them
 * (`sidebar-split.ts`), both drawn by default: the operator's call on the
 * preview was that both sections stay visible and relatively sizable, with the
 * navigation links in this same column. A 56px icon strip is what the column
 * collapses to.
 *
 * WHY THE DESTINATIONS STAY IN THIS FILE while the list moved in beside them:
 * the list's own component (`chat-sidebar.tsx`) reads the router, the
 * canonical-sessions store and the desktop capability hooks and is already
 * self-sufficient - it is rendered here rather than re-implemented - and the
 * destinations are the same table this file has always owned, on the same
 * routes and in the same order, so a tour step or a bookmark that names one
 * still lands where it always did.
 *
 * ## Why the ground is `surface`
 *
 * HISTORY, because the first half of this was a real fix and its finding still
 * holds. The rail was `surface` - a step *above* the `canvas` page - and on the
 * agents and settings routes it sat directly against another `surface` list
 * panel with no boundary between them, so the two merged into one 480px slab.
 * It was moved to `sunken` for that reason. THE ROW-STATE REFINEMENT PUT IT
 * BACK, because `sunken` broke something this column owns: the rows in it are
 * ROW STATES (`rowCurrent` for the destination you are on, `row-hover` for the
 * row under the pointer), and both roles are authored as a step of the palette's
 * own `surface` (`docs/design/row-states-refinement.md` § 4), so a column whose
 * ground is a rung *below* `surface` paints those states into that rung rather
 * than out of the panel they were measured against. MEASURED on the fleet: the
 * current row's fill landed ΔE00 0.44 off the column on `alucard` - 7 of the 59
 * palettes under the file's own 2.0 field floor. So the rule is the invariant:
 * **a surface that paints the row states wears `surface`.**
 *
 * THE BOUNDARY IS NOW THE PANE'S, and it is drawn there rather than here: this
 * column is `surface` and the chat pane beside it is `canvas`, a step apart with
 * no line needed, and the right pane keeps its leading `hairline`. The rule the
 * old rail needed - a drawn line between two `surface` panels - no longer has
 * two panels to separate on this screen.
 *
 * ## Density
 *
 * 260px docked (user-resizable 220-320), 56px collapsed, and the thresholds live
 * in `chat-sidebar-layout.ts` where they can be asserted. Every row here is
 * 30px: 16px glyph, 13px label, 8px of padding.
 */

type SidebarNavigationProps = Record<string, never>;

type NavItem = {
	icon: LucideIcon;
	label: string;
	path: string;
	isActive: boolean;
	tourTag: string;
	/**
	 * How many browser approvals are waiting on the user, ACROSS EVERY
	 * CONVERSATION (operator ask, 2026-09-23). Zero draws nothing at all - a
	 * badge reading `0` would be a mark that says nothing is being asked, which
	 * is the honest rendering of an item with no badge.
	 */
	attention?: number;
};

/** A destination row: 30px, one line, 13px, and never a second line. */
const DESTINATION_ROW =
	"flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-body-sm transition-colors duration-fast ease-out-quart";

export const SidebarNavigation: FC<SidebarNavigationProps> = () => {
	const navigate = useNavigate();
	const currentView = useCurrentView();
	const { expanded, mode, onCollapse } = useSidebarFrame();
	const openCommandPalette = useUiPreferencesStore(
		(state) => state.openCommandPalette,
	);
	/*
	 * The catalogue capability, the gate the New chat row is disabled on - the
	 * same bit `app.tsx`'s ⌘N binding reads, so the row and the chord refuse in
	 * exactly the same states.
	 */
	const capabilities = useDesktopCapabilities();
	/*
	 * The open conversation, SUBSCRIBED rather than read once: the list marks the
	 * row the user is in, and a `getState()` read during render would freeze that
	 * mark at whatever was open when this component last re-rendered.
	 */
	const activeSessionId = useCanonicalSessionsStore(
		(state) => state.activeSessionId,
	);
	/*
	 * The column is on EVERY route, so its Browser item answers the question no
	 * per-conversation badge can: is an agent anywhere in this app blocked on me?
	 * The count is the projection's own live set, unattributed requests included -
	 * see `useAppWideApprovals` for why that one deliberately disagrees with the
	 * chat header's count.
	 */
	const browserApprovals = useAppWideApprovals();

	const navItems: NavItem[] = [
		{
			icon: Bot,
			label: "Agents",
			path: "/agents",
			isActive: currentView === "agents",
			tourTag: "nav-item-agents",
		},
		{
			icon: CalendarDays,
			label: "Schedules",
			path: "/schedules",
			isActive: currentView === "schedules",
			tourTag: "nav-item-schedules",
		},
		{
			// Named "Browser" rather than "Web" or "Pages": the feature is a browser
			// the user can use and an agent can drive, and the design's own word for
			// it is the tab it opens (design 11.9).
			icon: Globe,
			label: "Browser",
			path: "/browser",
			isActive: currentView === "browser",
			tourTag: "nav-item-browser",
			attention: browserApprovals,
		},
		{
			icon: Store,
			label: "Agent hub",
			path: "/agent-hub",
			isActive: currentView === "agent-hub",
			tourTag: "nav-item-agent-hub",
		},
	];

	/*
	 * THE BODY. The list brings its own actions - its `New chat` row stages an
	 * untargeted draft, its rows open conversations - and it is handed the two
	 * callbacks its existing API asks for rather than reading the store itself.
	 * `openConversation` is the same function the route's own switcher uses, so a
	 * click here and a click inside the pane are one code path with one set of
	 * rules about the URL.
	 *
	 * The route's own `setRouteError(null)` half of that path stays with the
	 * route: `chat-page.tsx` clears its sentence when the draft key or the route
	 * identity moves, and a switch from this column moves both.
	 */
	const listBody: ReactNode = (
		<ChatSidebar
			selectedConversation={activeSessionId ?? undefined}
			onSelectConversation={(id: string) => void openConversation(navigate, id)}
			onStageDraft={(target?: ChatTarget, fresh?: boolean) => {
				useCanonicalSessionsStore.getState().stageDraft(target, fresh);
				navigate("/chat");
			}}
		/>
	);

	const renderNavItem = (item: NavItem) => {
		/*
		 * The tour clicks these by `[data-tour-tag="nav-item-agents"]` and its
		 * siblings, so the tag has to stay on the button itself. Putting it on a
		 * wrapper would leave the tour dispatching a click at a div and silently
		 * doing nothing.
		 */
		const attention = item.attention ?? 0;
		/*
		 * THE NAME CARRIES THE NUMBER (operator ask, 2026-09-23): a badge is a visual
		 * convenience over a fact the control has to STATE, and a screen reader that
		 * found only the word "Browser" would be told there was nothing to answer
		 * while an agent sat blocked on a prompt. Set in BOTH widths so the name does
		 * not change with the column's width - and only when a badge is drawn, so a
		 * quiet column keeps the plain label it has always had.
		 */
		const attentionLabel =
			attention > 0 ? `${item.label}, ${attention} waiting` : item.label;
		const rowState = item.isActive
			? rowCurrent
			: "text-ink-muted hover:bg-row-hover hover:text-ink";
		return (
			<li
				key={item.path}
				className={cn(
					"flex h-[30px] w-full items-center rounded-md",
					"transition-colors duration-fast ease-out-quart",
					rowState,
				)}
			>
				<button
					type="button"
					onClick={() => navigate(item.path)}
					data-tour-tag={item.tourTag}
					aria-current={item.isActive ? "page" : undefined}
					/* Collapsed there is no text in the row, and the tooltip cannot
					   supply the name: Radix's `Trigger` adds `aria-describedby`, and
					   only while open. */
					aria-label={expanded && attention === 0 ? undefined : attentionLabel}
					className={cn(
						"flex h-full min-w-0 flex-1 items-center gap-2 rounded-md",
						expanded ? "px-2" : "justify-center px-0",
					)}
				>
					<item.icon
						size={16}
						aria-hidden="true"
						className={cn("shrink-0", item.isActive && "text-accent")}
					/>
					{expanded && <span className="truncate">{item.label}</span>}
					{attention > 0 && (
						/*
						 * THE SAME BADGE THE HEADER'S GLOBE CARRIES (design 5.1). In flow at
						 * the row's trailing edge rather than absolutely positioned: the row is
						 * 30px with a 13px label, so the trailing edge IS its top-right at any
						 * size a badge would use, and a 16px badge inside a 30px row moves
						 * neither the label's start nor the row's height.
						 */
						<span className={cn(expanded && "ml-auto", "inline-flex")}>
							<Badge
								variant="attention"
								shape="pill"
								size="count"
								data-tour-tag="nav-browser-badge"
							>
								{attention}
							</Badge>
						</span>
					)}
				</button>
			</li>
		);
	};

	/*
	 * Collapsed, the tooltip is the only name a row shows on screen; the
	 * accessible name is the button's own `aria-label`. Wrapping the `<li>` keeps
	 * one DOM shape in both widths, so the rows MOVED between the two renders
	 * rather than being rebuilt in a second layout.
	 */
	const renderNavRow = (item: NavItem) =>
		expanded ? (
			renderNavItem(item)
		) : (
			<li key={item.path}>
				<Tooltip content={item.label} side="right">
					{renderNavItem(item)}
				</Tooltip>
			</li>
		);

	/*
	 * THE ONE TOGGLE, and its glyph follows WHERE the sidebar is drawn (design
	 * round 1, D3). Docked, it collapses to the strip: `‹`. In the sheet it
	 * closes the sheet: `×`, because the sheet is a layer that goes away rather
	 * than a column that narrows. In the strip it expands: `›` (the dock at
	 * >=1024, the sheet below - the shell decides which, `chat-layout.tsx`). The
	 * sheet used to draw the docked `‹` beside the dialog primitive's own `×`,
	 * one over the other in a single focus-ringed box.
	 */
	const toggleLabel =
		mode === "overlay"
			? "Close sidebar"
			: expanded
				? "Collapse sidebar"
				: "Expand sidebar";
	const ToggleGlyph =
		mode === "overlay" ? X : expanded ? ChevronLeft : ChevronRight;
	const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
	const catalogueReady = desktopFeatureEnabled(
		capabilities.data,
		"session_catalogue",
		2,
	);
	const activeDraftKey = useCanonicalSessionsStore(
		(state) => state.activeDraftKey,
	);
	const drafts = useCanonicalSessionsStore((state) => state.drafts);
	/*
	 * An untargeted draft is the one THIS row stages, so it is the row marked
	 * current while one is up - the same terms the list's old `New chat` row
	 * used. A draft with a target belongs to its agent's row.
	 */
	const untargetedDraft =
		Boolean(activeDraftKey) &&
		!(activeDraftKey ? drafts[activeDraftKey] : undefined)?.target;
	const stageNewChat = () => {
		useCanonicalSessionsStore.getState().stageDraft(undefined, true);
		navigate("/chat");
	};

	/*
	 * THE PRIMARY ACTIONS, two 30px rows at the top of the column (§C1.2; design
	 * round 1, D1): `New chat ⌘N`, then `Search ⌘K`.
	 *
	 * New chat moved HERE from the list's own header, where it sat under a second
	 * search field, a disclosure and an `All chats` row - the placement the design
	 * round named as the biggest reason the shell read as two panels welded
	 * together. Search stays the command palette's door: the one visible search in
	 * the column. The list's own filter is type-to-filter now (`chat-sidebar.tsx`),
	 * so there is no second search control at rest.
	 *
	 * THE CHORD IS WRITTEN ON THE ROW, as caps with no separator between them
	 * (N1: `⌘K`, not `⌘ + K`) - the app's `KeyboardShortcut` spells a chord as
	 * `+`-joined caps and prints the `+`, so the rows pass the caps as one string
	 * and split nothing. The accessible name carries the chord in words.
	 *
	 * DISABLED ON THE CATALOGUE GATE, the same bit `app.tsx`'s ⌘N reads: staging a
	 * draft needs the session catalogue, and a row that staged one against an
	 * absent catalogue would be the shortcut claiming a capability the app has
	 * just said it does not have.
	 */
	const newChatLabel = `New chat (${newChatShortcutCap(isMac).replace("+", "")})`;
	const searchLabel = `Search (${paletteShortcutLabel(isMac)})`;
	const primaryRow = (
		icon: LucideIcon,
		label: string,
		caps: string,
		props: {
			onClick: () => void;
			ariaLabel: string;
			current?: boolean;
			disabled?: boolean;
			attrs?: Record<string, string>;
		},
	) => {
		const Icon = icon;
		return (
			<button
				type="button"
				{...props.attrs}
				onClick={props.onClick}
				disabled={props.disabled}
				aria-label={props.ariaLabel}
				aria-current={props.current ? "page" : undefined}
				className={cn(
					DESTINATION_ROW,
					props.current
						? rowCurrent
						: "text-ink-muted hover:bg-row-hover hover:text-ink",
					"disabled:text-ink-disabled disabled:hover:bg-transparent",
				)}
			>
				<Icon size={16} aria-hidden="true" className="shrink-0" />
				<span className="truncate">{label}</span>
				{/*
				 * Decorative: the accessible name above already carries the chord, so the
				 * caps are hidden from a screen reader rather than announced beside it.
				 */}
				<span aria-hidden="true" className="ml-auto">
					<KeyboardShortcut shortcut={caps} joined />
				</span>
			</button>
		);
	};
	const newChatRow = primaryRow(
		MessageSquarePlus,
		"New chat",
		newChatShortcutCap(isMac),
		{
			onClick: stageNewChat,
			ariaLabel: newChatLabel,
			current: untargetedDraft,
			disabled: !catalogueReady,
			/*
			 * THE TOUR'S CHAT ANCHOR: the one sidebar's body IS the chat list, so the
			 * onboarding step that clicks its way back to a conversation needs a control
			 * that lands on `/chat`, and this row is the one that does.
			 */
			attrs: { "data-tour-tag": "nav-item-chat", "data-new-chat-row": "" },
		},
	);
	const searchRowExpanded = primaryRow(
		Search,
		"Search",
		paletteShortcutCaps(isMac),
		{
			onClick: openCommandPalette,
			ariaLabel: searchLabel,
			attrs: { "data-command-palette-trigger": "" },
		},
	);

	/*
	 * A strip control: 32px, one glyph, the name in a tooltip and in
	 * `aria-label`. The strip's first group is expand + New chat + Search (§J2/§C3,
	 * design round 1, D11): with only the destinations in it, New chat was
	 * reachable from a narrow window by ⌘N alone.
	 */
	const stripButton = (
		icon: LucideIcon,
		label: string,
		props: {
			onClick: () => void;
			disabled?: boolean;
			attrs?: Record<string, string | boolean>;
		},
	) => {
		const Icon = icon;
		return (
			<Tooltip content={label} side="right">
				<button
					type="button"
					{...props.attrs}
					onClick={props.onClick}
					disabled={props.disabled}
					aria-label={label}
					className={cn(
						"flex size-8 items-center justify-center rounded-sm text-ink-muted",
						"transition-colors duration-fast ease-out-quart",
						"hover:bg-row-hover hover:text-ink",
						"disabled:text-ink-disabled disabled:hover:bg-transparent",
					)}
				>
					<Icon size={16} aria-hidden="true" />
				</button>
			</Tooltip>
		);
	};

	/*
	 * The collapse/close control in the brand row, revealed when the column is
	 * pointed at or contains focus - Linear, Notion and Slack all put it in the
	 * header and reveal it on hover. In the SHEET it is always drawn: it is the
	 * sheet's one visible close, and a close that appears only on hover in a layer
	 * the user just opened is a close they have to hunt for.
	 *
	 * `pointer-events-none` gates the mouse only; focus is unaffected, so the
	 * button keeps its place in the tab order and reveals itself with
	 * `group-focus-within/sidebar` when a keyboard reaches it.
	 *
	 * `aria-keyshortcuts` names the chord the shell answers (`chat-layout.tsx`):
	 * this control and that handler are the two halves of one gesture.
	 */
	const collapseToggle = (
		<div
			className={cn(
				mode !== "overlay" &&
					cn(
						"pointer-events-none opacity-0 transition-opacity duration-fast ease-out-quart",
						"group-hover/sidebar:pointer-events-auto group-hover/sidebar:opacity-100",
						"group-focus-within/sidebar:pointer-events-auto group-focus-within/sidebar:opacity-100",
					),
			)}
		>
			<Tooltip content={toggleLabel} side="right">
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={onCollapse}
					aria-label={toggleLabel}
					aria-expanded={mode === "overlay" ? undefined : expanded}
					aria-keyshortcuts={sidebarToggleCap(isMac)}
				>
					<ToggleGlyph aria-hidden="true" />
				</Button>
			</Tooltip>
		</div>
	);

	/*
	 * The two affordances Settings keeps, and the reason it left the destination
	 * group: it is a route the user visits once and then returns from, so a
	 * permanent row spent a destination's width on it while the account row in
	 * the same foot already opens onto the same place. The gear is the one press;
	 * the account menu is the one that also carries Sign out. The tour's
	 * `navigate-settings` step attaches to this button, which is why it carries
	 * the tag rather than the menu item.
	 */
	const settingsGear = (
		<Tooltip content="Settings" side="top">
			<button
				type="button"
				data-tour-tag="nav-item-settings"
				onClick={() => navigate("/settings")}
				aria-current={currentView === "settings" ? "page" : undefined}
				aria-label="Settings"
				className={cn(
					"flex size-8 shrink-0 items-center justify-center rounded-sm text-ink-muted",
					"transition-colors duration-fast ease-out-quart",
					"hover:bg-row-hover hover:text-ink",
					currentView === "settings" && "text-ink",
				)}
			>
				<Settings size={16} aria-hidden="true" />
			</button>
		</Tooltip>
	);

	if (!expanded) {
		/*
		 * The 56px strip. 48 would be the VS Code activity bar's width and what the
		 * old rail collapsed to; 56 is 48 plus 8, so a 16px glyph keeps an 8px step
		 * on each side and a 28px hit target fits.
		 *
		 * THE LIST IS NOT DRAWN HERE. A 56px column cannot show a conversation
		 * title. The strip is: the brand, then the first group - expand, New chat,
		 * Search (§J2; design round 1, D11: it used to hold no New chat and no
		 * visible expand, so a narrow window reached New chat by ⌘N alone) - then
		 * the destinations, then the foot.
		 */
		return (
			<div
				data-sidebar-strip=""
				className="group/sidebar flex h-full min-h-0 flex-col items-center bg-surface"
			>
				<div className="flex h-10 shrink-0 items-center justify-center">
					<CollapsibleAppLogo expanded={false} />
				</div>
				<ul className="flex flex-col items-center gap-1">
					<li>
						{stripButton(ChevronRight, toggleLabel, {
							onClick: onCollapse,
							attrs: {
								"aria-expanded": false,
								"aria-keyshortcuts": sidebarToggleCap(isMac),
							},
						})}
					</li>
					<li>
						{stripButton(MessageSquarePlus, newChatLabel, {
							onClick: stageNewChat,
							disabled: !catalogueReady,
							attrs: { "data-tour-tag": "nav-item-chat" },
						})}
					</li>
					<li>
						{stripButton(Search, searchLabel, {
							onClick: openCommandPalette,
							attrs: { "data-command-palette-trigger": "" },
						})}
					</li>
				</ul>
				<ul className="mt-4 flex flex-col items-center gap-1">
					{navItems.map(renderNavRow)}
				</ul>
				<div className="mt-auto flex flex-col items-center gap-1 pb-2">
					{settingsGear}
					<UserProfileSidebar expanded={false} />
				</div>
			</div>
		);
	}

	/*
	 * `group/sidebar`, NAMED, and that is a fix rather than a style. Tailwind's
	 * bare `group-hover:` matches ANY hovered ancestor `.group`, and since the
	 * merge this column is an ancestor of every conversation row, whose own
	 * `group` reveals its Pin and Archive acts - so an unnamed group here revealed
	 * the acts on EVERY row whenever the pointer was anywhere in the sidebar.
	 */
	return (
		/*
		 * `overflow-hidden`, NOT `overflow-x-hidden`, and the difference is a
		 * scrollbar the operator caught in a screenshot: setting ONE axis of
		 * `overflow` turns the other axis from `visible` into `auto` (CSS 2.1
		 * §11.1.1), so `overflow-x-hidden` alone made THIS div a vertical scroller -
		 * a third scrollbar on the column, wrapping the two the sections below the
		 * boundary carry, with a wheel event having no unambiguous target and the
		 * brand row, `New chat` and the destinations able to be scrolled away from
		 * under the pointer. The column never scrolls: the two panes below the
		 * boundary each scroll themselves, and anything that would not fit here is
		 * clipped rather than scrolled.
		 *
		 * `data-sidebar-shell` is the handle the driver's `sidebar-sections` scene
		 * measures this contract on (`scrollHeight === clientHeight`, and a wheel
		 * over either pane leaving the chrome where it was).
		 */
		<div
			data-sidebar-shell=""
			className="group/sidebar flex h-full min-h-0 flex-col overflow-hidden bg-surface"
		>
			{/*
			 * The brand row, 40px, square with the top row beside it.
			 *
			 * 40 is the app's existing toolbar step (the chat header, every pane
			 * toolbar, this row) and it is what puts the brand and the conversation
			 * title on ONE line once the chrome lane is shell-level. `pl-4`: the
			 * column's 8px inset plus a row's 8px padding puts every row's mark 16px
			 * from this column's edge, and the logo starts on that same line.
			 */}
			<div className="flex h-10 shrink-0 items-center gap-1 pr-2 pl-4">
				<CollapsibleAppLogo expanded />
				<span className="ml-auto">{collapseToggle}</span>
			</div>

			{/*
			 * §C1.2 then §C1.3: the two primary rows 8px apart, then the destinations
			 * group. `pb-2` is the group's bottom step; the body below adds the rest of
			 * §B6's 16px between the destinations and the list's first label.
			 */}
			<div className="flex shrink-0 flex-col gap-2 px-2 pb-2">
				<div className="flex flex-col gap-0.5">
					{newChatRow}
					{searchRowExpanded}
				</div>
				{/*
				 * THE DESTINATIONS GROUP, four 30px rows: the same routes in the same
				 * order the old rail carried, minus Chat (which is the list itself) and
				 * minus Settings (which the foot owns).
				 */}
				<ul className="flex flex-col gap-0.5">{navItems.map(renderNavRow)}</ul>
			</div>

			{/*
			 * THE BODY: the one chat list, one scroll region. `mt-2` completes the 16px
			 * section tier with the group's own `pb-2` - the separation is space, not a
			 * rule.
			 */}
			<div className="mt-2 flex min-h-0 flex-1 flex-col">{listBody}</div>

			{/*
			 * THE FOOT: the account row, whose own menu carries Settings and Sign
			 * out, and the gear that goes straight to Settings.
			 *
			 * `pb-2` is the column's own bottom pad, and it is the same step the
			 * strip's foot carries - the operator's report of 2026-09-26 was that
			 * this row sat flush against the window's bottom edge with "no
			 * padding against the bottom of the screen". `min-h-10` keeps the
			 * foot at its 40px row height and lets the padding extend the box to
			 * 48, so the row is not squeezed (a fixed `h-10` with `pb-2` would
			 * leave a 32px content box and a 40px row overflowing it).
			 */}
			<div className="flex min-h-10 shrink-0 items-center justify-between gap-1 px-2 pb-2">
				<UserProfileSidebar expanded />
				{settingsGear}
			</div>
		</div>
	);
};

export type { SidebarNavigationProps };
