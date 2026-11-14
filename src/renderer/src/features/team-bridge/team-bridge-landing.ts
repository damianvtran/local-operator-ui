/**
 * WHICH CONVERSATION A TEAM BRIDGE OPEN LANDS ON, KNOWN BEFORE THE PAGE EXISTS
 * (bridge-instant-load, ui#1895 follow-up).
 *
 * The operator's bar: "The whole thing should load in under 300ms ... loading
 * and updating things in the background via a team bridge daemon/process, so
 * that clicking in is instant". The renderer's "background daemon" is the
 * shell's notification watcher (`useTeamBridgeNotifications`): it is mounted
 * for the life of the app window and already keeps this account's
 * conversation list warm. What it did NOT know was which conversation the page
 * would land on, so the first open still paid one full history round trip
 * (native bench on v0.56.1: first open 362.4 ms against the 300 ms bar, with
 * the list already cached and 6 blocking messages reads).
 *
 * This module answers that question with the SAME helpers, in the SAME order,
 * as the page's opening path (`TeamBridgePage`), so the watcher warms exactly
 * the entry the page's timeline then adopts:
 *
 *   1. scope: `readLastScope ?? readScopePreference`, validated by
 *      `resolveOpeningScope` against the organizations (page: `storedScope`,
 *      `scope` initialiser and the adoption effect);
 *   2. rows: `snapshotForScope` then `visibleConversationRows` (page:
 *      `openingSnapshot` -> `conversations` -> `visibleConversations`);
 *   3. landing: the remembered view for that scope (`readViewMemory`) when it
 *      names a conversation the rows hold, else `defaultLandingConversation`
 *      (page: the one-shot landing effect, whose remembered target the
 *      validation falls back from when it no longer resolves).
 *
 * Deliberately NOT modelled: a deep link or notification click (`?conversation=`)
 * - those name their conversation, and the page's own parallel read
 * (`prefetchTeamBridgeLanding`) already starts it at mount.
 *
 * Pure apart from the storage it is handed: no query, no request.
 */
import type { TeamBridgeConversation } from "../../../../shared/team-bridge-contract";
import {
	TEAM_BRIDGE_ALL_SCOPE,
	type TeamBridgeOrganization,
	type TeamBridgeScope,
	defaultLandingConversation,
	isPreviewConversation,
	visibleConversationRows,
} from "./team-bridge-model";
import { teamBridgePrefetchCandidates } from "./team-bridge-prefetch";
import {
	readScopePreference,
	resolveOpeningScope,
	snapshotForScope,
} from "./team-bridge-scope-preference";
import { readLastScope, readViewMemory } from "./team-bridge-view-memory";

/**
 * How many conversations the watcher warms per changed list, INCLUDING the
 * landing one. The landing is the read the first open waits on; the other
 * two make the "never-prefetched skeleton" on the next click rarer without
 * the watcher becoming a second planner: the page's own plan
 * (`TEAM_BRIDGE_PREFETCH_RECENT`, 8) takes over once it is mounted. Small on
 * purpose - every read spends the hub's per-account `conversation-reads`
 * bucket (120/min) that agent sessions share.
 */
export const TEAM_BRIDGE_BACKGROUND_WARM = 3;

export type TeamBridgeOpeningLanding = {
	scope: TeamBridgeScope;
	/** The conversation the open lands on, or undefined (nothing to land on). */
	landing: TeamBridgeConversation | undefined;
	/** Landing first, then the next most likely clicks; at most `limit`. */
	warm: TeamBridgeConversation[];
};

export function teamBridgeOpeningLanding({
	rows,
	organizations,
	accountId,
	storage,
	limit = TEAM_BRIDGE_BACKGROUND_WARM,
}: {
	/** The watcher's account-scoped list: the page's `openingRows`. */
	rows: readonly TeamBridgeConversation[];
	organizations: readonly TeamBridgeOrganization[];
	accountId: string;
	storage: Pick<Storage, "getItem"> | null;
	limit?: number;
}): TeamBridgeOpeningLanding {
	const stored = storage
		? (readLastScope(storage, accountId) ??
			readScopePreference(storage, accountId))
		: undefined;
	const scope = resolveOpeningScope({
		organizations,
		stored,
		requestedTenant: null,
		chosen: false,
		current: stored ?? TEAM_BRIDGE_ALL_SCOPE,
		snapshotRows: rows,
	});
	const visible = visibleConversationRows(
		snapshotForScope(rows, scope),
		scope,
		organizations,
	);
	const remembered = storage ? readViewMemory(storage, accountId, scope) : null;
	const rememberedTarget = remembered?.target;
	const rememberedRow =
		rememberedTarget?.type === "conversation"
			? visible.find(
					(row) =>
						row.id === rememberedTarget.id &&
						// The record's tenant, when it has one: a conversation id is
						// only addressable together with its organization.
						(!remembered?.tenantId || row.tenant_id === remembered.tenantId),
				)
			: undefined;
	const landing =
		rememberedRow ??
		defaultLandingConversation(
			visible,
			organizations.map((organization) => organization.tenantId),
		);
	const warm: TeamBridgeConversation[] = [];
	const seen = new Set<string>();
	const take = (row: TeamBridgeConversation | undefined) => {
		if (!row || warm.length >= limit) return;
		// A preview has no readable history and an archived row is rarely the
		// next click; the page's planner skips both for the same reasons.
		if (isPreviewConversation(row) || row.status === "archived") return;
		const key = `${row.tenant_id}\u0000${row.id}`;
		if (seen.has(key)) return;
		seen.add(key);
		warm.push(row);
	};
	take(landing);
	for (const row of teamBridgePrefetchCandidates(visible, {
		recent: limit,
		max: limit,
	}))
		take(row);
	return { scope, landing, warm };
}
