import type { CanonicalSessionRow } from "@shared/store/canonical-sessions-store";
import {
	type ConversationInputState,
	composerHasUnsentPayload,
} from "../../shared/store/conversation-input-store";
import type { WorkspaceTab, WorkspaceTarget } from "./workspace-tabs-model";
import { sameWorkspaceTarget } from "./workspace-tabs-model";

/** Match the app's existing 30-minute inactivity convention for temporary chats.
 * Unlike temporary chat expiry, this removes only the workspace tab. */
export const WORKSPACE_INACTIVE_MINUTES = 30;
export const WORKSPACE_INACTIVE_MS = WORKSPACE_INACTIVE_MINUTES * 60_000;
export type WorkspaceStatusReceipt = {
	epoch: string;
	revision: number;
	code: string;
};

export function confirmedWorkspaceRest(
	row: CanonicalSessionRow | undefined,
	receipt: WorkspaceStatusReceipt | undefined,
	input: ConversationInputState | undefined,
	hasDraft: boolean,
	queuedInput?: ConversationInputState,
): boolean {
	return (
		!!row &&
		!!receipt &&
		!hasDraft &&
		// We can prove freshness for the local owner using THIS feed. A peer's
		// last-known idle or an unplaced legacy row cannot vouch for a close.
		row.locality === "local" &&
		!row.link_down &&
		row.status_epoch === receipt.epoch &&
		row.status_revision === receipt.revision &&
		row.status?.code === receipt.code &&
		(receipt.code === "idle" || receipt.code === "complete") &&
		row.active === false &&
		row.background_work === false &&
		row.waiting_on === 0 &&
		row.jobs_running === 0 &&
		row.pending === null &&
		row.asks_open === 0 &&
		!composerHasUnsentPayload(input) &&
		!composerHasUnsentPayload(queuedInput)
	);
}

/** The clock runs only across an uninterrupted run of the same positive evidence. */
export function advanceWorkspaceCleanup(
	tabs: readonly WorkspaceTab[],
	active: WorkspaceTarget | undefined,
	now: number,
	prior: ReadonlyMap<string, { since: number; evidence: string }>,
	settledEvidence: (id: string) => string | undefined,
) {
	const next = new Map<string, { since: number; evidence: string }>();
	const expired = new Set<string>();
	let wakeAt = Number.POSITIVE_INFINITY;
	for (const tab of tabs) {
		if (
			tab.target.kind !== "session" ||
			tab.pinned ||
			sameWorkspaceTarget(active, tab.target)
		)
			continue;
		const evidence = settledEvidence(tab.target.id);
		if (!evidence) continue;
		const previous = prior.get(tab.key);
		const since =
			previous?.evidence === evidence && previous.since <= now
				? previous.since
				: now;
		if (now - since >= WORKSPACE_INACTIVE_MS) expired.add(tab.key);
		else {
			next.set(tab.key, { since, evidence });
			wakeAt = Math.min(wakeAt, since + WORKSPACE_INACTIVE_MS);
		}
	}
	return { next, expired, wakeAt };
}
