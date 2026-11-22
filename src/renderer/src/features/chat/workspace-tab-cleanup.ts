import type { DesktopResponse } from "../../../../shared/desktop-contract";

/** Match the app's existing 30-minute inactivity convention for temporary chats.
 * Unlike temporary chat expiry, this removes only the workspace tab. */
export const WORKSPACE_INACTIVE_MINUTES = 30;
export const WORKSPACE_INACTIVE_MS = WORKSPACE_INACTIVE_MINUTES * 60_000;

function fields(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/** Catalogue facts can veto a probe, not certify rest: cold rows legitimately
 * lack live job/ask counts and status stamps. Core's opted-in proof replaces
 * that inference, but never overrides an explicitly blocked row. */
export function workspaceRowCanRest(value: unknown): boolean {
	const row = fields(value);
	if (!row || row.locality !== "local") return false;
	const code = fields(row.status)?.code;
	return (
		!row.link_down &&
		!row.pinned &&
		!row.archived &&
		!row.active &&
		!row.background_work &&
		fields(row.attention)?.unseen !== true &&
		row.pending == null &&
		["waiting_on", "jobs_running", "asks_open"].every(
			(key) => row[key] == null || row[key] === 0,
		) &&
		(code === undefined || code === "idle" || code === "complete")
	);
}

/** Positive evidence lives only in this response, never in the sidebar's
 * merged rows. A page miss, duplicate row, incompatible Core or bad receipt
 * supplies no evidence; the revision's contents have no client-side meaning. */
export function workspaceRestRevisions(
	response: DesktopResponse | null,
	requested: ReadonlySet<string>,
	epoch: string,
): ReadonlyMap<string, string | undefined> {
	const revisions = new Map<string, string | undefined>();
	if (!response || response.status < 200 || response.status >= 300)
		return revisions;
	const rows = fields(fields(response.body)?.result)?.sessions;
	if (!Array.isArray(rows)) return revisions;
	for (const value of rows) {
		const row = fields(value);
		if (!row || typeof row.id !== "string" || !requested.has(row.id)) continue;
		const proof = fields(row.workspace_rest);
		const revision = proof?.revision;
		revisions.set(
			row.id,
			!revisions.has(row.id) &&
				workspaceRowCanRest(row) &&
				proof?.version === 1 &&
				proof.epoch === epoch &&
				typeof revision === "string" &&
				revision.trim().length > 0
				? revision
				: undefined,
		);
	}
	return revisions;
}
