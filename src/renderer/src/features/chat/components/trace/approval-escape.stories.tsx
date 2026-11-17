/**
 * The approval card's policy handles, in the states D9 added (onboarding
 * friction, 2026-11): 41 external users pressed "Set auto for all sessions"
 * and 10 rage-clicked it, because the result showed only in a status line the
 * dock's secondary region clipped. The pressed handle now says "Setting
 * auto..." and then the state that holds. Production `ApprovalEscapeControls`.
 */

import type { Meta, StoryObj } from "@storybook/react";
import {
	ApprovalEscapeControls,
	type ApprovalEscapeMode,
	type ApprovalEscapeProvenance,
	approvalPolicyLine,
	policyAfterSave,
} from "./approval-escape";

/* The gate as raised: ask, from the global default. */
const GATE: {
	mode: ApprovalEscapeMode;
	provenance: ApprovalEscapeProvenance;
	globalMode: ApprovalEscapeMode;
} = { mode: "ask", provenance: "global", globalMode: "ask" };
import "../../../../styles/index.css";

const meta: Meta<typeof ApprovalEscapeControls> = {
	title: "Chat/Approval escape",
	component: ApprovalEscapeControls,
	render: (args) => (
		<div className="w-[560px] bg-surface p-4">
			<ApprovalEscapeControls {...args} />
		</div>
	),
	args: {
		onSetSession: () => {},
		onSetAll: () => {},
		policyLine: "Approvals: Ask — global default.",
	},
};
export default meta;
type Story = StoryObj<typeof ApprovalEscapeControls>;

export const Idle: Story = {};
export const SettingAll: Story = { args: { busy: true, pending: "all" } };
/*
 * The saved frames carry the policy line `policyAfterSave` derives for that
 * outcome (design round 1, D4), not the gate's pre-press "Ask", which is what
 * the connected `ApprovalEscape` now renders.
 */
export const AllSessionsOn: Story = {
	args: {
		status: { kind: "default-saved" },
		policyLine: approvalPolicyLine(
			policyAfterSave({ kind: "default-saved" }, GATE),
		),
	},
};
export const SessionOn: Story = {
	args: {
		status: { kind: "session-saved" },
		policyLine: approvalPolicyLine(
			policyAfterSave({ kind: "session-saved" }, GATE),
		),
	},
};
export const DefaultSavedSessionRefused: Story = {
	args: {
		status: {
			kind: "default-saved-session-failed",
			detail: "this session needs operator authority",
		},
	},
};
export const Refused: Story = {
	args: {
		status: { kind: "refused", detail: "no operator anchor on this machine" },
	},
};
