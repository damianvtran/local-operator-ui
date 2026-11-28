/**
 * The Guard status read (`GET /v1/desktop/guard`, local-operator
 * `server/models/desktop_guard.py`, design `docs/design/guard-desktop-routes.md`).
 *
 * WHY THESE ARE PARSED, NOT CAST. The Settings section, the passive indicator
 * and the rail attention line all read this one answer, and a sparse or skewed
 * body must degrade to the calm "unavailable" line instead of reaching a reader
 * as a typed object with a missing field (the boundary rule `mesh-approvals.ts`
 * states for the approvals read). A body that does not parse is `null`.
 *
 * STATES ARE ENUMS, TEXT IS OURS. The backend ships closed enums only, plus an
 * organisation's own display name; every sentence the person reads is keyed
 * copy in `ui.guard.*` (RFC §15.4' C9). The only free text here is `org`, which
 * is untrusted and is always rendered inside `<bdi>`.
 *
 * NO GRANT FIELD EXISTS. `prompt` is display-only: answering it is the typed
 * `guard_consent` approvals card the row's `approval_id` names.
 */

import { z } from "zod";
import { GUARD_SCOPE_ORDER, sanitizeOrgName } from "./guard-consent";

const scope = z.enum(GUARD_SCOPE_ORDER);

export const GUARD_ORG_STATES = [
	"sharing",
	"sharing_pending",
	"waiting",
	"not_sharing",
	"paused",
	"will_ask",
] as const;
export type GuardOrgState = (typeof GUARD_ORG_STATES)[number];

/** The pause reasons this build has a sentence for; any other reads plain "paused". */
export const GUARD_PAUSE_REASONS = [
	"entitlement_lapsed",
	"org_off",
	"membership_ended",
	"scope_revoked",
	"revoke_pending",
	"console_revoked",
] as const;
export type GuardPauseReason = (typeof GUARD_PAUSE_REASONS)[number];

/**
 * An org name that is blank AFTER sanitising (a name made only of invisible
 * characters or Hangul fillers) is MISSING, not a name (security r2 S-9). The
 * consent card goes opaque for that (no Share, see `guardOrgNameSchema`); Settings
 * cannot go opaque without hiding "Stop sharing" from the member, so it names the
 * org by its tenant id instead, which is the host's own opaque identifier and never
 * blank. Either way no surface draws an empty name in a sentence.
 */
const nameOrTenant = <T extends { org: string; tenant: string }>(
	row: T,
): T => ({
	...row,
	org: row.org || row.tenant,
});

export const guardOrgSchema = z
	.object({
		tenant: z.string().min(1).max(160),
		/** Admin-chosen text: invisible formatting stripped on parse (see `sanitizeOrgName`). */
		org: z.string().max(256).transform(sanitizeOrgName),
		role: z.string().max(32),
		state: z.enum(GUARD_ORG_STATES),
		reason: z.string().max(64).default(""),
		since: z.number().finite().nullable().default(null),
		answered_via: z.string().max(32).default(""),
		scopes_shared: z.array(scope).max(16).default([]),
		prompt: z
			.object({
				approval_id: z.string().max(64).nullable().default(null),
				collection_rev: z.number().int(),
				reason: z.string().max(32),
				widening: z.boolean(),
				asked_scopes: z.array(scope).max(16),
				grant_scopes: z.array(scope).max(16),
			})
			.nullable()
			.default(null),
		can_revoke: z.boolean(),
		can_share_again: z.boolean(),
	})
	.transform(nameOrTenant);
export type GuardOrg = z.infer<typeof guardOrgSchema>;

export const guardStatusSchema = z.object({
	mode: z.enum(["none", "orgs", "non_team", "unavailable"]),
	badge: z
		.enum(["", "waiting", "report_waiting", "sharing_pending", "sharing"])
		.default(""),
	orgs: z.array(guardOrgSchema).max(64).default([]),
	insights: z
		.array(
			z
				.object({
					tenant: z.string().min(1).max(160),
					org: z.string().max(256).transform(sanitizeOrgName),
					url: z.string().max(2048),
				})
				.transform(nameOrTenant),
		)
		.max(64)
		.default([]),
	/** Days backups of deleted step-by-step timing survive; `null` = unmeasured. */
	backup_days: z.number().int().positive().nullable().default(null),
	this_computer: z.string().max(128).default(""),
	can_answer: z.boolean().default(false),
	team_url: z.string().max(2048).default(""),
});
export type GuardStatus = z.infer<typeof guardStatusSchema>;

export function guardStatus(value: unknown): GuardStatus | null {
	const parsed = guardStatusSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

export const guardNonTeamCardSchema = z.object({
	trial_days: z.number().int().positive().nullable().default(null),
	org: z
		.string()
		.max(256)
		.transform((name) => sanitizeOrgName(name) || null)
		.nullable()
		.default(null),
	url: z.string().max(2048).default(""),
});
export type GuardNonTeamCard = z.infer<typeof guardNonTeamCardSchema>;

export function guardNonTeamCard(value: unknown): GuardNonTeamCard | null {
	const parsed = guardNonTeamCardSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

/**
 * The revoke answer. `revoke_pending` is a calm success, never an error: this
 * install stopped sharing before the request left, Radient is simply not
 * confirmed yet (RFC §5.4).
 */
export const guardRevokeResultSchema = z.object({
	tenant: z.string(),
	status: z.enum(["revoked", "revoke_pending"]),
	code: z.string().max(64).default(""),
	org: guardOrgSchema.nullable().default(null),
});
export type GuardRevokeResult = z.infer<typeof guardRevokeResultSchema>;
