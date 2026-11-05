/**
 * The profile-save card, in every state its own vocabulary allows.
 *
 * ## What is stubbed, and what is not
 *
 * NOTHING BEHIND THESE STORIES DIALS A BACKEND. The rows below are `MeshApprovalRow`
 * values — the shape `GET /v1/desktop/approvals` normalises to — and every view is
 * derived by the shipped `profileCardView`, so the state under test is the state
 * that renders in the app rather than a hand-built prop bag.
 *
 * The wire payloads follow the FROZEN v1 shapes: the disclosure from
 * `local_operator/profile_approval.py::disclosure` and the revert descriptor from
 * the backend's `profile_revert` action. `profile_save` is REMOVED from production
 * registration pending a C5 decision, so no enabled backend serves these rows
 * today: these stories are the surface's proof-of-shape, not evidence that a live
 * approval can be answered.
 *
 * ## Why every state has a story
 *
 * A consent surface is judged on the states nobody photographs: a proposal that
 * expired while the reader was away, a card whose typed block this build cannot
 * read, a revert that already happened. Each of those has an arm here, including
 * the kill-switch (`UnavailableRevert`) — the absent-descriptor shape that must
 * render no control at all.
 *
 * ## The shutter latch
 *
 * A state that arrives AFTER a press is dispatched never re-enables the control:
 * `profileRevertState` resolves `submitted` only when no outcome exists, and an
 * answered action id resolves to a settled state before the pending arm is
 * considered. `RevertPending`, `RevertSuccess` and `RevertFailure` are that
 * ordering drawn.
 */

import type { Meta, StoryObj } from "@storybook/react";
import type { ProfileSaveDisclosure } from "../../../../shared/profile-consent";
import { profileCardView, profileRevertView } from "./mesh-profile-approval";
import { ProfileConsentCard } from "./profile-consent-card";

const digest = `sha256:${"a".repeat(64)}`;

const agentImage = (over: Record<string, unknown> = {}) => ({
	id: "ag_researcher",
	name: "Researcher",
	label: "Research agent",
	description: "Reads papers and keeps the notes.",
	tags: ["research", "notes"],
	categories: ["analysis"],
	model: "anthropic/claude-opus-5-5",
	instructions: "Read sources before summarising.",
	...over,
});

function disclosure(
	over: Partial<ProfileSaveDisclosure> = {},
): ProfileSaveDisclosure {
	return {
		version: 1,
		operation: "profile_save",
		approval_id: "ap_demo1234",
		profile_kind: "agent",
		scope: "global",
		profile_operation: "update",
		target_id: "ag_researcher",
		profile_name: "Researcher",
		session_id: "s_9f2c",
		tool_call_id: "tc_4a1b",
		receipt_id: "rc_71bd",
		changed_fields: ["model", "instructions"],
		before: agentImage({
			model: "anthropic/claude-sonnet-5",
			instructions: "Summarise.",
		}),
		after: agentImage(),
		base_commitment: digest,
		after_commitment: digest,
		expires_at: 1_900_000_000,
		signing_principal: "operator-key",
		...over,
	} as ProfileSaveDisclosure;
}

function row(
	over: Record<string, unknown> = {},
	typed: Record<string, unknown> | null = null,
) {
	return {
		approvalId: "ap_demo1234",
		state: "requested",
		kind: "profile",
		expiresAt: 1_900_000_000,
		where: {
			deviceId: "dv_1",
			name: "studio-mini",
			host: "studio-mini",
			user: "damian",
			transport: "relay",
			hostKeyFp: "",
		},
		what: {
			connect: false,
			install: false,
			anchor: false,
			networkId: "",
			role: "",
			unattended: false,
			grants: [],
		},
		requestedBy: { surface: "desktop", sessionId: "s_9f2c", deviceId: "dv_1" },
		...(typed === null
			? {}
			: {
					profile: {
						action: "approve-operation",
						operation: "profile_save",
						request_digest: digest,
						disclosure_digest: digest,
						disclosure: disclosure(),
						signable_here: true,
						refusal: "",
						refusal_message: "",
						apply_outcome: null,
						...typed,
					},
				}),
		...over,
	} as unknown as Parameters<typeof profileCardView>[0];
}

const revertDescriptor = {
	schema: 1 as const,
	kind: "profile_revert" as const,
	action_id: "ra_5b81",
	label: "Revert",
	profile_kind: "agent" as const,
	profile_name: "Researcher",
	receipt_id: "rc_71bd",
};

const meta = {
	title: "Mesh/ProfileConsentCard",
	component: ProfileConsentCard,
	parameters: {
		layout: "padded",
		docs: {
			description: {
				component:
					"One profile proposal: the fields that change, BEFORE and AFTER, the record's state, and the one-click revert when a verified descriptor exists.",
			},
		},
	},
	args: { onRevert: () => {} },
} satisfies Meta<typeof ProfileConsentCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const approveActions = (
	<span className="text-meta text-ink-muted">
		Approve / Deny live in the host
	</span>
);

/** The ordinary case: an update to an agent profile with two changed columns. */
export const DisclosurePopulated: Story = {
	args: {
		view: profileCardView(row(), {
			profileApprovals: true,
			canApprove: true,
			canDeny: true,
		}),
		actions: approveActions,
	},
};

/** A team profile: the other family, whose authored columns differ. */
export const TeamProfile: Story = {
	args: {
		view: profileCardView(
			row(
				{},
				{
					disclosure: disclosure({
						profile_kind: "team",
						profile_operation: "create",
						target_id: "tm_launch",
						profile_name: "Launch team",
						changed_fields: ["manager", "members", "project"],
						before: null,
						after: {
							id: "tm_launch",
							name: "Launch team",
							label: "Launch",
							description: "Carries a launch to its release gate.",
							manager: "Researcher",
							members: [{ name: "Researcher" }, { name: "Reviewer" }],
							aliases: ["launch-crew"],
							instructions: "Follow the release runbook.",
							project: "Launch",
						},
					} as Partial<ProfileSaveDisclosure>),
				},
			),
			{ profileApprovals: true, canApprove: true, canDeny: true },
		),
		actions: approveActions,
	},
};

/** A queued, unattended proposal — filed by a teammate, waiting on this machine. */
export const QueuedUnattended: Story = {
	args: {
		view: profileCardView(row({ state: "requested" }), {
			profileApprovals: true,
			canApprove: true,
			canDeny: true,
		}),
		actions: approveActions,
	},
};

/** Denied: the safe direction, settled and read-only. */
export const Denied: Story = {
	args: {
		view: profileCardView(row({ state: "denied" }), { profileApprovals: true }),
	},
};

/** Expired while nobody answered: not saved, and no control is offered. */
export const Expired: Story = {
	args: {
		view: profileCardView(row({ state: "expired" }), {
			profileApprovals: true,
		}),
	},
};

/** Signed, not saved — the two facts the card keeps apart. */
export const ApprovedNotSaved: Story = {
	args: {
		view: profileCardView(row({ state: "approved" }), {
			profileApprovals: true,
			canRetryApply: true,
		}),
	},
};

/**
 * The kill-switch: a backend that does not advertise `profile_approvals`.
 *
 * The card still states the record and its diff, and says plainly that this
 * version cannot sign it — the shape that must appear when the kind is not
 * enabled on the backend.
 */
export const UnavailableBackend: Story = {
	args: {
		view: profileCardView(row(), { profileApprovals: false, canDeny: true }),
	},
};

/**
 * A typed block this build cannot read: the profile is named where the wire named
 * it, the diff is empty rather than invented, and nothing may be signed.
 */
export const LegacyUnknownAction: Story = {
	args: {
		view: profileCardView(row({}, { disclosure: null }), {
			profileApprovals: true,
			canDeny: true,
		}),
	},
};

/** No verified descriptor: the revert control does not render at all. */
export const UnavailableRevert: Story = {
	args: {
		view: profileCardView(row({ state: "connected" }), {
			profileApprovals: true,
		}),
		onRevert: undefined,
	},
};

/** The descriptor's resting state: one press, offered. */
export const RevertAvailable: Story = {
	args: {
		view: profileCardView(row({ state: "connected" }), {
			profileApprovals: true,
			revert: revertDescriptor,
		}),
	},
};

/** Dispatched, no answer yet: latched, so a second press cannot be sent. */
export const RevertPending: Story = {
	args: {
		view: profileCardView(row({ state: "connected" }), {
			profileApprovals: true,
			revert: revertDescriptor,
		}),
		onRevert: () => {},
	},
	render: (args) => (
		<ProfileConsentCard
			{...args}
			view={{
				...args.view,
				revert: profileRevertView(revertDescriptor, { submitted: true }),
			}}
		/>
	),
};

/** Answered: the record is back to the saved image, and the press is spent. */
export const RevertSuccess: Story = {
	args: {
		view: profileCardView(row({ state: "connected" }), {
			profileApprovals: true,
			revert: revertDescriptor,
		}),
	},
	render: (args) => (
		<ProfileConsentCard
			{...args}
			view={{
				...args.view,
				revert: profileRevertView(revertDescriptor, {
					outcome: { approved: true, state: "connected" },
				}),
			}}
		/>
	),
};

/** The answer was no: the descriptor stays usable, which is why this one is enabled. */
export const RevertFailure: Story = {
	args: {
		view: profileCardView(row({ state: "connected" }), {
			profileApprovals: true,
			revert: revertDescriptor,
		}),
	},
	render: (args) => (
		<ProfileConsentCard
			{...args}
			view={{
				...args.view,
				revert: profileRevertView(revertDescriptor, {
					outcome: { approved: false },
				}),
			}}
		/>
	),
};

/** Expired: the action id can no longer answer anything, so nothing is offered. */
export const RevertStale: Story = {
	args: {
		view: profileCardView(row({ state: "connected" }), {
			profileApprovals: true,
			revert: revertDescriptor,
		}),
	},
	render: (args) => (
		<ProfileConsentCard
			{...args}
			view={{
				...args.view,
				revert: profileRevertView(revertDescriptor, {
					outcome: { approved: true, state: "expired" },
				}),
			}}
		/>
	),
};
