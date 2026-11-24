import { PhoneAccessOffer } from "@features/providers/phone-access-offer";
import { UpdateFootIcon } from "@shared/components/common/update-foot-icon";
import { SIDEBAR_INSET } from "@shared/components/navigation/sidebar-inset";
import { UserProfileSidebar } from "@shared/components/navigation/user-profile-sidebar";
import { BrowserSafeTooltip } from "@shared/components/ui/browser-safe-tooltip";
import {
	isSettingsPath,
	useCloseSettings,
} from "@shared/hooks/use-settings-route";
import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { Settings } from "lucide-react";
import type { FC } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/*
 * The docked sidebar's foot, in its own module so a route that takes over the
 * left column (Team Bridge) can draw the same foot without importing the whole
 * navigation - see `left-sidebar-host.tsx`.
 */

/*
 * The two affordances Settings keeps, and the reason it left the destination
 * group: it is a route the user visits once and then returns from, so a
 * permanent row spent a destination's width on it while the account row in
 * the same foot already opens onto the same place. The gear is the one press;
 * the account menu is the one that also carries Sign out. The tour's
 * `navigate-settings` step attaches to this button, which is why it carries
 * the tag rather than the menu item.
 *
 * A COMPONENT RATHER THAN A LOCAL ELEMENT so the route-owned column (Team
 * Bridge, `team-bridge-route-column.tsx`) draws the same foot: the swap reads as
 * "the same column showing other content" only if the account row and the gear
 * are the same controls in the same place, and a second copy would drift.
 */
/**
 * The id the gear points at while Settings is open. One gear is on screen per
 * route, so a constant is unambiguous.
 */
const SETTINGS_GEAR_DIRECTION_ID = "settings-gear-direction";

export const SettingsGear: FC = () => {
	const navigate = useNavigate();
	const closeSettings = useCloseSettings();
	const { pathname } = useLocation();
	/*
	 * ONE CONTROL, TWO DIRECTIONS (operator, 2026-11-23: "gear_closes: Yes, gear
	 * toggles"). Settings is a route with no OS chrome to close it, so the gear
	 * is the toggle the user already reaches for: while the page is open it
	 * closes, on every other route it opens. The ACCESSIBLE NAME stays "Settings"
	 * (`aria-current="page"` already says the page is this one), because a name
	 * that changes under the pointer is a name a screen reader has to
	 * rediscover. The DIRECTION is exposed beside it: the tooltip for a sighted
	 * pointer reader, and `aria-description` for the screen reader that would
	 * otherwise hear "Settings, current page, button" over an action that
	 * leaves the page (round 1: D6, U5). The description reuses the existing
	 * "Close settings" copy rather than adding a string that would stale the
	 * translation ledger.
	 */
	const isOpen = isSettingsPath(pathname);
	return (
		<BrowserSafeTooltip
			content={
				isOpen
					? t("ui.settings.navigation.settings_page.close_settings")
					: t("ui.shell.sidebar_navigation.settings")
			}
			side="top"
		>
			<button
				type="button"
				data-tour-tag="nav-item-settings"
				onClick={() => (isOpen ? closeSettings() : navigate("/settings"))}
				aria-current={isOpen ? "page" : undefined}
				aria-label={t("ui.shell.sidebar_navigation.settings")}
				aria-describedby={isOpen ? SETTINGS_GEAR_DIRECTION_ID : undefined}
				className={cn(
					"flex size-8 shrink-0 items-center justify-center rounded-sm text-ink-muted",
					"transition-colors duration-fast ease-out-quart",
					"hover:bg-row-hover hover:text-ink",
					isOpen && "text-ink",
				)}
			>
				<Settings size={16} aria-hidden="true" />
				{/*
				 * The direction, for a screen reader: "Settings, current page,
				 * button" over an action that leaves the page reads as a
				 * destination, not a toggle (round 1: D6, U5). A DESCRIPTION, not a
				 * name - `aria-label` keeps the name stable under the pointer - and
				 * `sr-only`, so nothing is drawn. It sits inside the button because
				 * the tooltip's trigger takes exactly one child element.
				 */}
				{isOpen && (
					<span id={SETTINGS_GEAR_DIRECTION_ID} className="sr-only">
						{t("ui.settings.navigation.settings_page.close_settings")}
					</span>
				)}
			</button>
		</BrowserSafeTooltip>
	);
};

/**
 * THE DOCKED COLUMN'S FOOT: the account row, whose own menu carries Settings
 * and Sign out, and the gear that goes straight to Settings. Exported for the
 * route-owned column, which keeps it so the account and Settings stay one press
 * away on a route that hides this navigation (see `SettingsGear`).
 */
export const SidebarFoot: FC = () => (
	<>
		{/*
		 * The first-sign-in phone access offer (spec v2 §4.1): above the account
		 * row it is about, in-app and non-modal. Renders nothing unless the
		 * backend, the account and this machine's setup state all say to offer.
		 */}
		<PhoneAccessOffer />
		<SidebarFootRow />
	</>
);

const SidebarFootRow: FC = () => (
	<div
		className={cn(
			"flex min-h-10 shrink-0 items-center justify-between gap-1 pb-2",
			SIDEBAR_INSET,
		)}
	>
		<UserProfileSidebar expanded />
		{/*
		 * THE CLUSTER, AND WHY IT IS ONE CHILD (design consult §3.1): three
		 * children under `justify-between` would spread the row - the icon
		 * would float to the middle - so the icon and the gear are wrapped in
		 * one `flex items-center gap-1` div and the row keeps its two-child
		 * shape. The icon sits immediately left of the gear at the row's own
		 * 4px step (the measured slot), and the gear stays the row's last stop.
		 */}
		<div className="flex items-center gap-1">
			<UpdateFootIcon />
			<SettingsGear />
		</div>
	</div>
);
