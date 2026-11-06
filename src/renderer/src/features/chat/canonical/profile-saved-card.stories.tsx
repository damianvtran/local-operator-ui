/**
 * The TRANSCRIPT's saved-profile card, driven through the transcript's own model.
 *
 * WHY THIS FILE EXISTS. The card in the conversation is reached by a tool row,
 * and a browser capture of a whole chat turn would need a session and a model
 * call to get there. These stories skip the turn and keep the interesting part:
 * `profileSaveCall` — the shipped parser the transcript runs — is handed the
 * `output` string a `profile_save` call returns, and the resulting view is drawn
 * by the shipped `ProfileConsentCard`. So the state under test is the state a
 * real row would paint; only the session around it is missing.
 *
 * THE FIXTURES ARE THE FROZEN v1 SHAPES: the disclosure from
 * `local_operator/profile_approval.py::disclosure`, the queued receipt from the
 * tool's own answer, and the `profile_revert` descriptor the backend agreed. The
 * `profile_save` kind is NOT registered on shipping backends (a C5 decision is
 * pending), so these are proof-of-shape, not a live approval.
 *
 * NO CONTROL IS CLICKABLE HERE. The revert press belongs to the conversation that
 * answers the gate (`sessions.answer` with the row's epoch), so a story draws the
 * resting `available` state and passes no handler — which is exactly the
 * kill-switch's second arm: descriptor present, no verified dispatch, control
 * disabled with its reason.
 */

import type { Meta, StoryObj } from "@storybook/react";
import {
	type ProfileRevertDescriptor,
	profileRevertDescriptor,
} from "../../../../../shared/profile-consent";
import type { ProfileCardView } from "../../mesh/mesh-profile-approval";
import {
	GOLDEN_QUEUED_TOOL_RESULT,
	GOLDEN_SAVED_AGENT_TOOL_RESULT,
} from "../../mesh/profile-action-golden";
import { ProfileConsentCard } from "../../mesh/profile-consent-card";
import { profileSaveCall } from "../components/trace/profile-save-card-model";

const digest = `sha256:${"a".repeat(64)}`;

const agentImage = (over: Record<string, unknown> = {}) => ({
	id: "ag_researcher",
	name: "Researcher",
	label: "Research agent",
	description: "Reads papers and keeps the notes.",
	tags: ["research"],
	categories: ["analysis"],
	model: "anthropic/claude-opus-5-5",
	instructions: "Read sources before summarising.",
	...over,
});

const disclosure = (over: Record<string, unknown> = {}) => ({
	version: 1,
	operation: "profile_save",
	approval_id: "ap_dem1234",
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
});

/*
 * THE ARTIFACT'S OWN DESCRIPTOR, verbatim - parsed through the shipped schema so a
 * drift fails here rather than in a preflight. No minted id, no chosen receipt.
 */
const revert = profileRevertDescriptor(
	GOLDEN_SAVED_AGENT_TOOL_RESULT.details.profile_action,
) as ProfileRevertDescriptor;
if (!revert) throw new Error("the artifact's descriptor no longer parses");

/** The call's `output` as the transcript holds it: the settled result's text. */
const viewOf = (output: unknown): ProfileCardView => {
	const call = profileSaveCall({
		toolName: "agent",
		output: typeof output === "string" ? output : JSON.stringify(output),
	});
	if (!call) throw new Error("fixture is not a bound profile answer");
	return call.view;
};

const meta = {
	title: "Chat/ProfileSavedCard",
	component: ProfileConsentCard,
	parameters: {
		layout: "padded",
		docs: {
			description: {
				component:
					"The conversation's saved-profile card: what the profile_save answer itself carried — profile, scope, operation, the changed fields BEFORE/AFTER, and the one-click revert when the backend verified a descriptor.",
			},
		},
	},
} satisfies Meta<typeof ProfileConsentCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The saved change, from the artifact's real result.
 *
 * THE CONTROL IS NOT ENABLED HERE, deliberately: a descriptor is not permission, and a
 * story that handed itself `enabled: true` would photograph a state the product cannot
 * produce. The enabled affordance is `ScriptedTransportEnabled` in the mesh set, where
 * a scripted `available` ACK causes it.
 */
export const Saved: Story = {
	args: { view: viewOf(GOLDEN_SAVED_AGENT_TOOL_RESULT.details) },
};

/** The same answer without the backend's verification: the press is not offered. */
export const UnverifiedRevert: Story = {
	args: { view: viewOf({ disclosure: disclosure(), state: "applied" }) },
};

/** An unattended proposal, from the artifact's real queued receipt. */
export const QueuedReceipt: Story = {
	args: { view: viewOf(GOLDEN_QUEUED_TOOL_RESULT.details) },
};

/** Denied: the change never happened, and the card offers nothing. */
export const Denied: Story = {
	args: { view: viewOf({ disclosure: disclosure(), state: "denied" }) },
};

/** Expired before anyone answered. */
export const Expired: Story = {
	args: { view: viewOf({ disclosure: disclosure(), state: "expired" }) },
};

/** The disclosure alone (no state word): a proposal still waiting. */
export const DisclosureOnly: Story = {
	args: { view: viewOf(disclosure()) },
};

/** A team profile: the other family, whose authored columns differ. */
export const TeamProfile: Story = {
	args: {
		view: viewOf({
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
			}),
			state: "applied",
		}),
	},
};
