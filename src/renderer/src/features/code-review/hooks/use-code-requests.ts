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
 * - a 60 s interval runs ONLY while a surface showing rows is on screen AND
 *   (the session is live OR a row has CI pending), and `refetchIntervalInBackground`
 *   stays false. A settled, idle session costs nothing; a running one keeps its
 *   CI figures moving at a cadence the design measured against GitHub's own
 *   `max-age=60`.
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
	DesktopCodeRequestRow,
	DesktopCodeRequestsList,
} from "../../../../../shared/desktop-contract";
import { chipLabel, groupRows, needsAttention } from "../code-review-model";

export const codeRequestsKeys = {
	/** One session's ledger. The prefix the refresh and the feed drop. */
	session: (sessionId: string) =>
		["desktop", "code-requests", sessionId] as const,
};

export type CodeRequestsPoll = {
	/**
	 * Whether a surface showing this list is ON SCREEN. The rail item - ambient
	 * chrome whose counts ride the feed and the focus refetch - passes `false`;
	 * the pane and the chip pass `true`. A list with no rows is never polled:
	 * discovery of a session's FIRST row is the feed frame's and the focus
	 * refetch's job, and a 60 s timer on every empty session would be the chrome
	 * this design refused.
	 */
	visible: boolean;
	/**
	 * The session is live - a turn is running, or its transport is attached.
	 * Either reading is the same answer to the interval's question ("might the
	 * ledger be moving right now?"); the call sites take the one their own data
	 * holds, and the union of observers means the pane's answer wins while the
	 * pane is open.
	 */
	sessionLive: boolean;
	/** The caller's own gate, beyond the session and the capability. */
	enabled?: boolean;
};

/** Whether the owner should poll right now, from the freshest data. */
function intervalFor(
	rows: readonly DesktopCodeRequestRow[],
	poll: CodeRequestsPoll,
): number | false {
	if (!poll.visible || rows.length === 0) return false;
	const ciPending = rows.some(
		(row) =>
			row.summary?.ci.status === "pending" ||
			(row.summary?.ci.pending ?? 0) > 0,
	);
	return poll.sessionLive || ciPending ? 60_000 : false;
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
	useCodeRequestsFeedInvalidation(sessionId);
	return useQuery(
		{
			queryKey: codeRequestsKeys.session(sessionId ?? ""),
			enabled:
				Boolean(sessionId) && capable && (poll.enabled ?? true) && provided,
			queryFn: () =>
				desktopResult<DesktopCodeRequestsList>({
					op: "code_requests.list",
					sessionId: sessionId ?? "",
				}),
			retry: retryDesktopQuery,
			staleTime: 10_000,
			refetchInterval: (query) =>
				intervalFor(
					(query.state.data as DesktopCodeRequestsList | undefined)?.rows ?? [],
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
 * A FRAME FOR ANOTHER SESSION IS IGNORED: the ledger is per conversation, and
 * invalidating this session's key because a DIFFERENT conversation's index
 * moved would refetch a list nothing changed. The pane mounts for one session
 * at a time, so last-frame-wins is the whole state this needs; a switch
 * remounts the query and fetches fresh regardless.
 *
 * The applied ref makes a duplicate delivery free, and is initialised from the
 * frame on first render so a hook that mounts AFTER a frame does not.
 */
function useCodeRequestsFeedInvalidation(sessionId: string | null) {
	const { codeRequestsRevision } = useDesktopFeed();
	/*
	 * The provider gate, same reason as `useCodeRequests`' own: a document with no
	 * `QueryClientProvider` (the mini view) must not throw on the client read NOR
	 * run an invalidation against a client nobody reads - there is no query to
	 * invalidate there, and `provided` false short-circuits both.
	 */
	const { client: queryClient, provided } = useOptionalQueryClient();
	const applied = useRef<{ sessionId: string; revision: number } | null>(
		codeRequestsRevision,
	);
	useEffect(() => {
		if (!provided) return;
		if (!sessionId) return;
		if (!codeRequestsRevision) return;
		if (codeRequestsRevision.sessionId !== sessionId) return;
		const previous = applied.current;
		if (
			previous &&
			previous.sessionId === codeRequestsRevision.sessionId &&
			previous.revision === codeRequestsRevision.revision
		)
			return;
		applied.current = codeRequestsRevision;
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
			mutationFn: async () => {
				await desktopResult<unknown>({
					op: "code_requests.refresh",
					sessionId: sessionId ?? "",
					force: true,
				});
			},
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
 * VISIBLE IS `true` FOR THE CALLER'S OWN REASON: the chip renders ONLY when
 * rows exist, so "the chip is visible" and "the list has rows" are the same
 * admission; before that, the feed frame and the focus refetch are what
 * announce the first row.
 */
export function useCodeRequestsChip(
	sessionId: string | null,
	sessionLive: boolean,
) {
	const hosted = useUiPreferencesStore((s) => s.rightSlotRoute.mounted);
	const query = useCodeRequests(sessionId, {
		visible: true,
		sessionLive,
		/*
		 * A WINDOW WITH NO SLOT READS NOTHING: with `hosted` false the query is
		 * DISABLED rather than merely hidden, so the mini quick-send window does not
		 * fire a local GET per session for a chip it cannot draw (the fail-closed
		 * direction this plane states everywhere else).
		 */
		enabled: hosted,
	});
	const rows = query.data?.rows ?? [];
	const groups = groupRows(rows);
	const attention = needsAttention(rows);
	return {
		show: hosted && rows.length > 0,
		count: rows.length,
		opened: groups.opened.length,
		mentioned: groups.mentioned.length,
		attention,
		label: chipLabel(
			rows.length,
			groups.opened.length,
			groups.mentioned.length,
			attention,
		),
	};
}
