/**
 * The profile-save consent contract: what a saved agent/team profile card may
 * claim, and the ONE place its wire shapes are bounded.
 *
 * WHY THIS IS SHARED RATHER THAN IN THE MESH FEATURE. Two surfaces state the same
 * fact about the same signed record: the Mesh approvals tray (the durable inbox,
 * which must still hold an unattended proposal after a restart) and the chat
 * transcript's saved card (the tool call's own receipt, with the one-click
 * revert). A second parser beside the first is how the two start disagreeing
 * about which field changed, so the row normaliser and the chat card both read
 * this module and neither re-interprets a payload.
 *
 * THE WIRE IS THE BACKEND'S, FIELD FOR FIELD, and it is closed: every schema
 * here is `.strict()`, because a payload that grew a field this build does not
 * know is one this build would render as a claim it never bounded. The disclosure
 * block mirrors `local_operator/profile_approval.py::disclosure`, the queued
 * receipt the tool's own answer, and the revert descriptor the backend's
 * `profile_revert` action.
 *
 * NO MANUFACTURED PLACEHOLDERS. An authored column is `undefined` when the wire
 * omitted it and `null` when the wire said "explicitly none" (the agent `model`
 * is the one nullable authored field). The two are different facts — a reset
 * versus a build that never carried the column — so `profileFieldRows` reports
 * three states rather than flattening them into one empty string.
 */

import { z } from "zod";

export const PROFILE_SAVE_OPERATION = "profile_save" as const;
export const PROFILE_REVERT_KIND = "profile_revert" as const;

/** The two profile families the backend authors. */
export const PROFILE_KINDS = ["agent", "team"] as const;
export type ProfileKind = (typeof PROFILE_KINDS)[number];

/** `create`/`update`/`revert` — the proposal's own operation, not the desktop op. */
export const PROFILE_OPERATIONS = ["create", "update", "revert"] as const;
export type ProfileOperation = (typeof PROFILE_OPERATIONS)[number];

/** The only scope v1 mints; a wider value is a contract change, not a guess. */
export const PROFILE_SCOPES = ["global"] as const;

/**
 * The authored columns, per family, in the order a reader compares them.
 *
 * `id` and `name` are deliberately absent: they identify the record rather than
 * describe it, and the backend's own `changed_fields` excludes them
 * (`profile_approval.disclosure`), so listing them would show a diff row for a
 * rename that the disclosure does not claim.
 */
export const PROFILE_AUTHORED_FIELDS: Readonly<
	Record<ProfileKind, readonly string[]>
> = {
	agent: [
		"label",
		"description",
		"tags",
		"categories",
		"model",
		"instructions",
	],
	team: [
		"label",
		"description",
		"manager",
		"members",
		"aliases",
		"instructions",
		"project",
	],
};

/*
 * The bounds are the backend models' own (`profile_approval.AgentImage` and
 * `TeamImage`). Restating them is the point: a client that accepted 200_000
 * characters of instructions would render a card the server would have refused,
 * and the reader would be reviewing a proposal that cannot be signed.
 */
const authoredText = z.string().max(100_000);
const shortText = (max: number) => z.string().max(max);
const token = z
	.string()
	.min(1)
	.max(160)
	.regex(/^[A-Za-z0-9_-]+$/);
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);

/**
 * One authored column's value, as the wire may spell it: a string, a list of
 * strings, a team-member row, or an explicit `null` reset.
 */
const authoredValue = z.union([
	z.string().max(100_000),
	z.array(z.string().max(512)).max(128),
	z.array(z.record(z.string(), z.unknown())).max(64),
	z.null(),
]);

/**
 * An agent image, closed. `model` is nullable because the backend authors a
 * reset as `null`; every other column is required by the model, so an absent one
 * is a payload this build refuses rather than repairs.
 */
export const profileAgentImageSchema = z
	.object({
		id: token,
		name: z.string().min(1).max(128),
		label: shortText(256),
		description: shortText(16_000),
		tags: z.array(shortText(512)).max(128),
		categories: z.array(shortText(128)).max(32),
		model: shortText(512).nullable(),
		instructions: authoredText,
	})
	.strict();

export const profileTeamImageSchema = z
	.object({
		id: token,
		name: z.string().min(1).max(128),
		label: shortText(256),
		description: shortText(16_000),
		manager: z.string().min(1).max(128),
		/*
		 * A member is the existing `TeamMember` wire, which this build does not
		 * own; the fields the card reads (`name`, `kind`) stay optional so an
		 * unknown member shape is COUNTED rather than rejected — refusing the
		 * whole card because the core added a member field would hide the
		 * disclosure the operator needs to review.
		 */
		members: z
			.array(
				z
					.object({
						name: z.string().max(128).optional(),
						kind: z.string().max(64).optional(),
					})
					.passthrough(),
			)
			.max(64),
		aliases: z.array(shortText(128)).max(32),
		instructions: authoredText,
		project: authoredText,
	})
	.strict();

export type ProfileAgentImage = z.infer<typeof profileAgentImageSchema>;
export type ProfileTeamImage = z.infer<typeof profileTeamImageSchema>;
export type ProfileImage = ProfileAgentImage | ProfileTeamImage;

/**
 * The disclosure the card reviews, and the digests that bind it.
 *
 * THE DIGESTS ARE CARRIED, NEVER COMPUTED HERE: the renderer has no canonical
 * JSON encoder matching the server's, so a digest minted in this process would be
 * a claim about bytes the server never served. Both are echoed verbatim from the
 * record on disk, and a mismatch is refused by the server before any signer runs.
 */
export const profileSaveDisclosureSchema = z
	.object({
		version: z.literal(1),
		operation: z.literal(PROFILE_SAVE_OPERATION),
		approval_id: z.string().min(1).max(64),
		profile_kind: z.enum(PROFILE_KINDS),
		scope: z.literal("global"),
		profile_operation: z.enum(PROFILE_OPERATIONS),
		target_id: token,
		profile_name: z.string().min(1).max(128),
		session_id: token,
		tool_call_id: token,
		receipt_id: token,
		changed_fields: z.array(z.string().max(64)).max(32),
		before: z.record(z.string(), authoredValue).nullable(),
		after: z.record(z.string(), authoredValue),
		base_commitment: digest,
		after_commitment: digest,
		expires_at: z.number().finite(),
		signing_principal: z.string().min(1).max(160),
	})
	.strict();

export type ProfileSaveDisclosure = z.infer<typeof profileSaveDisclosureSchema>;

/** The typed block a profile row carries (`typed_approval`), closed like the wire's. */
export const profileTypedApprovalSchema = z
	.object({
		action: z.literal("approve-operation"),
		operation: z.literal(PROFILE_SAVE_OPERATION),
		request_digest: digest,
		disclosure_digest: digest,
		disclosure: profileSaveDisclosureSchema.nullable(),
		/**
		 * The server's own answer to "may THIS host sign it". Absent reads false:
		 * an optimistic optional field must never enable a signature.
		 */
		signable_here: z.boolean(),
		refusal: z.string().max(64),
		refusal_message: z.string().max(2000),
		apply_outcome: z
			.object({
				code: z.string().max(64),
				retryable: z.boolean(),
				reason: z.string().max(2000),
				remedy: z.string().max(2000),
			})
			.strict()
			.nullable(),
	})
	.strict();

export type ProfileTypedApproval = z.infer<typeof profileTypedApprovalSchema>;

/**
 * What the tool answered when it filed the proposal: the queued receipt the chat
 * card is built from. `status` is the only arm v1 mints; a saved/deferred answer
 * is a DIFFERENT result and is not coerced into this one.
 */
export const profileQueuedReceiptSchema = z
	.object({
		status: z.literal("queued"),
		approval_id: z.string().min(1).max(64),
		request_digest: digest,
		expires_at: z.number().finite(),
		receipt_id: token,
		profile_kind: z.enum(PROFILE_KINDS),
		profile_name: z.string().min(1).max(128),
		scope: z.literal("global"),
	})
	.strict();

export type ProfileQueuedReceipt = z.infer<typeof profileQueuedReceiptSchema>;

/**
 * The revert descriptor — the ONLY thing that may draw a Revert button.
 *
 * Every field is namespaced (`profile_*`) and the kind is spelled, because a
 * descriptor is untrusted input that arrives beside a tool result: a model-authored
 * shape, a rebuilt transcript or a stale payload must not look like this one. A
 * descriptor that fails this schema is not "unknown"; it is a reason to offer
 * nothing, which is why the caller renders `unavailable` rather than a disabled
 * guess.
 */
export const profileRevertDescriptorSchema = z
	.object({
		schema: z.literal(1),
		kind: z.literal(PROFILE_REVERT_KIND),
		action_id: z
			.string()
			.min(1)
			.max(64)
			.regex(/^[A-Za-z0-9_-]+$/),
		label: z.string().min(1).max(64),
		profile_kind: z.enum(PROFILE_KINDS),
		profile_name: z.string().min(1).max(128),
		receipt_id: token,
	})
	.strict();

export type ProfileRevertDescriptor = z.infer<
	typeof profileRevertDescriptorSchema
>;

/* --------------------------------------------------------- the diff rows */

/** One authored column's three-valued state. */
export type ProfileFieldPresence = "set" | "unset" | "absent";

export type ProfileFieldRow = {
	field: string;
	before: { presence: ProfileFieldPresence; text: string };
	after: { presence: ProfileFieldPresence; text: string };
};

function valueText(value: unknown): string {
	if (typeof value === "string") return value;
	if (Array.isArray(value))
		return value
			.map((entry) =>
				typeof entry === "string"
					? entry
					: typeof entry === "object" && entry !== null
						? String((entry as { name?: unknown }).name ?? "")
						: "",
			)
			.filter((entry) => entry !== "")
			.join(", ");
	return "";
}

function presenceOf(
	image: Record<string, unknown> | null,
	field: string,
): { presence: ProfileFieldPresence; text: string } {
	if (image === null) return { presence: "absent", text: "" };
	if (!Object.prototype.hasOwnProperty.call(image, field))
		return { presence: "absent", text: "" };
	if (image[field] === null) return { presence: "unset", text: "" };
	return { presence: "set", text: valueText(image[field]) };
}

/**
 * The BEFORE/AFTER rows the card draws, derived from the disclosure's OWN images.
 *
 * THE FIELD LIST IS THE DISCLOSURE'S, filtered to columns this build knows for
 * the family. A `changed_fields` entry the images do not carry is dropped rather
 * than rendered as an empty pair (that would be a placeholder for a change
 * nobody can see), and a column whose two sides are equal is dropped for the same
 * reason: the card's job is what changed.
 *
 * `model`, `members` and every other authored column appear when — and only when —
 * the disclosure lists them, so a tools/class column that a future backend adds
 * arrives as one more row through `PROFILE_AUTHORED_FIELDS`, and this module never
 * invents one.
 */
export function profileFieldRows(
	disclosure: ProfileSaveDisclosure,
): ProfileFieldRow[] {
	const known = PROFILE_AUTHORED_FIELDS[disclosure.profile_kind];
	const rows: ProfileFieldRow[] = [];
	for (const field of disclosure.changed_fields) {
		if (!known.includes(field)) continue;
		const before = presenceOf(disclosure.before, field);
		const after = presenceOf(disclosure.after, field);
		if (before.presence === "set" && after.presence === "set") {
			if (before.text === after.text) continue;
		} else if (
			before.presence === after.presence &&
			before.presence === "absent"
		) {
			continue;
		}
		rows.push({ field, before, after });
	}
	return rows;
}

/* -------------------------------------------------------- the revert states */

/**
 * The Revert button's whole state vocabulary.
 *
 * `unavailable` is a LOAD-BEARING state, not an error: a saved card whose
 * descriptor did not survive the reload must say so plainly instead of drawing a
 * dead button, because the one thing a consent surface may never do is offer a
 * press that cannot work.
 */
export const PROFILE_REVERT_STATES = [
	"available",
	"pending",
	"saved",
	"stale",
	"failed",
	"unavailable",
] as const;
export type ProfileRevertState = (typeof PROFILE_REVERT_STATES)[number];

export type ProfileRevertInput = {
	/**
	 * The descriptor exactly as it arrived. Anything other than the verified
	 * backend shape resolves to `unavailable`.
	 */
	descriptor: unknown;
	/**
	 * The backend's own verification of that descriptor in THIS runtime
	 * (`features.profile_approvals` plus a verified receipt). Our parse alone is
	 * never proof: a well-formed payload a model wrote is still a model's words.
	 */
	descriptorVerified: boolean;
	/** The transcript was rebuilt after a restart and no verified reconstruction covers it. */
	reconstructed?: boolean;
	/** This descriptor's own press has been sent and is in flight. */
	submitted?: boolean;
	/** The answered result of the press, once one landed. */
	outcome?: { approved: boolean; state?: string } | null;
	/** This `action_id` is already spent — a second press answers nothing. */
	alreadyAnswered?: boolean;
};

/**
 * Resolve the button's state, and whether it is enabled, in ONE place.
 *
 * ORDER MATTERS AND IS THE SAFETY PROPERTY: a descriptor that is not verified, or
 * an action id already answered, resolves to a state that disables the control
 * BEFORE any optimistic "pending" arm is considered — so a stale render cannot
 * re-enable a duplicate press by painting the in-flight state.
 */
export function profileRevertState(input: ProfileRevertInput): {
	state: ProfileRevertState;
	enabled: boolean;
} {
	const parsed = profileRevertDescriptorSchema.safeParse(input.descriptor);
	if (!input.descriptorVerified || !parsed.success)
		return { state: "unavailable", enabled: false };
	if (input.alreadyAnswered) return { state: "saved", enabled: false };
	if (input.outcome) {
		if (input.outcome.approved === false)
			return { state: "failed", enabled: true };
		const settled = input.outcome.state ?? "";
		if (settled === "expired" || settled === "stale")
			return { state: "stale", enabled: false };
		return { state: "saved", enabled: false };
	}
	if (input.submitted) return { state: "pending", enabled: false };
	if (input.reconstructed) return { state: "unavailable", enabled: false };
	return { state: "available", enabled: true };
}

/**
 * The revert's activation request, or `null` when this press may not be sent.
 *
 * IT IS AN ORDINARY AUTHENTICATED APPROVAL ANSWER on the originating session
 * (`sessions.answer`): `request_id` is the descriptor's `action_id` and `approved`
 * is true. THERE IS NO `remember` FIELD, and its absence is the point: the gate
 * answer carries `{session_id, epoch, request_id, approved}` and nothing else, so
 * a revert can never be remembered into firing again on a later request id. A
 * `remember: false` here would name a field the request schema refuses, and a
 * shape that disagrees with its wire is how a false claim starts.
 *
 * No model argument, no raw command and no reconstructed action reaches this
 * path — the caller holds a verified descriptor or nothing.
 */
export function profileRevertAnswer(args: {
	descriptor: unknown;
	sessionId: string | null;
	ownerEpoch?: string | null;
	state: ProfileRevertState;
}): {
	sessionId: string;
	ownerEpoch?: string;
	requestId: string;
	approved: true;
} | null {
	const parsed = profileRevertDescriptorSchema.safeParse(args.descriptor);
	if (!parsed.success || !args.sessionId) return null;
	if (args.state !== "available") return null;
	return {
		sessionId: args.sessionId,
		...(args.ownerEpoch ? { ownerEpoch: args.ownerEpoch } : {}),
		requestId: parsed.data.action_id,
		approved: true,
	};
}

/** The disclosure, or `null` when the wire value is not exactly one this build bounds. */
export function profileDisclosure(
	value: unknown,
): ProfileSaveDisclosure | null {
	const parsed = profileSaveDisclosureSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

/** The typed row block, or `null` — a `typed_approval` this build cannot echo. */
export function profileTypedApproval(
	value: unknown,
): ProfileTypedApproval | null {
	const parsed = profileTypedApprovalSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

/** The queued receipt a tool call answered with, or `null`. */
export function profileQueuedReceipt(
	value: unknown,
): ProfileQueuedReceipt | null {
	const parsed = profileQueuedReceiptSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

/**
 * The revert descriptor a tool result carries, read from the one place it is
 * allowed to live: a `profile_revert` action block on the SAVED result. A
 * descriptor anywhere else (an argument, a free-form note) is not read.
 */
export function profileRevertDescriptor(
	value: unknown,
): ProfileRevertDescriptor | null {
	const parsed = profileRevertDescriptorSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

/**
 * Whether a description of the operation is one this build will state in words.
 * `create` names a new profile; `update` lists changed columns; `revert` restores
 * a saved receipt — the three arms the backend mints, and nothing else.
 */
export function profileOperationKey(operation: ProfileOperation): string {
	return `ui.mesh.mesh_approvals_tray.profile_operation_${operation}`;
}
