import type { Meta, StoryObj } from "@storybook/react";
import {
	TEAM_BRIDGE_ALL_SCOPE,
	type TeamBridgeCommunity,
	type TeamBridgeOrganization,
	asTeamBridgeCommunityId,
	asTeamBridgeTenantId,
	organizationOptions,
} from "./team-bridge-model";
import { TeamBridgeOrgSwitcher } from "./team-bridge-org-switcher";

/**
 * The organization switcher on its own, closed and open.
 *
 * WHY A SEPARATE BOARD. The page stories show the trigger in its rail; only an
 * open menu shows the membership rows this slice adds — names, roles and the
 * per-org counts joined from the account aggregate. Storybook's dropdown is
 * portalled, so the decorator gives it the same 288px rail ground the page
 * uses and the capture sees the panel where a user would.
 */
const minerva: TeamBridgeOrganization = {
	tenantId: asTeamBridgeTenantId("tnt_1"),
	name: "Minerva",
	role: "owner",
	unread: 5,
};

const northwind: TeamBridgeOrganization = {
	tenantId: asTeamBridgeTenantId("tnt_2"),
	name: "Northwind Collective",
	role: "member",
	unread: 4,
};

const meta = {
	title: "Team Bridge/Organization switcher",
	component: TeamBridgeOrgSwitcher,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className="w-72 rounded-md bg-canvas p-3 text-ink">
				<div className="flex h-11 items-center gap-2">
					<Story />
				</div>
			</div>
		),
	],
	args: {
		organizations: [minerva, northwind],
		scope: minerva.tenantId,
		totalUnread: minerva.unread + northwind.unread,
		onScopeChange: () => {},
		// The failed read's recovery action is a menu row; a fixture no-op keeps
		// that row visible in the state the design review judges.
		onRetry: () => {},
	},
} satisfies Meta<typeof TeamBridgeOrgSwitcher>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneOrganization: Story = {
	args: {
		organizations: [minerva],
		totalUnread: minerva.unread,
	},
};

export const MenuOpen: Story = {
	args: { defaultOpen: true },
};

export const AccountWideSelected: Story = {
	args: { scope: TEAM_BRIDGE_ALL_SCOPE, defaultOpen: true },
};

/**
 * Hub tenants with an empty memberships read, built through
 * `organizationOptions` as the page does: rows wear the hub's names and no
 * role, so the menu shows no empty role slot before the count.
 */
export const HubTenantsWithoutMemberships: Story = {
	args: {
		organizations: organizationOptions(
			[],
			[
				{ tenant_id: minerva.tenantId, unread: 5 },
				{ tenant_id: northwind.tenantId, unread: 4 },
			],
			[
				{ tenant_id: minerva.tenantId, tenant_name: "Minerva" },
				{ tenant_id: northwind.tenantId, tenant_name: "Northwind Collective" },
			],
		),
		scope: TEAM_BRIDGE_ALL_SCOPE,
		defaultOpen: true,
	},
};

export const MembershipsFailed: Story = {
	args: {
		organizations: [],
		scope: TEAM_BRIDGE_ALL_SCOPE,
		organizationsFailed: true,
		defaultOpen: true,
	},
};

export const MembershipsLoading: Story = {
	args: {
		organizations: [],
		scope: TEAM_BRIDGE_ALL_SCOPE,
		membershipsLoading: true,
		defaultOpen: true,
	},
};

/*
 * RFC v2.4 Amendment A - the Organizations and Communities groups (frames D21
 * and D22). The stories above are the dark state: no community joined and the
 * flag off, which must look exactly as before. Below, the two-group menu with
 * the fixture names and counts the frames use, so a capture can be compared
 * with D21 row for row.
 */
const acme: TeamBridgeOrganization = {
	tenantId: asTeamBridgeTenantId("tnt_3"),
	name: "Acme Labs",
	role: "member",
	unread: 3,
};
const minervaD21: TeamBridgeOrganization = { ...minerva, unread: 9 };

const community = (
	id: string,
	name: string,
	unread = 0,
): TeamBridgeCommunity => ({
	kind: "community",
	communityId: asTeamBridgeCommunityId(id),
	name,
	unread,
});
const localOperatorCommunity = community(
	"cmty_local_operator",
	"Local Operator Community",
	4,
);
/** D21's inset: eight joined, so search appears and the group scrolls. */
const eightCommunities: TeamBridgeCommunity[] = [
	localOperatorCommunity,
	community("cmty_rust_agents", "Rust Agents Guild"),
	community("cmty_prompt", "Prompt Engineers", 2),
	community("cmty_open_data", "Open Data Commons"),
	community("cmty_homelab", "Homelab Builders", 7),
	community("cmty_indie_saas", "Indie SaaS Founders"),
	community("cmty_llm_evals", "LLM Evals Working Group", 1),
	community("cmty_design_systems", "Design Systems Circle"),
];

/** D21: viewing Minerva; All organizations 12 = 9 + 3, the community's 4 apart. */
export const OrganizationsAndCommunities: Story = {
	args: {
		organizations: [minervaD21, acme],
		scope: minervaD21.tenantId,
		totalUnread: minervaD21.unread + acme.unread,
		communities: [localOperatorCommunity],
		communitiesEnabled: true,
		onBrowseCommunities: () => {},
		defaultOpen: true,
	},
};

/** A community in view: the trigger names it, no private row is checked. */
export const CommunitySelected: Story = {
	args: {
		...OrganizationsAndCommunities.args,
		selectedCommunityId: localOperatorCommunity.communityId,
	},
};

/** D21 inset: more than six joined -> "Communities · 8 joined", search, scroll. */
export const ManyCommunitiesWithSearch: Story = {
	args: {
		...OrganizationsAndCommunities.args,
		communities: eightCommunities,
	},
};

/** The search field filtering to nothing. */
export const CommunitySearchNoMatch: Story = {
	args: {
		...ManyCommunitiesWithSearch.args,
		defaultCommunityQuery: "zzz",
	},
};

/** Flag on, nothing joined yet: the group is only "Browse communities…". */
export const CommunitiesFlagOnNoneJoined: Story = {
	args: {
		...OrganizationsAndCommunities.args,
		communities: [],
	},
};

/**
 * D22's inset: a pending invitation to a private org is the opening scope even
 * with a community joined; the row reads Invited instead of a role.
 */
export const PendingInvitation: Story = {
	args: {
		organizations: [{ ...acme, role: "", unread: 0, invited: true }],
		scope: acme.tenantId,
		totalUnread: 0,
		communities: [localOperatorCommunity],
		communitiesEnabled: true,
		onBrowseCommunities: () => {},
		defaultOpen: true,
	},
};
