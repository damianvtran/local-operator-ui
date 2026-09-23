import {
	DesktopControlError,
	desktopResult,
} from "@shared/api/local-operator/desktop-api";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { type RefObject, useEffect, useRef } from "react";
import {
	type CanonicalFrontendState,
	type CompletionAttention,
	STORE_BUSY_CODE,
	receiptSettled,
} from "../../../../shared/desktop-session-contract";

/** A stream, mount, watch lease or offscreen row is never evidence of reading.
 * Capture canonical identity and completion together; navigation retires this
 * attempt, and main independently checks the actual BrowserWindow at admission.
 * An acknowledgement is believed only when its ANSWER says this conversation is
 * read (`receiptSettled`), never because the call resolved.
 *
 * TWO DECISIONS ARE DELIBERATELY SEPARATE, and the reported defect is what
 * happens when they are one: whether there is a loop AT ALL, and whether an
 * individual attempt may go out. The loop exists exactly while this
 * conversation has an unread completion; every attempt re-asks the rest of the
 * conditions (the pane is ready, the session is the selected one, the window is
 * focused, the result is on screen) because those are facts about THIS ATTEMPT.
 * They used to be one decision - the gates lived in the effect body - which made
 * the loop's existence depend on an instantaneous snapshot of the view, and the
 * reader below reads them at attempt time for the same reason.
 */

/** Poll cadence while the completion has not been acknowledged. */
const CHECK_MS = 500;
/** Consecutive failures before the retry cadence starts backing off. */
const FAILURES_BEFORE_BACKOFF = 3;
/** Ceiling on the backed-off cadence: ~1 attempt/minute, not ~7,200/hour. */
const MAX_BACKOFF_MS = 60_000;
/**
 * Prompt retries of an acknowledgement the store refused for CONTENTION, and the
 * longest single wait between two of them.
 *
 * CONTENTION IS THE ONE REFUSAL WHOSE REMEDY IS THE ATTEMPT ITSELF, so it gets
 * its own budget instead of a turn on the shared ladder: the backend answers
 * `503 store_busy` because another writer holds the store's lock
 * (`STORE_BUSY_CODE`), and it clears on its own in the same second-scale window
 * the send path already absorbs (`BUSY_RESENDS` in the canonical store). The
 * operator's own log is the evidence that this needed telling apart: three
 * refusals of `/seen` on 2026-09-23, ONE attempt each, minutes apart, with the
 * completion's mark still on the row - the shared ladder would have retried a
 * contention within the second and the generic ceiling would have bounded it.
 *
 * The budget is BOUNDED AND SMALL on purpose. A store still busy after this many
 * prompt retries is not contention any more, and the refusal then takes the
 * shared ladder with its 60 s ceiling and its one warning, rather than retrying
 * twice a second for as long as the conversation stays open. The cap on a single
 * wait is the send path's rule as well: `retry_after_ms` comes off the wire, and
 * a backend that asked for a minute must not park the receipt that long with the
 * mark still on screen. (The shipped backend sends no `retry_after_ms` for this
 * code - `_store_refusal` in the desktop routes composes `code` and `message`
 * only - so the default is what runs today; the field is read so that a backend
 * which does start sending it steers this without a client change.)
 */
const BUSY_RETRIES = 5;
const BUSY_RETRY_MAX_WAIT_MS = 5_000;
const BUSY_RETRY_DEFAULT_WAIT_MS = 1_000;
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

/**
 * Whether this failure is the STORE refusing for contention.
 *
 * The CODE is the check and the bare status is not, the same reading
 * `isDeadlineExceeded` gives its own refusal one module over: the answering
 * process declared the category (`store_busy`, the third arm of the backend's
 * store ladder in `local_operator/session/store_failures.py`), and the status is
 * where it arrived (503) rather than what it means. The CLASS gate is what the
 * rest of this tree puts on a wire code - `DesktopControlError.code` is a vetted
 * category, while `Error.code` on a Node failure is `ENOENT` and friends - so a
 * transport error can never be mistaken for a store that will recover.
 */
const isStoreBusy = (error: unknown): error is DesktopControlError =>
	error instanceof DesktopControlError && error.code === STORE_BUSY_CODE;

export function useCompletionView(
	frontend: CanonicalFrontendState | null | undefined,
	ready: boolean,
	root: RefObject<HTMLDivElement>,
) {
	const attention = frontend?.attention;
	const sessionId = frontend?.session_id;
	/*
	 * The latest render, for an attempt that must not close over it.
	 *
	 * WHY A REF RATHER THAN A DEPENDENCY. An attempt gate read from the closure
	 * holds the value the loop was created with, and the interval created here
	 * outlives the renders that change `ready` (the pane finishing its validate)
	 * without re-running this effect - so the gate would refuse an attempt the
	 * reader has since earned, for as long as the loop lives. The ref is the same
	 * idiom `useCanonicalSession` uses for its own "latest view for callbacks that
	 * must not re-create per render".
	 */
	const live = useRef({ frontend, ready });
	live.current = { frontend, ready };
	useEffect(() => {
		/*
		 * THE ONLY GATE THAT DECIDES WHETHER THE LOOP EXISTS, because it is the one
		 * fact the loop is ABOUT: an acknowledgement is the only thing that clears
		 * `unseen`, so a completion the reader has already been shown as read has
		 * nothing left to receipt. Every other condition below decides whether a
		 * single attempt may go out, and is asked again per attempt - a momentary
		 * flip of any of them must not leave a completion unacknowledged for as long
		 * as the reader looks at it.
		 */
		if (!sessionId || !attention?.unseen) return;
		const applyAttention = useCanonicalSessionsStore.getState().applyAttention;
		/**
		 * The completion this loop was created for.
		 *
		 * ITS IDENTITY, not the token that goes on the wire: an attempt reads the CURRENT
		 * token (`check`), and this is what tells the two apart. What it buys is the
		 * budget: a NEW completion is a new attempt with a fresh one, because the
		 * previous loop's may already be spent -- on a token the backend has moved past,
		 * which is exactly what a superseded refusal means.
		 */
		let attemptToken = attention.completion_token;
		let cancelled = false;
		let pending = false;
		let acknowledged = false;
		let attempts = 0;
		/** Contention retries already spent on this completion. */
		let busyRetries = 0;
		let nextAttempt = 0;
		/**
		 * The last press of this conversation this loop has honoured.
		 *
		 * Seeded from the store so a press made BEFORE this loop existed cannot
		 * release its first attempt for free: only a press the operator makes while
		 * this completion is unread and on screen is a new statement about it.
		 */
		let rearmed =
			useCanonicalSessionsStore.getState().readAckRearm?.revision ?? 0;
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
			if (cancelled || pending || acknowledged) return;
			/*
			 * THE OPERATOR'S OWN GESTURE, BEFORE THE DEFERRAL IT RELEASES.
			 *
			 * `readAckRearm` is stamped by every press that opens a conversation,
			 * including a press of the row the view is already on - and that press is
			 * exactly the remedy an operator has for a mark that did not clear. It
			 * clears everything the ladder had built up (the pushed-out next attempt
			 * and the spent contention budget), because the gesture is new information
			 * about the reader rather than another retry of the same refusal. Read
			 * live rather than subscribed: this hook renders nothing, so a subscription
			 * here would be a second, staler copy of one fact.
			 */
			const press = useCanonicalSessionsStore.getState().readAckRearm;
			if (
				press &&
				press.sessionId === sessionId &&
				press.revision !== rearmed
			) {
				rearmed = press.revision;
				attempts = 0;
				busyRetries = 0;
				nextAttempt = 0;
			}
			/*
			 * THE ATTEMPT GATES. Each answers "may THIS attempt go out", and each is
			 * read now rather than captured: the pane's own readiness and the live
			 * session stream, then the store's selection.
			 */
			const view = live.current.frontend;
			const viewAttention = view?.attention;
			if (!live.current.ready || view?.streaming) return;
			if (viewAttention?.supported !== true) return;
			if (viewAttention.conversation_id !== `session/${sessionId}`) return;
			const completionToken = viewAttention.completion_token;
			const anchorId = viewAttention.anchor_id;
			/*
			 * The token is read HERE rather than closed over, which is what makes a
			 * superseded refusal resolve itself: the state that arrives names the
			 * current completion, so the next attempt acknowledges THAT one instead of
			 * re-sending a token the backend has already moved past.
			 */
			if (!completionToken || !anchorId) return;
			if (completionToken !== attemptToken) {
				/*
				 * A NEWER COMPLETION ARRIVED WHILE THIS LOOP RAN. The state moved on to a
				 * token the previous attempts were not about, so their budget is spent on
				 * something the backend no longer names and the wait it built would keep the
				 * reader looking at an unread result. Fresh budget, and the attempt below
				 * sends the token the state now names; the effect's own deps re-create the
				 * loop on the same rule when the change arrives as a render.
				 */
				attemptToken = completionToken;
				attempts = 0;
				busyRetries = 0;
				nextAttempt = 0;
			}
			if (useCanonicalSessionsStore.getState().activeSessionId !== sessionId)
				return;
			if (
				document.visibilityState !== "visible" ||
				!document.hasFocus() ||
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
					/*
					 * APPLY THE ANSWER, AND DO NOT WAIT FOR THE FEED TO REPEAT IT.
					 *
					 * `unseen` is cleared by an acknowledgement and by nothing else, and
					 * the machine-wide feed is how that reaches the row - so a feed whose
					 * own read is failing (the operator's log, minutes after these very
					 * refusals: `attention store stayed busy through 2 attempts`) left a
					 * SUCCESSFUL receipt with the mark still on the row, and the operator
					 * clicking the row to clear it. The answer to THIS request is the same
					 * state the feed would publish, and the row's merge is
					 * revision-guarded (`mergeCompletionAttention`), so applying it here can
					 * only bring the row up to what the backend just told this client - a
					 * staler frame arriving later still cannot undo it.
					 */
					applyAttention(sessionId, state);
				})
				.catch((error: unknown) => {
					/*
					 * CONTENTION GETS ITS OWN PROMPT, BOUNDED BUDGET (see `BUSY_RETRIES`).
					 * Every other failure - including the 409 that tells this client its
					 * token was superseded - belongs to the shared ladder, whose flat
					 * window is what lets a superseded attempt re-read and re-acknowledge
					 * the token the state now names.
					 */
					if (isStoreBusy(error) && busyRetries < BUSY_RETRIES) {
						busyRetries += 1;
						nextAttempt =
							Date.now() +
							Math.min(
								Math.max(0, error.retryAfterMs ?? BUSY_RETRY_DEFAULT_WAIT_MS),
								BUSY_RETRY_MAX_WAIT_MS,
							);
						return;
					}
					unresolved(error);
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
	}, [sessionId, attention?.completion_token, attention?.unseen, root]);
}
