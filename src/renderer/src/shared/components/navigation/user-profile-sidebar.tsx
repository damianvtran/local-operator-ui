import {
	Avatar,
	AvatarFallback,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	Tooltip,
} from "@shared/components/ui";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { LogOut, Settings, Shield, User } from "lucide-react";
import { useCallback, useMemo } from "react";
import React, { type FC } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Props for the UserProfileSidebar component
 */
type UserProfileSidebarProps = {
	/** Whether the sidebar is expanded or collapsed */
	expanded: boolean;
	/** Whether to display authentication-related menu items (default: false) */
	useAuth?: boolean;
};

/**
 * The account row at the foot of the sidebar: avatar alone when collapsed,
 * avatar plus name and email when expanded.
 *
 * ## One button, two behaviours
 *
 * With `useAuth` the row opens an account menu; without it, it navigates
 * straight to settings. Both branches render the same `<button>`, and the menu
 * branch reaches it through `DropdownMenuTrigger asChild` rather than letting
 * the trigger render its own button. That keeps the settings branch free of the
 * menu semantics (`aria-haspopup`, `aria-expanded`) it would otherwise
 * advertise without having a menu.
 *
 * When collapsed the row has no visible label, so it gets a tooltip. Both
 * triggers compose onto the single button via `asChild`, which is why the
 * tooltip wraps the menu trigger rather than the other way round.
 *
 * ## Removed rather than translated
 *
 * The old menu carried a lot that was not information: a light/dark
 * `linear-gradient` overlay on the panel, a rotated 10px pseudo-element arrow,
 * `theme.shadows[3]` on top of the system's single overlay shadow, and
 * `transform: translateX(5px)` on every item hover. The sign-out item was
 * `alpha("#ff6b6b", 0.9)` — a hardcoded red belonging to no theme; it is now
 * `text-danger`, the role that exists for exactly this.
 */
export const UserProfileSidebar: FC<UserProfileSidebarProps> = React.memo(
	({ expanded, useAuth = false }) => {
		const navigate = useNavigate();

		const { user, isAuthenticated, signOut } = useRadientAuth();
		const userName = user?.name ?? "User";
		const userEmail = user?.email ?? "";

		const handleSignOut = useCallback(async () => {
			if (isAuthenticated) {
				await signOut();
				/*
				 * A full reload rather than a state reset: auth state is spread
				 * across the query cache, the token refresher and the Radient
				 * provider, and reloading is the only way to be certain none of it
				 * survives the sign-out.
				 */
				window.location.reload();
			}
		}, [isAuthenticated, signOut]);

		const userInitials = useMemo(() => {
			if (!userName) return null;

			return userName
				.split(" ")
				.map((part) => part.charAt(0))
				.join("")
				.toUpperCase()
				.substring(0, 2);
		}, [userName]);

		const row = (
			<button
				type="button"
				onClick={useAuth ? undefined : () => navigate("/settings")}
				className="mx-2 flex items-center gap-3 rounded-sm px-3 py-1 transition-colors duration-fast ease-out-quart hover:bg-elevated"
			>
				<Avatar className="size-7">
					<AvatarFallback className="bg-accent text-on-accent">
						{userInitials ?? <User size={14} aria-hidden="true" />}
					</AvatarFallback>
				</Avatar>
				{expanded && userName && (
					<span className="min-w-0 text-left">
						<span className="block truncate text-body text-ink">
							{userName}
						</span>
						{userEmail && (
							<span className="block truncate text-meta text-ink-dim">
								{userEmail}
							</span>
						)}
					</span>
				)}
			</button>
		);

		/* Collapsed, the avatar is the whole row and nothing on screen names it. */
		const labelled = expanded ? (
			row
		) : (
			<Tooltip content="Account settings" side="right">
				{row}
			</Tooltip>
		);

		if (!useAuth) return labelled;

		/*
		 * The trigger reaches the button through `asChild` in both branches so
		 * the menu and the tooltip anchor to the same real element. The order
		 * matters: `TooltipTrigger asChild` may wrap `DropdownMenuTrigger`,
		 * because both forward refs down the chain, but the reverse would ask
		 * the menu to clone a composite component that does not forward a ref,
		 * and the trigger would silently lose its anchor.
		 */
		return (
			<DropdownMenu>
				{expanded ? (
					<DropdownMenuTrigger asChild>{row}</DropdownMenuTrigger>
				) : (
					<Tooltip content="Account settings" side="right">
						<DropdownMenuTrigger asChild>{row}</DropdownMenuTrigger>
					</Tooltip>
				)}
				<DropdownMenuContent align="end" side="top" className="min-w-50">
					<DropdownMenuItem onSelect={() => navigate("/settings")}>
						<Settings size={16} aria-hidden="true" />
						Settings
					</DropdownMenuItem>
					<DropdownMenuItem>
						<Shield size={16} aria-hidden="true" />
						Privacy and security
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						onSelect={handleSignOut}
						className="text-danger focus:bg-danger-wash focus:text-danger"
					>
						<LogOut size={16} aria-hidden="true" />
						Sign out
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		);
	},
);

UserProfileSidebar.displayName = "UserProfileSidebar";
