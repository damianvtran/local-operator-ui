import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { type RefObject, useEffect } from "react";
import type { CanonicalFrontendState } from "../../../../shared/desktop-session-contract";

/** A stream, mount, watch lease or offscreen row is never evidence of reading.
 * Capture canonical identity and completion together; navigation retires this
 * attempt, and main independently checks the actual BrowserWindow at admission.
 */
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
		const check = () => {
			if (
				cancelled ||
				pending ||
				acknowledged ||
				document.visibilityState !== "visible" ||
				!document.hasFocus() ||
				useCanonicalSessionsStore.getState().activeSessionId !== sessionId
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
				})
				.catch(() => {
					// No optimistic clear. A rejected native-focus check or stale
					// token leaves authoritative state intact and permits a retry.
				})
				.finally(() => {
					pending = false;
				});
		};
		const frame = requestAnimationFrame(check);
		const timer = window.setInterval(check, 500);
		return () => {
			cancelled = true;
			cancelAnimationFrame(frame);
			clearInterval(timer);
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
