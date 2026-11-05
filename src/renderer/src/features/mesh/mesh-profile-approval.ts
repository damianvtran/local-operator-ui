/**
 * The profile-save card's pure half: the one place a row or a saved tool result
 * becomes the words and states its surface paints.
 *
 * WHY A MODULE RATHER THAN LOGIC IN THE CARD. Three surfaces state the same
 * record — the Mesh durable inbox, the chat transcript's saved card, and the
 * stories that exist so a designer can look at every state without a backend —
 * and a card that derived its own labels would be the second opinion about what
 * "cleared" means. Everything that is not JSX lives here, so the states are
 * testable and no rendering path can invent a fifteenth one.
 *
 * THE BACKEND IS NOT SHIPPING THIS KIND YET (`profile_save` is removed from
 * production registration pending a C5 decision), so every function here must be
 * safe with a row that carries NO typed block at all: that is the kill-switch the
 * surfaces render as an honest sentence, never as a disabled guess.
 */

import { t } from "../../../../i18n/messages";
import {
	PROFILE_KINDS,
	type ProfileFieldRow,
	type ProfileKind,
	type ProfileOperation,
	type ProfileQueuedReceipt,
	type ProfileRevertDescriptor,
	type ProfileRevertState,
	type ProfileSaveDisclosure,
	profileFieldRows,
	profileRevertState,
} from "../../../../shared/profile-consent";
import type { MeshApprovalRow } from "./mesh-approvals";

/** One authored column's BEFORE/AFTER cell pair, as the card draws it. */
export type ProfileFieldView = ProfileFieldRow;

/** The card's own vocabulary for the record's lifecycle, independent of the store's states. */
export type ProfileCardState =
	| "waiting"
	| "approved_not_saved"
	| "saved"
	| "denied"
	| "expired"
	| "stopped"
	| "unknown";

export type ProfileCardView = {
	/** `agent`/`team`, or `null` when the row did not say — never guessed. */
	kind: ProfileKind | null;
	/** The profile's authored name, or the empty string when the wire carried none. */
	name: string;
	operation: ProfileOperation | null;
	scope: "global" | null;
	/** The authored columns that differ, BEFORE and AFTER, from the disclosure's own images. */
	fields: ProfileFieldView[];
	/** The record's lifecycle in this card's words. */
	state: ProfileCardState;
	/** The state's own sentence; `null` when the store's label is already the honest one. */
	stateNote: string | null;
	/** Whether an Approve may be sent from here (capability + server's own signable answer). */
	canApprove: boolean;
	canDeny: boolean;
	/** A signed card whose apply did not finish and whose outcome allows a retry. */
	canRetryApply: boolean;
	/**
	 * WHY this card cannot be signed here, when it cannot and the row still waits.
	 * `null` when signing is offered or the record is no longer waiting.
	 */
	unavailableReason: string | null;
	/** The one-click revert, when a verified descriptor reached this surface. */
	revert: ProfileRevertView;
};

export type ProfileRevertView = {
	state: ProfileRevertState;
	enabled: boolean;
	/** The descriptor's own label, or the app's `Revert` when it carried none. */
	label: string;
	/** The sentence beside the control; the honest reason when it is not offered. */
	note: string | null;
	descriptor: ProfileRevertDescriptor | null;
};

/**
 * The revert control's honest default: nothing verified, nothing offered.
 *
 * Exported because it is the KILL-SWITCH, not a convenience: a surface with no
 * verified descriptor must render this exact shape (disabled, with the reason),
 * and every story covering the kill-switch builds it from this constant so the
 * state under test is the state that ships.
 */
export function profileRevertUnavailable(): ProfileRevertView {
	return {
		state: "unavailable",
		enabled: false,
		label: t("ui.mesh.mesh_approvals.profile_revert"),
		note: t("ui.mesh.mesh_approvals.profile_revert_unavailable"),
		descriptor: null,
	};
}

export function profileKindLabel(kind: ProfileKind): string {
	return kind === "agent"
		? t("ui.mesh.mesh_approvals.profile_kind_agent")
		: t("ui.mesh.mesh_approvals.profile_kind_team");
}

export function profileOperationLabel(operation: ProfileOperation): string {
	switch (operation) {
		case "create":
			return t("ui.mesh.mesh_approvals.profile_operation_create");
		case "update":
			return t("ui.mesh.mesh_approvals.profile_operation_update");
		default:
			return t("ui.mesh.mesh_approvals.profile_operation_revert");
	}
}

/**
 * What the state says, in the card's own vocabulary.
 *
 * `approved_not_saved` is the arm that exists because the two facts are separate:
 * a signature is not a write, and a card that said `Saved` on a signed record
 * would be the exact false claim the backup/revert path exists to avoid.
 */
function cardState(
	row: MeshApprovalRow,
	canRetryApply: boolean,
): { state: ProfileCardState; note: string | null } {
	switch (row.state) {
		case "requested":
			return {
				state: "waiting",
				note: t("ui.mesh.mesh_approvals.profile_waiting"),
			};
		case "approved":
			return {
				state: "approved_not_saved",
				note: canRetryApply
					? t("ui.mesh.approval.retry_hint")
					: t("ui.mesh.approval.approved_not_applied"),
			};
		case "connected":
			return { state: "saved", note: null };
		case "denied":
			return { state: "denied", note: null };
		case "expired":
			return { state: "expired", note: null };
		case "failed":
			return {
				state: "stopped",
				note: canRetryApply
					? t("ui.mesh.approval.retry_hint")
					: t("ui.mesh.approval.could_not_apply"),
			};
		default:
			return { state: "unknown", note: null };
	}
}

/**
 * The card from a Mesh row.
 *
 * `capabilities.profileApprovals` is the backend's own advertisement, and it is
 * read here rather than in the JSX so a story can state the kill-switch as a
 * capability that is absent, not as a component that forgot to ask.
 */
export function profileCardView(
	row: MeshApprovalRow,
	{
		profileApprovals = false,
		canApprove = false,
		canDeny = false,
		canRetryApply = false,
		revert = null,
	}: {
		profileApprovals?: boolean;
		canApprove?: boolean;
		canDeny?: boolean;
		canRetryApply?: boolean;
		/** The verified descriptor this surface was handed, if any. */
		revert?: ProfileRevertDescriptor | null;
	} = {},
): ProfileCardView {
	const disclosure: ProfileSaveDisclosure | null =
		row.profile?.disclosure ?? null;
	const waiting = row.state === "requested";
	/*
	 * THE DISCLOSURE IS THE ONLY SOURCE OF THE CARD'S FACTS. A row whose typed
	 * block is missing or malformed still renders — with its profile named where
	 * the wire named one — and offers nothing, because the values that would be
	 * signed are exactly the ones this build could not read.
	 */
	const kind = disclosure?.profile_kind ?? null;
	const fields = disclosure ? profileFieldRows(disclosure) : [];
	const state = cardState(row, canRetryApply);
	const unavailableReason =
		waiting && !canApprove
			? profileApprovals
				? t("ui.mesh.mesh_approvals.profile_approval_unavailable")
				: t("ui.mesh.mesh_approvals.profile_unavailable")
			: null;
	return {
		kind,
		name: disclosure?.profile_name ?? "",
		operation: disclosure?.profile_operation ?? null,
		scope: disclosure?.scope ?? null,
		fields,
		state: state.state,
		stateNote: state.note,
		canApprove,
		canDeny,
		canRetryApply,
		unavailableReason,
		revert: revert ? profileRevertView(revert) : profileRevertUnavailable(),
	};
}

/**
 * The revert control's view for a VERIFIED descriptor, before any press.
 *
 * The states that need a transcript (pending, a result, a spent action) are
 * resolved by `profileRevertState` at the surface that owns them; this is the
 * descriptor's own resting shape, which is `available`.
 */
export function profileRevertView(
	descriptor: ProfileRevertDescriptor | null,
	options: {
		submitted?: boolean;
		outcome?: { approved: boolean; state?: string } | null;
		alreadyAnswered?: boolean;
		reconstructed?: boolean;
	} = {},
): ProfileRevertView {
	if (!descriptor) return profileRevertUnavailable();
	const resolved = profileRevertState({
		descriptor,
		descriptorVerified: true,
		...options,
	});
	return {
		state: resolved.state,
		enabled: resolved.enabled,
		label: descriptor.label || t("ui.mesh.mesh_approvals.profile_revert"),
		note: revertNote(resolved.state),
		descriptor,
	};
}

function revertNote(state: ProfileRevertState): string | null {
	switch (state) {
		case "available":
			return null;
		case "pending":
			return t("ui.mesh.mesh_approvals.profile_revert_pending");
		case "saved":
			return t("ui.mesh.mesh_approvals.profile_revert_done");
		case "stale":
			return t("ui.mesh.mesh_approvals.profile_revert_stale");
		case "failed":
			return t("ui.mesh.mesh_approvals.profile_revert_failed");
		default:
			return t("ui.mesh.mesh_approvals.profile_revert_unavailable");
	}
}

/**
 * The chat card's view of a tool call's own answer.
 *
 * A `profile_save` call answers with the queued receipt (an unattended proposal)
 * or with a decision — and a queued receipt is NOT a saved profile, so the card
 * says `waiting` and names the approval it waits on. Anything else (a legacy
 * answer, a refusal, a shape this build cannot read) yields `null`: the caller
 * then paints the ordinary tool row, which is the truthful rendering of a call
 * this build cannot describe.
 */
export function profileReceiptView(
	receipt: ProfileQueuedReceipt,
): ProfileCardView {
	return {
		kind: receipt.profile_kind,
		name: receipt.profile_name,
		operation: "create",
		scope: receipt.scope,
		fields: [],
		state: "waiting",
		stateNote: t("ui.mesh.mesh_approvals.profile_waiting"),
		canApprove: false,
		canDeny: false,
		canRetryApply: false,
		unavailableReason: null,
		revert: profileRevertUnavailable(),
	};
}

/**
 * The card from a DISCLOSURE and a lifecycle state, with no approval row behind it.
 *
 * The transcript's saved card has the same statement to make as the inbox card and
 * none of the inbox's machinery: there is no store state to read, no signable row
 * to gate, and nothing to approve - only what was saved and the one press that can
 * undo it. Sharing this builder is what keeps the two surfaces from describing the
 * same record in two voices.
 */
export function profileDisclosureView(
	disclosure: ProfileSaveDisclosure,
	{
		state = "waiting",
		revert,
	}: {
		state?: ProfileCardState;
		revert?: ProfileRevertView;
	} = {},
): ProfileCardView {
	return {
		kind: disclosure.profile_kind,
		name: disclosure.profile_name,
		operation: disclosure.profile_operation,
		scope: disclosure.scope,
		fields: profileFieldRows(disclosure),
		state,
		stateNote: stateNoteFor(state),
		canApprove: false,
		canDeny: false,
		canRetryApply: false,
		unavailableReason: null,
		revert: revert ?? profileRevertUnavailable(),
	};
}

/**
 * A lifecycle state's own sentence, or `null` where the state word is already the
 * whole fact (`saved`, `denied`, `expired`).
 */
export function stateNoteFor(state: ProfileCardState): string | null {
	switch (state) {
		case "waiting":
			return t("ui.mesh.mesh_approvals.profile_waiting");
		case "approved_not_saved":
			return t("ui.mesh.approval.approved_not_applied");
		case "stopped":
			return t("ui.mesh.approval.could_not_apply");
		default:
			return null;
	}
}

/** Whether a title-level chip should name the family (a card without a disclosure cannot). */
export function profileKindOf(row: MeshApprovalRow): ProfileKind | null {
	const kind = row.profile?.disclosure?.profile_kind;
	return kind && PROFILE_KINDS.includes(kind) ? kind : null;
}
