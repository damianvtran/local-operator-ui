/**
 * The renderer's end of the machine-wide desktop feed.
 *
 * Two jobs, and both are about REPLACING A TIMER rather than adding one:
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
		const offState = native.watchState((state) =>
			setConnected(state.connected),
		);
		const offFrames = native.subscribe((frame: DesktopFeedFrame) => {
			if (frame.type === "attention") {
				applyAttention(frame.session_id, frame.payload);
				return;
			}
			if (frame.type === "catalogue") {
				setCatalogueRevision(frame.payload.revision);
			}
			// `open`, `heartbeat` and `gap` carry transport state and nothing the
			// renderer renders: the snapshot IS the first catalogue revision, and a
			// reconnect is main's watchdog's job. Ignored deliberately rather than
			// routed into a state store nothing reads.
		});
		return () => {
			offFrames();
			offState();
		};
	}, [available, native]);

	return { available, connected: available && connected, catalogueRevision };
}
