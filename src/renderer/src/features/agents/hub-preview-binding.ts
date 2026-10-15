import type {
	HubPullPreview,
	HubPushPreview,
} from "@shared/api/local-operator/hub-link-actions";
import type { HubLink } from "@shared/api/local-operator/hub-links";

/**
 * Only the visible binding can be checked in React. Core must revalidate fresh
 * local bytes/account/pin and atomically CAS the remote row at confirmation.
 * This helper never certifies server CAS or regenerates a stale proposal.
 */
export function hubPreviewIsCurrent(
	preview: HubPullPreview | HubPushPreview,
	link: HubLink,
	now = Date.now(),
): boolean {
	const expiry = Date.parse(preview.expires_at);
	return (
		preview.local_fingerprint.length > 0 &&
		preview.proposal_fingerprint.length > 0 &&
		preview.link_id === link.link_id &&
		(preview.direction === "push" || preview.remote_fingerprint.length > 0) &&
		preview.proposal.kind === link.kind &&
		preview.hub_source === link.hub_source &&
		preview.visibility === link.visibility &&
		preview.tenant_id === link.tenant_id &&
		preview.expected_policy_revision === link.policy.revision &&
		preview.expected_remote_revision === link.remote_revision &&
		Number.isFinite(expiry) &&
		expiry > now
	);
}

/** A declined/no-op preview stays readable, but can never be confirmed. */
export function hubPreviewMatches(
	preview: HubPullPreview | HubPushPreview,
	link: HubLink,
	now = Date.now(),
): boolean {
	return (
		preview.can_confirm &&
		preview.preview_receipt.length > 0 &&
		hubPreviewIsCurrent(preview, link, now)
	);
}
