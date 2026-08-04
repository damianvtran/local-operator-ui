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
 * border. Both are gone: `bg-surface` against the route's `bg-canvas` already
 * separates the two grounds, so the border carried no information, and a shadow
 * on an in-flow panel is exactly what the branding contract reserves for
 * objects that leave the flow.
 */
const RAIL_WIDTH = { expanded: "w-55", collapsed: "w-17" } as const;

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
				className={cn(
					"flex min-h-9 w-full items-center rounded-sm px-3 py-1 text-body transition-colors duration-fast ease-out-quart",
					expanded ? "justify-start gap-3" : "justify-center",
					item.isActive
						? "bg-accent-wash text-accent"
						: "text-ink-muted hover:bg-elevated hover:text-ink",
				)}
			>
				<item.icon size={18} strokeWidth={1.5} aria-hidden="true" />
				{expanded && <span className="truncate">{item.label}</span>}
			</button>
		);

		/* Collapsed, the icon is unlabelled, so the tooltip is the only name. */
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

	return (
		<nav
			className={cn(
				"flex shrink-0 flex-col justify-between overflow-x-hidden bg-surface transition-[width] duration-base ease-out-quart",
				expanded ? RAIL_WIDTH.expanded : RAIL_WIDTH.collapsed,
			)}
		>
			<div>
				<div className="flex items-center justify-center py-4">
					<CollapsibleAppLogo expanded={expanded} />
				</div>

				<ul className="flex flex-col gap-1 p-2">
					{navItems.map(renderNavItem)}
				</ul>
			</div>

			<div className="flex flex-col pb-4">
				<UserProfileSidebar expanded={expanded} />

				{/*
				 * The rule between the account row and the collapse control is the
				 * one border kept in this file: without it the toggle reads as a
				 * sixth nav item rather than as chrome belonging to the rail.
				 */}
				<div
					className={cn(
						"mt-2 flex items-center border-hairline border-t pt-2",
						expanded ? "justify-end pr-4" : "justify-center",
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
			</div>
		</nav>
	);
};
