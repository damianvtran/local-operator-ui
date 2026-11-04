/**
 * Every state of the Team Bridge trial (teams-trial §9 Lane F), rendered in the
 * real page so a frame shows the composition the user sees, not a component in
 * a vacuum. The page view takes the trial's two seams directly (`noOrgPanel` at
 * the no-organization branch, the trial note in `notice`, the paused state
 * through `readOnly`), so these stories need no transport.
 *
 * States: signed out, eligible, the dialog (empty and ready to submit, plus a
 * refused start), post-start (trial active), ended/paused, ineligible.
 */
import type { Meta, StoryObj } from "@storybook/react";
import type { TeamBridgePageView } from "../team-bridge/team-bridge-page";
import pageMeta, {
	PopulatedDirectMessage,
} from "../team-bridge/team-bridge-page.stories";
import { TeamBridgeTrialDialogView } from "./team-bridge-trial-dialog";
import { TeamBridgeTrialEmptyView } from "./team-bridge-trial-empty";
import { subscribeUrlFor } from "./team-bridge-trial-model";
import { TeamBridgeTrialNoteView } from "./team-bridge-trial-paused";

/** A fixed zone so every frame names the same day (Thursday, December 3, 2026). */
const ZONE = "UTC";
const ENDS_AT = "2026-12-03T14:05:00Z";
const ENDED_AT = "2026-11-02T09:30:00Z";

const meta = {
	...pageMeta,
	title: "Team Bridge/Trial",
} satisfies Meta<typeof TeamBridgePageView>;
export default meta;
type Story = StoryObj<typeof meta>;

const noOrg = {
	eligibility: "plan_required" as const,
	conversations: [],
	target: null,
	messages: [],
	messageState: "idle" as const,
	people: [],
	organizations: [],
};

const eligibleView = {
	kind: "eligible" as const,
	tenantId: "ten_home",
	tenantName: "Ada's Organization",
	endsAt: ENDS_AT,
	termsVersion: "2026-07-29",
	termsUrl: "https://radienthq.com/terms",
};

/** Not signed in: the page's existing "Sign in to Radient" panel, unchanged. */
export const SignedOut: Story = {
	args: { ...noOrg, eligibility: "signed_out" },
};

/** Signed in, in no Team organization, and eligible: the one calm CTA. */
export const Eligible: Story = {
	args: {
		...noOrg,
		noOrgPanel: <TeamBridgeTrialEmptyView view={eligibleView} />,
	},
};

/** The eligibility read in flight: a quiet check, not the old plan panel. */
export const Checking: Story = {
	args: {
		...noOrg,
		noOrgPanel: <TeamBridgeTrialEmptyView view={{ kind: "checking" }} />,
	},
};

/** Already used the trial: Subscribe opens the console; no trial button. */
export const Ineligible: Story = {
	args: {
		...noOrg,
		noOrgPanel: (
			<TeamBridgeTrialEmptyView
				view={{
					kind: "ineligible",
					reason: "trial_used",
					subscribeUrl: subscribeUrlFor("ten_home"),
				}}
			/>
		),
	},
};

/** Not the owner: the sentence names who can act, so there is no button at all. */
export const IneligibleNotOwner: Story = {
	args: {
		...noOrg,
		noOrgPanel: (
			<TeamBridgeTrialEmptyView
				view={{
					kind: "ineligible",
					reason: "not_owner",
					subscribeUrl: subscribeUrlFor("ten_home"),
				}}
			/>
		),
	},
};

const dialogArgs = {
	open: true,
	onClose: () => {},
	endsAt: ENDS_AT,
	termsUrl: "https://radienthq.com/terms",
	orgName: "Ada's Organization",
	onOrgNameChange: () => {},
	onTermsAcceptedChange: () => {},
	onConfirm: () => {},
	timeZone: ZONE,
};

/** The dialog as it opens: name prefilled, Terms unticked, Start disabled. */
export const Dialog: Story = {
	args: {
		...noOrg,
		noOrgPanel: (
			<>
				<TeamBridgeTrialEmptyView view={eligibleView} />
				<TeamBridgeTrialDialogView {...dialogArgs} termsAccepted={false} />
			</>
		),
	},
};

/** Terms ticked and a name typed: Start is enabled. */
export const DialogReady: Story = {
	args: {
		...noOrg,
		noOrgPanel: (
			<>
				<TeamBridgeTrialEmptyView view={eligibleView} />
				<TeamBridgeTrialDialogView
					{...dialogArgs}
					orgName="Acme"
					termsAccepted
				/>
			</>
		),
	},
};

/** The Terms changed between the read and the press: box un-ticked, asked again. */
export const DialogTermsOutdated: Story = {
	args: {
		...noOrg,
		noOrgPanel: (
			<>
				<TeamBridgeTrialEmptyView view={eligibleView} />
				<TeamBridgeTrialDialogView
					{...dialogArgs}
					termsAccepted={false}
					failure="terms_outdated"
				/>
			</>
		),
	},
};

/** After the start: the org's page with the trial note and Invite teammates. */
export const PostStart: Story = {
	args: {
		...PopulatedDirectMessage.args,
		notice: (
			<TeamBridgeTrialNoteView
				kind="active"
				at={ENDS_AT}
				tenantId="ten_home"
				timeZone={ZONE}
			/>
		),
	},
};

/** The trial ended: history readable, posting off, Subscribe opens the console. */
export const Paused: Story = {
	args: {
		...PopulatedDirectMessage.args,
		readOnly: true,
		notice: (
			<TeamBridgeTrialNoteView
				kind="paused"
				at={ENDED_AT}
				tenantId="ten_home"
				timeZone={ZONE}
			/>
		),
	},
};
