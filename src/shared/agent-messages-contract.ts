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

export const agentMessagesSettingsResultSchema = z
	.object({
		endpoint: endpointSchema.extend({
			account_id: z.string().min(1),
			tenant_id: z.string().min(1),
		}),
	})
	.passthrough();
export type AgentMessagesSettingsResult = z.infer<
	typeof agentMessagesSettingsResultSchema
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
