/**
 * The renderer's end of the machine-wide desktop feed.
 *
 * Three jobs, and every one of them is about REPLACING A TIMER rather than
 * adding one:
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
			 * Captured from `getState()` once per subscription rather than called
			 * through the hook, exactly as `applyAttention` above is: the handler is
			 * not a render, and a zustand action is stable for the store's lifetime.
			 */
			if (frame.type === "session_status") {
				applySessionStatus(
					frame.session_id,
					frame.payload,
					frame.payload.revision,
					frame.epoch,
				);
				return;
			}
			if (frame.type === "catalogue") {
				setCatalogueRevision(frame.payload.revision);
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

	return { available, connected: available && connected, catalogueRevision };
}
