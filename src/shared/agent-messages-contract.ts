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
 * Default-on (opt-out) enrolment facts (runtime PR #2790, batch-5 deliverable 4).
 *
 * WHY: under `bridge_consent_v2` the runtime enrols an eligible member without
 * a consent dialog and nothing fires at enrolment, so the UI's whole first-run
 * job becomes one dismissible banner. `in_force` says the hub serves AND accepts
 * v2 (the opt-in dialog and every Enable cue must then stay out of the way);
 * `notice_pending` says the member has not dismissed that banner yet.
 *
 * CONSTRAINTS: additive and optional. A runtime older than #2790, or a hub
 * serving only v1, omits the key and the client behaves exactly as before the
 * feature existed. A malformed block degrades to absent (`.catch`) rather than
 * failing the status read that gates every agent-messages surface: the
 * conservative reading of "I cannot tell" is the opt-in flow we already ship.
 */
export const agentMessagesDefaultOnSchema = z
	.object({
		in_force: z.boolean(),
		// Tolerated on its own: a malformed `notice_pending` must read as "no
		// notice", never collapse the whole block to absent - an absent block
		// means "not in force" and would reopen the opt-in dialog for a member
		// who is enrolled. false only hides the banner.
		notice_pending: z.boolean().catch(false),
	})
	.passthrough()
	.optional()
	.catch(undefined);

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
		default_on: agentMessagesDefaultOnSchema,
	})
	.passthrough();
export type AgentMessagesStatus = z.infer<typeof agentMessagesStatusSchema>;

/**
 * What a REQUEST may claim about where consent was collected.
 *
 * `"default_on"` is deliberately absent: only the hub's enrolment route can
 * assert it, and the runtime answers a client that tries with a 422. Keeping
 * the request types narrower than the response enum below makes the claim
 * unrepresentable here rather than relying on the server to refuse it.
 */
export type AgentMessagesRequestConsentVia = "dialog" | "settings";

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
	consented_via?: AgentMessagesRequestConsentVia;
	label?: string;
};

const consentRecordSchema = z
	.object({
		version: z.string().min(1),
		consented_at: z.string().min(1),
		// RESPONSES ONLY may carry "default_on" (a member the runtime enrolled
		// automatically). Requests use AgentMessagesRequestConsentVia, which
		// cannot. The enum has already grown once, so the read stays open: an
		// unknown spelling from a newer runtime must not fail the settings read
		// (it would put the whole section in its error state). Surfaces label the
		// known values through the catalogue and show an unknown one as-is.
		consented_via: z.string().min(1),
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
		// Runtime #2790: true when the endpoint's consent was collected as
		// `default_on`. Absent on an older runtime; a malformed value reads as
		// absent so it can only hide the banner, never break the settings read.
		default_on: z.boolean().optional().catch(undefined),
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

/** The runtime's answer to the banner's dismiss route. */
export const agentMessagesOnboardingDismissResultSchema = z
	.object({ onboarding: z.literal("seen") })
	.passthrough();

/**
 * Whether default-on is in force for this status: the hub serves and accepts v2.
 *
 * Every opt-in cue (the onboarding dialog, an Enable button, "enable later"
 * copy, the opt-in default-reach line) is suppressed while this is true. Absent
 * or malformed reads as false, so an older runtime keeps today's flow.
 */
export function agentMessagesDefaultOnInForce(
	status: AgentMessagesStatus | null,
): boolean {
	return status?.default_on?.in_force === true;
}

/**
 * The consent text the default-on banner may show, or null.
 *
 * The banner promises the member the text they were ENROLLED under. The status
 * read serves the CURRENT text (or a cached copy), which can have moved on
 * since enrolment; showing it would put words in front of the member that they
 * never accepted. So the served text is returned only when its version equals
 * the endpoint's recorded consent version; on any mismatch (or no record) the
 * caller shows the "unavailable" copy rather than a different version's text.
 */
export function agentMessagesDefaultOnBannerConsentText(
	status: AgentMessagesStatus | null,
	settings: Pick<AgentMessagesSettingsResult, "endpoint"> | null,
): string | null {
	const served = agentMessagesServedConsent(status);
	const enrolled = settings?.endpoint?.consent?.version;
	return served && enrolled && served.version === enrolled ? served.text : null;
}

/**
 * The banner rule, exactly as the runtime contract states it: active/enrolled
 * (surface C), the endpoint was enrolled by default-on, and the member has not
 * dismissed the notice. All three are required; a missing one hides the banner
 * rather than guessing, since a banner that returns after dismissal breaks the
 * "never returns" promise.
 *
 * The endpoint must also still be `active`: a Turn off answer changes the
 * endpoint before the cached status catches up, and a banner offering to turn
 * off something already off would be a lie for those few seconds.
 */
export function agentMessagesDefaultOnBannerPending(
	status: AgentMessagesStatus | null,
	settings: Pick<AgentMessagesSettingsResult, "default_on" | "endpoint"> | null,
): boolean {
	return (
		status?.surface_state === "C" &&
		settings?.default_on === true &&
		settings.endpoint?.state === "active" &&
		status.default_on?.notice_pending === true
	);
}

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
		// Under default-on there is nothing to opt into, so there is no
		// onboarding context: the dialog cannot open and the model cannot present
		// or send an enable on its behalf.
		agentMessagesDefaultOnInForce(status) ||
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
