import { useAidaMissedMessages } from "@features/aida/use-aida-missed-messages";
import { useAidaTarget } from "@features/aida/use-aida-target";
import { useAppWideApprovals } from "@features/browser/hooks/use-app-wide-approvals";
import {
	useMeshApprovals,
	waitingApprovalCount,
} from "@features/mesh/mesh-approvals";
import { useMeshMembership } from "@features/mesh/mesh-store";
import { useNotificationsCount } from "@features/notifications/notifications-api";
import { badgeCountOf } from "@features/notifications/notifications-model";
import {
	desktopFeatureEnabled,
	desktopFeatureState,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { t } from "@shared/i18n";

/**
 * The attention the app navigation carries for surfaces OTHER than the route
 * that hid it - one number, for the route column's Back control.
 *
 * WHY THIS EXISTS. `SidebarNavigation` is the app's always-on attention
 * surface: Aida's missed messages, the Notifications count, app-wide browser
 * approvals and the Mesh waiting count all ride its rows. A route that takes
 * over the left column (Team Bridge, operator 2026-11-03) unmounts it, and
 * without this every one of those requests would be invisible for as long as
 * the reader stayed on the route - the Slack pattern answers it by badging the
 * way back, so this does the same.
 *
 * SAME READS, SAME GATES, deliberately repeated rather than shared with the
 * navigation: each count is drawn only where the navigation would draw its row
 * (Aida only when her row exists, Mesh only for a member device, Notifications
 * only on its capability), so this total never counts something the reader
 * could not find after pressing Back. React Query and the projection store
 * dedupe the reads; the two components are never mounted together on the
 * route that uses this, so the Mesh poll still has exactly one owner. The
 * navigation's own call sites are pinned by their tests, which is why they are
 * not refactored onto this hook.
 *
 * Team Bridge's own unread is NOT included: it is on screen in the rail.
 */
/**
 * The total, and one line per source that is waiting, worded by the SAME keys
 * the navigation's rows use for their own names (so the tooltip says exactly
 * what the row would have said, in every locale, with no new copy). Ordered as
 * the rows are. Empty `lines` when nothing waits.
 */
export type OtherSurfacesAttention = { total: number; lines: string[] };

export function useOtherSurfacesAttention(): OtherSurfacesAttention {
	const capabilities = useDesktopCapabilities();

	const aidaEnabled = desktopFeatureEnabled(capabilities.data, "aida", 1);
	const aida = useAidaTarget(aidaEnabled);
	const aidaVisible = aidaEnabled && aida.data?.enabled === true;
	const aidaMissed = useAidaMissedMessages(aida.data?.session_id);

	const notificationsEnabled = desktopFeatureEnabled(
		capabilities.data,
		"notifications",
		1,
	);
	const notificationsCount = useNotificationsCount(notificationsEnabled);

	const browserApprovals = useAppWideApprovals();

	const meshMembership = useMeshMembership(
		desktopFeatureState(capabilities.data, "peers") === "enabled",
	);
	const meshApprovals = useMeshApprovals(
		meshMembership === "member" &&
			desktopFeatureState(capabilities.data, "approvals") === "enabled",
		{ poll: true },
	);

	const aidaCount = aidaVisible ? aidaMissed : 0;
	const notifications = notificationsEnabled
		? badgeCountOf(notificationsCount.data)
		: 0;
	const mesh =
		meshMembership === "member"
			? waitingApprovalCount(meshApprovals.data ?? [])
			: 0;
	const lines: string[] = [];
	if (aidaCount > 0)
		lines.push(
			t("ui.shell.sidebar_navigation.aida_missed", {
				// The nav's own fallback for a backend that predates her name.
				name: aida.data?.name ?? "Aida",
				count: aidaCount,
			}),
		);
	if (notifications > 0)
		lines.push(
			t("ui.notifications.nav.unread", {
				count: notifications,
				countText: String(notifications),
			}),
		);
	if (browserApprovals > 0)
		lines.push(
			t("ui.shell.sidebar_navigation.browser_waiting", {
				count: browserApprovals,
				countText: String(browserApprovals),
			}),
		);
	if (mesh > 0)
		lines.push(
			t("ui.shell.sidebar_navigation.mesh_waiting", {
				count: mesh,
				countText: String(mesh),
			}),
		);
	return {
		total: aidaCount + notifications + browserApprovals + mesh,
		lines,
	};
}
