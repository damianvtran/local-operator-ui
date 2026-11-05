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

import { t } from "../../../../../../i18n/messages";
import {
	type ProfileRevertDescriptor,
	type ProfileSaveDisclosure,
	profileDisclosure,
	profileQueuedReceipt,
	profileRevertDescriptor,
} from "../../../../../../shared/profile-consent";

/** The receipt's parsed shape, taken from the one schema that defines it. */
type ProfileReceipt = NonNullable<ReturnType<typeof profileQueuedReceipt>>;
import {
	type ProfileCardState,
	type ProfileCardView,
	profileDisclosureView,
	profileRevertUnavailable,
} from "../../../mesh/mesh-profile-approval";

/** The calls this card owns. Anything else keeps its existing rendering. */
export const PROFILE_SAVE_TOOLS: ReadonlySet<string> = new Set([
	"profile_save",
	"profile_revert",
]);

export type ProfileSaveCall = {
	view: ProfileCardView;
	/**
	 * The descriptor this payload named, or `null`. Parsing it proves the SHAPE,
	 * never the right to execute: see `revertVerifiedByProducer`.
	 */
	descriptor: ProfileRevertDescriptor | null;
	/**
	 * What the payload CLAIMS about its descriptor (`revert_verified: true`).
	 *
	 * THIS IS EVIDENCE, NOT AUTHORITY (review R2). A persisted tool output can be
	 * replayed by a reload, a restored transcript or an agent that wrote it, so a
	 * flag in it records only what some producer once verified. Whether THIS runtime
	 * may answer the action is decided by the surface from the running backend's own
	 * registration and the conversation's gate identity — never from this boolean.
	 */
	revertVerifiedByProducer: boolean;
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
	"profile_action",
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
	/*
	 * THE DESCRIPTOR LIVES UNDER `details.profile_action`, and only there. Not
	 * `details.revert` (the legacy `{op: "revert", backup_id}` text hint) and not
	 * top level: a persisted payload may hold a legacy hint or an agent-authored
	 * object, and neither may draw a control.
	 */
	const descriptor = profileRevertDescriptor(envelope?.profile_action);
	return {
		view: profileDisclosureView(disclosure, {
			state,
			// The resting view is the UNAVAILABLE shape: only the surface, which
			// knows the running backend and the gate identity, may raise it.
			revert: descriptor ? profileRevertUnavailable() : undefined,
		}),
		descriptor,
		revertVerifiedByProducer: envelope?.revert_verified === true,
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
	/**
	 * The call's own `details` block, when the harness carried one.
	 *
	 * THE RECEIPT LIVES HERE, not only in the result text: the backend's
	 * `_queued_profile_receipt` puts `{status, fields, diff, …}` in `details`, and an
	 * applied card carries `fields`/`diff` there too. Reading only `output` was how
	 * a receipt with a real, backend-authored diff could read as "nothing changed".
	 */
	details?: Record<string, unknown> | null;
}): ProfileSaveCall | null {
	if (!PROFILE_SAVE_TOOLS.has(record.toolName)) return null;
	const payload = isRecord(record.details)
		? record.details
		: parsePayload(record.output ?? "");
	if (!isRecord(payload)) return null;

	const direct = profileDisclosure(payload);
	if (direct) return fromDisclosure(direct, null);
	const receipt = profileQueuedReceipt(payload);
	if (receipt)
		return {
			view: receiptView(receipt),
			descriptor: null,
			revertVerifiedByProducer: false,
			state: "waiting",
		};

	for (const key of Object.keys(payload))
		if (!ENVELOPE_KEYS.has(key)) return null;
	const envelopeDisclosure = profileDisclosure(payload.disclosure);
	if (envelopeDisclosure) return fromDisclosure(envelopeDisclosure, payload);
	const envelopeReceipt = profileQueuedReceipt(payload.receipt);
	if (!envelopeReceipt) return null;
	const base = receiptView(envelopeReceipt);
	const descriptor = profileRevertDescriptor(payload.profile_action);
	return {
		view: {
			...base,
			state: STATE_WORDS[stateWord(payload)] ?? base.state,
			revert: descriptor ? profileRevertUnavailable() : base.revert,
		},
		descriptor,
		revertVerifiedByProducer: payload.revert_verified === true,
		state: STATE_WORDS[stateWord(payload)] ?? base.state,
	};
}

/**
 * A queued receipt's card: the profile is named, the operation is the one the
 * receipt stands for, and no field is claimed — the receipt carries no images, and
 * a diff this card invented would be a diff nobody reviewed.
 */
function receiptView(receipt: ProfileReceipt): ProfileCardView {
	/*
	 * THE RECEIPT'S OWN LINES ARE THE CARD'S BODY when it has them. `fields` are the
	 * changed column names and `diff` the backend's human-readable summary — the one
	 * place a class/effort/tools/delegate change is stated in words, because those
	 * live inside `tags`. Rendered verbatim, never re-derived.
	 */
	const diffLines = receipt.diff ?? [];
	const changedFields = receipt.fields ?? [];
	return {
		kind: receipt.profile_kind,
		name: receipt.profile_name,
		operation: "create",
		scope: receipt.scope,
		// No before/after images: a receipt cannot fill the two-column diff.
		fields: [],
		changesIncluded: diffLines.length > 0 || changedFields.length > 0,
		diffLines,
		changedFieldNames: changedFields,
		state: receipt.status === "applied" ? "saved" : "waiting",
		stateNote:
			receipt.status === "applied"
				? null
				: t("ui.mesh.mesh_approvals.profile_waiting"),
		canApprove: false,
		canDeny: false,
		canRetryApply: false,
		unavailableReason: null,
		revert: profileRevertUnavailable(),
	};
}
