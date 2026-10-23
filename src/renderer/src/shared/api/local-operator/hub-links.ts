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
/**
 * The `recorded_by` provenance literal core writes (provenance.py `RecordedBy`).
 * `adopt-unknown` is the one value that means the baseline is NOT vouched for
 * (a link over a differing copy, `UNKNOWN_BASELINE`); every other value records a
 * known common ancestor. The union is closed for the known set and admits any
 * other string, because a future core value must read as "not unknown" rather
 * than crash a renderer — but `adopt-unknown` is the ONLY value that reads as
 * unknown, so this is not a permissive fallback.
 */
export type HubRecordedBy =
	| "pull"
	| "publish"
	| "merge-pull"
	| "merge-push"
	| "adopt"
	| "adopt-unknown"
	| (string & {});

/** A baseline is known unless it is explicitly the unknown-origin sentinel. */
export function baselineIsKnown(recordedBy: HubRecordedBy): boolean {
	return recordedBy !== "adopt-unknown";
}
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
	baseline_state: HubRecordedBy;
	remote_revision: string | null;
	/**
	 * Whether the managed copy exists on this machine.
	 *
	 * Membership and content are independent facts (core PR #2713): a subscribed
	 * skill can have no copy at all. Absent from a row that predates the field, so
	 * every read goes through `hubLinkContentState` -- reading the field directly
	 * would turn "old backend" into "not installed" and offer a Download that
	 * already happened.
	 */
	content_state?: "present" | "absent" | (string & {});
	/** Absolute managed path; present only when the copy exists. */
	local_path?: string | null;
	auto_will_apply: boolean;
	auto_will_push: boolean;
	pull: HubDirectionStatus;
	push: HubDirectionStatus;
};
export type HubUnresolvedLink = {
	/*
	 * `agent` | `team` ONLY, the kinds the frozen resolve arm accepts (core
	 * `HubApply.kind`). An unresolved row is a LEGACY identity-less link whose
	 * only honest next step is the source-confirmation act, and skills are a new
	 * capability-gated kind with no legacy predecessor — so a skill can never be
	 * an unresolved row, and the panel's resolve control is never wired to one.
	 */
	kind: "agent" | "team";
	local_id: string;
	name: string;
	hub_id: string;
	/** A diagnostic, NOT an origin, writable policy, grant or synthetic link ID. */
	reason: "source-unresolved";
};
/**
 * The link's content fact, normalized against older rows that omit the field.
 *
 * Core writes `content_state` on every skill link row now; a server from before
 * that field reported the copy implicitly by linking at all, so a missing value
 * is "present", which is also core's own default on read.
 */
export function hubLinkContentState(
	link: Pick<HubLink, "content_state">,
): "present" | "absent" {
	return link.content_state === "absent" ? "absent" : "present";
}
export type HubLinks = { links: HubLink[]; unresolved: HubUnresolvedLink[] };
/**
 * The result of an explicit source confirmation on a legacy unknown-origin row
 * (proposed additive wire, b-wire-receipt §Part 2).
 *
 * The real `link` comes from the service's canonical identity computation, never
 * a synthetic id, and `resolved.scope_known` is always true on success: the whole
 * point of the act is that a source+scope is now stated and recorded. A differing
 * KNOWN scope is refused (`origin-conflict`) with the old state byte-unchanged,
 * so a refusal arrives as an error, not as a resolved row with a swapped tenant.
 *
 * `baseline_state` is the recorded-by literal the BACKEND wrote, under the
 * stable key core renamed it to: the resolve arm always writes `"adopt-unknown"`
 * (a source/scope confirmed with no vouched common ancestor), while the separate
 * equal-text auto path writes `"adopt"`. Both are admitted defensively; the
 * earlier shorthand `"adopted"` is NOT a value any path emits and must never
 * appear. Key the unresolved->adopt transition on `baseline_state ===
 * "adopt-unknown"` for this arm. (No source line numbers or commit heads: they
 * rot across repos.)
 */
export type HubSourceResolution = {
	source: string;
	visibility: "public" | "org";
	tenant_id: string | null;
	baseline_state: "adopt" | "adopt-unknown";
	scope_known: true;
};
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

/**
 * The unresolved DIAGNOSTICS for one local item (CODE MAJOR-B, design §Sidebar).
 *
 * `linksForLocalItem` reads only `inventory.links`, so an item that is present in
 * `inventory.unresolved` but absent from `inventory.links` renders NO roster mark:
 * the one thing the operator asked for - a subtle indicator beside an item when
 * there is something to act on - is missing exactly when the item needs the
 * source-confirmation act. Worse, once `hub_links` is advertised the legacy
 * `HubUpdateMark` is suppressed, so nothing stands in. This reader is the second
 * half: the caller draws a DISTINCT "source not confirmed" affordance from it.
 *
 * `kind` is narrowed to the resolve arm's own domain (agent|team) because a skill
 * can never be an unresolved row - the panel's resolve control is never wired to
 * one - so the roster lookup must not offer an affordance that has no action.
 */
export function unresolvedForLocalItem(
	inventory: HubLinks | undefined,
	kind: HubLinkKind,
	localId: string | undefined,
	name: string,
): HubUnresolvedLink[] {
	return (inventory?.unresolved ?? []).filter(
		(diagnostic) =>
			diagnostic.kind === kind &&
			(localId ? diagnostic.local_id === localId : diagnostic.name === name),
	);
}
