/**
 * Profile proposals: the wire shapes and the pure decisions behind the Agents
 * review surface.
 *
 * ## What a proposal is, and why it lives in Agents
 *
 * When an agent wants to change an account agent or team profile and the
 * operator did not ask for that edit in so many words, core files a PROPOSAL
 * instead of writing (core plan §2: owner-typed edits that name the profile
 * apply directly, so most edits never reach this surface). Proposals used to be
 * signed mesh approvals and showed in Mesh → Approvals, where a machine without
 * a presence-backed key could not accept them at all. They now have their own
 * store and routes (`features.profile_proposals`), and this UI shows them where
 * the profile lives: a badge on the Agents nav row and on the agent/team row,
 * and a review panel on the record with a git-style diff.
 *
 * ## The contract (core plan §4)
 *
 * - `GET  /v1/desktop/profile-proposals?state=pending` →
 *   `{proposals: Summary[], counts: {agent: {name: n}, team: {name: n}}}`
 * - `GET  /v1/desktop/profile-proposals/{id}` → `Detail`
 * - `POST .../{id}/accept` `{request_id, after?, rebase?}` →
 *   `{proposal: Detail, profile, backup_id}`; 409 `profile_proposal_stale` /
 *   `profile_proposal_not_pending`
 * - `POST .../{id}/reject` `{request_id, note?}` → `{proposal: Detail}`
 *
 * The schemas permit additive object fields, but unknown lifecycle states
 * become unavailable (never actionable), and unknown trust is untrusted.
 * Missing diff content fails the detail read rather than inviting blind Accept.
 */

import { z } from "zod";

export const PROFILE_PROPOSAL_STALE = "profile_proposal_stale";
export const PROFILE_PROPOSAL_NOT_PENDING = "profile_proposal_not_pending";

/**
 * The Agents badge polls at the mesh approvals' cadence (`MESH_APPROVAL_POLL_MS`):
 * the read is one local directory scan, and a proposal is not urgent enough to
 * justify a faster one. Only while the window is visible.
 */
export const PROFILE_PROPOSAL_POLL_MS = 15_000;

const kind = z.enum(["agent", "team", "skill"]);
const state = z
	.enum(["pending", "accepted", "rejected", "superseded", "stale", "expired"])
	.catch("expired");
const trust = z.enum(["owner", "agent", "untrusted"]).catch("untrusted");

const origin = z
	.object({
		trust,
		session_id: z.string().nullable().optional(),
		trigger: z.string().nullable().optional(),
	})
	.passthrough();

export const profileProposalSummarySchema = z
	.object({
		id: z.string(),
		kind,
		name: z.string(),
		label: z.string().nullable().optional(),
		operation: z.string().catch("update"),
		fields: z.array(z.string()).catch([]),
		state,
		stale: z.boolean().catch(false),
		origin: origin.catch({ trust: "untrusted" }),
		created_at: z.number().nullable().optional(),
		expires_at: z.number().nullable().optional(),
	})
	.passthrough();

export const profileProposalChangeSchema = z
	.object({
		field: z.string(),
		label: z.string().nullable().optional(),
		before_text: z.string().nullable().catch(""),
		after_text: z.string().nullable().catch(""),
		format: z.enum(["text", "list", "json"]).catch("json"),
	})
	.passthrough();

export const profileProposalDetailSchema = profileProposalSummarySchema
	.extend({
		changes: z.array(profileProposalChangeSchema),
		base_commitment: z.string().nullable().optional(),
		after_commitment: z.string().nullable().optional(),
	})
	.passthrough();

export const profileProposalListSchema = z
	.object({
		proposals: z.array(profileProposalSummarySchema).catch([]),
		counts: z
			.object({
				agent: z.record(z.string(), z.number()).catch({}),
				team: z.record(z.string(), z.number()).catch({}),
			})
			.partial()
			.passthrough()
			.catch({}),
	})
	.passthrough();

export const profileProposalAcceptSchema = z
	.object({
		proposal: profileProposalDetailSchema,
		backup_id: z.string().nullable().optional(),
	})
	.passthrough();

export const profileProposalRejectSchema = z
	.object({ proposal: profileProposalDetailSchema })
	.passthrough();

export type ProfileProposalSummary = z.infer<
	typeof profileProposalSummarySchema
>;
export type ProfileProposalChange = z.infer<typeof profileProposalChangeSchema>;
export type ProfileProposalDetail = z.infer<typeof profileProposalDetailSchema>;
export type ProfileProposalList = z.infer<typeof profileProposalListSchema>;
export type ProfileProposalKind = "agent" | "team" | "skill";

/** Pending proposals for one record; 0 for an unknown name or no data. */
export function pendingProposalCount(
	list: ProfileProposalList | undefined,
	kind: ProfileProposalKind,
	name: string,
): number {
	const counted = kind === "skill" ? undefined : list?.counts?.[kind]?.[name];
	if (typeof counted === "number") return counted;
	return (
		list?.proposals.filter(
			(p) =>
				p.kind === kind &&
				p.name === name &&
				(p.state === "pending" || p.state === "stale"),
		).length ?? 0
	);
}

/** Every pending proposal, the number the Agents nav badge shows. */
export function totalPendingProposals(
	list: ProfileProposalList | undefined,
): number {
	if (!list) return 0;
	return list.proposals.filter(
		(p) => p.state === "pending" || p.state === "stale",
	).length;
}

/**
 * The pending proposals for one record, newest first: the panel's cards.
 * Superseded/decided ones are core's history, not something to act on.
 */
export function proposalsFor(
	list: ProfileProposalList | undefined,
	kind: ProfileProposalKind,
	name: string,
): ProfileProposalSummary[] {
	return (list?.proposals ?? [])
		.filter(
			(p) =>
				p.kind === kind &&
				p.name === name &&
				(p.state === "pending" || p.state === "stale"),
		)
		.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}

/** Known formats can be edited before accepting; JSON is parsed before sending. */
export function isEditableChange(change: ProfileProposalChange): boolean {
	return ["text", "list", "json"].includes(change.format);
}

/**
 * The `after` body for Edit-then-accept: only fields the proposal changed AND
 * the person actually edited, in the value type core's image model expects. A
 * `list` field is edited as one item per line (that is how `after_text` shows
 * it) and sent back as an array, blank lines dropped. Returns undefined when
 * nothing differs from the proposal, so a plain Accept is sent instead.
 */
export function editedAfterBody(
	changes: readonly ProfileProposalChange[],
	drafts: Readonly<Record<string, string>>,
): Record<string, unknown> | undefined {
	const out: Record<string, unknown> = {};
	for (const change of changes) {
		if (!isEditableChange(change)) continue;
		const draft = drafts[change.field];
		if (draft === undefined || draft === (change.after_text ?? "")) continue;
		out[change.field] =
			change.format === "list"
				? draft
						.split("\n")
						.map((line) => line.trim())
						.filter(Boolean)
				: change.format === "json"
					? JSON.parse(draft)
					: draft;
	}
	return Object.keys(out).length ? out : undefined;
}

/** The deep link to a record's proposal panel (`agents-page.tsx` reads it). */
export function proposalReviewPath(
	kind: ProfileProposalKind,
	name: string,
	proposalId?: string,
): string {
	// The agents page reads an absent `kind` as the Agents tab, the way its own
	// `go()` writes it; only a team says so.
	const params = new URLSearchParams();
	if (kind !== "agent") params.set("kind", kind);
	params.set("name", name);
	if (proposalId) params.set("proposal", proposalId);
	return `/agents?${params.toString()}`; // i18n: ignore route path, not user copy
}

/**
 * Pending proposals that would CREATE an agent or team the roster does not list
 * yet, one per name (newest first). Review round 1, F4/U-F4: these were counted
 * in the Agents nav badge but had no row to open, so they could never be
 * accepted. The Agents page lists them under "Proposed new" and opens the same
 * review panel in place of the missing record. A name the roster already has is
 * not "new" whatever the operation says: its proposals show on that record.
 */
export function proposedNewProfiles(
	list: ProfileProposalList | undefined,
	kind: "agent" | "team",
	existing: readonly string[],
): ProfileProposalSummary[] {
	const known = new Set(existing);
	const seen = new Set<string>();
	const out: ProfileProposalSummary[] = [];
	for (const p of [...(list?.proposals ?? [])].sort(
		(a, b) => (b.created_at ?? 0) - (a.created_at ?? 0),
	)) {
		if (p.kind !== kind || p.operation !== "create") continue;
		if (p.state !== "pending" && p.state !== "stale") continue;
		if (known.has(p.name) || seen.has(p.name)) continue;
		seen.add(p.name);
		out.push(p);
	}
	return out;
}
