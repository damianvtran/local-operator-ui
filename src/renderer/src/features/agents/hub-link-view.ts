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
