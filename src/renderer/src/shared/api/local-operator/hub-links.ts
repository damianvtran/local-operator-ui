/**
 * Additive hub_links:1 contract, coordinated with the core owner's wire receipt.
 *
 * Unlike the legacy pending projection this is a local-only full inventory:
 * healthy links remain present so their source-scoped policy is discoverable.
 * Never use the active organization picker as an origin or infer policy/safety
 * from a display name. The service owns admission, ancestry, merge and CAS.
 */
export type HubLinkKind = "agent" | "team" | "skill";
export type HubLinkDirection = "pull" | "push";
export type HubDirectionStatus = {
	state: string;
	classification: string | null;
	enabled: boolean;
	last_checked_at: string | null;
	last_success_at: string | null;
	attempts: number;
	next_retry_at: string | null;
	error_class: string | null;
	error_subclass: string | null;
	safe_message: string | null;
	operation_id: string | null;
	model_used: string | null;
	summary: string | null;
	backup_receipt: string | null;
};
export type HubLink = {
	link_id: string;
	kind: HubLinkKind;
	local_id: string;
	name: string;
	hub_id: string;
	hub_source: string;
	visibility: "public" | "org";
	tenant_id: string | null;
	/** Verified metadata only; null on an org link must never render Public. */
	tenant_name: string | null;
	policy: { subscribe: boolean; auto_push: boolean; revision: string };
	eligibility: { can_auto_push: boolean; reason: string | null };
	baseline_state: "known" | "unknown" | "mixed-lineage";
	remote_revision: string | null;
	auto_will_apply: boolean;
	auto_will_push: boolean;
	pull: HubDirectionStatus;
	push: HubDirectionStatus;
};
export type HubUnresolvedLink = {
	kind: HubLinkKind;
	local_id: string;
	name: string;
	hub_id: string;
	/** A diagnostic, NOT an origin, writable policy, grant or synthetic link ID. */
	reason: "source-unresolved";
};
export type HubLinks = { links: HubLink[]; unresolved: HubUnresolvedLink[] };
export type HubLinkPolicyPatch = {
	subscribe?: boolean;
	auto_push?: boolean;
	confirm_public_egress?: boolean;
};

/** Immutable local identity beats a mutable alias; names are fallback display. */
export function linksForLocalItem(
	inventory: HubLinks | undefined,
	kind: HubLinkKind,
	localId: string | undefined,
	name: string,
): HubLink[] {
	return (inventory?.links ?? []).filter(
		(link) =>
			link.kind === kind &&
			(localId ? link.local_id === localId : link.name === name),
	);
}
