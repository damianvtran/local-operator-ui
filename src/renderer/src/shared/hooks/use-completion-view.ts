import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { type RefObject, useEffect } from "react";
import {
	type CanonicalFrontendState,
	type CompletionAttention,
	isSupersededReceipt,
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
		let failures = 0;
		/**
		 * Consecutive SUPERSEDED refusals for the token this attempt rendered.
		 *
		 * Its own counter rather than an arm of `failures`, because the two mean
		 * different things: a failure is a call that did not work, while a
		 * superseded refusal is a call that worked exactly as promised and whose
		 * remedy is to wait for the projection to name the current token. Only the
		 * first few are free -- see the catch below for why they are bounded.
		 */
		let superseded = 0;
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
			 * One free sample is enough, and the claim it supports is unchanged: an
			 * overlay that really hides the row -- a modal scrim, which spans the
			 * viewport -- covers every sample, so a reader who cannot see the result
			 * still cannot receipt it.
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
					// Any answer at all means this attempt got through, so whatever
					// streak of superseded refusals preceded it is over.
					superseded = 0;
					if (!receiptSettled(state, sessionId)) {
						// Resolved, but the conversation is NOT read: the receipt did not
						// land on the completion this attempt rendered (the token was
						// already superseded when it arrived, or a newer completion
						// published under it). Nothing is latched -- the poll keeps
						// running and re-arms with whatever token the next state names,
						// which is the token that actually clears the mark. Latching here
						// is the defect: a no-op 200 used to stop every later attempt.
						return;
					}
					acknowledged = true;
					// Nothing left to attempt for this completion; a new one
					// re-runs the effect with a fresh token.
					stop();
				})
				.catch((error: unknown) => {
					// No optimistic clear. A rejected native-focus check or stale
					// token leaves authoritative state intact and permits a retry.
					if (isSupersededReceipt(error)) {
						// Expected and self-healing to begin with: the backend has moved
						// past the token this attempt rendered, and the state it publishes
						// names the current one. NOT a failure while the projection is one
						// push behind -- but nothing here bounds how long that lasts, so a
						// projection that never advances would be re-attempted at the flat
						// cadence (2/s) for as long as the conversation stays open, in
						// silence. It therefore backs off on the same ladder and says so
						// once, and the re-arm is untouched: a state that names the current
						// token re-runs this effect with these counters at zero.
						superseded += 1;
						if (superseded === FAILURES_BEFORE_BACKOFF) {
							console.warn(
								`[attention] ${sessionId} still names a superseded completion after ${superseded} attempts; backing off until the state re-arms`,
								error,
							);
						}
						if (superseded >= FAILURES_BEFORE_BACKOFF) {
							nextAttempt = Date.now() + backoffMs(superseded);
						}
						return;
					}
					superseded = 0;
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
						nextAttempt = Date.now() + backoffMs(failures);
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
