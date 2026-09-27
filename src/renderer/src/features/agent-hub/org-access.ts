/**
 * What a membership entitles, in one place (design §3.2/§8.4).
 *
 * The org selector, the publish target picker and the degraded-plan copy all ask
 * the same question about the same row, and the answer must not be spelled three
 * times: a surface that offered an org the server refuses, or hid one it would
 * answer for, is exactly the defect this module exists to prevent.
 *
 * ## The rule, and where it comes from
 *
 * `available` — the org's workspace can be read, and a publication can target it:
 * an ACTIVE membership whose tenant plan entitles org features, OR the caller is
 * the OWNER. Both halves are the server's own rule, not this app's reading of it:
 * `CheckOrgAccess` (agent-server, internal/services/membership_service.go)
 * requires an active membership at the needed rank and, "for non-owners", a plan
 * that entitles org features (`planStatusEntitlesOrgAccess`), and §3.2 states the
 * owner half — "the owner retains read access to the org workspace in every
 * state".
 *
 * `plan_inactive` — a membership that cannot use the org because of the PLAN: the
 * caller is not the owner and the plan is `none` or `canceled`. This is the state
 * §8.4's picker renders disabled with an upgrade hint, and it is deliberately NOT
 * `past_due`: §3.1 gives `past_due` FULL entitlements during dunning, with a
 * payment-issue banner rather than a loss of access, so treating it as unentitled
 * would hide an org the hub would still answer for.
 *
 * `no_access` — the membership itself does not grant org features (`pending`
 * before a plan, or `disabled` by a downgrade, §3.3). The server answers these
 * with `not_a_member`, which is the same 403 a stranger gets, and §2.2 refuses to
 * say which of the three it was.
 */

import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import type { MembershipSummary } from "@shared/api/radient/types";

export type OrgAccess = "available" | "plan_inactive" | "no_access";

/**
 * The plan statuses that entitle org features (§3.1's entitlements column).
 *
 * `past_due` is here on purpose and the comment above says why; a reader who
 * "fixes" it into `status === "active"` would deny an org mid-dunning.
 */
export const planEntitlesOrgFeatures = (
	status: MembershipSummary["plan"]["status"],
): boolean => status === "active" || status === "past_due";

/** What one membership row entitles, per the module comment above. */
export const orgAccess = (membership: MembershipSummary): OrgAccess => {
	if (membership.status !== "active") return "no_access";
	if (membership.role === "owner") return "available";
	return planEntitlesOrgFeatures(membership.plan.status)
		? "available"
		: "plan_inactive";
};

/** The orgs a scope selector or a target picker may offer, in list order. */
export const usableOrgs = (
	memberships: readonly MembershipSummary[],
): MembershipSummary[] =>
	memberships.filter((m) => orgAccess(m) === "available");

/**
 * The orgs a target picker must show DISABLED, with the reason it shows.
 *
 * The picker is the one surface that names what the user cannot do, because the
 * alternative is an org that silently is not there: a member whose team plan
 * lapsed would otherwise see no sign that their organization exists. `no_access`
 * rows are not offered at all — publishing into an org whose membership is
 * pending or disabled is not a plan problem, and inviting them to "upgrade"
 * would name the wrong remedy.
 */
export const planBlockedOrgs = (
	memberships: readonly MembershipSummary[],
): MembershipSummary[] =>
	memberships.filter((m) => orgAccess(m) === "plan_inactive");

/**
 * What an org read's REFUSAL means, when it means something other than an outage.
 *
 * Design §8.4: "empty/revoked states render as 'no access' per plan status, not
 * as errors". The three frozen org codes (§2.2) are exactly that distinction, and
 * the desktop transport preserves them — `_failure` puts the code in
 * `detail.code`, `desktopResult` lifts it onto `DesktopControlError.code`, and
 * the credential classifier's reminder that a 403 is "not a credential refusal"
 * exists for this reading.
 *
 * `null` means "this was not an org refusal" — an outage, an unreachable
 * backend, a refused credential — and every one of those keeps the surface's own
 * failure treatment. Reading them as "no access" would be the silent wrong
 * answer this function exists to prevent: a backend that is not running would
 * render as an organization that revoked access.
 *
 * `insufficient_role` is folded into `no_access` rather than given a third
 * state, because for the read this classifies it means the same thing to the
 * reader: the org is not open to you, and somebody with authority has to change
 * that. The role's name only exists on the wire for the WRITE paths, where the
 * publish dialog has a `required` detail to quote.
 */
export type OrgRefusal = "plan" | "no_access" | null;

export const orgRefusalFromError = (error: unknown): OrgRefusal => {
	if (!(error instanceof DesktopControlError)) return null;
	switch (error.code) {
		case "team_plan_required":
			return "plan";
		case "not_a_member":
		case "insufficient_role":
			return "no_access";
		default:
			return null;
	}
};
