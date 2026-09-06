import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { type RefObject, useEffect } from "react";
import type { CanonicalFrontendState } from "../../../../shared/desktop-session-contract";

/** A stream, mount, watch lease or offscreen row is never evidence of reading.
 * Capture canonical identity and completion together; navigation retires this
 * attempt, and main independently checks the actual BrowserWindow at admission.
 */

/** Poll cadence while the completion has not been acknowledged. */
const CHECK_MS = 500;
/** Consecutive failures before the retry cadence starts backing off. */
const FAILURES_BEFORE_BACKOFF = 3;
/** Ceiling on the backed-off cadence: ~1 attempt/minute, not ~7,200/hour. */
const MAX_BACKOFF_MS = 60_000;
export function useCompletionView(
	frontend: CanonicalFrontendState | null | undefined,
	ready: boolean,
	root: RefObject<HTMLDivElement>,
) {
	const selected = useCanonicalSessionsStore((state) => state.activeSessionId);
	const attention = frontend?.attention;
	const sessionId = frontend?.session_id;
	useEffect(() => {
		if (
			!ready ||
			frontend?.streaming ||
			!sessionId ||
			selected !== sessionId ||
			!attention?.unseen ||
			attention.supported !== true ||
			!attention.completion_token ||
			!attention.anchor_id ||
			attention.conversation_id !== `session/${sessionId}`
		)
			return;
		const completionToken = attention.completion_token;
		const anchorId = attention.anchor_id;
		let cancelled = false;
		let pending = false;
		let acknowledged = false;
		let failures = 0;
		let nextAttempt = 0;
		let timer = 0;
		const stop = () => {
			if (timer) {
				clearInterval(timer);
				timer = 0;
			}
		};
		const check = () => {
			if (
				cancelled ||
				pending ||
				acknowledged ||
				document.visibilityState !== "visible" ||
				!document.hasFocus() ||
				useCanonicalSessionsStore.getState().activeSessionId !== sessionId ||
				Date.now() < nextAttempt
			)
				return;
			const element = root.current?.querySelector<HTMLElement>(
				`[data-completion-anchor="${CSS.escape(anchorId)}"][data-completion-complete="true"]`,
			);
			if (!element) return;
			const rect = element.getBoundingClientRect();
			const x = rect.left + rect.width / 2;
			const y = rect.bottom - 2;
			if (
				rect.width <= 0 ||
				rect.height <= 0 ||
				x < 0 ||
				x >= innerWidth ||
				y < 0 ||
				y >= innerHeight
			)
				return;
			const top = document.elementFromPoint(x, y);
			if (!top || !element.contains(top)) return;
			pending = true;
			void desktopResult({ op: "sessions.seen", sessionId, completionToken })
				.then(() => {
					acknowledged = true;
					// Nothing left to attempt for this completion; a new one
					// re-runs the effect with a fresh token.
					stop();
				})
				.catch((error: unknown) => {
					// No optimistic clear. A rejected native-focus check or stale
					// token leaves authoritative state intact and permits a retry.
					//
					// Backed off and logged ONCE at the threshold because the
					// failing cases are persistent, not transient: a backend that
					// predates the receipt route, a wedged store, a window state
					// the native gate keeps refusing. At a flat cadence that is
					// thousands of silent IPC round trips an hour with nothing in
					// the renderer rendering `attention` to explain them.
					failures += 1;
					if (failures === FAILURES_BEFORE_BACKOFF) {
						console.warn(
							`[attention] could not mark ${sessionId} read after ${failures} attempts; backing off`,
							error,
						);
					}
					if (failures >= FAILURES_BEFORE_BACKOFF) {
						nextAttempt =
							Date.now() +
							Math.min(
								MAX_BACKOFF_MS,
								CHECK_MS * 2 ** (failures - FAILURES_BEFORE_BACKOFF + 1),
							);
					}
				})
				.finally(() => {
					pending = false;
				});
		};
		const frame = requestAnimationFrame(check);
		timer = window.setInterval(check, CHECK_MS);
		return () => {
			cancelled = true;
			cancelAnimationFrame(frame);
			stop();
		};
	}, [
		ready,
		frontend?.streaming,
		sessionId,
		selected,
		attention?.conversation_id,
		attention?.completion_token,
		attention?.anchor_id,
		attention?.unseen,
		attention?.supported,
		root,
	]);
}
