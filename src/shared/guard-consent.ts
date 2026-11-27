/**
 * The Radient Guard consent contract: what a pending `guard_consent` approval
 * may claim, and the ONE place its wire shape is bounded.
 *
 * WHAT GUARD IS (Guard RFC v0.9 §5). A Team org can switch on guardrail
 * analytics; each MEMBER still decides, once per computer, whether this
 * computer shares enum-only stats. The decision belongs to the lop HOST: the
 * host queues the prompt (`local_operator/guard/consent.py`), mirrors it as a
 * `guard_consent` record on the desktop approvals plane, and signs and sends the
 * one grant itself. This app is a RENDERER of that record. It never holds a key,
 * never calls `/v1/guard/*`, and cannot grant anything the host did not offer:
 * there is no grant without the host.
 *
 * WHY THE WIRE IS CLOSED (`.strict()`): a payload that grew a field this build
 * does not know is one it would render as a claim it never bounded - for a
 * privacy disclosure that is the wrong direction to fail. An unparseable block
 * leaves the row opaque and offers no "Share".
 *
 * THE DIGESTS ARE ECHOED, NEVER COMPUTED HERE. The accept body is the closed
 * `{operation, request_digest, disclosure_digest}` acknowledgment
 * (`OperationApprovalAcknowledgment`); the host recomputes both from the record
 * on disk and refuses a stale renderer before signing. The body has no scope
 * field, so an accept is all-or-nothing by construction (RFC §5.2.2, R2-m2).
 */

import { z } from "zod";

/** The typed-op name the host registered (`guard/consent_op.py::OP`). */
export const GUARD_CONSENT_OPERATION = "guard_consent" as const;

/**
 * Input inside this window after a card renders is ignored (RFC §5.2.3).
 * A UX debounce, not a security bound: it stops a typed-ahead Enter meant for
 * the composer from answering a card that arrived while the person was typing.
 */
export const GUARD_DEBOUNCE_MS = 500;

/** Why the host is asking (RFC §5.2.1 `reason`). */
export const GUARD_REASONS = [
	"new_org",
	"widened",
	"reactivated",
	"plan_gap",
	"new_device",
	"rejoined",
] as const;
export type GuardReason = (typeof GUARD_REASONS)[number];

/**
 * The scope vocabulary in the order the prompt lists it (RFC §15.4' C4), never
 * the queue's sorted order - the TUI's `_SCOPE_ORDER`, so the two surfaces
 * disclose the same lines in the same sequence.
 */
export const GUARD_SCOPE_ORDER = [
	"decisions",
	"posture",
	"task_time",
	"review_cycles",
	"reports",
	"trace_detail",
	"admin_share",
] as const;
export type GuardScope = (typeof GUARD_SCOPE_ORDER)[number];

const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
/** A scope name this build has copy for; anything else fails the whole block. */
const scopeName = z.enum(GUARD_SCOPE_ORDER);

/** What the member is agreeing to, as the host's `consent_op.disclosure` wrote it. */
export const guardConsentDisclosureSchema = z
	.object({
		version: z.literal(1),
		operation: z.literal(GUARD_CONSENT_OPERATION),
		approval_id: z.string().min(1).max(64),
		tenant: z.string().min(1).max(160),
		/** The org's own display name: verbatim, untrusted text (rendered inside `<bdi>`). */
		org_display_name: z.string().min(1).max(256),
		reason: z.enum(GUARD_REASONS),
		collection_rev: z.number().int().nonnegative(),
		revocation_gen: z.number().int().nonnegative(),
		/** What "Share" grants: the offered scopes, or only the ADDED ones on a widening. */
		asked_scopes: z.array(scopeName).max(16),
		/** The whole ceiling the org offers; drives the visibility sentence. */
		grant_scopes: z.array(scopeName).max(16),
		rendered_terms_digest: digest,
		prompt_digest: digest,
		expires_at: z.number().finite().nullable().optional(),
		signing_principal: z.string().max(160).nullable().optional(),
	})
	.strict();
export type GuardConsentDisclosure = z.infer<
	typeof guardConsentDisclosureSchema
>;

/**
 * The `typed_approval` block a `guard_consent` row carries
 * (`desktop_approval.row_fields`). `action` is legacy wire vocabulary
 * ("approve-credential" on every typed row), bounded but not keyed on: the
 * selector is `operation === "guard_consent"`.
 */
export const guardTypedApprovalSchema = z
	.object({
		action: z.string().min(1).max(64),
		operation: z.literal(GUARD_CONSENT_OPERATION),
		request_digest: digest,
		assurance: z.string().max(64).optional(),
		unproven_human: z.boolean().optional(),
		disclosure: guardConsentDisclosureSchema.nullable().optional(),
		disclosure_digest: digest.optional(),
		/** The host's own answer to "may THIS host sign it"; absent reads false. */
		signable_here: z.boolean(),
		refusal: z.string().max(64).optional(),
		refusal_message: z.string().max(2000).optional(),
		apply_outcome: z
			.object({
				code: z.string().max(64),
				retryable: z.boolean(),
				reason: z.string().max(2000),
				remedy: z.string().max(2000),
			})
			.strict()
			.nullable()
			.optional(),
		upgrade: z
			.object({ available: z.boolean(), helper: z.string().max(64) })
			.strict()
			.optional(),
	})
	.strict();
export type GuardTypedApproval = z.infer<typeof guardTypedApprovalSchema>;

/** The typed block, or `null` when this build cannot echo it. */
export function guardTypedApproval(value: unknown): GuardTypedApproval | null {
	const parsed = guardTypedApprovalSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}
