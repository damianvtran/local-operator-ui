/**
 * The transcript's saved-profile card: what a `profile_save` call's own answer
 * says, and nothing else.
 *
 * WHY A PARSER RATHER THAN A PROP. A tool row's result is model-facing text. The
 * card may state a saved change only from a payload it can BOUND, so this module
 * accepts exactly the frozen shapes and returns `null` for everything else - the
 * caller then paints today's ordinary row, which is the honest rendering of an
 * answer this build cannot describe. A refactor of the ledger row is deliberately
 * not part of this: one tool name gains one card, as the image-gen card does.
 *
 * THE ACCEPTED SHAPES (all strict; anything else is `null`):
 *   1. the frozen disclosure object itself      -> the saved change, awaiting the decision;
 *   2. `{ disclosure, state?, revert?, revert_verified? }`;
 *   3. the queued receipt object itself         -> a proposal waiting on this machine;
 *   4. `{ receipt, state?, revert?, revert_verified? }`.
 *
 * THE REVERT BUTTON IS GATED TWICE, and both gates matter: the descriptor must
 * parse as the backend's own shape AND the envelope must carry
 * `revert_verified: true` — the backend's statement that it verified that
 * descriptor for this runtime. A descriptor we merely parsed is not verification,
 * and a tool result is exactly the kind of input that could carry one an agent
 * wrote.
 */

import {
	type ProfileRevertDescriptor,
	type ProfileSaveDisclosure,
	profileDisclosure,
	profileQueuedReceipt,
	profileRevertDescriptor,
} from "../../../../../../shared/profile-consent";
import {
	type ProfileCardState,
	type ProfileCardView,
	profileDisclosureView,
	profileRevertView,
} from "../../../mesh/mesh-profile-approval";

/** The calls this card owns. Anything else keeps its existing rendering. */
export const PROFILE_SAVE_TOOLS: ReadonlySet<string> = new Set([
	"profile_save",
	"profile_revert",
]);

export type ProfileSaveCall = {
	view: ProfileCardView;
	/**
	 * The verified descriptor, or `null`. `null` is what makes the control
	 * disappear: an absent action is not a disabled button with a mystery.
	 */
	descriptor: ProfileRevertDescriptor | null;
	/** The call's own lifecycle word, when the payload carried one. */
	state: ProfileCardState;
};

const STATE_WORDS: Readonly<Record<string, ProfileCardState>> = {
	queued: "waiting",
	requested: "waiting",
	approved: "approved_not_saved",
	saved: "saved",
	applied: "saved",
	denied: "denied",
	expired: "expired",
	failed: "stopped",
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The envelope's own keys, so a payload that grew one is refused rather than half-read. */
const ENVELOPE_KEYS = new Set([
	"disclosure",
	"receipt",
	"state",
	"revert",
	"revert_verified",
]);

function parsePayload(text: string): unknown {
	const trimmed = text.trim();
	if (!trimmed.startsWith("{")) return null;
	try {
		return JSON.parse(trimmed);
	} catch {
		return null;
	}
}

function fromDisclosure(
	disclosure: ProfileSaveDisclosure,
	envelope: Record<string, unknown> | null,
): ProfileSaveCall {
	const state = STATE_WORDS[stateWord(envelope)] ?? "waiting";
	const verified =
		envelope?.revert_verified === true
			? profileRevertDescriptor(envelope.revert)
			: null;
	return {
		view: profileDisclosureView(disclosure, {
			state,
			revert: verified ? profileRevertView(verified) : undefined,
		}),
		descriptor: verified,
		state,
	};
}

/**
 * The state word, lower-cased and bounded.
 *
 * A word this build does not know resolves to `waiting` rather than to a guess:
 * "the proposal is still there" is the safe reading of an answer that did not say
 * it was saved, and it is the one state a reader can act on.
 */
function stateWord(envelope: Record<string, unknown> | null): string {
	const value = envelope?.state;
	return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * The card a tool row's result earns, or `null` when it earns none.
 *
 * `output` is the call's result text as the transcript holds it; a row that has
 * not settled has none, and a running call keeps today's row because there is
 * nothing yet to state.
 */
export function profileSaveCall(record: {
	toolName: string;
	output: string;
}): ProfileSaveCall | null {
	if (!PROFILE_SAVE_TOOLS.has(record.toolName)) return null;
	const payload = parsePayload(record.output ?? "");
	if (!isRecord(payload)) return null;

	const direct = profileDisclosure(payload);
	if (direct) return fromDisclosure(direct, null);
	const receipt = profileQueuedReceipt(payload);
	if (receipt)
		return { view: receiptView(receipt), descriptor: null, state: "waiting" };

	for (const key of Object.keys(payload))
		if (!ENVELOPE_KEYS.has(key)) return null;
	const envelopeDisclosure = profileDisclosure(payload.disclosure);
	if (envelopeDisclosure) return fromDisclosure(envelopeDisclosure, payload);
	const envelopeReceipt = profileQueuedReceipt(payload.receipt);
	if (!envelopeReceipt) return null;
	const base = receiptView(envelopeReceipt);
	const verified =
		payload.revert_verified === true
			? profileRevertDescriptor(payload.revert)
			: null;
	return {
		view: {
			...base,
			state: STATE_WORDS[stateWord(payload)] ?? base.state,
			revert: verified ? profileRevertView(verified) : base.revert,
		},
		descriptor: verified,
		state: STATE_WORDS[stateWord(payload)] ?? base.state,
	};
}

/**
 * A queued receipt's card: the profile is named, the operation is the one the
 * receipt stands for, and no field is claimed — the receipt carries no images, and
 * a diff this card invented would be a diff nobody reviewed.
 */
function receiptView(receipt: {
	profile_kind: "agent" | "team";
	profile_name: string;
	scope: "global";
}): ProfileCardView {
	return {
		kind: receipt.profile_kind,
		name: receipt.profile_name,
		operation: "create",
		scope: receipt.scope,
		fields: [],
		state: "waiting",
		stateNote: null,
		canApprove: false,
		canDeny: false,
		canRetryApply: false,
		unavailableReason: null,
		revert: profileRevertView(null),
	};
}
