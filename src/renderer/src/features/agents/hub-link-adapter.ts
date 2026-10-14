import type {
	HubDirectionStatus,
	HubLink,
} from "@shared/api/local-operator/hub-links";
import type { HubLinkDirectionView, HubLinkView } from "./hub-link-view";

const RETRYABLE_ERRORS = new Set([
	"provider-error",
	"model-unavailable",
	"prompt-too-long",
	"concurrent-edit",
	"local-concurrent-edit",
	"remote-revision-changed",
	"hub-error",
]);

/**
 * Directional failure admission follows existing hub failure classes. Unknown or
 * privacy/auth errors open detail instead of blindly resending private material.
 * Actual actions still pass every service check and cannot override safety.
 */
function directionView(
	status: HubDirectionStatus,
	effective: boolean,
	reason: string | null,
	canApply: boolean,
): HubLinkDirectionView {
	return {
		state: status.state,
		effective,
		reason,
		retryable:
			status.error_class !== null &&
			RETRYABLE_ERRORS.has(status.error_class.split("/")[0]),
		canApply,
		lastSuccess: status.last_success_at,
		modelUsed: status.model_used,
		operationId: status.operation_id,
	};
}

/** Names and source scopes come from this row, NEVER the hub browser's picker. */
export function hubLinkView(link: HubLink): HubLinkView {
	const source =
		link.visibility === "public"
			? { visibility: "public" as const, address: link.hub_source }
			: link.tenant_name
				? {
						visibility: "org" as const,
						address: link.hub_source,
						organization: link.tenant_name,
					}
				: { visibility: "unavailable" as const, address: link.hub_source };
	return {
		id: link.link_id,
		kind: link.kind,
		localId: link.local_id,
		name: link.name,
		source,
		policy: {
			subscribe: link.policy.subscribe,
			autoPush: link.policy.auto_push,
			revision: link.policy.revision,
		},
		canEnableAutoPush:
			link.eligibility.can_auto_push &&
			!!link.remote_revision &&
			source.visibility !== "unavailable",
		autoPushUnavailableReason: link.eligibility.reason,
		canEditPolicy: true,
		pull: directionView(
			link.pull,
			link.auto_will_apply,
			null,
			link.baseline_state === "known" &&
				link.pull.classification === "remote-only",
		),
		push: directionView(
			link.push,
			link.auto_will_push,
			link.eligibility.reason,
			false,
		),
	};
}
