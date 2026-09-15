import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { type RefObject, useEffect } from "react";
import {
	type CanonicalFrontendState,
	type CompletionAttention,
	receiptSettled,
} from "../../../../shared/desktop-session-contract";

/** A stream, mount, watch lease or offscreen row is never evidence of reading.
 * Capture canonical identity and completion together; navigation retires this
 * attempt, and main independently checks the actual BrowserWindow at admission.
 * An acknowledgement is believed only when its ANSWER says this conversation is
 * read (`receiptSettled`), never because the call resolved.
 */

/** Poll cadence while the completion has not been acknowledged. */
const CHECK_MS = 500;
/** Consecutive failures before the retry cadence starts backing off. */
const FAILURES_BEFORE_BACKOFF = 3;
/** Ceiling on the backed-off cadence: ~1 attempt/minute, not ~7,200/hour. */
const MAX_BACKOFF_MS = 60_000;
/**
 * The wait after `attempts` consecutive attempts that got nowhere.
 *
 * One function because two kinds of attempt back off (a refusal that failed and
 * a refusal that cannot resolve) and two copies of the ladder would be two
 * places to change the ceiling.
 */
const backoffMs = (attempts: number) =>
	Math.min(
		MAX_BACKOFF_MS,
		CHECK_MS * 2 ** (attempts - FAILURES_BEFORE_BACKOFF + 1),
	);
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
		let attempts = 0;
		let nextAttempt = 0;
		// All non-settling outcomes share a budget: alternating a refusal with
		// an old backend's unread 2xx must not reset the ladder forever.
		const unresolved = (reason: unknown) => {
			attempts += 1;
			if (attempts === FAILURES_BEFORE_BACKOFF) {
				console.warn(
					`[attention] ${sessionId} receipt unresolved after ${attempts} attempts; backing off`,
					reason,
				);
			}
			if (attempts >= FAILURES_BEFORE_BACKOFF)
				nextAttempt = Date.now() + backoffMs(attempts);
		};
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
			const y = rect.bottom - 2;
			if (rect.width <= 0 || rect.height <= 0 || y < 0 || y >= innerHeight)
				return;
			/*
			 * SEVERAL SAMPLES, not one pixel. The gate exists to prove the END of this
			 * result is on screen -- not merely that a row exists -- so the probe has to
			 * be a hit test rather than a layout measure. But a single sample at the
			 * row's centre is at the mercy of the app's OWN floating controls, and it
			 * was: measured on the real app, the "Scroll to bottom" button sits at the
			 * transcript's bottom centre, over the last row's bottom edge, and the one
			 * sample landed on it -- so the acknowledgement was refused for as long as
			 * the conversation stayed open, over a result the reader was looking at.
			 * (That control also stayed hit-testable while invisible; it no longer is.
			 * Both halves are needed: the overlay was a bug and the probe was fragile.)
			 *
			 * One free sample admits a partially covered bottom edge, unlike the old
			 * centre-only rule. It does not prove the whole result is unobscured. A
			 * viewport-spanning scrim still covers every sample and refuses receipt.
			 */
			const coveredBy = (x: number): boolean => {
				if (x < 0 || x >= innerWidth) return true;
				const top = document.elementFromPoint(x, y);
				return !top || !element.contains(top);
			};
			if (
				[0.25, 0.5, 0.75].every((fraction) =>
					coveredBy(rect.left + rect.width * fraction),
				)
			)
				return;
			pending = true;
			void desktopResult<CompletionAttention>({
				op: "sessions.seen",
				sessionId,
				completionToken,
			})
				.then((state) => {
					if (!receiptSettled(state, sessionId, completionToken)) {
						unresolved("answer did not settle the rendered completion");
						return;
					}
					acknowledged = true;
					stop();
				})
				.catch((error: unknown) => unresolved(error))
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
