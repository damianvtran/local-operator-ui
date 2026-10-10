/**
 * The Code review pane's data layer: one query, one refresh mutation, and the
 * desktop-feed invalidation that keeps the row list honest.
 *
 * ONE KEY, SHARED BY THREE SURFACES. The pane, the rail item and the composer
 * chip all read the same ledger for the same session, so they read the same
 * key (`["desktop", "code-requests", sessionId]`) through this hook; a fourth
 * spelling of the key is how a rail count and the pane it opens come to
 * disagree. The key module exports it so the refresh mutation and the feed
 * invalidation cannot drift from the reads.
 *
 * FRESHNESS (design record §D.5). Three writers, and none of them is a timer
 * the app forgot about:
 *
 * - the desktop-feed frame `code_requests` - published when the session's
 *   ledger index or fetch cache moves - arrives through `useDesktopFeed` and
 *   invalidates this key for the session the frame names;
 * - the app's global `refetchOnWindowFocus` re-reads the pane the moment the
 *   operator looks back at the window;
 * - a 60 s interval runs ONLY while the PANE is on screen AND (a turn is
 *   RUNNING on the session OR a row has CI pending), and
 *   `refetchIntervalInBackground` stays false. A settled, idle session costs
 *   nothing; a running one keeps its CI figures moving at a cadence the design
 *   measured against GitHub's own `max-age=60`. The chip and the rail item are
 *   DOORS whose counts ride the frame and the window-focus refetch, never this
 *   timer (the amended rule QA round 1's Q-2 forced: `sessionLive` used to
 *   mean transport-attached, which is true for every open window).
 *
 * CAPABILITY-GATED, FAIL-CLOSED: `features.code_requests` absent means the
 * query is disabled entirely, exactly as `projects.list` states for its own
 * gate - a read fired before the capability answer arrives would 404 against an
 * older backend and paint an error the user cannot act on.
 */

import { retryDesktopQuery } from "@shared/api/local-operator/backend-error";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { useDesktopFeed } from "@shared/hooks/use-desktop-feed";
import { useOptionalQueryClient } from "@shared/hooks/use-optional-query-client";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type {
	DesktopCodeRequestRefreshReceipt,
	DesktopCodeRequestRow,
	DesktopCodeRequestsList,
} from "../../../../../shared/desktop-contract";
import {
	attentionCause,
	chipLabel,
	groupRows,
	rowHasPendingCi,
} from "../code-review-model";

export const codeRequestsKeys = {
	/** One session's ledger. The prefix the refresh and the feed drop. */
	session: (sessionId: string) =>
		["desktop", "code-requests", sessionId] as const,
};

export type CodeRequestsPoll = {
	/**
	 * Whether a surface that WANTS the refresh timer is on screen: the PANE
	 * passes `true`, and nothing else does (§D.5, as amended by QA round 1's
	 * Q-2/F5). The chip and the rail item are DOORS whose counts ride the
	 * desktop-feed frame and the window-focus refetch - a closed pane's chip
	 * polling every 60 s was the defect: an idle session with a chip and no
	 * open pane cost a local GET forever, and each GET could trigger a forge
	 * refetch through the backend's own TTL pass.
	 */
	visible: boolean;
	/**
	 * True while the session is ACTIVELY RUNNING A TURN (`canonical.turnAlive`,
	 * the same reading the Stop control takes), not merely transport-attached.
	 * An open window on an idle conversation is not a reason to poll; a turn in
	 * flight is, because the ledger is being written under it.
	 */
	sessionLive: boolean;
	/** The caller's own gate, beyond the session and the capability. */
	enabled?: boolean;
};

/**
 * How long a scan that has not settled waits before the next read: the
 * backend's own `scan_state: "refreshing"` is the signal, and the cadence is
 * short because the scan is local and settles in seconds (UX round 1, U2's
 * "poll slowly while scanning" - no frame, no 75 s stuck on a stale empty).
 */
export const SCAN_POLL_MS = 5_000;

/**
 * Whether the owner should poll right now, from the freshest data.
 *
 * THE RULE (manager decision 4 as amended by QA Q-2 / review F5): 60 s ONLY
 * while the PANE is visible AND (a turn is running OR a row has CI pending);
 * `false` otherwise. A scan the backend has not settled polls at
 * `SCAN_POLL_MS` regardless of rows, because the index under the pane is
 * about to be replaced.
 */
export function intervalFor(
	data: DesktopCodeRequestsList | undefined,
	poll: CodeRequestsPoll,
): number | false {
	if (!poll.visible) return false;
	if (data?.scan_state === "refreshing") return SCAN_POLL_MS;
	const rows = data?.rows ?? [];
	if (poll.sessionLive || rows.some(rowHasPendingCi)) return 60_000;
	return false;
}

/**
 * Whether the ledger read may run at all. Pure so the enablement rules are
 * pinned by a test rather than by a render: a read fires only with a session,
 * the capability, the caller's own gate and a real query client (the mini
 * view's document supplies none - `useOptionalQueryClient`).
 */
export function codeRequestsEnabled(input: {
	sessionId: string | null;
	capable: boolean;
	pollEnabled: boolean;
	provided: boolean;
}): boolean {
	return (
		Boolean(input.sessionId) &&
		input.capable &&
		input.pollEnabled &&
		input.provided
	);
}

/**
 * The applied-frame ledger's next value: the frame when it names THIS session
 * and is not the one already spent, the previous value otherwise. Pure so the
 * invalidation rule (including "a frame for another session is ignored") is
 * pinned directly; the effect below spends it.
 *
 * A duplicate delivery is free because the pair matches what is already applied
 * - and the ref is initialised to `null` rather than to the frame (agent review
 * round 1, N2: `useDesktopFeed`'s state is per-call and starts null, so the old
 * `useRef(codeRequestsRevision)` initialiser was vacuous, and a hook that
 * mounts while a frame is current simply treats that frame as new, which is the
 * correct answer for a query that has not read yet anyway).
 */
export function appliedAfterFrame(
	applied: { sessionId: string; revision: number } | null,
	frame: { sessionId: string; revision: number } | null,
	sessionId: string | null,
): { sessionId: string; revision: number } | null {
	if (!frame || !sessionId) return applied;
	if (frame.sessionId !== sessionId) return applied;
	if (
		applied &&
		applied.sessionId === frame.sessionId &&
		applied.revision === frame.revision
	)
		return applied;
	return frame;
}

/**
 * The ledger read. See the module header for the freshness model.
 *
 * `retryDesktopQuery` and `staleTime: 10_000` are the desktop hooks' house
 * pattern (`use-projects-queries.ts` states the division): retries only where
 * the failure carries a status to retry AGAINST, and a ten-second window so a
 * remount does not re-read what the last surface just read.
 *
 * THE PROVIDER GATE, through `useOptionalQueryClient` (`useDesktopCapabilities`'
 * own pattern): the shared composer mounts in the mini view's document, which
 * carries no `QueryClientProvider`, and `useQuery` cannot be called without a
 * client at all - it throws before any option is read. A document with no
 * provider gets the inert fallback client and `provided: false`, the query is
 * DISABLED (never fetched from a client nobody reads, and `enabled` reads
 * absence as "this surface is not offered here"), and no state whatsoever is
 * written: the mini window, and any bare test harness, mount the composer
 * exactly as they did before this feature.
 */
export function useCodeRequests(
	sessionId: string | null,
	poll: CodeRequestsPoll,
) {
	const { client, provided } = useOptionalQueryClient();
	const capabilities = useDesktopCapabilities();
	const capable = desktopFeatureEnabled(capabilities.data, "code_requests");
	useCodeRequestsFeedInvalidation(sessionId, provided);
	return useQuery(
		{
			queryKey: codeRequestsKeys.session(sessionId ?? ""),
			enabled: codeRequestsEnabled({
				sessionId,
				capable,
				pollEnabled: poll.enabled ?? true,
				provided,
			}),
			queryFn: () =>
				desktopResult<DesktopCodeRequestsList>({
					op: "code_requests.list",
					sessionId: sessionId ?? "",
				}),
			retry: retryDesktopQuery,
			staleTime: 10_000,
			refetchInterval: (query) =>
				intervalFor(
					query.state.data as DesktopCodeRequestsList | undefined,
					poll,
				),
			refetchIntervalInBackground: false,
		},
		client,
	);
}

/**
 * The feed invalidation: a `code_requests` frame for THIS session re-reads the
 * list. The transport (revisions) lives in `use-desktop-feed`; the KEY belongs
 * to this module, so the effect that spends it lives beside the key, exactly as
 * `useAuthoringRefresh` states the split for the authoring lists.
 *
 * A FRAME FOR ANOTHER SESSION IS IGNORED (`appliedAfterFrame`): the ledger is
 * per conversation, and invalidating this session's key because a DIFFERENT
 * conversation's index moved would refetch a list nothing changed. The pane
 * mounts for one session at a time, so last-frame-wins is the whole state this
 * needs; a switch remounts the query and fetches fresh regardless.
 */
function useCodeRequestsFeedInvalidation(
	sessionId: string | null,
	provided: boolean,
) {
	const { codeRequestsRevision } = useDesktopFeed();
	/*
	 * The invalidation's own provider gate, same reason as `useCodeRequests`':
	 * a document with no `QueryClientProvider` (the mini view) must not run an
	 * invalidation against a client nobody reads - `provided` false
	 * short-circuits the client read and the effect.
	 */
	const { client: queryClient } = useOptionalQueryClient();
	const applied = useRef<{ sessionId: string; revision: number } | null>(null);
	useEffect(() => {
		if (!provided) return;
		const next = appliedAfterFrame(
			applied.current,
			codeRequestsRevision,
			sessionId,
		);
		if (next === applied.current) return;
		applied.current = next;
		if (!sessionId) return;
		void queryClient.invalidateQueries({
			queryKey: codeRequestsKeys.session(sessionId),
		});
	}, [codeRequestsRevision, sessionId, queryClient, provided]);
}

/**
 * The refresh mutation: the pane bar's Refresh, and the only press in this
 * feature that reaches the network on its own (`POST …/refresh {force: true}`
 * bypasses the TTL but not a host's rate-limit window - the cooling line says
 * when one is open, and the route's own 202 says the fetch is in flight).
 *
 * THE INVALIDATION AFTER THE POST IS DELIBERATE: the GET answers from the
 * cache without blocking, so a bare re-read would paint the same rows; the
 * write marks the key dirty, and the re-read then finds the fresh set the
 * background fetch landed (or the frame that says it landed). The mutation's
 * success is not a claim that data arrived - the feed is what says that.
 */
export function useRefreshCodeRequests(sessionId: string | null) {
	const { client: queryClient, provided } = useOptionalQueryClient();
	return useMutation(
		{
			/*
			 * The 202 receipt is RETURNED rather than discarded: its `accepted` and
			 * `note` are the backend's own sentence about the two halves, and the
			 * pane's quiet cue after a press reads them (UX round 1, U3).
			 */
			mutationFn: async () =>
				desktopResult<DesktopCodeRequestRefreshReceipt>({
					op: "code_requests.refresh",
					sessionId: sessionId ?? "",
					force: true,
				}),
			onSuccess: () => {
				if (!provided) return;
				if (!sessionId) return;
				void queryClient.invalidateQueries({
					queryKey: codeRequestsKeys.session(sessionId),
				});
			},
		},
		queryClient,
	);
}

/**
 * The composer chip's state: whether the chip shows at all, the counts that
 * name it, and the one label its tooltip and its announced name share.
 *
 * THE HOST GATE IS THE FIRST TERM. A chip is a DOOR; it may only be drawn in a
 * document that has somewhere to open (the right slot), and the honest signal
 * for that is the store's route fact - the same fact every pane's drawability
 * reads. The mini quick-send window mounts a composer and no chat surface, so
 * `mounted` is false there and the chip cannot appear; a control whose press
 * opens nothing is the dead affordance this codebase refuses elsewhere.
 *
 * THE CHIP NEVER POLLS (QA round 1, Q-2 / review F5). It passes
 * `visible: false`: its count rides the desktop-feed frame and the
 * window-focus refetch, and a closed pane's chip running a 60 s timer was the
 * defect - an idle conversation paid a local GET forever. `sessionLive` is not
 * a parameter at all any more: with no timer it decided nothing, and the one
 * caller passed a transport reading that was always true.
 */
export function useCodeRequestsChip(sessionId: string | null, open = false) {
	const hosted = useUiPreferencesStore((s) => s.rightSlotRoute.mounted);
	const query = useCodeRequests(sessionId, {
		visible: false,
		sessionLive: false,
		/*
		 * A WINDOW WITH NO SLOT READS NOTHING: with `hosted` false the query is
		 * DISABLED rather than merely hidden, so the mini quick-send window does not
		 * fire a local GET per session for a chip it cannot draw (the fail-closed
		 * direction this plane states everywhere else).
		 */
		enabled: hosted,
	});
	return chipState(hosted, query.data?.rows ?? [], open);
}

/**
 * The chip's whole derived state, pure (`useCodeRequestsChip` is the wrapper):
 * whether the chip shows, the counts that name it, and the one label its
 * tooltip and announced name share.
 *
 * SHOW = a slot to open into AND ≥1 VISIBLE ROW (manager decision 2): the
 * rows the backend collapsed into `tool_output_only_count` never arrive in
 * this list, so `rows.length` IS the count of visible rows - a `gh pr list`
 * dump does not raise the chip.
 */
export function chipState(
	hosted: boolean,
	rows: DesktopCodeRequestRow[],
	open = false,
) {
	const groups = groupRows(rows);
	/*
	 * THE CAUSE, not a boolean (D5/U6): "findings open" was stated when the only
	 * cause was a red pipeline.
	 */
	const cause = attentionCause(rows);
	return {
		show: hosted && rows.length > 0,
		count: rows.length,
		opened: groups.opened.length,
		mentioned: groups.mentioned.length,
		attention: cause !== null,
		cause,
		label: chipLabel(
			rows.length,
			groups.opened.length,
			groups.mentioned.length,
			cause,
			open,
		),
	};
}
