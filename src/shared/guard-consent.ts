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

/**
 * CHARACTERS AN ORG NAME MAY NOT CARRY INTO THIS UI (security review U1 r1, S-2).
 *
 * The name is chosen by a Team admin and is shown to a member inside a CONSENT
 * prompt, so a name that reorders or hides its own neighbours changes what the
 * member believes they are agreeing to. Markup is already inert (React text), so
 * the residue is invisible formatting: C0/C1 controls, bidi overrides/embeddings/
 * isolates (U+202A-202E, U+2066-2069, U+200E/F, U+061C), zero-width space / word
 * joiner / BOM (U+200B, U+2060, U+FEFF), line and paragraph separators, and the
 * private-use code point the renderer uses as its own org marker (U+E000).
 *
 * ZWNJ and ZWJ (U+200C/D) are KEPT on purpose: Persian, Urdu and Indic names need
 * them to spell correctly, and neither reorders text. Stripping happens once, here,
 * so every surface (entry, dialog, Settings, revoke confirm) inherits it; the
 * renderer additionally isolates the name in `<bdi>`.
 */
const ORG_NAME_STRIP =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point of this pattern.
	/[\u0000-\u0008\u000E-\u001F\u007F-\u0084\u0086-\u009F\u061C\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF\uE000]+/g;

/** The org's display name with invisible formatting removed and whitespace collapsed. */
export function sanitizeOrgName(value: string): string {
	// Line-ish controls (tab, newline, NEL, LS, PS) become a space so "a\nb" does not
	// fuse into "ab"; invisible formatting is dropped without leaving a gap in a word.
	return value
		.replace(ORG_NAME_STRIP, "")
		.replace(/[\s\u0085]+/g, " ")
		.trim();
}

/**
 * A display name safe to draw: bounded, sanitised, and non-empty AFTER sanitising
 * (a name made only of controls leaves the card opaque, which offers no Share).
 */
export const guardOrgNameSchema = z
	.string()
	.max(256)
	.transform(sanitizeOrgName)
	.pipe(z.string().min(1));
/** A scope name this build has copy for; anything else fails the whole block. */
const scopeName = z.enum(GUARD_SCOPE_ORDER);

/** What the member is agreeing to, as the host's `consent_op.disclosure` wrote it. */
export const guardConsentDisclosureSchema = z
	.object({
		version: z.literal(1),
		operation: z.literal(GUARD_CONSENT_OPERATION),
		approval_id: z.string().min(1).max(64),
		tenant: z.string().min(1).max(160),
		/** The org's own display name: untrusted text, sanitised on parse and rendered inside `<bdi>`. */
		org_display_name: guardOrgNameSchema,
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

/*
 * THE HOST'S ANSWER TO A TYPED ACCEPT (S-1, security review U1 r1).
 *
 * `approvals.approveOperation` is sign-THEN-apply, and the host reports the two
 * phases separately (`desktop_approval.approve_and_apply`, contract
 * `docs/design/guard-desktop-routes.md` in core): once the signature is made an apply
 * refusal is NOT an HTTP error, it is `200 {signed:{ok:true}, applied:{ok:false,
 * code, retryable, reason, remedy}, state}`. Treating every 200 as "sharing" told a
 * member their grant was live when the host had been unable to send it. A grant is
 * live only when BOTH phases say ok; anything this build cannot read is "unconfirmed",
 * never success.
 *
 * `approvals.applyOperation` (the retry) answers `200 {applied:{ok:true}}` or, on an
 * apply refusal, a 409 whose `detail.apply_outcome` carries the same
 * `{code, retryable, reason, remedy}` block.
 */
const applyOutcomeBlock = z
	.object({
		code: z.string().max(64).optional(),
		retryable: z.boolean().optional(),
		/** Desktop-safe sentences the host authored: shown verbatim, never reworded here. */
		reason: z.string().max(2000).optional(),
		remedy: z.string().max(2000).optional(),
	})
	.passthrough();

const guardAcceptReplySchema = z
	.object({
		signed: z.object({ ok: z.boolean() }).passthrough(),
		applied: z.object({ ok: z.boolean() }).passthrough(),
	})
	.passthrough();

const guardApplyReplySchema = z
	.object({ applied: z.object({ ok: z.boolean() }).passthrough() })
	.passthrough();

/** What a Guard answer came to, as far as the host's own reply says. */
export type GuardAnswerOutcome =
	| { kind: "done" }
	| {
			kind: "not_applied";
			/** The host's sentence for why the grant could not be sent; may be empty. */
			reason: string;
			remedy: string;
			/** Whether the SAME signed card may be re-applied (`applyOperation`). */
			retryable: boolean;
	  }
	| { kind: "unreadable" };

function notApplied(block: unknown): GuardAnswerOutcome {
	const parsed = applyOutcomeBlock.safeParse(block);
	const data = parsed.success ? parsed.data : {};
	return {
		kind: "not_applied",
		reason: data.reason ?? "",
		remedy: data.remedy ?? "",
		// Absent reads false: "Try again" is offered only when the host says it can work.
		retryable: data.retryable === true,
	};
}

/** The outcome of `approvals.approveOperation` for a `guard_consent` card. */
export function guardAcceptOutcome(reply: unknown): GuardAnswerOutcome {
	const parsed = guardAcceptReplySchema.safeParse(reply);
	if (!parsed.success) return { kind: "unreadable" };
	// Not signed: the host would have refused with an error, but a reply that says
	// so is still not a grant.
	if (!parsed.data.signed.ok) return { kind: "unreadable" };
	if (parsed.data.applied.ok) return { kind: "done" };
	return notApplied(parsed.data.applied);
}

/** The outcome of `approvals.applyOperation` (the retry of a signed card). */
export function guardApplyOutcome(reply: unknown): GuardAnswerOutcome {
	const parsed = guardApplyReplySchema.safeParse(reply);
	if (!parsed.success) return { kind: "unreadable" };
	if (parsed.data.applied.ok) return { kind: "done" };
	return notApplied(parsed.data.applied);
}

/** The apply-refusal block a 409 from `applyOperation` carries in `detail.apply_outcome`. */
export function guardApplyRefusal(detail: unknown): GuardAnswerOutcome | null {
	if (typeof detail !== "object" || detail === null) return null;
	const block = (detail as { apply_outcome?: unknown }).apply_outcome;
	if (typeof block !== "object" || block === null) return null;
	return notApplied(block);
}

/**
 * Whether a card's own window has passed (S-6). The host folds expiry into `state` on
 * every list read, but a list can be up to a poll old, and a Share pressed on a card
 * the host has already retired would be refused after the member believed they chose.
 * `expires_at` is epoch SECONDS (the store's `time.time()`); a missing/zero value
 * cannot expire, as on the host (`approvals.presented`).
 */
export function guardCardExpired(
	expiresAt: readonly (number | null | undefined)[],
	nowMs: number,
): boolean {
	return expiresAt.some(
		(at) => typeof at === "number" && at > 0 && nowMs >= at * 1000,
	);
}
