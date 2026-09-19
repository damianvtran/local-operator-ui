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
import { cn } from "@shared/lib/utils";
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
				/* Collapsed the row is an avatar, and its initials — or the fallback
				   mark, when there is no name to initialise — are not a name for
				   what the control does. The tooltip only contributes
				   `aria-describedby`, and only while open. Expanded, the name and
				   email in the row are the name. */
				aria-label={expanded ? undefined : "Account settings"}
				className={cn(
					"flex w-full items-center gap-2 rounded-sm transition-colors duration-fast ease-out-quart hover:bg-row-hover",
					/*
					 * `px-3` matches a nav row exactly, so the avatar sits on the same
					 * 20px line as every nav mark above it. Collapsed, the rail is 48px
					 * and there is only room to centre.
					 */
					expanded ? "px-3 py-1.5" : "justify-center py-1.5",
				)}
			>
				{/*
				 * A neutral plate, not an accent fill. The rail already spends the
				 * accent on the active destination; a solid accent disc at the foot
				 * is a second, larger spend on the one row that is not a
				 * destination. `elevated` is the plate's own step up off the rail's
				 * `surface` ground — the arrangement the refinement round left, and
				 * NOT a fix for the rail's ground: that ground is `surface` now, so
				 * the fallback's default `sunken` would no longer vanish into it
				 * (measured, `sunken` off `surface` is ΔE00 3.96 at its tightest).
				 *
				 * `border-control` is what makes the plate SURVIVE its row, and the
				 * reason is a property of the row state rather than of this value:
				 * the row above paints `hover:bg-row-hover`, and a row state is
				 * authored as a step of the panel it sits on, so on some palette a
				 * state lands on the plate's own rung. Measured on the shipped
				 * values: `elevated` against `rowHover` is byte-identical on
				 * `arcade` (ΔE00 0.00) and inside the field floor on `gruvbox`
				 * (1.14), `obsidian` (1.21) and `everforest` (1.90) — hover the row
				 * at any of them and the plate is a disc of the row's own hover
				 * colour. No fill role escapes that (a state that is a step of the
				 * panel will always land on a rung somewhere), so the edge is the
				 * carrier: `border-control` is this system's role for an edge that
				 * IS the boundary of a thing, and its 3:1 floor is asserted against
				 * every ground. Both halves of that are guarded — the class here in
				 * `scripts/chat-sidebar-selection.test.mjs`, and the colours per
				 * palette in `scripts/contrast-contract.mjs` — because the palette
				 * gate cannot see which class an element paints and this file's own
				 * reader cannot see a palette.
				 */}
				<Avatar className="size-7 shrink-0">
					<AvatarFallback className="border border-control bg-elevated text-ink">
						{userInitials ?? <User size={14} aria-hidden="true" />}
					</AvatarFallback>
				</Avatar>
				{expanded && userName && (
					<span className="min-w-0 text-left">
						{/*
						 * 13px, one step under the nav labels' weight rather than one
						 * above: the account is the quietest thing on the rail, not the
						 * loudest.
						 */}
						<span className="block truncate text-body-sm text-ink">
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

		/* Collapsed, the tooltip is the only name on screen; the accessible name
		   is the button's own `aria-label`. */
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
