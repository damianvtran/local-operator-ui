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
import { openConversation } from "@features/chat/open-conversation";
import { hideRegion, regionVisibility } from "@features/chat/sidebar-split";
import {
	paletteShortcutCaps,
	paletteShortcutLabel,
} from "@features/command-palette/palette-shortcut";
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
	Search,
	Settings,
	Store,
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
 * foot. The list is the body rather than a second column, so the agents tree
 * that used to sit above it has moved behind the `Agents` destination's own
 * disclosure (collapsed by default, and the state it writes is the one the list
 * itself reads), and a 56px icon strip is what the column collapses to.
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
	const { expanded, onCollapse } = useSidebarFrame();
	const openCommandPalette = useUiPreferencesStore(
		(state) => state.openCommandPalette,
	);
	/*
	 * The agents tree's disclosure, and it writes the SAME preference the list
	 * reads for its own two regions rather than a second flag beside it: the list
	 * renders the entities region when this says so and a restore row when it
	 * does not, so one stored value drives both and the two cannot disagree. The
	 * default is "chats" - the disclosure starts closed - which is what stops the
	 * agents tree from pushing the chat list below the fold.
	 */
	const regions = useUiPreferencesStore((state) => state.chatSidebarRegions);
	const setRegions = useUiPreferencesStore(
		(state) => state.setChatSidebarRegions,
	);
	const entitiesOpen = regionVisibility(regions).entityVisible;
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
		const disclosure = item.path === "/agents";
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
		/*
		 * THE ROW IS TWO CONTROLS, not one, and that is why the state is painted on
		 * the `<li>` rather than on the button. `Agents` navigates AND discloses, and
		 * a button inside a button is invalid HTML that no browser will deliver a
		 * press to - so the destination is one button and the chevron is a second,
		 * side by side in a box that carries the row's hover and current ground for
		 * both. A single button that did both would leave the user's press ambiguous
		 * between two different outcomes, only one of which they can undo.
		 */
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
				{disclosure && expanded && (
					<button
						type="button"
						onClick={() =>
							setRegions(
								entitiesOpen ? hideRegion(regions, "entities") : "both",
							)
						}
						aria-expanded={entitiesOpen}
						aria-label={
							entitiesOpen ? "Hide the agent list" : "Show the agent list"
						}
						className={cn(
							"mr-1 flex size-6 shrink-0 items-center justify-center rounded-sm text-ink-dim",
							"transition-colors duration-fast ease-out-quart",
							"hover:bg-row-hover hover:text-ink",
						)}
					>
						<ChevronRight
							size={14}
							aria-hidden="true"
							className={cn(
								"transition-transform duration-fast ease-out-quart",
								entitiesOpen && "rotate-90",
							)}
						/>
					</button>
				)}
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

	const toggleLabel = expanded ? "Collapse sidebar" : "Expand sidebar";
	const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;

	/*
	 * THE PRIMARY ACTION, and the one row of it: Search.
	 *
	 * Search was at the foot of the old rail, beside the account, because the
	 * list above it was DESTINATIONS and every row in it lit up with
	 * `aria-current` - and Search is not a place. That argument still holds,
	 * which is why it is not in the destinations group below; what changed is
	 * that the column now has a group for CONTROLS at its top, where the
	 * reference products put theirs, so the palette's door is one press from the
	 * column's first row instead of its last.
	 *
	 * NEW CHAT IS NOT DUPLICATED HERE. The spec's primary-actions group names two
	 * rows, and the second one already exists one row below this group: the
	 * list's own `New chat` row, whose exact class expression is pinned by
	 * `scripts/new-chat-row.test.mjs` against the `All chats` row directly above
	 * it and whose placement under those two rows is an arbitrated design
	 * decision (D1 of `docs/design/sidebar-row-space.md`). A second copy in this
	 * group would put two New chat rows in one 260px column, a hundred pixels
	 * apart, and taking the list's away is a change inside that region's measured
	 * header - which is the list's own commit, not this layout one. What this
	 * commit owes it is the tour's anchor: the row carries
	 * `data-tour-tag="nav-item-chat"` now (see `chat-sidebar.tsx`), so the
	 * onboarding step that clicks its way back to chat still finds a control.
	 *
	 * ## Why a visible chord
	 *
	 * The gesture is what makes this surface fast, and a user who never learns it
	 * uses the palette once. The chord is written on the row (the app's key cap,
	 * the same one the palette's own footer prints) rather than in a tooltip, so
	 * the column teaches Cmd+K without being asked. The cap is FILL-LESS by its
	 * own construction (`keyboard-shortcut.tsx`, `CAP` - no fill, no border), so
	 * it needs no ground of its own and reads the same here as in the palette.
	 *
	 * The macOS spelling rides a real platform check rather than a guess: off
	 * macOS the same row reads Ctrl+K.
	 */
	const searchLabel = `Search (${paletteShortcutLabel(isMac)})`;

	const searchRow = expanded ? (
		<button
			type="button"
			data-command-palette-trigger=""
			onClick={openCommandPalette}
			aria-label={searchLabel}
			className={cn(
				DESTINATION_ROW,
				"text-ink-muted hover:bg-row-hover hover:text-ink",
			)}
		>
			<Search size={16} aria-hidden="true" className="shrink-0" />
			<span className="truncate">Search</span>
			{/*
			 * Decorative: the accessible name above already carries the chord, so the
			 * caps are hidden from a screen reader rather than announced beside it.
			 */}
			<span aria-hidden="true" className="ml-auto">
				<KeyboardShortcut shortcut={paletteShortcutCaps(isMac)} />
			</span>
		</button>
	) : (
		<Tooltip content={searchLabel} side="right">
			<button
				type="button"
				data-command-palette-trigger=""
				onClick={openCommandPalette}
				aria-label={searchLabel}
				className={cn(
					"flex size-8 items-center justify-center rounded-sm text-ink-muted",
					"transition-colors duration-fast ease-out-quart",
					"hover:bg-row-hover hover:text-ink",
				)}
			>
				<Search size={16} aria-hidden="true" />
			</button>
		</Tooltip>
	);

	/*
	 * The collapse control lives in the brand row, revealed when the column is
	 * pointed at or contains focus.
	 *
	 * It used to have a full-width row of its own at the foot of the rail, above
	 * a hairline drawn only so the chevron would not read as a sixth destination
	 * - about 40px of permanent chrome and one border, to hold a control that is
	 * used a few times a week. Linear, Notion and Slack all put it in the header
	 * and all reveal it on hover; collapsed, it takes the logo's place, because a
	 * 56px strip has room for exactly one thing.
	 *
	 * `pointer-events-none` gates the mouse only. Focus is unaffected by it, so
	 * the button keeps its place in the tab order and reveals itself with
	 * `group-focus-within` when a keyboard reaches it.
	 *
	 * `aria-keyshortcuts` names the chord the shell answers (`chat-layout.tsx`):
	 * this control and that handler are the two halves of one gesture, and the
	 * cap is built from the same `sidebarToggleCap` the shell's divider label
	 * prints.
	 */
	const collapseToggle = (
		<div
			className={cn(
				"pointer-events-none opacity-0 transition-opacity duration-fast ease-out-quart",
				"group-hover:pointer-events-auto group-hover:opacity-100",
				"group-focus-within:pointer-events-auto group-focus-within:opacity-100",
			)}
		>
			<Tooltip content={toggleLabel} side="right">
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={onCollapse}
					aria-label={toggleLabel}
					aria-expanded={expanded}
					aria-keyshortcuts={sidebarToggleCap(isMac)}
				>
					{expanded ? (
						<ChevronLeft aria-hidden="true" />
					) : (
						<ChevronRight aria-hidden="true" />
					)}
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
		 * title, and a strip that scrolled would be a list nobody could read. The
		 * strip is the destinations plus the two ways back to the rest of it: the
		 * expand control in the brand slot, and the shell's own ⌘B.
		 */
		return (
			<div
				data-sidebar-strip=""
				className={cn(
					"group flex h-full min-h-0 flex-col items-center bg-surface py-2",
				)}
			>
				<div className="relative flex size-8 items-center justify-center">
					<div className="transition-opacity duration-fast ease-out-quart group-hover:opacity-0 group-focus-within:opacity-0">
						<CollapsibleAppLogo expanded={false} />
					</div>
					<div className="absolute inset-0 flex items-center justify-center">
						{collapseToggle}
					</div>
				</div>
				<ul className="mt-2 flex flex-col items-center gap-1">
					<li>{searchRow}</li>
					{navItems.map(renderNavRow)}
				</ul>
				<div className="mt-auto flex flex-col items-center gap-1">
					{settingsGear}
					<UserProfileSidebar expanded={false} />
				</div>
			</div>
		);
	}

	return (
		<div className="group flex h-full min-h-0 flex-col overflow-x-hidden bg-surface">
			{/*
			 * The brand row, 40px, square with the top row beside it.
			 *
			 * 40 is the app's existing toolbar step (the chat header, every pane
			 * toolbar, this row) and it is what puts the brand and the conversation
			 * title on ONE line once the chrome lane is shell-level. `pl-4`: the
			 * list's 8px inset plus a row's 8px padding puts every row's mark 16px
			 * from this column's edge, and the logo starts on that same line or the
			 * column reads as two that nearly agree.
			 */}
			<div className="flex h-10 shrink-0 items-center gap-1 pr-2 pl-4">
				<CollapsibleAppLogo expanded />
				<span className="ml-auto">{collapseToggle}</span>
			</div>

			<div className="flex shrink-0 flex-col gap-2 px-2 pb-2">
				{searchRow}
				{/*
				 * THE DESTINATIONS GROUP, four 30px rows: the same routes in the same
				 * order the old rail carried, minus Chat (which is the list itself, one
				 * group below) and minus Settings (which the foot owns).
				 */}
				<ul className="flex flex-col gap-0.5">{navItems.map(renderNavRow)}</ul>
			</div>

			{/*
			 * THE BODY. `mt-3` is the 16px section tier the spec asks for between the
			 * destinations and the list's first label, less the group's own 8px of
			 * bottom padding - the separation is space, not a rule.
			 */}
			<div className="mt-3 flex min-h-0 flex-1 flex-col">{listBody}</div>

			{/*
			 * THE FOOT, 40px: the account row, whose own menu carries Settings and
			 * Sign out, and the gear that goes straight to Settings.
			 * `justify-between` rather than `ml-auto` on the gear so the two stay
			 * apart when the column is dragged to its 220px floor.
			 */}
			<div className="flex h-10 shrink-0 items-center justify-between gap-1 px-2">
				<UserProfileSidebar expanded />
				{settingsGear}
			</div>
		</div>
	);
};

export type { SidebarNavigationProps };
