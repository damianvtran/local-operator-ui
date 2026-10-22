import { z } from "zod";

/** Natural boundaries only: this family has no passive eligibility timer. */
export const agentMessagesBoundarySchema = z.enum([
	"app_start",
	"sign_in",
	"window_focus",
	"surface_open",
]);
export type AgentMessagesBoundary = z.infer<typeof agentMessagesBoundarySchema>;

const endpointSchema = z
	.object({
		id: z.string().min(1),
		state: z.enum(["active", "paused", "disabled"]),
	})
	.passthrough();
const tenantSchema = z
	.object({
		tenant_id: z.string().min(1),
		tenant_name: z.string().optional(),
		eligible: z.boolean(),
		endpoint: endpointSchema.nullable(),
	})
	.passthrough();
export const agentMessagesRefusalSchema = z
	.object({
		code: z.string(),
		message: z.string(),
		details: z.record(z.unknown()).optional(),
		retry_after_seconds: z.number().optional(),
	})
	.passthrough();
export type AgentMessagesRefusal = z.infer<typeof agentMessagesRefusalSchema>;

/**
 * Messages this machine is HOLDING for the owner (runtime PR #2777, F8).
 *
 * WHY: a member whose accepted consent is v1 never agreed that a message may
 * engage a session they have not used, so the runtime holds cards addressed to
 * a never-opened designated chief of staff (`open_chief_of_staff`) instead of
 * delivering them. Opening that session once releases them; this field is how
 * the owner learns that. Code + count + the designated session id only, never
 * message ids or content.
 *
 * CONSTRAINTS: additive and optional. A runtime older than #2777 omits the key,
 * #2777 sends `null` when nothing waits. A malformed hold degrades to `null`
 * (`.catch`) rather than failing the whole status read: the hint is advisory,
 * and the status read gates every agent-messages surface, so a bad hint must
 * never take Settings or the inbox down with it. `code` stays an open string
 * so a future hold reason parses; the renderer shows only codes it has copy
 * for.
 */
export const agentMessagesDeliveryHoldSchema = z
	.object({
		code: z.string().min(1),
		count: z.number().int().nonnegative(),
		/*
		 * Its own `.catch` (review R1-2): a bad session id degrades only the
		 * "Message chief of staff" target, never the count the owner must see.
		 */
		session: z.string().min(1).nullable().optional().catch(null),
	})
	.passthrough()
	.nullable()
	.optional()
	.catch(null);
export type AgentMessagesDeliveryHold = NonNullable<
	z.infer<typeof agentMessagesDeliveryHoldSchema>
>;

/**
 * The local desktop projection, not a second Radient eligibility policy.
 * Unknown additive fields survive; missing or unfamiliar required state fails
 * closed. The backend alone selects the v1 organization (HOME-first, then ID).
 */
export const agentMessagesStatusSchema = z
	.object({
		capability: z.number(),
		// Missing on frozen H1: absence forbids consent writes, not status reads.
		consent_account_guard: z.boolean().optional(),
		state: z.enum(["ready", "signed_out", "unavailable", "update_required"]),
		account_id: z.string().nullable(),
		tenant_id: z.string().nullable(),
		surface_state: z.enum(["A", "B", "C", "D", "E", "F", "G"]).nullable(),
		visibility: z.object({
			settings: z.boolean(),
			inbox: z.boolean(),
			account_door: z.boolean(),
			onboarding: z.boolean(),
		}),
		update_required: z.boolean(),
		local: z.object({
			enabled: z.boolean(),
			onboarding: z.string(),
			session: z.string(),
		}),
		status: z
			.object({
				tenants: z.array(tenantSchema),
			})
			.passthrough()
			.nullable(),
		consent: z
			.object({
				version: z.string().min(1).max(128),
				text: z
					.string()
					.min(1)
					.refine(
						(text) => new TextEncoder().encode(text).length <= 2048,
						"Consent exceeds the served-text contract",
					),
				source: z.enum(["served", "cached", "embedded"]),
			})
			.nullable(),
		error: agentMessagesRefusalSchema.nullable(),
		// Present only on a killed/lapsed organization (surface F); the section
		// renders it when the server chose to explain the state.
		state_note: z.string().nullable().optional(),
		// F's posture: the server admits only safety-increasing edits. The
		// section gates the reach editor's controls rather than letting a reader
		// press a Save the server will refuse.
		read_only: z.boolean().optional(),
		delivery_hold: agentMessagesDeliveryHoldSchema,
	})
	.passthrough();
export type AgentMessagesStatus = z.infer<typeof agentMessagesStatusSchema>;

export type AgentMessagesConsentPut = {
	expected_account_id: string;
	tenant_id: string;
	state: "active";
	consent_version: string;
	consented_via: "dialog";
};

/**
 * The full settings write this section needs (RFC §5.2). `state` is present on
 * EVERY request - the server reads the body as a state assertion, never as a
 * patch - and the consent echo rides only where the server requires one.
 */
export type AgentMessagesSettingsPut = {
	expected_account_id: string;
	tenant_id?: string;
	state: "active" | "paused" | "disabled";
	consent_version?: string;
	consented_via?: "dialog" | "settings";
	label?: string;
};

const consentRecordSchema = z
	.object({
		version: z.string().min(1),
		consented_at: z.string().min(1),
		consented_via: z.enum(["dialog", "settings"]),
		// False means the served text moved on since this record was written; the
		// surface must route the reader back through the enable action.
		current: z.boolean(),
	})
	.passthrough();

/**
 * GET/PUT /v1/desktop/team-bridge/settings.
 *
 * `endpoint` is null until the account opts in. Unknown additive fields survive
 * on every block; a missing required field fails the whole read, because a
 * half-read endpoint would render controls whose writes the server refuses.
 */
export const agentMessagesSettingsResultSchema = z
	.object({
		endpoint: endpointSchema
			.extend({
				// NO account_id: the upstream BridgeEndpointResponse does not carry
				// one. The write's captured-account receipt (expected_account_id) is
				// the account guard, and the caller's endpoint is already its own.
				tenant_id: z.string().min(1),
				label: z.string().optional(),
				consent: consentRecordSchema.nullable().optional(),
				created_at: z.string().optional(),
				updated_at: z.string().optional(),
			})
			.nullable(),
		settings: z
			.object({
				tenant_id: z.string().min(1),
				eligible: z.boolean(),
				consent_version: z.string().optional(),
				consent_required: z.boolean(),
			})
			.passthrough(),
	})
	.passthrough();
export type AgentMessagesSettingsResult = z.infer<
	typeof agentMessagesSettingsResultSchema
>;

/*
 * The READ target names its kind (`endpoint`/`account`) beside the id; the
 * WRITE's `AllowlistTargetIn` accepts exactly one id and no `kind` (the id
 * prefix states it). One schema here tolerates both spellings, while the PUT
 * body's type below stays the write's exact shape.
 */
const allowlistTargetSchema = z
	.object({
		kind: z.enum(["endpoint", "account"]).optional(),
		endpoint_id: z.string().min(1).optional(),
		account_id: z.string().min(1).optional(),
	})
	.passthrough()
	.refine(
		(target) => Boolean(target.endpoint_id) !== Boolean(target.account_id),
		"An allowlist target names exactly one of endpoint_id or account_id",
	)
	.refine(
		(target) =>
			target.kind === undefined ||
			(target.kind === "endpoint"
				? target.endpoint_id !== undefined
				: target.account_id !== undefined),
		"An allowlist target's kind must agree with the id it carries",
	);

const allowlistEntrySchema = z
	.object({
		direction: z.enum(["send", "receive"]),
		effect: z.enum(["allow", "deny"]),
		target: allowlistTargetSchema,
		id: z.string().optional(),
	})
	.passthrough();
export type AgentMessagesAllowlistEntry = z.infer<typeof allowlistEntrySchema>;

/**
 * The bounded replace-set (§6.1/§9): the write sends the whole policy, so an
 * entry the surface failed to read is an entry the write would delete.
 */
export type AgentMessagesAllowlistPut = {
	expected_account_id: string;
	tenant_id?: string;
	entries: {
		direction: "send" | "receive";
		effect: "allow" | "deny";
		target: { endpoint_id: string } | { account_id: string };
	}[];
};

const directionViewSchema = z
	.object({
		mode: z.enum(["class_default", "listed_only"]),
		allow: z.number(),
		deny: z.number(),
	})
	.passthrough();

/**
 * GET/PUT /v1/desktop/team-bridge/allowlist. `view` is the server's S-7
 * reading (mode per direction, counts, cues): the surface renders it rather
 * than re-deriving the RFC's rules from the entries.
 */
export const agentMessagesAllowlistResultSchema = z
	.object({
		allowlist: z
			.object({
				tenant_id: z.string().min(1),
				entries: z.array(allowlistEntrySchema),
			})
			.passthrough(),
		view: z
			.object({
				tenant_id: z.string().nullable(),
				entries: z.array(allowlistEntrySchema),
				directions: z.object({
					send: directionViewSchema,
					receive: directionViewSchema,
				}),
				class_default: z.literal("cos_cos"),
				cues: z
					.object({
						allow_entry_switches_direction_to_listed_only: z.boolean(),
						listed_only_affects: z.string(),
						removing_allow_does_not_stop_open_thread: z.boolean(),
						deny_stops_pair_both_directions: z.boolean(),
					})
					.passthrough(),
			})
			.passthrough(),
	})
	.passthrough();
export type AgentMessagesAllowlistResult = z.infer<
	typeof agentMessagesAllowlistResultSchema
>;

/**
 * Validate the selected row, never pick a row. This consistency check also
 * refuses old mixed-org projections rather than inferring "any eligible".
 */
export function agentMessagesOnboardingContext(
	status: AgentMessagesStatus | null,
	accountId: string | null,
): { accountId: string; tenantId: string } | null {
	if (
		!status ||
		!accountId ||
		status.account_id !== accountId ||
		status.capability < 1 ||
		status.state !== "ready" ||
		status.update_required ||
		status.surface_state !== "B" ||
		!status.visibility.onboarding ||
		!status.tenant_id
	)
		return null;
	const rows = status.status?.tenants.filter(
		(row) => row.tenant_id === status.tenant_id,
	);
	if (
		rows?.length !== 1 ||
		rows[0].eligible !== true ||
		rows[0].endpoint !== null
	)
		return null;
	return { accountId, tenantId: status.tenant_id };
}

/** Embedded consent is deliberately not an enable fallback in this slice. */
export function agentMessagesServedConsent(status: AgentMessagesStatus | null) {
	const consent = status?.consent;
	return consent && (consent.source === "served" || consent.source === "cached")
		? consent
		: null;
}
