/**
 * Every state of the Team Bridge trial (teams-trial §9 Lane F), rendered in the
 * real page so a frame shows the composition the user sees, not a component in
 * a vacuum. The page view takes the trial's two seams directly (`noOrgPanel` at
 * the no-organization branch, the trial note in `notice`, the paused state
 * through `readOnly`), so these stories need no transport.
 *
 * States: signed out, eligible, the dialog (empty and ready to submit, a
 * refused start, rate limited, and a retry after a refusal that succeeds),
 * post-start (trial active), ended/paused for an owner and for a disabled
 * member (in-page, and on the no-organization branch the live wire reaches,
 * QA round 1 Q5), ineligible (including not_owner for a member and for an admin).
 */
import type { Meta, StoryObj } from "@storybook/react";
import { type FC, useState } from "react";
import {
	TeamBridgePageView,
	type TeamBridgePageViewProps,
} from "../team-bridge/team-bridge-page";
import pageMeta, {
	PopulatedDirectMessage,
} from "../team-bridge/team-bridge-page.stories";
import { TeamBridgeTrialDialogView } from "./team-bridge-trial-dialog";
import { TeamBridgeTrialEmptyView } from "./team-bridge-trial-empty";
import { subscribeUrlFor } from "./team-bridge-trial-model";
import {
	TeamBridgeTrialEndedView,
	TeamBridgeTrialNoteView,
} from "./team-bridge-trial-paused";

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
					canSubscribe: true,
				}}
			/>
		),
	},
};

/** Not the owner, a plain member: the sentence names who can act, no button. */
export const IneligibleNotOwner: Story = {
	args: {
		...noOrg,
		noOrgPanel: (
			<TeamBridgeTrialEmptyView
				view={{
					kind: "ineligible",
					reason: "not_owner",
					subscribeUrl: subscribeUrlFor("ten_home"),
					canSubscribe: false,
				}}
			/>
		),
	},
};

/** Not the owner, an admin: cannot start a trial, CAN subscribe (C3). */
export const IneligibleNotOwnerAdmin: Story = {
	args: {
		...noOrg,
		noOrgPanel: (
			<TeamBridgeTrialEmptyView
				view={{
					kind: "ineligible",
					reason: "not_owner",
					subscribeUrl: subscribeUrlFor("ten_home"),
					canSubscribe: true,
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

/** Too many trial requests: the inline sentence, the buttons where they were. */
export const DialogRateLimited: Story = {
	args: {
		...noOrg,
		noOrgPanel: (
			<>
				<TeamBridgeTrialEmptyView view={eligibleView} />
				<TeamBridgeTrialDialogView
					{...dialogArgs}
					termsAccepted
					failure="rate_limited"
				/>
			</>
		),
	},
};

/**
 * A retry after a refusal, end to end in the view: the first press is refused
 * (rate limited), the second press starts the trial and lands on the trial
 * note. The request-id rule behind it (a fresh id per press, R1-1) is pinned in
 * `scripts/team-bridge-trial.test.mjs`; this story shows the user's half.
 */
const RetryAfterRefusal: FC = () => {
	const [presses, setPresses] = useState(0);
	const [termsAccepted, setTermsAccepted] = useState(true);
	if (presses >= 2)
		return (
			<TeamBridgePageView
				// The page meta carries the populated arguments; the story itself is `{}`.
				{...(pageMeta.args as TeamBridgePageViewProps)}
				notice={
					<TeamBridgeTrialNoteView
						kind="active"
						at={ENDS_AT}
						tenantId="ten_home"
						timeZone={ZONE}
					/>
				}
			/>
		);
	return (
		<>
			<TeamBridgeTrialEmptyView view={eligibleView} />
			<TeamBridgeTrialDialogView
				{...dialogArgs}
				termsAccepted={termsAccepted}
				onTermsAcceptedChange={setTermsAccepted}
				failure={presses === 1 ? "rate_limited" : null}
				onConfirm={() => setPresses((n) => n + 1)}
			/>
		</>
	);
};

export const DialogRetrySucceeds: Story = {
	args: { ...noOrg, noOrgPanel: <RetryAfterRefusal /> },
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
		readOnlyExplained: true,
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

/**
 * The trial ended, seen by a member it disabled (X3): the note names who can
 * act and offers no Subscribe, because the console would refuse them.
 */
export const PausedMember: Story = {
	args: {
		...PopulatedDirectMessage.args,
		readOnly: true,
		readOnlyExplained: true,
		notice: (
			<TeamBridgeTrialNoteView
				kind="paused"
				at={ENDED_AT}
				tenantId="ten_home"
				audience="member"
				timeZone={ZONE}
			/>
		),
	},
};

/**
 * The trial ended and no organization is eligible: the live wire's shape (QA
 * round 1, Q5) is surface A with `tenant_id: null` plus the runtime's
 * `trial_ended` marker, so the no-organization branch shows the paused band for
 * that organization instead of a trial on-ramp. Owner/admin: Subscribe.
 */
export const PausedNoOrg: Story = {
	args: {
		...noOrg,
		noOrgPanel: (
			<TeamBridgeTrialEndedView
				tenantId="ten_home"
				endedAt={ENDED_AT}
				timeZone={ZONE}
			/>
		),
	},
};

/** The same, for a member the trial end disabled: who can act, no button. */
export const PausedNoOrgMember: Story = {
	args: {
		...noOrg,
		noOrgPanel: (
			<TeamBridgeTrialEndedView
				tenantId="ten_home"
				endedAt={ENDED_AT}
				audience="member"
				timeZone={ZONE}
			/>
		),
	},
};
