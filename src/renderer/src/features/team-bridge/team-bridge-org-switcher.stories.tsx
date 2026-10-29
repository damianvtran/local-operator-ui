import type { Meta, StoryObj } from "@storybook/react";
import {
	TEAM_BRIDGE_ALL_SCOPE,
	type TeamBridgeOrganization,
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
