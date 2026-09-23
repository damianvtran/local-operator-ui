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
	SUPERSEDED_COMPLETION_TOKEN_CODE,
	mergeCompletionAttention,
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
/**
 * The wait a contention refusal asks for, bounded on both sides.
 *
 * The FLOOR is zero rather than the default: a backend that says "now" is
 * answered now. The CEILING is `BUSY_RETRY_MAX_WAIT_MS` and not `backoffMs`,
 * because this refusal's remedy is the attempt itself - parking it for the
 * shared ladder's minute would defeat the budget it has (`BUSY_RETRIES`).
 *
 * NON-FINITE IS THE THIRD CASE, and it is not decoration (agent review round 1,
 * N1): `Math.max(0, NaN)` is `NaN`, and `Date.now() < NaN` is false, so a
 * `nextAttempt` of `NaN` silently turns the gate that defers the next attempt
 * into no gate at all and spends the prompt budget at the poll cadence. The
 * transport sets the field only behind `Number.isFinite` (`desktop-api.ts`), so
 * this guards a future writer of it rather than today's reading; it is here so
 * that the clamp cannot be the thing that loses the bound.
 */
const contentionWaitMs = (asked: number | undefined): number =>
	typeof asked === "number" && Number.isFinite(asked)
		? Math.max(0, Math.min(asked, BUSY_RETRY_MAX_WAIT_MS))
		: BUSY_RETRY_DEFAULT_WAIT_MS;

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

/**
 * Whether this failure is the backend saying the token this attempt carried is
 * no longer the conversation's current completion.
 *
 * A SUPERSEDED TOKEN IS NOT A REFUSAL OF THE RECEIPT, which is why it gets a
 * reading of its own rather than a turn on the ladder: the completion this loop
 * was created for is GONE, the backend holds a newer one, and no number of
 * retries of this token can change that (`desktop-session-contract.ts` states
 * the shape, and names the FEED as the arrival path for the state that
 * supersedes it). Spending the ladder on it - the shipped behaviour - meant a
 * loop that re-sent a superseded token forever whenever the session stream
 * lagged the feed, with the mark still on the row and the cadence decaying onto
 * the 60 s ceiling (agent review round 1, M1).
 *
 * The CLASS gate is the same one `isStoreBusy` applies and for the same reason:
 * `DesktopControlError.code` is a vetted wire category, while `Error.code` on a
 * Node failure is `ENOENT` and friends, so a transport error cannot be mistaken
 * for the backend's own statement about this conversation.
 */
const isSupersededToken = (error: unknown): error is DesktopControlError =>
	error instanceof DesktopControlError &&
	error.code === SUPERSEDED_COMPLETION_TOKEN_CODE;

/**
 * The completion a receipt is about, as the app's TWO channels jointly state it.
 *
 * WHY THE STREAM ALONE IS NOT ENOUGH. The same fact reaches this client twice:
 * the open conversation's own session stream (`frontend.attention`, the live
 * owner's copy) and the machine-wide feed, which is the writer of the ROW the
 * sidebar draws its mark from. They are independent by construction, and the
 * contract names the FEED as the path by which the state that supersedes a
 * stale token arrives - so a loop created around the stream's token alone can
 * spend its whole existence re-sending a token the backend has already moved
 * past, which is `M1`'s failure. The newer of the two is therefore the loop's
 * subject, and the merge is the app's OWN definition of "newer"
 * (`mergeCompletionAttention`, revision-guarded, and the function the stream
 * already uses to fold attention frames into its own state) rather than a
 * second comparison written here.
 *
 * WHAT THIS DOES NOT CHANGE: the anchor hit test is still the definition of
 * "shown", so the row's state is never acknowledged blindly - an attempt still
 * has to find THAT completion's rendered result on screen. `supported` still
 * has to be true, and it is inherited from the stream when the feed's own
 * payload does not state it (the merge's rule, and the reason a catalogue frame
 * cannot silently disable receipts).
 */
const completionSubject = (
	stream: CompletionAttention | undefined,
	feed: CompletionAttention | undefined,
	sessionId: string | undefined,
): CompletionAttention | undefined =>
	sessionId ? mergeCompletionAttention(stream, feed, sessionId) : stream;

export function useCompletionView(
	frontend: CanonicalFrontendState | null | undefined,
	ready: boolean,
	root: RefObject<HTMLDivElement>,
) {
	const attention = frontend?.attention;
	const sessionId = frontend?.session_id;
	/*
	 * THE FEED'S OWN COPY OF THE SAME FACT, and the ONE subscription this hook
	 * holds.
	 *
	 * WHY SUBSCRIBED RATHER THAN READ AT ATTEMPT TIME. The loop's IDENTITY is the
	 * completion it is about, so when the feed publishes a newer one for this
	 * conversation the loop has to be re-created around it - which is the re-read
	 * `M1` asks for, and which only happens if this component re-renders. Reading
	 * the row off `getState()` at attempt time would give the tick the newer token
	 * but leave the effect's dependencies unchanged, so a loop that had ended
	 * (a superseded refusal, a settled answer) would never form again while the
	 * row it was about still stood unread. The selector returns the row's own
	 * attention object, so a re-render costs one identity comparison per frame and
	 * nothing per unrelated row change.
	 */
	const feedAttention = useCanonicalSessionsStore(
		(state) =>
			state.sessions.find((item) => item.session_id === sessionId)?.attention,
	);
	/*
	 * The completion this loop is about, from both channels; the docblock above
	 * `completionSubject` states why the stream alone is not enough.
	 */
	const subject = completionSubject(attention, feedAttention, sessionId);
	/*
	 * The latest render, for an attempt that must not close over it.
	 *
	 * WHY A REF RATHER THAN A DEPENDENCY. An attempt gate read from the closure
	 * holds the value the loop was created with, and the interval created here
	 * outlives the renders that change `ready` (the pane finishing its validate)
	 * without re-running this effect - so the gate would refuse an attempt the
	 * reader has since earned, for as long as the loop lives. The ref is the same
	 * idiom `useCanonicalSession` uses for its own "latest view for callbacks that
	 * must not re-create per render". The SUBJECT is carried here for the second
	 * half of that rule: the loop exists for one completion, and every attempt
	 * re-reads which completion that is, so an attempt after a feed frame
	 * acknowledges the completion the app currently names rather than the one the
	 * effect was created for.
	 */
	const live = useRef({
		subject,
		streaming: frontend?.streaming === true,
		ready,
	});
	live.current = { subject, streaming: frontend?.streaming === true, ready };
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
		if (!sessionId || !subject?.unseen) return;
		const applyAttention = useCanonicalSessionsStore.getState().applyAttention;
		/*
		 * THE RECEIPT'S OWN OBSERVABLE STATE, published while this loop runs.
		 *
		 * WHY THE LOOP PUBLISHES AND NOT THE VIEW. An attempt can be refused by a
		 * store that is busy, by the anchor gate, or by the ladder's own ceiling - and
		 * every one of those refusals used to end in a `console.warn`, a developer
		 * channel, so "the app is still trying" and "the app gave up" were the same
		 * screen (UX round 1, U1: the panel already owns both sentences, in the bulk
		 * receipt's toast and its in-flight cue). The row the mark is on is the only
		 * surface that can carry the difference, and this loop is the only thing that
		 * knows it. `readAckNotice` on the store states the shape and the lifetime
		 * rule; `features/chat/read-ack-notice.ts` owns the words.
		 */
		const publishNotice =
			useCanonicalSessionsStore.getState().publishReadAckNotice;
		const clearNotice = useCanonicalSessionsStore.getState().clearReadAckNotice;
		/**
		 * The completion this loop was created for.
		 *
		 * ITS IDENTITY, not the token that goes on the wire: an attempt reads the CURRENT
		 * token (`check`), and this is what tells the two apart. What it buys is the
		 * budget: a NEW completion is a new attempt with a fresh one, because the
		 * previous loop's may already be spent -- on a token the backend has moved past,
		 * which is exactly what a superseded refusal means.
		 */
		let attemptToken = subject.completion_token;
		let cancelled = false;
		let pending = false;
		let acknowledged = false;
		let attempts = 0;
		/** Contention retries already spent on this completion. */
		let busyRetries = 0;
		let nextAttempt = 0;
		/**
		 * Whether this budget has already recorded its one warning.
		 *
		 * ONE PER GESTURE, and this flag is what makes that a property of the code
		 * rather than a coincidence of the cases that happen to exist: the warning
		 * used to fire on the `attempts === 3` crossing alone, which is once per
		 * window only while nothing resets `attempts` inside one - and a press does
		 * exactly that, so a second crossing reported a second bound for the same
		 * refusal (agent review round 1, N4). Every reset of the ladder resets this
		 * with it, so the warning - and the toast that rides on it - is one per
		 * budget, which is one per press.
		 */
		let ladderWarned = false;
		/**
		 * The last press of this conversation this loop has honoured.
		 *
		 * Seeded from the store so a press made BEFORE this loop existed cannot
		 * release its first attempt for free: only a press the operator makes while
		 * this completion is unread and on screen is a new statement about it.
		 *
		 * Read live rather than subscribed, and this is the one fact in the hook that
		 * is: a press is an EVENT that has already happened, so a subscription would
		 * only re-render for a stamp the tick is about to read anyway, while the
		 * subject above is subscribed because the loop's IDENTITY follows it.
		 */
		let rearmed =
			useCanonicalSessionsStore.getState().readAckRearm?.revision ?? 0;
		// All non-settling outcomes share a budget: alternating a refusal with
		// an old backend's unread 2xx must not reset the ladder forever.
		const unresolved = (reason: unknown) => {
			attempts += 1;
			if (attempts >= FAILURES_BEFORE_BACKOFF) {
				nextAttempt = Date.now() + backoffMs(attempts);
				if (ladderWarned) return;
				ladderWarned = true;
				console.warn(
					`[attention] ${sessionId} receipt unresolved after ${attempts} attempts; backing off`,
					reason,
				);
				/*
				 * THE SAME FACT IN THE CHANNEL THE OPERATOR READS (UX round 1, U1).
				 *
				 * The bound was recorded in a `console.warn` and nowhere else, so a receipt
				 * the app had stopped retrying promptly was pixel-identical to one it was
				 * still trying: the row kept its mark either way. This is the give-up arm -
				 * the cadence is now the 60 s ceiling - and it is the moment to say which
				 * one the reader is looking at, once per budget, in the same lane the bulk
				 * receipt's own failure already speaks in.
				 */
				publishNotice(sessionId, "unsettled", reason);
				return;
			}
			/*
			 * STILL TRYING, PROMPTLY: the ladder's flat window is the state the operator
			 * cannot otherwise tell from the one above, and the row's clause is where the
			 * difference is drawn.
			 */
			publishNotice(sessionId, "pending");
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
			 * about the reader rather than another retry of the same refusal. Read live
			 * rather than subscribed, which the stamp's own docblock below states the
			 * reason for.
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
				// A press is a new budget, and the warning it may earn is that budget's
				// own: the flag is reset with the counters it guards (N4).
				ladderWarned = false;
			}
			/*
			 * THE ATTEMPT GATES. Each answers "may THIS attempt go out", and each is
			 * read now rather than captured: the pane's own readiness and whether the
			 * session is still streaming, then the store's selection.
			 */
			if (!live.current.ready || live.current.streaming) return;
			/*
			 * THE SUBJECT, RE-READ FOR THIS ATTEMPT, and the attempt's token comes off
			 * it rather than off the render this loop was created in: that is what makes
			 * a superseded refusal resolvable at all (the state that arrives names the
			 * current completion, so the next attempt acknowledges THAT one), and what
			 * keeps the loop honest when the FEED is the channel that moved first.
			 */
			const current = live.current.subject;
			if (current?.supported !== true) return;
			if (current.conversation_id !== `session/${sessionId}`) return;
			const completionToken = current.completion_token;
			const anchorId = current.anchor_id;
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
			if (!element) {
				/*
				 * THE ONE PRESS THAT CAN NEVER SUCCEED, AND WHY IT IS SAID OUT LOUD (UX
				 * round 1, U2). The anchor gate is the definition of "shown", so a
				 * completion whose result is not on screen is never receipted - and the
				 * operator's own remedy (press the row again) cannot satisfy a
				 * precondition they cannot see: the store is healthy, the loop is alive,
				 * and nothing on screen ever changes. The gate is NOT weakened for it
				 * (nothing may be acknowledged without a rendered result); what changes is
				 * that the state now names itself and names the move that does work.
				 *
				 * TWO SHAPES REACH THIS ARM, and both are "the result is not on screen":
				 * the anchor row is outside the rendered window (the transcript pages
				 * oldest-window first), or it is rendered and off the viewport. Neither
				 * can be fixed by pressing; both are fixed by scrolling to it, which is
				 * exactly what the clause tells the reader - and the receipt then goes out
				 * on the next tick, so the state heals itself.
				 */
				publishNotice(sessionId, "offscreen");
				return;
			}
			const rect = element.getBoundingClientRect();
			const y = rect.bottom - 2;
			if (rect.width <= 0 || rect.height <= 0 || y < 0 || y >= innerHeight) {
				publishNotice(sessionId, "offscreen");
				return;
			}
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
					/*
					 * A LOOP WHOSE RENDER IS GONE LANDS NOTHING (agent review round 1, N3).
					 *
					 * The token is a dependency, so a state that moves on while an attempt is
					 * out tears this loop down and creates a new one - which means two `/seen`
					 * calls can be in flight for one conversation, about two different tokens.
					 * Both used to apply and announce their answers, so the older one could
					 * write (or republish a notice) after the loop that owned the conversation
					 * had been replaced, on behalf of a receipt the app is no longer making.
					 * The newer loop is the authority for the conversation from the moment it
					 * exists, and it makes the same attempt itself: the older answer is about a
					 * subject nothing is watching, so it is dropped rather than reconciled.
					 * The ROW is protected either way - `mergeCompletionAttention` refuses a
					 * lower revision - and this is the half that keeps a stale answer from
					 * speaking for the live one.
					 */
					if (cancelled) return;
					if (!receiptSettled(state, sessionId, completionToken)) {
						unresolved("answer did not settle the rendered completion");
						return;
					}
					acknowledged = true;
					stop();
					/*
					 * THE RECEIPT HAS LANDED, so the state it was published in goes with it:
					 * the mark this loop was about is cleared by the answer below, and a
					 * clause saying otherwise would be the second sentence about a fact that
					 * no longer holds.
					 */
					clearNotice(sessionId);
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
					// The same inertness as the resolved arm, and for the same reason: a
					// refusal that arrives after this loop's render is gone belongs to a
					// receipt nothing is making, so it may not spend a budget, warn or
					// publish a state on the live loop's behalf.
					if (cancelled) return;
					/*
					 * CONTENTION GETS ITS OWN PROMPT, BOUNDED BUDGET (see `BUSY_RETRIES`).
					 * Every other failure - including the 409 that tells this client its
					 * token was superseded - belongs to the shared ladder, whose flat
					 * window is what lets a superseded attempt re-read and re-acknowledge
					 * the token the state now names.
					 */
					if (isStoreBusy(error) && busyRetries < BUSY_RETRIES) {
						busyRetries += 1;
						/*
						 * A NON-FINITE `retryAfterMs` IS NOT A WAIT (agent review round 1, N1).
						 * `NaN` makes `nextAttempt` itself `NaN`, and `Date.now() < NaN` is false -
						 * so the gate that defers the next attempt stops gating, and the prompt
						 * budget would be spent at the poll cadence instead. The transport sets
						 * the field only behind `Number.isFinite` (`desktop-api.ts`), so this is
						 * unreachable today; it is checked here so that stays true of any future
						 * writer of the field.
						 */
						nextAttempt = Date.now() + contentionWaitMs(error.retryAfterMs);
						/*
						 * THE IN-FLIGHT HALF OF U1 too, and the shape the panel already uses for
						 * it: the bulk control's spinner leaves the label's ink alone while the
						 * request is open. Here the mark stays and the row's own clause says the
						 * receipt is being retried, so "still trying" is not the same screen as
						 * "gave up" - which is what the whole of `readAckNotice` exists to say.
						 */
						publishNotice(sessionId, "pending");
						return;
					}
					if (isSupersededToken(error)) {
						/*
						 * TERMINAL FOR THIS LOOP, AND NOT A TURN ON THE LADDER (agent review
						 * round 1, M1). The backend has moved past the completion this attempt
						 * named; the state that supersedes it arrives by the FEED, and the loop's
						 * subject is the merge of both channels - so the re-read is the effect's
						 * own re-creation around the newer completion (the subscription above
						 * is what makes the feed's arrival a re-render), not a resend of a
						 * token the backend no longer holds. Retrying it was the shipped
						 * behaviour, and it is what let a superseded refusal spend the ladder to
						 * its ceiling while the row stayed unread and no attempt could settle.
						 *
						 * Nothing is ANNOUNCED for this arm: the refuser is not the store, no
						 * write was refused, and the mark the reader can see belongs to the NEWER
						 * completion rather than to this one. What the next loop does with that
						 * newer completion is the whole of its own story - and if its result is
						 * not on screen, THAT arm says so.
						 */
						stop();
						clearNotice(sessionId);
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
			/*
			 * THE NOTICE IS THE LOOP'S OWN STATEMENT, so it goes when the loop does -
			 * a superseded completion, a settled one, a session switch and an unmount
			 * all end this loop, and in every one of them the app has stopped trying for
			 * this completion. The TOAST is what survives the loop for the reader who
			 * navigated away, which is why the give-up arm speaks in both channels.
			 */
			clearNotice(sessionId);
		};
	}, [sessionId, subject?.completion_token, subject?.unseen, root]);
}
