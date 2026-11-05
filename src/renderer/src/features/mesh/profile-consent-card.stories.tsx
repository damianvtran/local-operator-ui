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
import { useEffect, useState } from "react";
import {
	type ProfileSaveDisclosure,
	profileRevertDescriptor,
} from "../../../../shared/profile-consent";
import { profileSaveCall } from "../chat/components/trace/profile-save-card-model";
import { approvalRows } from "./mesh-approvals";
import { profileCardView, profileRevertView } from "./mesh-profile-approval";
import {
	GOLDEN_APPROVAL_ROWS,
	GOLDEN_QUEUED_TOOL_RESULT,
	GOLDEN_SAVED_AGENT_TOOL_RESULT,
} from "./profile-action-golden";
import { ProfileConsentCard } from "./profile-consent-card";
import {
	SCRIPTED_REVERT_DESCRIPTOR,
	type ScriptedRevertSequence,
	runScriptedRevertSequence,
} from "./profile-revert-scripted";

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
						/*
						 * THE LEGACY TOKEN, because that is what `row_fields` emits on every
						 * typed row (`desktop_approval.py:382`). The old fixture wrote the
						 * newer label and so photographed a shape no daemon serves.
						 */
						action: "approve-credential",
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

/**
 * The card for a golden ToolResult's `details`, through the SHIPPED parser.
 *
 * `profileSaveCall` is what the transcript calls, so a story cannot photograph a
 * shape the app would never build - and a fixture that stops parsing throws HERE
 * instead of quietly painting the fallback row.
 */
function goldenView(details: Record<string, unknown>) {
	const result = profileSaveCall({
		toolName: "agent",
		output: "",
		details,
	});
	if (!result) throw new Error("a golden fixture no longer parses");
	return result.view;
}

/**
 * THE ARTIFACT'S OWN DESCRIPTOR, verbatim.
 *
 * Not a minted id and not a chosen `receipt_id`: `saved_agent_tool_result.details`
 * carries `{action_id, kind, label, profile_kind, profile_name, receipt_id, schema}`,
 * and this is exactly that object, so the story cannot disagree with the wire about
 * which record the control refers to.
 */
const revertDescriptor = (() => {
	const parsed = profileRevertDescriptor(
		GOLDEN_SAVED_AGENT_TOOL_RESULT.details.profile_action,
	);
	// The artifact's own descriptor must parse through the shipped schema; if it
	// stops, every revert story below is photographing a control that cannot exist.
	if (!parsed) throw new Error("the artifact's descriptor no longer parses");
	return parsed;
})();

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

/**
 * THE POSITIVE ROW, STRAIGHT FROM THE WIRE.
 *
 * `PROFILE_APPROVAL_LIST_WIRE` is a `GET /v1/desktop/approvals` response in the
 * daemon's own serialisation, and it goes through the shipped `approvalRows` and
 * `profileCardView`. That is the point: the story cannot photograph a card the app
 * would not build, and if the daemon's block moves, `profile-approval-fixtures.test.mjs`
 * fails rather than the card quietly degrading to its unsupported state.
 */
export const DisclosurePopulated: Story = {
	args: {
		view: profileCardView(
			approvalRows({ approvals: GOLDEN_APPROVAL_ROWS })[0],
			{
				profileApprovals: true,
				canApprove: true,
				canDeny: true,
			},
		),
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
							/*
							 * `TeamMember` as `local_operator/teams.py` declares it: `role` is the
							 * authored field, and `{name}` (what this fixture used to carry) is a
							 * shape the wire never had - which is exactly why a roster change
							 * once read as "no changes" (review R1/R2.3).
							 */
							members: [
								{ role: "Researcher", count: 2, tier: "hi" },
								{ role: "Reviewer", saver: false },
							],
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

/** The record after a successful apply: saved, with its own outcome sentence. */
export const Saved: Story = {
	args: {
		/*
		 * A REAL SAVED TOOL RESULT through the shipped parser: the card the transcript
		 * paints after an apply, with the backend's own `diff` lines and the agreed
		 * `profile_action` descriptor.
		 */
		view: goldenView(GOLDEN_SAVED_AGENT_TOOL_RESULT.details),
	},
};

/** A queued, unattended proposal — filed by a teammate, waiting on this machine. */
export const QueuedUnattended: Story = {
	args: {
		/*
		 * A RECEIPT, not a disclosure: this is the chat-side shape a queued proposal
		 * arrives as (`_queued_profile_receipt`), so the state under test is the one
		 * the transcript paints - including the backend's own `diff` lines, which is
		 * where a policy change becomes readable.
		 */
		view: goldenView(GOLDEN_QUEUED_TOOL_RESULT.details),
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

/**
 * The ENABLED affordance, driven by a SCRIPTED TRANSPORT (`profile-revert-scripted.ts`).
 *
 * The control exists only after the artifact's correlated `agent.available` ACK for
 * this exact identity, and the press settles on its `applied` frame — no descriptor
 * alone and no persisted flag enables it.
 *
 * SCRIPTED TRANSPORT — NO BACKEND PROFILE WRITE.
 */
function ScriptedTransportStory() {
	const [view, setView] = useState(() =>
		profileCardView(row({ state: "connected" }), { profileApprovals: true }),
	);
	const [sequence, setSequence] = useState<ScriptedRevertSequence | null>(null);
	useEffect(() => {
		void runScriptedRevertSequence().then(setSequence);
	}, []);
	useEffect(() => {
		if (!sequence) return;
		const enabled = sequence.authority.enabled;
		const settled = sequence.settled.state;
		setView((base) => ({
			...base,
			revert: profileRevertView(SCRIPTED_REVERT_DESCRIPTOR, {
				// The ENABLED arm is the scripted `available`; the settled arm is the
				// artifact's `applied` frame. Nothing here reads a persisted flag.
				...(enabled && settled === "available"
					? {}
					: settled === "pending"
						? { submitted: true }
						: {
								outcome: { approved: settled === "succeeded", state: settled },
							}),
			}),
		}));
	}, [sequence]);
	return (
		<ProfileConsentCard
			view={view}
			onRevert={() => {
				void runScriptedRevertSequence().then(setSequence);
			}}
		/>
	);
}

export const ScriptedTransportEnabled: Story = {
	args: {
		/*
		 * THE RESTING SHAPE OFFERS NOTHING: no descriptor-backed `revert` is handed in,
		 * so nothing can be enabled before the scripted read answers.
		 */
		view: profileCardView(row({ state: "connected" }), {
			profileApprovals: true,
		}),
	},
	render: () => <ScriptedTransportStory />,
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
