/**
 * The join between a remote skill CATALOGUE row and its LOCAL link.
 *
 * Pure on purpose (no React, no transport): the hub serves the catalogue and the
 * desktop serves the link inventory, and the card can only show one honest state
 * if those two facts are joined by identity rather than by row order or by name.
 * Keeping the rule here also lets `scripts/hub-skill-state.test.mjs` pin it
 * without mounting anything.
 *
 * WHY THE JOIN NEEDS THREE FIELDS. A hub id is unique only inside one source and
 * scope: the same id can exist publicly and under an organization, and two
 * sources are two different hubs. Joining on the id alone would attach one
 * source's content state to another's card, which reads as "installed" for a
 * skill that is not on this machine.
 *
 * WHY THE SCOPE FILTER EXISTS AT ALL. The server already refuses to serve a
 * private row outside its tenant, and the catalogue hooks key their cache by
 * scope. This filter is defence in depth: a renderer assembled from a cached
 * response, a retained callback or a future proxy bug must not draw a private
 * row in the public list. It never widens what the server returned.
 */
import {
	type HubLink,
	hubLinkContentState,
} from "@shared/api/local-operator/hub-links";
import type { HubUpdateItem } from "@shared/api/local-operator/hub-updates";

/** The scope a catalogue read ran under; the same shape the skills hook uses. */
export type HubSkillScopeView =
	| { visibility: "public"; tenantId: null }
	| { visibility: "org"; tenantId: string };

/** Just enough of a catalogue row to decide scope and identity. */
type SkillRowIdentity = {
	id: string;
	visibility: string;
	tenant_id?: string | null;
};

/** One normalized origin: a trailing slash is the same hub, and is not a second source. */
const TRAILING_SLASHES = /\/+$/;
function normalizeOrigin(origin: string): string {
	return origin.replace(TRAILING_SLASHES, "");
}

/**
 * Whether a catalogue row belongs to the active scope. Public means public with
 * NO tenant; org means exactly the active tenant. A row carrying a tenant in the
 * public scope (or another tenant in an org scope) is out of scope, never
 * relabelled.
 */
export function skillRowInScope(
	row: SkillRowIdentity,
	scope: HubSkillScopeView,
): boolean {
	if (scope.visibility === "public")
		return row.visibility === "public" && !row.tenant_id;
	return row.visibility === "org" && row.tenant_id === scope.tenantId;
}

/** The join key: hub id plus the identity fields that make it unique. */
export function hubSkillKey(input: {
	id?: string;
	hub_id?: string;
	visibility: string;
	tenantId?: string | null;
	tenant_id?: string | null;
}): string {
	const id = input.id ?? input.hub_id ?? "";
	const tenant = input.tenantId ?? input.tenant_id ?? "";
	return `${id}\u0000${input.visibility}\u0000${tenant}`;
}

/**
 * Index the skill links this catalogue could describe.
 *
 * Only `kind === "skill"` links from the SAME source are admitted: a link from
 * another origin is a different skill even when the ids collide. An old core that
 * does not report skill rows simply yields an empty index, so every card reads
 * "not downloaded" rather than inventing a link.
 */
export function hubSkillLinkIndex(
	links: HubLink[] | undefined,
	origin: string,
): Map<string, HubLink> {
	const wanted = normalizeOrigin(origin);
	const index = new Map<string, HubLink>();
	for (const link of links ?? []) {
		if (link.kind !== "skill") continue;
		if (normalizeOrigin(link.hub_source) !== wanted) continue;
		index.set(
			hubSkillKey({
				hub_id: link.hub_id,
				visibility: link.visibility,
				tenantId: link.tenant_id,
			}),
			link,
		);
	}
	return index;
}

/**
 * One displayed state per skill. `update` outranks the presence states because it
 * is the thing a person must act on, and it is only ever reported for a copy that
 * EXISTS: a subscribed-but-absent skill has nothing to update, its next act is a
 * download, and calling that "update available" would describe bytes that are not
 * on the machine.
 *
 * `applied` is deliberately not a state here: it is a transient outcome the
 * updates store reports, rendered through the existing hub mark vocabulary
 * beside this state rather than folded into it (an applied update must not look
 * like a waiting one).
 */
export type HubSkillState =
	| { kind: "not-present" }
	/** Linked, no copy, subscription on: "subscribed, not installed". */
	| { kind: "subscribed"; link: HubLink }
	/** Copy present and subscribed. */
	| { kind: "pulled"; link: HubLink }
	/** Copy present, subscription off: manual pulls only. */
	| { kind: "manual"; link: HubLink }
	/** Linked with no copy and no subscription: the link is dormant. */
	| { kind: "detached"; link: HubLink }
	| { kind: "update"; link: HubLink; automatic: boolean };

/**
 * Derive the state from the three facts that decide it, in this order:
 * link presence, copy presence, subscription, and a waiting update.
 *
 * `automatic` follows the backend's own `auto_will_apply` (or the link's push
 * answer when no update row exists). It is read, never re-derived: the policy
 * that decides it lives on the server and a second copy here would disagree the
 * first time the policy moved.
 */
export function hubSkillState(
	link: HubLink | undefined,
	update: HubUpdateItem | undefined,
): HubSkillState {
	if (!link) return { kind: "not-present" };
	const content = hubLinkContentState(link);
	const waiting =
		content === "present" &&
		(link.pull.state === "available" ||
			(update?.state === "available" && !update.error_class));
	if (waiting)
		return {
			kind: "update",
			link,
			automatic: update?.auto_will_apply === true || link.auto_will_apply,
		};
	if (content === "absent")
		return link.policy.subscribe
			? { kind: "subscribed", link }
			: { kind: "detached", link };
	return link.policy.subscribe
		? { kind: "pulled", link }
		: { kind: "manual", link };
}
