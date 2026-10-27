import {
	Avatar,
	AvatarFallback,
	AvatarImage,
	BrowserSafeTooltip,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@shared/components/ui";
import { useOwnAccountAvatar } from "@shared/hooks/use-account-avatar";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { isRadientAccountFailure } from "@shared/hooks/use-radient-user-query";
import { useTextDirection } from "@shared/i18n/use-document-direction";
import { cn } from "@shared/lib/utils";
import { LogOut, RotateCw, Settings, Shield, User } from "lucide-react";
import { useCallback, useMemo } from "react";
import React, { type FC } from "react";
import { useNavigate } from "react-router-dom";
import { t } from "../../../../../i18n/messages";

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
		const direction = useTextDirection();
		const navigate = useNavigate();

		const { user, isAuthenticated, accountRead, signOut } = useRadientAuth();
		/*
		 * The row says what the app KNOWS about the account, never a placeholder
		 * dressed as a person.
		 *
		 * The report this branch answers was partly read off THIS row: beside a
		 * backend holding a valid Radient credential, the rail read "User" - the
		 * user store's default name - exactly as it does for somebody who has
		 * never signed in, while the account read was failing or never settling a
		 * few hundred pixels away (qa round 1, A7). The placeholder is still the
		 * fallback for the ordinary signed-out state, which is not a fault and not
		 * this row's to explain; every state where the app cannot tell is now
		 * named, in the same register the settings surface uses.
		 */
		const accountStateLabel =
			accountRead === "checking"
				? t("ui.shell.user_profile_sidebar.checking_account")
				: isRadientAccountFailure(accountRead)
					? t("ui.shell.user_profile_sidebar.account_unavailable")
					: null;
		const userName =
			user?.name ??
			accountStateLabel ??
			t("ui.shell.user_profile_sidebar.user");
		/*
		 * A failed read is the one account state with somewhere to GO, and the row
		 * is the only place this sidebar can offer it: the foot has no room for a
		 * second control, and the row is already a button (a link nested in a
		 * button is not markup a browser can resolve).
		 *
		 * So the row itself becomes the affordance. Failed, its second line names
		 * the move - "Reconnect Radient", in the accent this system uses for
		 * "there is something to do" - and its press goes straight to the provider
		 * surface with Radient preselected, which is where a refused or unreadable
		 * account is actually repaired. Every other state keeps the email line and
		 * the plain settings destination it always had.
		 */
		const reconnect = isRadientAccountFailure(accountRead);
		const userEmail = user?.email ?? "";
		const secondLine = reconnect
			? t("ui.shell.user_profile_sidebar.reconnect_radient")
			: userEmail;
		const settingsTarget = reconnect
			? "/settings?section=providers&provider=radient"
			: "/settings";
		const collapsedLabel = reconnect
			? t("ui.shell.user_profile_sidebar.reconnect_radient")
			: t("ui.shell.user_profile_sidebar.account_settings");

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
			/*
			 * Only a real account name carries initials. The row's fallback labels
			 * are statements about the app ("Checking account…", "Account
			 * unavailable"), and initialising those would put a two-letter code for
			 * a sentence on the plate; the glyph fallback is what that case is for.
			 */
			const name = user?.name;
			if (!name) return null;

			return name
				.split(" ")
				.map((part) => part.charAt(0))
				.join("")
				.toUpperCase()
				.substring(0, 2);
		}, [user?.name]);

		/*
		 * The person's own Radient photo, through the ONE private-avatar path
		 * (`use-account-avatar.ts`): bytes come from core over the desktop-media
		 * transport, fenced to the signed-in account, cached per auth epoch and
		 * revoked on sign-out. The version (account + content hash) comes from
		 * this same account read (`/me`'s `profile.avatar`). Undefined means
		 * initials: no photo, signed out, a failed read, or a core older than
		 * 0.90.13, whose avatar relay 404s.
		 */
		const avatarUrl = useOwnAccountAvatar(user?.radientUser.account, 64);

		const row = (
			<button
				type="button"
				onClick={useAuth ? undefined : () => navigate(settingsTarget)}
				/* Collapsed the row is an avatar, and its initials — or the fallback
				   mark, when there is no name to initialise — are not a name for
				   what the control does. The tooltip only contributes
				   `aria-describedby`, and only while open. Expanded, the name and
				   email in the row are the name. */
				aria-label={expanded ? undefined : collapsedLabel}
				className={cn(
					/*
					 * `min-w-0` is what lets the row SHRINK below its own content: without it
					 * the button's min-content width wins, a long name or email pushes the
					 * foot's settings gear out of the rail, and the sidebar's
					 * `overflow-hidden` clips it (design round 1, D1 - a 31-character email
					 * alone was enough, with the gear painting 0 pixels against 331 where it
					 * belongs). With the class both lines ellipsise inside their own box and
					 * the gear keeps its place; the text column below already carries the
					 * same pair one level down (`min-w-0` on the column, `truncate` on each
					 * of its two lines).
					 */
					"flex w-full min-w-0 items-center gap-2 rounded-sm transition-colors duration-fast ease-out-quart hover:bg-row-hover",
					/*
					 * `px-2` lands the avatar on the column's own 16px line: the
					 * destination rows above are `px-2` inside this column's `px-2`
					 * groups, and the brand row's logo starts on that same line. It was
					 * `px-3` - 20px, the older rail's idiom - and the operator's report
					 * of 2026-09-26 ("doesn't properly align left with the other
					 * aspects") is exactly that 4px. Collapsed, the rail centres.
					 */
					expanded ? "px-2 py-1.5" : "justify-center py-1.5",
				)}
			>
				{/*
				 * A neutral plate, not an accent fill. The rail already spends the
				 * accent on the active destination; a solid accent disc at the foot
				 * is a second, larger spend on the one row that is not a
				 * destination.
				 *
				 * ONE PERSON, ONE SHAPE (design review round 1, D1). Team Bridge draws
				 * this same person's photo, through this same `use-account-avatar.ts`
				 * cache, on `TeamBridgeAvatar`'s rounded-square plate (`rounded-md`,
				 * `team-bridge-profile-card.tsx`), and the operator asked for
				 * rounded-square images. So the root overrides the shared primitive's
				 * `rounded-full` with that same token rather than a new radius, and
				 * the photo, the initials and a transparent upload's backing all share
				 * one box. `size-7` is unchanged, so the swap moves no geometry.
				 *
				 * BORDERLESS, ON THE FILL TEAM BRIDGE ALREADY MEASURED (D2, D4). The
				 * plate used to be `elevated` with a `border-control` ring, because
				 * `elevated` lands on `rowHover` on some palettes (ΔE00 0.00 on
				 * `arcade`) and the row above paints `hover:bg-row-hover`. That ring
				 * showed for every launch while the bytes were in flight and dropped
				 * away the moment the photo landed. `media-surface` is the borderless
				 * fill #1427 gave the Team Bridge initial plates, asserted in
				 * `scripts/contrast-contract.mjs` against both grounds this row
				 * paints - the rail's `surface` and `rowHover` (the `team bridge
				 * borderless person and agent plates` row) - with `inkMuted` initials
				 * on it (`team bridge person initial plate`). The fill sits on the
				 * ROOT, not only the fallback, because Radix unmounts the fallback
				 * once the image loads: a transparent PNG would otherwise float on the
				 * row and change colour under the pointer. The class half is pinned in
				 * `scripts/chat-sidebar-selection.test.mjs`.
				 */}
				<Avatar className="size-7 shrink-0 rounded-md bg-media-surface">
					{/*
					 * Radix mounts the image only once it has LOADED, so the fallback
					 * holds the plate until then and a slow or failed decode never
					 * flashes an empty box. `lo-avatar-arrival` fades it in over
					 * `--duration-fast` (D5): opacity only, in a box that already has
					 * its final size, and switched off under reduced motion
					 * (`styles/index.css`).
					 */}
					{avatarUrl && (
						<AvatarImage src={avatarUrl} alt="" className="lo-avatar-arrival" />
					)}
					<AvatarFallback className="rounded-md bg-media-surface text-ink-muted">
						{userInitials ?? <User size={14} aria-hidden="true" />}
					</AvatarFallback>
				</Avatar>
				{expanded && userName && (
					<span className="min-w-0 text-start">
						{/*
						 * 13px, one step under the nav labels' weight rather than one
						 * above: the account is the quietest thing on the rail, not the
						 * loudest.
						 */}
						<span className="block truncate text-body-sm text-ink">
							{userName}
						</span>
						{secondLine && (
							<span
								className={cn(
									"block truncate text-meta",
									reconnect ? "text-accent" : "text-ink-dim",
								)}
							>
								{secondLine}
							</span>
						)}
					</span>
				)}
			</button>
		);

		/* Collapsed, the tooltip is the only name on screen; the accessible name
		   is the button's own `aria-label`. */
		/*
		 * Collapsed, the tooltip is the visible name. It stays on every route
		 * without a mounted browser view; with one, it would open right into the
		 * native page and be clipped, so `aria-label` is the channel there
		 * (`BrowserSafeTooltip`). The round-1 cut deleted it unconditionally and
		 * lost the name on chat, schedules and settings too.
		 */
		const labelled = expanded ? (
			row
		) : (
			<BrowserSafeTooltip
				content={collapsedLabel}
				side={direction === "rtl" ? "left" : "right"}
			>
				{row}
			</BrowserSafeTooltip>
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
					<BrowserSafeTooltip
						content={collapsedLabel}
						side={direction === "rtl" ? "left" : "right"}
					>
						<DropdownMenuTrigger asChild>{row}</DropdownMenuTrigger>
					</BrowserSafeTooltip>
				)}
				<DropdownMenuContent align="end" side="top" className="min-w-50">
					{reconnect ? (
						<DropdownMenuItem onSelect={() => navigate(settingsTarget)}>
							<RotateCw size={16} aria-hidden="true" />
							{t("ui.shell.user_profile_sidebar.reconnect_radient")}
						</DropdownMenuItem>
					) : null}
					<DropdownMenuItem onSelect={() => navigate("/settings")}>
						<Settings size={16} aria-hidden="true" />
						{t("ui.shell.user_profile_sidebar.settings")}
					</DropdownMenuItem>
					<DropdownMenuItem>
						<Shield size={16} aria-hidden="true" />
						{t("ui.shell.user_profile_sidebar.privacy_and_security")}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						onSelect={handleSignOut}
						className="text-danger focus:bg-danger-wash focus:text-danger"
					>
						<LogOut size={16} aria-hidden="true" />
						{t("ui.shell.user_profile_sidebar.sign_out")}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		);
	},
);

UserProfileSidebar.displayName = "UserProfileSidebar";
