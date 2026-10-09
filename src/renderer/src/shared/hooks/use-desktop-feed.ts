/**
 * The renderer's end of the machine-wide desktop feed.
 *
 * Four jobs, and the first three have the same shape: each one REPLACES A TIMER
 * rather than adding one.
 *
 * 1. **The unseen mark arrives on the event.** Each `attention` frame is merged
 *    into its catalogue row through the store's revision-guarded merge, so the
 *    mark appears when the completion happens instead of up to 5 s later.
 * 2. **The catalogue refreshes on an invalidation.** A `catalogue` frame bumps a
 *    revision the sidebar watches; that revision replaces the 5 s
 *    `sessions.list` timer, whose per-row cost is a transcript-tail preview scan
 *    that grows with the store. The revision is EXPOSED rather than acted on
 *    here, because the sidebar owns `fetchSessions` and the 30 s safety poll that
 *    backs the event up.
 * 3. **The row's status arrives on the event.** Each `session_status` frame
 *    carries the backend's derived `{code, label}` and the revision it was
 *    published under, so a gate answer or a completed turn paints its row
 *    instead of waiting up to the safety poll for a whole catalogue read. The
 *    frame is applied IN PLACE and leaves one value for two writers to disagree
 *    about, which is what the guard in the store's list merge settles.
 * 4. **The authoring lists refresh on an invalidation that replaces NOTHING.**
 *    `profiles.list`/`teams.list` have no poll to replace - `staleTime: 10_000`
 *    is a freshness window refetched on mount and on window focus, not a
 *    cadence - so the `authoring` frame is the only event-driven refresh those
 *    two lists will ever have. It exists because the writer is usually an AGENT:
 *    a team or profile created over there happens with no click in this window
 *    and nothing for the renderer to invalidate a cache from, which is the
 *    reported defect this frame removes.
 *
 * CAPABILITY-GATED BOTH WAYS, and the gate is deliberately about what this app
 * can DO, not only what the backend advertises: `features.desktop_feed` absent
 * (an older backend) OR no `window.api.desktop.feed` (browser development, where
 * there is no relay and no native delivery) means the hook reports `available:
 * false` and the sidebar keeps the poll it has today. An old renderer against a
 * new backend is equally untouched — it never calls this.
 *
 * The disconnected state is surfaced rather than swallowed. A dead socket after
 * a sleep/wake is indistinguishable from a quiet machine unless somebody says
 * so, and the failure it hides is invisible: no banner, no mark, no reconnect.
 * The line the sidebar renders from this is the cheapest honest answer.
 */

import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { hostPublishRecord } from "@shared/lib/host-publish-record";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useEffect, useRef, useState } from "react";
import type { DesktopFeedFrame } from "../../../../shared/desktop-session-contract";

export type DesktopFeedConnection = {
	/** The backend advertises the feed AND this build can consume it. */
	available: boolean;
	/** The feed socket is live. Meaningless (and reported false) when unavailable. */
	connected: boolean;
	/**
	 * Whether the transport has REPORTED a state at all, ever.
	 *
	 * WHY THIS IS NOT `connected`'s job (round 1, Q3). `connected` starts `false` and
	 * the first `watchState` callback arrives a few milliseconds after mount, so a
	 * banner gated on `!connected` alone drew "Not connected to the backend" for one
	 * frame on every launch - a statement about a connection the app had not yet
	 * asked about, and about the last known state before there is one. A reader
	 * cannot act on it and the next paint contradicts it. `reported` is the fact that
	 * distinguishes "not connected" from "not asked yet".
	 */
	reported: boolean;
	/**
	 * The backend's catalogue revision as of the last `catalogue` frame, or null
	 * before the first one. A sidebar effect keyed on this refetches once per
	 * invalidation.
	 */
	catalogueRevision: number | null;
	/**
	 * Every edge that can move a row's TIME, counted. A sidebar effect keyed on
	 * this refetches once per edge, exactly as it does for `catalogueRevision` -
	 * and it exists because that frame is not promised for every edge.
	 *
	 * WHY THE BINS NEED THEIR OWN TRIGGER (2026-09-28, the operator's report). A
	 * row's bin and its relative label read the transcript's activity clock
	 * (`updated_at`), and a completed turn advances that clock on disk - but the
	 * client only learns the new value from a LIST read. The backend publishes a
	 * `catalogue` invalidation when a completion moves the row's ORDER KEY, and
	 * that covers the common case; it cannot fire for a completion that moves no
	 * key (a session already in its completion band, with the busy band missed),
	 * and there the row sat in its old bin until the 30 s safety poll - measured
	 * live: 26.3 s after the completion, on the installed runtime. So the two
	 * events that ARE always published for a finished turn - the row's
	 * `session_status` transition and its `attention` mark - also re-read the
	 * catalogue, coalesced into the same request the catalogue frames take.
	 *
	 * A COUNTER rather than a revision because the frames carry none for this
	 * edge: any change re-runs the effect, and two edges in one frame are one
	 * refetch either way (the store's coalescer is the second half of that rule).
	 */
	activityRevision: number;
	/**
	 * The backend's AUTHORING revision as of the last `authoring` frame, or null
	 * before the first one.
	 *
	 * Null is also the answer an older backend gives forever, which is what keeps
	 * this capability-free: a consumer guards on `null` and a frame that never
	 * arrives changes nothing. Consumed by the authoring queries themselves rather
	 * than by the sidebar - see the fourth job above.
	 */
	authoringRevision: number | null;
	/**
	 * Advances only when an already-established feed reconnects. The first open
	 * is not an invalidation: mount already fetched the current authoring lists.
	 */
	authoringReconnectRevision: number;
	/**
	 * The last `code_requests` frame's session and revision, or null before the
	 * first one - which is also the answer an older backend gives forever, so a
	 * consumer guards on null and a frame that never arrives changes nothing.
	 *
	 * EXPOSED rather than acted on here, exactly as `authoringRevision` is: the
	 * frame says ONE SESSION's ledger moved, and what that invalidates is that
	 * session's query key, which belongs to its owner (the code-review hooks).
	 * Handed the pair verbatim - the session id travels because the ledger is per
	 * conversation and a frame without it could not say whose list to re-read -
	 * and the CONSUMER drops a frame for a session it is not showing.
	 */
	codeRequestsRevision: { sessionId: string; revision: number } | null;
};

export function useDesktopFeed(): DesktopFeedConnection {
	const capabilities = useDesktopCapabilities();
	const native = window.api?.desktop?.feed;
	const available =
		desktopFeatureEnabled(capabilities.data, "desktop_feed") && Boolean(native);
	const [connected, setConnected] = useState(false);
	const [reported, setReported] = useState(false);
	const [catalogueRevision, setCatalogueRevision] = useState<number | null>(
		null,
	);
	const [activityRevision, setActivityRevision] = useState(0);
	const [authoringRevision, setAuthoringRevision] = useState<number | null>(
		null,
	);
	const [authoringReconnectRevision, setAuthoringReconnectRevision] =
		useState(0);
	const [codeRequestsRevision, setCodeRequestsRevision] = useState<{
		sessionId: string;
		revision: number;
	} | null>(null);
	// The feed's `open` snapshot is intentionally not enough to detect a missed
	// authoring change: a no-subscriber baseline can retain the same revision.
	// Track transport history instead, and only publish recovery after we have
	// observed a successful connection followed by a later successful connection.
	const wasConnected = useRef(false);
	const hasConnected = useRef(false);

	useEffect(() => {
		if (!available || !native) {
			// The gate closing must also clear the state it published: a backend
			// that loses the capability (a downgrade under a running app) must not
			// leave the sidebar rendering a connection it no longer has.
			wasConnected.current = false;
			setConnected(false);
			setReported(false);
			/* The runtime may have changed under us (see `host-publish-record.ts`). */
			hostPublishRecord.reset();
			return;
		}
		const applyAttention = useCanonicalSessionsStore.getState().applyAttention;
		const applySessionStatus =
			useCanonicalSessionsStore.getState().applySessionStatus;
		const offState = native.watchState(({ connected: nextConnected }) => {
			if (nextConnected) {
				if (hasConnected.current && !wasConnected.current) {
					// A reconnect starts from a backend baseline rather than replaying
					// changes during the outage. Invalidate once even when its revision
					// did not advance because there were no feed subscribers.
					setAuthoringReconnectRevision((revision) => revision + 1);
				}
				hasConnected.current = true;
			}
			/*
			 * A DROPPED CONNECTION WIPES WHAT WAS LEARNED ABOUT THE HOST: the daemon
			 * may be replaced before it returns, and the renderer is not reloaded
			 * when that happens. Wiped on the drop rather than on the return so an
			 * outage never leaves a lock the record cannot vouch for.
			 */
			if (!nextConnected) hostPublishRecord.reset();
			wasConnected.current = nextConnected;
			setReported(true);
			setConnected(nextConnected);
		});
		const offFrames = native.subscribe((frame: DesktopFeedFrame) => {
			/* Every feed frame names the process that produced it. */
			hostPublishRecord.observeProcess(frame.epoch);
			if (frame.type === "attention") {
				applyAttention(frame.session_id, frame.payload);
				/*
				 * A STANDING or NEW completion mark is one of the two edges that always
				 * accompanies a finished turn, so it re-reads the catalogue (see
				 * `activityRevision`). `unseen === false` - a receipt being CLEARED - is
				 * deliberately not one: an acknowledgement writes no transcript byte, so
				 * no row's time moved and there is nothing to re-read.
				 */
				if (frame.payload.unseen === true) {
					setActivityRevision((revision) => revision + 1);
				}
				return;
			}
			/*
			 * The row's status, pushed instead of re-read. `payload` is the backend's
			 * DERIVED pair plus the revision it was published under, and `epoch` is the
			 * feed process's - passed through untouched because it is the half of the
			 * stamp that makes a restart's counters distinguishable from a live one's.
			 *
			 * The pair is PROJECTED onto its two fields rather than passed through as
			 * the payload: the store writes its `status` argument onto the row verbatim,
			 * so handing it the payload stamps a `revision` key onto a row whose status
			 * type has no such field. That is invisible in TypeScript - the wire payload
			 * is structurally assignable to `SessionCatalogueStatus` - which is why the
			 * projection is written out here instead of being left to the types.
			 *
			 * Captured from `getState()` once per subscription rather than called
			 * through the hook, exactly as `applyAttention` above is: the handler is
			 * not a render, and a zustand action is stable for the store's lifetime.
			 */
			if (frame.type === "session_status") {
				applySessionStatus(
					frame.session_id,
					{ code: frame.payload.code, label: frame.payload.label },
					frame.payload.revision,
					frame.epoch,
				);
				/*
				 * THE OTHER ALWAYS-PUBLISHED EDGE of a turn that started or finished:
				 * the derived pair moved, and the row's bin/label read a clock this
				 * frame does not carry, so the list is re-read. The backend dedupes
				 * clock-only republishes (`status_dedupe_key`), so every frame that
				 * arrives here is a real transition rather than a ticking age.
				 */
				setActivityRevision((revision) => revision + 1);
				return;
			}
			if (frame.type === "catalogue") {
				setCatalogueRevision(frame.payload.revision);
				return;
			}
			/*
			 * The authoring revision is EXPOSED, not acted on, for the same reason the
			 * catalogue revision is: this hook is the transport, and what a revision
			 * invalidates belongs to whoever owns the query keys. Here that is the
			 * profile hooks themselves rather than the sidebar, because the sidebar is
			 * route-scoped and `/agents` is the page these lists live on.
			 *
			 * Handed the revision verbatim, in the same branch shape as `catalogue`
			 * above: a frame this build does not know falls through both.
			 */
			if (frame.type === "authoring") {
				setAuthoringRevision(frame.payload.revision);
			}
			/*
			 * ONE SESSION's code request ledger moved. A `code_requests` frame is
			 * applied by EXPOSING its pair, the same shape `authoring` above takes and
			 * for the same reason: the invalidation belongs to the session's own query
			 * owner (`features/code-review/hooks/use-code-requests.ts`), which is also
			 * the module that owns the key. The session id travels with the revision
			 * because the ledger is per conversation; a frame for a session this
			 * window is not showing is dropped by the consumer rather than by a filter
			 * here, so the transport stays free of query knowledge.
			 */
			if (frame.type === "code_requests") {
				setCodeRequestsRevision({
					sessionId: frame.session_id,
					revision: frame.payload.revision,
				});
			}
			// `open`, `heartbeat` and `gap` carry no renderable authoring data. The
			// first `open` deliberately causes no invalidation because query mounts
			// already fetch; recovery after a previously connected transport drops is
			// published through `watchState` above, where a baseline with an unchanged
			// revision cannot hide the outage. Unknown frame types remain a no-op for
			// older renderers.
		});
		return () => {
			offFrames();
			offState();
		};
	}, [available, native]);

	return {
		available,
		connected: available && connected,
		reported: available && reported,
		catalogueRevision,
		activityRevision,
		authoringRevision,
		authoringReconnectRevision,
		codeRequestsRevision,
	};
}
