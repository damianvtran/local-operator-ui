import { AttentionBadge } from "@shared/components/ui/attention-badge";
import { Badge } from "@shared/components/ui/badge";
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
import { Building2, ChevronDown, Compass, Globe, Search } from "lucide-react";
import { type FC, useState } from "react";
import {
	TEAM_BRIDGE_ALL_SCOPE,
	type TeamBridgeCommunity,
	type TeamBridgeCommunityId,
	type TeamBridgeOrganization,
	type TeamBridgeScope,
	asTeamBridgeCommunityId,
	organizationForScope,
	teamBridgeScopeFromValue,
	teamBridgeSwitcherGroups,
} from "./team-bridge-model";

/*
 * ONE TRAILING COUNT COLUMN (design review round 1, D1; frames D21 and M8:
 * "unread counts and the check share one aligned right column"). Every row
 * reserves the same slot whether or not it has a count, with the badge
 * right-aligned inside, so the Public badges on community rows and the role
 * labels on organization rows sit in one column instead of jumping 24px left
 * on each row that has unread. 1.5rem holds a one- or two-digit count (the
 * badge is `min-w-4` plus `px-1`); a capped "99+" may still widen its row,
 * which is rare and still right-aligned.
 */
const COUNT_SLOT = "flex min-w-6 shrink-0 justify-end";

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
 *
 * TWO GROUPS (RFC v2.4 Amendment A, frames D21/D22). "Organizations" holds the
 * private Team orgs and "All organizations", which merges only those; joined
 * communities are a separate "Communities" group below it - each its own
 * scope, marked Public by label and icon (never colour alone), with its own
 * count - then "Browse communities…". They are two radio groups because they
 * are two kinds of scope: a community can never be the value of the private
 * group, so it can never be the merged view. With no community joined and the
 * community feature off, the second group is absent and the menu is exactly
 * the pre-Amendment one (same "Organization" label), which is what lets this
 * ship dark. Past six joined communities the group gains a search field and
 * scrolls, so the menu stays short.
 */
export const TeamBridgeOrgSwitcher: FC<{
	organizations: TeamBridgeOrganization[];
	scope: TeamBridgeScope;
	onScopeChange: (scope: TeamBridgeScope) => void;
	/** The account aggregate's total, shown on the "All organizations" row. */
	totalUnread: number;
	membershipsLoading?: boolean;
	organizationsFailed?: boolean;
	/**
	 * The unread aggregate is being re-read behind an already-painted count
	 * (tb-instant-open). The trigger states that the badge below it is being
	 * refreshed instead of leaving a stale number looking current.
	 */
	unreadRefreshing?: boolean;
	/** Story/capture seed only: opens the menu so its rows are visible. */
	defaultOpen?: boolean;
	/** Refetch the memberships after a failed read; shown as a menu action. */
	onRetry?: () => void;
	/** Joined communities (empty until the community client lands). */
	communities?: readonly TeamBridgeCommunity[];
	/** The community feature flag; with none joined, off hides the group. */
	communitiesEnabled?: boolean;
	/** The community being viewed, when the scope is a community. */
	selectedCommunityId?: TeamBridgeCommunityId | null;
	onCommunityChange?: (communityId: TeamBridgeCommunityId) => void;
	/** Omitted -> no Browse row (nothing to open it with yet). */
	onBrowseCommunities?: () => void;
	/** Story/capture seed only: the community search field's text. */
	defaultCommunityQuery?: string;
}> = ({
	organizations,
	scope,
	onScopeChange,
	totalUnread,
	membershipsLoading = false,
	organizationsFailed = false,
	unreadRefreshing = false,
	defaultOpen = false,
	onRetry,
	communities = [],
	communitiesEnabled = false,
	selectedCommunityId = null,
	onCommunityChange,
	onBrowseCommunities,
	defaultCommunityQuery = "",
}) => {
	useI18nLocale();
	const [communityQuery, setCommunityQuery] = useState(defaultCommunityQuery);
	const groups = teamBridgeSwitcherGroups({
		organizations,
		communities,
		communitiesEnabled,
		query: communityQuery,
	});
	const selectedCommunity = selectedCommunityId
		? (communities.find(
				(community) => community.communityId === selectedCommunityId,
			) ?? null)
		: null;
	const current = selectedCommunity
		? null
		: organizationForScope(groups.organizations, scope);
	const title = selectedCommunity
		? selectedCommunity.name
		: scope === TEAM_BRIDGE_ALL_SCOPE
			? t("ui.teamBridge.scope.all")
			: (current?.name ?? t("ui.teamBridge.scope.unknown"));

	return (
		<DropdownMenu defaultOpen={defaultOpen}>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					// A community is not an organization (Amendment A), so a screen
					// reader must not announce it as one (design review round 1, D2).
					aria-label={
						selectedCommunity
							? t("ui.teamBridge.scope.community.trigger", { name: title })
							: t("ui.teamBridge.scope.trigger", { name: title })
					}
					title={title}
					aria-busy={unreadRefreshing || undefined}
					className={cn(
						"group flex h-10 min-w-0 flex-1 items-center gap-2 rounded-sm px-2",
						"text-start text-ink transition-colors duration-fast",
						"hover:bg-row-hover data-[state=open]:bg-row-hover",
					)}
				>
					{/*
					 * THE WORKSPACE TILE (visual refresh §3.3; contract C2). Slack's and
					 * Discord's workspace mark: a 28px tile with the organization's
					 * initial in `accent-alt` on `accent-alt-wash` - the theme's identity
					 * pair, the same one a person's letter avatar wears, so "who/which"
					 * reads in one hue across the column. "All organizations" (and an
					 * unknown scope) has no single initial, so it keeps the building.
					 * Its left edge sits on the column's one 16px line with Back,
					 * Drafts and every section row (design D2 on #1660).
					 */}
					<span
						aria-hidden="true"
						data-org-tile=""
						className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-accent-alt-wash font-semibold text-[13px] text-accent-alt"
					>
						{selectedCommunity ? (
							<Globe size={16} />
						) : scope !== TEAM_BRIDGE_ALL_SCOPE && current?.name.trim() ? (
							current.name.trim().charAt(0).toUpperCase()
						) : (
							<Building2 size={16} />
						)}
					</span>
					<span className="min-w-0 flex-1 truncate font-semibold text-[15px]">
						{title}
					</span>
					<ChevronDown
						size={14}
						aria-hidden="true"
						className="shrink-0 text-ink-dim"
					/>
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="start"
				// D21 measures the two-group menu at ~350px: wide enough for "Local
				// Operator Community" beside its Public badge and count without
				// truncating. The dark menu keeps its original width.
				className={groups.showCommunities ? "w-[22rem]" : "w-64"}
			>
				<DropdownMenuLabel>
					{groups.showCommunities
						? t("ui.teamBridge.scope.group.organizations")
						: t("ui.teamBridge.scope.label")}
				</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					// A community in view leaves no private row checked.
					value={selectedCommunity ? "" : scope}
					onValueChange={(next) =>
						onScopeChange(teamBridgeScopeFromValue(next))
					}
				>
					<DropdownMenuRadioItem value={TEAM_BRIDGE_ALL_SCOPE}>
						<span className="min-w-0 flex-1 truncate">
							{t("ui.teamBridge.scope.all")}
						</span>
						<span className={COUNT_SLOT} data-count-slot="">
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
						</span>
					</DropdownMenuRadioItem>
					{groups.organizations.length > 0 && <DropdownMenuSeparator />}
					{groups.organizations.map((organization) => (
						<DropdownMenuRadioItem
							key={organization.tenantId}
							value={organization.tenantId}
						>
							<span className="min-w-0 flex-1 truncate">
								{organization.name}
							</span>
							{/* A hub tenant with no membership has no role; an empty
							    span would still take a flex slot before the badge. */}
							{organization.invited ? (
								<Badge variant="info" className="shrink-0">
									{t("ui.teamBridge.scope.invited")}
								</Badge>
							) : (
								organization.role && (
									<span className="shrink-0 text-meta-sm text-ink-dim capitalize">
										{organization.role}
									</span>
								)
							)}
							<span className={COUNT_SLOT} data-count-slot="">
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
							</span>
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
					groups.organizations.length === 0 && (
						<DropdownMenuLabel>
							{t("ui.teamBridge.scope.empty")}
						</DropdownMenuLabel>
					)}
				{groups.showCommunities && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuLabel>
							{groups.searchCommunities
								? t("ui.teamBridge.scope.group.communities_joined", {
										count: communities.length,
									})
								: t("ui.teamBridge.scope.group.communities")}
						</DropdownMenuLabel>
						{groups.searchCommunities && (
							<div className="px-2 pb-1">
								<label className="flex h-8 items-center gap-2 rounded-sm border border-hairline bg-sunken px-2 text-ink-dim focus-within:border-accent">
									<Search size={14} aria-hidden="true" />
									<input
										type="search"
										value={communityQuery}
										onChange={(event) => setCommunityQuery(event.target.value)}
										// Radix menus run typeahead on every printable key and
										// move focus to the matching row; stopping the event here
										// keeps the field the one receiving the text. Arrow keys
										// and Escape still reach the menu.
										onKeyDown={(event) => {
											if (
												!["ArrowDown", "ArrowUp", "Escape", "Tab"].includes(
													event.key,
												)
											)
												event.stopPropagation();
										}}
										placeholder={t("ui.teamBridge.scope.community.search")}
										aria-label={t("ui.teamBridge.scope.community.search")}
										className="min-w-0 flex-1 bg-transparent text-body-sm text-ink outline-none placeholder:text-ink-dim"
									/>
								</label>
							</div>
						)}
						{/* Six ~31.5px rows (measured in the D21 story), then scroll,
						    with the seventh peeking so the group reads as scrollable
						    (frame D21's inset). */}
						<div
							className={cn(
								groups.searchCommunities && "max-h-[12.5rem] overflow-y-auto",
							)}
						>
							<DropdownMenuRadioGroup
								value={selectedCommunity?.communityId ?? ""}
								onValueChange={(next) =>
									onCommunityChange?.(asTeamBridgeCommunityId(next))
								}
							>
								{groups.communities.map((community) => (
									<DropdownMenuRadioItem
										key={community.communityId}
										value={community.communityId}
									>
										<Globe
											size={14}
											aria-hidden="true"
											className="shrink-0 text-ink-dim"
										/>
										<span className="min-w-0 flex-1 truncate">
											{community.name}
										</span>
										<Badge
											variant="neutral"
											className="shrink-0 gap-1 px-1.5 py-0 text-meta-sm"
										>
											<Globe size={10} aria-hidden="true" />
											{t("ui.teamBridge.scope.community.public")}
										</Badge>
										<span className={COUNT_SLOT} data-count-slot="">
											{community.unread > 0 && (
												<AttentionBadge
													count={community.unread}
													aria-label={t("ui.teamBridge.unread.count", {
														count: community.unread,
													})}
													title={t("ui.teamBridge.unread.count", {
														count: community.unread,
													})}
												/>
											)}
										</span>
									</DropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
							{groups.searchCommunities && groups.communities.length === 0 && (
								<DropdownMenuLabel>
									{t("ui.teamBridge.scope.community.no_match")}
								</DropdownMenuLabel>
							)}
						</div>
						{onBrowseCommunities && (
							<>
								{/* With nothing joined the label already heads Browse;
								    a rule between them would frame an empty group. */}
								{communities.length > 0 && <DropdownMenuSeparator />}
								<DropdownMenuItem onSelect={() => onBrowseCommunities()}>
									<Compass
										size={14}
										aria-hidden="true"
										className="shrink-0 text-ink-dim"
									/>
									{t("ui.teamBridge.scope.community.browse")}
								</DropdownMenuItem>
							</>
						)}
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
};
