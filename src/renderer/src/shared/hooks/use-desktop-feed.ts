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
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useEffect, useState } from "react";
import type { DesktopFeedFrame } from "../../../../shared/desktop-session-contract";

export type DesktopFeedConnection = {
	/** The backend advertises the feed AND this build can consume it. */
	available: boolean;
	/** The feed socket is live. Meaningless (and reported false) when unavailable. */
	connected: boolean;
	/**
	 * The backend's catalogue revision as of the last `catalogue` frame, or null
	 * before the first one. A sidebar effect keyed on this refetches once per
	 * invalidation.
	 */
	catalogueRevision: number | null;
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
};

export function useDesktopFeed(): DesktopFeedConnection {
	const capabilities = useDesktopCapabilities();
	const native = window.api?.desktop?.feed;
	const available =
		desktopFeatureEnabled(capabilities.data, "desktop_feed") && Boolean(native);
	const [connected, setConnected] = useState(false);
	const [catalogueRevision, setCatalogueRevision] = useState<number | null>(
		null,
	);
	const [authoringRevision, setAuthoringRevision] = useState<number | null>(
		null,
	);

	useEffect(() => {
		if (!available || !native) {
			// The gate closing must also clear the state it published: a backend
			// that loses the capability (a downgrade under a running app) must not
			// leave the sidebar rendering a connection it no longer has.
			setConnected(false);
			return;
		}
		const applyAttention = useCanonicalSessionsStore.getState().applyAttention;
		const applySessionStatus =
			useCanonicalSessionsStore.getState().applySessionStatus;
		const offState = native.watchState((state) =>
			setConnected(state.connected),
		);
		const offFrames = native.subscribe((frame: DesktopFeedFrame) => {
			if (frame.type === "attention") {
				applyAttention(frame.session_id, frame.payload);
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
			// `open`, `heartbeat` and `gap` carry transport state and nothing the
			// renderer renders: the snapshot IS the first catalogue revision, and a
			// reconnect is main's watchdog's job. Ignored deliberately rather than
			// routed into a state store nothing reads — and a type this build does not
			// know (a newer backend's frame) is ignored by the same missing branch,
			// which is what makes the addition of one a no-op for older renderers.
		});
		return () => {
			offFrames();
			offState();
		};
	}, [available, native]);

	return {
		available,
		connected: available && connected,
		catalogueRevision,
		authoringRevision,
	};
}
