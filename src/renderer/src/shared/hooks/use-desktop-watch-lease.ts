/**
 * Drives the backend watch lease for the active canonical subscription.
 *
 * The lease is a heartbeat the backend expires after 45s. Sending it every
 * 15s from the renderer means a crashed or killed window stops it naturally
 * and the backend's own OS-toast fallback resumes; there is no teardown path
 * that can be forgotten. Visibility and focus are read from the document so
 * a background window reports itself as watching-but-not-interactive, which
 * is what lets the backend park a gate for notification instead of assuming
 * someone is looking.
 *
 * Under Electron the heartbeat goes through main, which is the only place
 * that knows whether it can really deliver a notification. In browser dev
 * there is no native delivery, so the lease is sent with can_notify false
 * through the JSON transport.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { useEffect } from "react";
import { SUBSCRIPTION_ID_PATTERN } from "../../../../shared/desktop-contract";

const HEARTBEAT_MS = 15_000;

export function useDesktopWatchLease(
	sessionId: string | undefined,
	subscriptionId: string | null,
): void {
	useEffect(() => {
		if (!sessionId || !subscriptionId) return;
		// Truthiness is not the contract. A lease names a subscription the backend
		// is holding RIGHT NOW, and the backend validates the id as
		// `[a-f0-9]{32}`: anything else - an empty string, a session id, the tail
		// of a torn frame - earns a 422 from `POST .../{id}/watch` while the
		// heartbeat keeps firing every 15s. The renderer has the same regex the
		// request schema has, so it can simply not send the lease.
		if (!SUBSCRIPTION_ID_PATTERN.test(subscriptionId)) return;
		let cancelled = false;

		const send = () => {
			if (cancelled) return;
			const visible = document.visibilityState === "visible";
			const focused = document.hasFocus();
			const native = window.api?.desktop?.watchHeartbeat;
			const promise = native
				? native({ sessionId, subscriptionId, visible, focused })
				: desktopResult({
						op: "sessions.watch",
						sessionId,
						subscriptionId,
						visible: visible && focused,
						canNotify: false,
					});
			void Promise.resolve(promise).catch(() => {
				// A missed heartbeat is self-healing: the next one re-establishes
				// the lease or the backend expires it. Nothing to surface.
			});
		};

		send();
		const timer = setInterval(send, HEARTBEAT_MS);
		// Focus/visibility changes are reported immediately so a gate raised
		// while the window was hidden is not held for a full interval.
		document.addEventListener("visibilitychange", send);
		window.addEventListener("focus", send);
		window.addEventListener("blur", send);
		return () => {
			cancelled = true;
			clearInterval(timer);
			document.removeEventListener("visibilitychange", send);
			window.removeEventListener("focus", send);
			window.removeEventListener("blur", send);
		};
	}, [sessionId, subscriptionId]);
}
