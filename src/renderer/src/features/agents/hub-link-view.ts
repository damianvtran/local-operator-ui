/**
 * Renderer presentation state, NOT the hub wire contract or a second sync engine.
 *
 * The adapter at the transport boundary supplies confirmed source/policy and
 * service-computed eligibility. Keeping a narrow view here lets the sidebar and
 * detail controls share one interpretation without duplicating merge, privacy or
 * CAS decisions in React. Unknown server states are deliberately view-only.
 */
export type HubLinkDirection = "pull" | "push";
export type HubLinkKind = "agent" | "team" | "skill";

export type HubLinkSourceView =
	| { visibility: "public"; address: string }
	| { visibility: "org"; address: string; organization: string }
	| { visibility: "unavailable"; address: string };

export type HubLinkDirectionView = {
	state: string;
	/** Read from the service, never inferred from the saved preference. */
	effective: boolean;
	reason: string | null;
	/** Only a service-approved retry is a primary action, not every failure. */
	retryable: boolean;
	/** A known-safe inbound action; an available conflict opens detail instead. */
	canApply: boolean;
	lastSuccess: string | null;
	modelUsed: string | null;
	operationId: string | null;
};

export type HubLinkView = {
	id: string;
	kind: HubLinkKind;
	localId: string;
	name: string;
	source: HubLinkSourceView;
	policy: { subscribe: boolean; autoPush: boolean; revision: string };
	/** Capability and lineage admission come from the backend, not visibility. */
	canEnableAutoPush: boolean;
	autoPushUnavailableReason: string | null;
	canEditPolicy: boolean;
	pull: HubLinkDirectionView;
	push: HubLinkDirectionView;
};

export type HubLinkPolicyChange = {
	subscribe?: boolean;
	autoPush?: boolean;
	/** A destination-specific affirmative action, not a generic terms checkbox. */
	consent?: true;
};

export type HubLinkMarkView = {
	kind: "healthy" | "review" | "failed" | "available" | "busy" | "applied";
	direction: HubLinkDirection;
	action: "policy" | "detail" | "apply" | "retry";
};

const REVIEW_STATES = new Set(["needs-review", "missing", "blocked"]);
const BUSY_STATES = new Set(["checking", "merging", "applying", "pushing"]);
const KNOWN_STATES = new Set([
	"idle",
	"available",
	"retry-wait",
	"failed",
	"applied",
	"published",
	...REVIEW_STATES,
	...BUSY_STATES,
]);

/**
 * Priority is visual only. It chooses a destination/action from service facts,
 * never decides whether a merge/publish is safe. In particular a paused outbound
 * link must remain discoverable even if inbound is currently busy or successful.
 */
export function hubLinkMark(link: HubLinkView): HubLinkMarkView {
	const directions = ["pull", "push"] as const;
	for (const direction of directions) {
		const status = link[direction];
		if (
			!KNOWN_STATES.has(status.state) ||
			REVIEW_STATES.has(status.state) ||
			(status.state === "failed" && !status.retryable) ||
			// An operation ID is not a reviewed proposal or a future-write grant.
			// OFF outbound failures open detail; only an explicitly held receipt
			// can reconcile a prior manual publication without a new preview.
			(direction === "push" &&
				!link.policy.autoPush &&
				(status.state === "failed" || status.state === "retry-wait")) ||
			(direction === "push" &&
				link.policy.autoPush &&
				!status.effective &&
				status.reason)
		)
			return { kind: "review", direction, action: "detail" };
	}
	for (const direction of directions) {
		const status = link[direction];
		if (
			(status.state === "failed" || status.state === "retry-wait") &&
			status.retryable
		)
			return { kind: "failed", direction, action: "retry" };
	}
	if (link.pull.state === "available")
		return link.pull.canApply
			? { kind: "available", direction: "pull", action: "apply" }
			: { kind: "review", direction: "pull", action: "detail" };
	for (const direction of directions) {
		if (BUSY_STATES.has(link[direction].state))
			return { kind: "busy", direction, action: "policy" };
	}
	for (const direction of directions) {
		if (
			link[direction].state === "applied" ||
			link[direction].state === "published"
		)
			return { kind: "applied", direction, action: "policy" };
	}
	return { kind: "healthy", direction: "pull", action: "policy" };
}

/**
 * The structural slice of a wire `HubLink` the auto-push gate reads. Kept
 * structural so this module stays free of the transport import (it is a
 * presentation module) and so the gate is testable without React.
 */
export type HubAutoPushGateInput = {
	visibility: "public" | "org";
	tenant_name: string | null;
	remote_revision: string | null;
	eligibility: { can_auto_push: boolean; reason: string | null };
};

/**
 * Whether the auto-push control may proceed, mirroring core's
 * `policies.update_policy` rule EXACTLY rather than inventing a stricter one.
 *
 * WHY the carve-out: for a PUBLIC link that has no grant yet the service reports
 * `can_auto_push=false` with reason `unsafe-publication`, because the grant does
 * not exist until the user gives destination-specific consent. Core therefore lets
 * exactly that case fall through to its consent branch (every EARLIER gate -
 * unsupported-precondition, baseline-unknown, mixed-lineage - still refuses). If
 * the desktop treated that reason as "unavailable" the consent dialog's Enable
 * button could never send the `confirm_public_egress:true` patch that mints the
 * first grant, and no public link could ever be enabled (caught by E2E).
 *
 * CONSTRAINTS: the carve-out is public-only (`unsafe-publication` on an org link
 * cannot apply there and stays refused); every other reason stays refused; a link
 * with no remote revision, or an org link whose verified tenant name is missing,
 * never enables. The carve-out only lets the consent dialog OPEN - the write still
 * requires the explicit consent press and carries `confirm_public_egress`.
 */
export function hubAutoPushGate(link: HubAutoPushGateInput): {
	unavailable: boolean;
	requiresConsent: boolean;
} {
	const consentMints =
		link.visibility === "public" &&
		link.eligibility.reason === "unsafe-publication";
	const unavailable =
		(!link.eligibility.can_auto_push && !consentMints) ||
		!link.remote_revision ||
		(link.visibility === "org" && !link.tenant_name);
	return { unavailable, requiresConsent: consentMints && !unavailable };
}
