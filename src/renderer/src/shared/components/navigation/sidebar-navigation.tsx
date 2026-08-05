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
	MessageSquare,
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
 * ## Why the rail is `sunken` and not `surface`
 *
 * It was `surface` — a step *above* the `canvas` page — which is backwards for
 * a permanent rail and produced a visible defect: on the agents and settings
 * routes this rail sits directly against another `surface` list panel with no
 * boundary between them, so the two merged into one 480px slab and the app
 * looked like it had one enormous sidebar.
 *
 * On `sunken` the app reads as three planes left to right, which is the depth
 * model the theme picker's own preview has always advertised and the one every
 * three-pane desktop app uses (1Password, Slack, Linear, Mail):
 *
 *   sunken app rail  ->  surface list panel  ->  canvas working surface
 *
 * permanent chrome recedes, the secondary list sits between, and the thing you
 * are working on comes forward. No border is needed to separate any of them.
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
					 * The wash is the state and the mark is the accent; the label
					 * stays `ink`. Tinting ground, mark and text is three signals for
					 * one fact, and it leaves the destination you are already on as
					 * the loudest text on the rail.
					 */
					item.isActive
						? "bg-accent-wash font-medium text-ink"
						: "text-ink-muted hover:bg-elevated hover:text-ink",
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
						<ChevronLeft size={16} aria-hidden="true" />
					) : (
						<ChevronRight size={16} aria-hidden="true" />
					)}
				</Button>
			</Tooltip>
		</div>
	);

	return (
		<nav
			className={cn(
				"group flex shrink-0 flex-col overflow-x-hidden bg-sunken transition-[width] duration-base ease-out-quart",
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

			{/* `mt-auto` rather than `justify-between` on the nav: the account row
			    is the only thing at the foot now, and space is what separates it
			    from the list — the hairline it used to need went with the toggle. */}
			<div className="mt-auto p-2">
				<UserProfileSidebar expanded={expanded} />
			</div>
		</nav>
	);
};
