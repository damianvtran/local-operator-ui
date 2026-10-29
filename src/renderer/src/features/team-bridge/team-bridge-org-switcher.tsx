import { AttentionBadge } from "@shared/components/ui/attention-badge";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@shared/components/ui/dropdown-menu";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Building2, ChevronDown } from "lucide-react";
import type { FC } from "react";
import {
	TEAM_BRIDGE_ALL_SCOPE,
	type TeamBridgeOrganization,
	type TeamBridgeScope,
	organizationForScope,
	teamBridgeScopeFromValue,
} from "./team-bridge-model";

/**
 * The organization switcher at the top of the conversation rail.
 *
 * WHY THE RAIL TITLE IS THE TRIGGER. The list's whole meaning is "conversations
 * of the organization named here"; a separate page heading above a scope chip
 * would spend a second line saying what the dropdown already says. The trigger
 * therefore shows the scope's name and opens the memberships.
 *
 * BORDERLESS BY CONSTRUCTION. The rail's own ground separates the rows; a
 * framed select would read as a form field floating above a list. The trigger
 * is the same 30px row the conversations use, with the same hover fill, so the
 * scope control reads as the first row of the rail rather than as chrome.
 *
 * KEYBOARD. `DropdownMenuRadioGroup` gives roving focus, arrow navigation,
 * Escape-to-close and — Radix's own behaviour — focus returned to the trigger
 * on close. The checked row is the current scope, so the trigger's name and the
 * menu's state cannot disagree.
 *
 * NO FAN-OUT. Per-org counts arrive in the same account aggregate the badge
 * already reads; this component renders what `organizationOptions` joined and
 * never fetches. `loading` is only the memberships read's first paint.
 */
export const TeamBridgeOrgSwitcher: FC<{
	organizations: TeamBridgeOrganization[];
	scope: TeamBridgeScope;
	onScopeChange: (scope: TeamBridgeScope) => void;
	/** The account aggregate's total, shown on the "All organizations" row. */
	totalUnread: number;
	membershipsLoading?: boolean;
	organizationsFailed?: boolean;
	/** Story/capture seed only: opens the menu so its rows are visible. */
	defaultOpen?: boolean;
	/** Refetch the memberships after a failed read; shown as a menu action. */
	onRetry?: () => void;
}> = ({
	organizations,
	scope,
	onScopeChange,
	totalUnread,
	membershipsLoading = false,
	organizationsFailed = false,
	defaultOpen = false,
	onRetry,
}) => {
	useI18nLocale();
	const current = organizationForScope(organizations, scope);
	const title =
		scope === TEAM_BRIDGE_ALL_SCOPE
			? t("ui.teamBridge.scope.all")
			: (current?.name ?? t("ui.teamBridge.scope.unknown"));

	return (
		<DropdownMenu defaultOpen={defaultOpen}>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					aria-label={t("ui.teamBridge.scope.trigger", { name: title })}
					title={title}
					className={cn(
						"group flex h-[30px] min-w-0 flex-1 items-center gap-2 rounded-md px-2",
						"text-start text-[13px] text-ink transition-colors duration-fast",
						"hover:bg-row-hover data-[state=open]:bg-row-hover",
					)}
				>
					<Building2
						size={16}
						aria-hidden="true"
						className="shrink-0 text-ink-muted"
					/>
					<span className="min-w-0 flex-1 truncate font-medium">{title}</span>
					<ChevronDown
						size={14}
						aria-hidden="true"
						className="shrink-0 text-ink-dim"
					/>
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-64">
				<DropdownMenuLabel>{t("ui.teamBridge.scope.label")}</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					value={scope}
					onValueChange={(next) =>
						onScopeChange(teamBridgeScopeFromValue(next))
					}
				>
					<DropdownMenuRadioItem value={TEAM_BRIDGE_ALL_SCOPE}>
						<span className="min-w-0 flex-1 truncate">
							{t("ui.teamBridge.scope.all")}
						</span>
						{totalUnread > 0 && (
							/* Unread across every organization: an attention count, so the
							   shared accent badge the sidebar rows wear (2026-10-28). */
							<AttentionBadge
								count={totalUnread}
								aria-label={t("ui.teamBridge.unread.count", {
									count: totalUnread,
								})}
								title={t("ui.teamBridge.unread.count", {
									count: totalUnread,
								})}
							/>
						)}
					</DropdownMenuRadioItem>
					{organizations.length > 0 && <DropdownMenuSeparator />}
					{organizations.map((organization) => (
						<DropdownMenuRadioItem
							key={organization.tenantId}
							value={organization.tenantId}
						>
							<span className="min-w-0 flex-1 truncate">
								{organization.name}
							</span>
							{/* A hub tenant with no membership has no role; an empty
							    span would still take a flex slot before the badge. */}
							{organization.role && (
								<span className="shrink-0 text-meta-sm text-ink-dim capitalize">
									{organization.role}
								</span>
							)}
							{organization.unread > 0 && (
								<AttentionBadge
									count={organization.unread}
									aria-label={t("ui.teamBridge.unread.count", {
										count: organization.unread,
									})}
									title={t("ui.teamBridge.unread.count", {
										count: organization.unread,
									})}
								/>
							)}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
				{membershipsLoading && (
					<DropdownMenuLabel>
						{t("ui.teamBridge.scope.loading")}
					</DropdownMenuLabel>
				)}
				{!membershipsLoading && organizationsFailed && (
					<>
						<DropdownMenuLabel>
							{t("ui.teamBridge.scope.error")}
						</DropdownMenuLabel>
						{onRetry && (
							<DropdownMenuItem onSelect={() => onRetry()}>
								{t("ui.teamBridge.list.retry")}
							</DropdownMenuItem>
						)}
					</>
				)}
				{!membershipsLoading &&
					!organizationsFailed &&
					organizations.length === 0 && (
						<DropdownMenuLabel>
							{t("ui.teamBridge.scope.empty")}
						</DropdownMenuLabel>
					)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
};
