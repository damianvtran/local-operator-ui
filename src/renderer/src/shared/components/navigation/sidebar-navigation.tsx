// One decision, one spelling: the row the reader is ON is painted by the
// sidebar's own role string rather than by a second copy of it here. A copy is
// what drifted twice (design rounds 3 and 4, D17/D19) and both drifts landed at
// an ELEMENT while the copied string above it stayed verbatim — so this rail
// imports the role exactly as the settings rail does.
import { rowCurrent } from "@features/chat/components/chat-sidebar";
import {
	paletteShortcutCaps,
	paletteShortcutLabel,
} from "@features/command-palette/palette-shortcut";
import { KeyboardShortcut } from "@shared/components/common/keyboard-shortcut";
import { CollapsibleAppLogo } from "@shared/components/navigation/collapsible-app-logo";
import { UserProfileSidebar } from "@shared/components/navigation/user-profile-sidebar";
import { Button, Tooltip } from "@shared/components/ui";
import { useCurrentView } from "@shared/hooks/use-route-params";
import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { LucideIcon } from "lucide-react";
import {
	Bot,
	CalendarDays,
	ChevronLeft,
	ChevronRight,
	Globe,
	MessageSquare,
	Search,
	Settings,
	Store,
} from "lucide-react";
import type { FC } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Props for the SidebarNavigation component
 * No props needed as we use React Router hooks internally
 */
type SidebarNavigationProps = Record<string, never>;

type NavItem = {
	icon: LucideIcon;
	label: string;
	path: string;
	isActive: boolean;
	tourTag: string;
};

/*
 * The sidebar was a permanent MUI `Drawer`, which is a flex child with a fixed
 * width and nothing modal about it — so it is now a plain `<nav>`, not a
 * `Sheet`. `Sheet` is for a panel that leaves the flow and takes a scrim with
 * it, and this one does neither.
 *
 * The old paper carried `boxShadow: 0 4px 20px rgba(0,0,0,0.2)` and a 1px right
 * border. Both are gone: elevation in this system is a ground step, and a
 * shadow on an in-flow panel is exactly what the branding contract reserves for
 * objects that leave the flow.
 *
 * ## Why the rail is `surface`, and what bounds it
 *
 * HISTORY, because the first half of this was a real fix and its finding still
 * holds. The rail was `surface` — a step *above* the `canvas` page — which is
 * backwards for a permanent rail and produced a visible defect: on the agents
 * and settings routes this rail sits directly against another `surface` list
 * panel with no boundary between them, so the two merged into one 480px slab
 * and the app looked like it had one enormous sidebar. It was moved to `sunken`
 * for that reason, and on `sunken` the app read as three planes left to right:
 *
 *   sunken app rail  ->  surface list panel  ->  canvas working surface
 *
 * THE ROW-STATE REFINEMENT PUT IT BACK, because `sunken` broke something this
 * rail owns. THE ROWS IN THIS LIST ARE ROW STATES: the destination you are on
 * carries `rowCurrent` and the rows around it take `hover:bg-row-hover`, and
 * both roles are authored as a step of the palette's own `surface`
 * (`docs/design/row-states-refinement.md` § 4). A rail whose ground is a rung
 * *below* `surface` therefore paints those states INTO that rung rather than
 * out of the panel they were authored against, and the panel is the reference
 * both roles are measured from. MEASURED, on the fleet: the current row's fill
 * landed **ΔE00 0.44** off this rail on `alucard` — 7 of the 59 palettes under
 * the file's own 2.0 field floor — and on 13 of the 59 the row under the
 * pointer read at least as far off this rail as the row the reader is ON, where
 * the shipped values did that on 2. That is the defect recorded in the
 * row-state block below, reintroduced by the ground rather than by the mark,
 * and the operator's original screenshot is the same sentence.
 *
 * So the rule is now the one the direction states, and it is an invariant the
 * app holds rather than a value a palette can be re-solved for: **a surface
 * that paints the row states wears `surface`**. Re-asserting the roles against
 * `sunken` was measured and refused — on the light fleet the largest ink-legal
 * fill can reach ΔE00 1.73-2.81 against `canvas` and clearing `sunken` forces
 * `alucard`'s selection down to a 2.36 `L*` step, under the pair's own floors.
 *
 * The boundary the tonal step used to carry is DRAWN instead — `border-r
 * border-hairline`, the same construction the agents panel beside it uses
 * (`features/agents/components/agents-sidebar.tsx`), so a rail that is `surface`
 * and a list that is `surface` are two panels rather than one slab. The rule is
 * doing real work on the light fleet, where `surface` and `canvas` are closest:
 * this rail's pair with the content beside it measures ΔE00 2.32 on
 * `localOperatorLight` and 2.60 on `alucard` — the two tightest of the four rail
 * palettes the evidence set renders, though NOT the fleet's tightest pairs
 * (`sage` 2.05, `catppuccinMacchiato` 2.08 and `oneLight` 2.10 are, and none of
 * the three carries a rail frame) — and on those it is the only boundary there is.
 *
 * The chat route is the same rule one plane to the right: its list panel is
 * `surface` and the column it opens is `canvas`, so the pair never repeats the
 * merge described above — and neither of those two columns paints a row state,
 * which is why neither of them has to be `surface`.
 *
 * ## Density
 *
 * 220px expanded, 48px collapsed. 48 is the VS Code activity-bar width and it
 * is what a 32px square button plus the list's own 8px inset comes to — the
 * previous 68px was a 36px button floating in 32px of air, which read as an
 * unfinished panel rather than as an icon rail.
 *
 * Rows are 32px with 16px marks and 13px labels, matching the settings rail
 * exactly. The two are visible in the same viewport, so anything they disagree
 * about reads as a mistake.
 *
 * ## Why the expanded width does NOT shrink on a narrow window
 *
 * On the settings screen this rail and the settings jump list are both on
 * screen, and at 220px each they took roughly half a 900px window before any
 * setting was drawn. The settings rail is what gives: below 1040px it becomes
 * a 48px icon rail, which takes a 900px window from 49% chrome to 30%.
 *
 * This rail was narrowed to 180px alongside it and the change was reverted,
 * because 180 clips the wordmark: "Local Operator" measures 100px and the
 * header leaves it 92px once the 20px inset that aligns the mark with the nav
 * marks, the 8px right padding and the 32px collapse control are taken out.
 * The first width that clears it with any margin is 200px, and 20px of content
 * is not worth putting the product's own name 12px from an ellipsis on the one
 * piece of chrome that is on screen everywhere. Global navigation is also the
 * wrong thing to shrink first: the user can already collapse this rail to 48px
 * and that choice is remembered.
 */
const RAIL_WIDTH = { expanded: "w-55", collapsed: "w-12" } as const;

export const SidebarNavigation: FC<SidebarNavigationProps> = () => {
	const navigate = useNavigate();
	const currentView = useCurrentView();
	const { isSidebarCollapsed, toggleSidebar } = useUiPreferencesStore();
	const openCommandPalette = useUiPreferencesStore(
		(state) => state.openCommandPalette,
	);

	const expanded = !isSidebarCollapsed;

	const navItems: NavItem[] = [
		{
			icon: MessageSquare,
			label: "Chat",
			path: "/chat",
			isActive: currentView === "chat",
			tourTag: "nav-item-chat",
		},
		{
			icon: Bot,
			label: "My agents",
			path: "/agents",
			isActive: currentView === "agents",
			tourTag: "nav-item-agents",
		},
		{
			icon: Store,
			label: "Agent hub",
			path: "/agent-hub",
			isActive: currentView === "agent-hub",
			tourTag: "nav-item-agent-hub",
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
		},
		{
			icon: Settings,
			label: "Settings",
			path: "/settings",
			isActive: currentView === "settings",
			tourTag: "nav-item-settings",
		},
	];

	const renderNavItem = (item: NavItem) => {
		/*
		 * The tour clicks these by `[data-tour-tag="nav-item-chat"]`, so the tag
		 * has to stay on the button itself. Putting it on a wrapper would leave
		 * the tour dispatching a click at a div and silently doing nothing.
		 */
		const button = (
			<button
				type="button"
				onClick={() => navigate(item.path)}
				data-tour-tag={item.tourTag}
				aria-current={item.isActive ? "page" : undefined}
				/* Collapsed there is no text in the row, and the tooltip cannot
				   supply the name: Radix's `Trigger` adds `aria-describedby`, and
				   only while open. */
				aria-label={expanded ? undefined : item.label}
				className={cn(
					"flex h-8 w-full items-center rounded-sm text-body-sm transition-colors duration-fast ease-out-quart",
					expanded ? "justify-start gap-2 px-3" : "justify-center",
					/*
					 * THE DESTINATION YOU ARE ON IS A ROW STATE, not the wash. It was
					 * `bg-accent-wash`, and on 6 of the 41 dark themes the wash is a
					 * WEAKER mark than the hover beside it — `obsidian` 2.02 against
					 * 3.42 is this rail, in the screenshot the operator reported — so
					 * the row he was on was quieter than the row he was merely pointing
					 * at. `rowCurrent` brings the role's ground and its `font-medium`
					 * (the 2px accent bar was removed with the refinement round — the
					 * fill carries the ranking now); the wash stays the transient idiom
					 * (pointer hover, and a keyboard-focused option in a list that is
					 * open).
					 *
					 * THIS ROW IS WHY THE RAIL IS `surface`, and the ground note above
					 * is the measurement: the roles are steps of the panel, so the panel
					 * they are painted on has to BE the panel. The first round of this
					 * branch painted this row on the rail's own `sunken` and the fill
					 * landed ΔE00 0.44 from its backdrop on `alucard`.
					 *
					 * The mark is still the accent, and the label still stays `ink`:
					 * tinting ground, mark and text is three signals for one fact, and
					 * it leaves the destination you are already on as the loudest text
					 * on the rail.
					 */
					item.isActive
						? rowCurrent
						: "text-ink-muted hover:bg-row-hover hover:text-ink",
				)}
			>
				<item.icon
					size={16}
					aria-hidden="true"
					className={cn("shrink-0", item.isActive && "text-accent")}
				/>
				{expanded && <span className="truncate">{item.label}</span>}
			</button>
		);

		/* Collapsed, the tooltip is the only name the row shows on screen; the
		   accessible name is the button's own `aria-label`. */
		return expanded ? (
			<li key={item.path}>{button}</li>
		) : (
			<li key={item.path}>
				<Tooltip content={item.label} side="right">
					{button}
				</Tooltip>
			</li>
		);
	};

	const toggleLabel = expanded ? "Collapse sidebar" : "Expand sidebar";

	/*
	 * The palette's own door, at the foot of the rail above the account row.
	 *
	 * ## Why the foot and not the head of the list
	 *
	 * The list above it is DESTINATIONS, and every row in it is one — the active
	 * row carries `aria-current="page"` and the accent wash that says "you are
	 * here". Search is not a place, so putting it in that list would have made it
	 * a seventh tab that lights up when nothing is selected, and would have pushed
	 * Chat out of the first position it holds as the app's default view. At the
	 * foot it sits beside the one other control the rail carries, on the same 32px
	 * row and the same 8px inset, so the rail still reads as two groups: where you
	 * can go, and what you can do.
	 *
	 * ## Why a visible chord
	 *
	 * The gesture is what makes this surface fast, and a user who never learns it
	 * uses the palette once. The chord is written on the row (the app's key cap, the
	 * same one the palette's own footer prints) rather than in a tooltip, so the rail
	 * teaches Cmd+K without being asked. It used to be plain monospace HERE and caps
	 * there, on the argument that a cap is `bg-sunken` while this rail was `sunken`
	 * too, so the cap would be a key with no key around it — true of that cap, and
	 * the reason the cap lost its fill rather than keeping two spellings of one
	 * thing (`docs/command-palette.md` records the single idiom). The rail's ground
	 * moved to `surface` with the row-state refinement and the argument does not
	 * come back: the cap is FILL-LESS by its own construction
	 * (`shared/components/common/keyboard-shortcut.tsx`, `CAP` — no fill, no
	 * border), so it needs no ground of its own on either one.
	 *
	 * The macOS spelling rides a real platform check rather than a guess: off
	 * macOS the same row reads Ctrl+K.
	 */
	const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
	const searchLabel = `Search (${paletteShortcutLabel(isMac)})`;

	const searchRow = expanded ? (
		<button
			type="button"
			data-command-palette-trigger=""
			onClick={openCommandPalette}
			className={cn(
				"flex h-8 w-full items-center gap-2 rounded-sm px-3 text-body-sm text-ink-muted",
				"transition-colors duration-fast ease-out-quart",
				"hover:bg-row-hover hover:text-ink",
			)}
		>
			<Search size={16} aria-hidden="true" className="shrink-0" />
			<span className="truncate">Search</span>
			{/*
			 * Decorative: the accessible name above already carries the chord, so the
			 * caps are hidden from a screen reader rather than announced beside it.
			 *
			 * The app's own key cap, on the rail's own ground — `surface` since the
			 * row-state refinement re-grounded the rail, `sunken` when this row was
			 * written. That is only possible because a cap has no fill of its own: the
			 * `bg-sunken` this component used to paint would vanish into this row
			 * exactly as the comment above says, which is why this row was monospace
			 * text for a round while the panel's footer drew caps. One idiom, one
			 * geometry, one ink — and the cap is still fill-less on the new ground
			 * rather than assumed to be, which the evidence README records as a DOM
			 * readback beside the rail's frames. The ink is a step up from the row's
			 * label, so the chord reads as a chord rather than as fine print (design
			 * round 1, D6).
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
					"flex h-8 w-full items-center justify-center rounded-sm text-ink-muted",
					"transition-colors duration-fast ease-out-quart",
					"hover:bg-row-hover hover:text-ink",
				)}
			>
				<Search size={16} aria-hidden="true" />
			</button>
		</Tooltip>
	);

	/*
	 * The collapse control lives in the header, revealed when the rail is
	 * pointed at or contains focus.
	 *
	 * It used to have a full-width row of its own at the foot of the rail, above
	 * a hairline drawn only so the chevron would not read as a sixth nav item —
	 * about 40px of permanent chrome and one border, to hold a control that is
	 * used a few times a week. Linear, Notion and Slack all put it in the header
	 * and all reveal it on hover; collapsed, it takes the logo's place, because
	 * a 48px rail has room for exactly one thing.
	 *
	 * `pointer-events-none` gates the mouse only. Focus is unaffected by it, so
	 * the button keeps its place in the tab order and reveals itself with
	 * `group-focus-within` when a keyboard reaches it — the same idiom the agent
	 * rows and the editable fields use.
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
					onClick={toggleSidebar}
					aria-label={toggleLabel}
					aria-expanded={expanded}
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

	return (
		<nav
			className={cn(
				/* `border-r border-hairline` carries the boundary the `sunken` step used
				   to: the rail and the list panel beside it are both `surface` now, and the
				   rule is the same construction `agents-sidebar.tsx` uses between two
				   `surface` panels. The ground note above says why the rail wears
				   `surface` at all (`rowCurrent` is painted on it). */
				"group flex shrink-0 flex-col overflow-x-hidden border-hairline border-r bg-surface transition-[width] duration-base ease-out-quart",
				expanded ? RAIL_WIDTH.expanded : RAIL_WIDTH.collapsed,
			)}
		>
			{/*
			 * A 48px header, square with the collapsed rail. `px-5` is not
			 * arbitrary: the list's 8px inset plus a row's 12px padding puts every
			 * nav mark 20px from the rail's edge, and the logo has to start on that
			 * same line or the rail reads as two columns that nearly agree.
			 */}
			<div
				className={cn(
					"flex h-12 shrink-0 items-center",
					expanded ? "justify-between pr-2 pl-5" : "justify-center",
				)}
			>
				{/* Collapsed, the mark and the expand control occupy one slot and
				    cross-fade; stacking them keeps the header from resizing. */}
				{expanded ? (
					<>
						<CollapsibleAppLogo expanded />
						{collapseToggle}
					</>
				) : (
					<div className="relative flex size-8 items-center justify-center">
						<div className="transition-opacity duration-fast ease-out-quart group-hover:opacity-0 group-focus-within:opacity-0">
							<CollapsibleAppLogo expanded={false} />
						</div>
						<div className="absolute inset-0 flex items-center justify-center">
							{collapseToggle}
						</div>
					</div>
				)}
			</div>

			<ul className="flex flex-col gap-1 p-2">{navItems.map(renderNavItem)}</ul>

			{/* `mt-auto` rather than `justify-between` on the nav: the account row is
			    the only thing at the foot now, and space is what separates it from the
			    list — the hairline it used to need went with the toggle. The search row
			    shares that foot, one gap above the account, because both are controls
			    rather than destinations. */}
			<div className="mt-auto flex flex-col gap-1 p-2">
				{searchRow}
				<UserProfileSidebar expanded={expanded} />
			</div>
		</nav>
	);
};
