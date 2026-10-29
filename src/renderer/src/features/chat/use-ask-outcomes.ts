/**
 * ONE STATE PATH FOR "WHAT BECAME OF THE ASK THIS SURFACE JUST ACTED ON".
 *
 * WHY IT EXISTS. Every surface that hosts `AskPanel` over rows it READ (rather
 * than over the live session stream) has the same problem: the owner accepts an
 * answer, decline or dismissal, and the rows on screen still say `open` until
 * the next read lands. The fleet pane papered over it with a refetch; the
 * Notifications detail pane kept only `{sending, refused}`, so its card went on
 * offering live options, a countdown and `Send answer` after the answer had been
 * accepted - and a press that changes nothing on screen reads as one that did
 * nothing, which is how an operator ended up answering the same ask twice
 * (the Notifications ask-pane bug). Two hand-rolled copies of this record had
 * already drifted (one recorded the owner/transport split, one did not), so the
 * record now lives here and both surfaces call it.
 *
 * WHAT IT RECORDS, per ask id (`AskOutcome`):
 *  - `sending` while the POST is out - the card disables its controls and says so;
 *  - on acceptance, `settled` (status, stamp, answers or reason), which
 *    `askQueueView` paints over a frame that still says `open`
 *    (`askWithLocalSettle`), so the card, its Pending/Settled filter and the
 *    counts move in the frame the owner answered rather than on the next read;
 *  - on failure, the refusal sentence, whether it was the owner's verdict, and -
 *    for a transport failure only - `retry`, which re-sends the SAME act. Nothing
 *    reverts silently: the draft is the caller's and is never cleared here, so a
 *    typed `Other` answer is still in its field next to the Retry.
 *
 * CONSTRAINTS. One lock per hosting surface (the caller's `lock`), taken by the
 * `send` thunks, so one act is in flight at a time whichever card started it. The
 * session-scope drawer in `chat-page.tsx` keeps its own awaited handlers because
 * its frame IS the live stream (it never shows a stale `open`); it shares the
 * `AskOutcome` shape, not this hook.
 */
import { useCallback, useRef, useState } from "react";
import type { PendingAskQuestion } from "../../../../shared/desktop-session-contract";
import { type AnswerOutcome, createSendLock } from "./ask-answer";
import {
	type AskDismissReason,
	type AskOutcome,
	askFailureEarnsRetry,
	askPaintableAnswers,
	askRefusalIsOwner,
	askRefusalSentence,
} from "./ask-queue";

/** Which door an act went through: the receipt each surface prints is keyed by it. */
export type AskActKind = "answered" | "changed" | "declined" | "dismissed";

export type AskAct = {
	askId: string;
	kind: AskActKind;
	/** The request itself, behind the caller's lock (`answerQueuedAsk` and siblings). */
	send: () => Promise<AnswerOutcome>;
	/**
	 * The map an answer or change carried. NEVER painted as is: a SECRET question's
	 * cell holds the typed value here (only core swaps it for a key name), so the
	 * record keeps `askPaintableAnswers(questions, answers)` instead.
	 */
	answers?: Record<string, string[]>;
	/** The ask's questions, so the record can tell which cells are secret. */
	questions?: readonly PendingAskQuestion[];
	/** The reason a dismissal carried. */
	reason?: AskDismissReason;
};

export const useAskOutcomes = ({
	onAccepted,
	now = Date.now,
}: {
	/** After the owner accepted an act: the surface's receipt and refresh. */
	onAccepted?: (act: AskAct) => void;
	/** Injectable clock, for the settled card's stamp. */
	now?: () => number;
} = {}) => {
	const lock = useRef(createSendLock()).current;
	const [outcomes, setOutcomes] = useState<
		Record<string, AskOutcome | undefined>
	>({});
	const [answering, setAnswering] = useState(false);
	/*
	 * The callback is read through a ref so `run` keeps one identity: the fleet
	 * pane's receipt closes over labels that change every poll, and a `run` that
	 * changed with them would re-render every card on each one.
	 */
	const accepted = useRef(onAccepted);
	accepted.current = onAccepted;

	const run = useCallback(
		(act: AskAct) => {
			if (lock.held) return;
			setAnswering(true);
			setOutcomes((current) => ({
				...current,
				[act.askId]: { sending: true, refused: null },
			}));
			void (async () => {
				let outcome: AnswerOutcome;
				try {
					outcome = await act.send();
				} catch (error) {
					/* The thunks never throw; a defect here must still not strand `sending`. */
					outcome = { status: "failed", request: {} as never, error };
				} finally {
					setAnswering(false);
				}
				if (outcome.status === "failed") {
					const byOwner = askRefusalIsOwner(outcome.error);
					/*
					 * A PAIRING REFUSAL IS NOT A RETRYABLE FAILURE (U2, UX review round 2). The
					 * classification and the retry decision read ONE predicate, so a 503 the
					 * contract calls `planeClosed` can no longer earn a control whose only
					 * outcome is the sentence above it. The owner's own verdict is still the
					 * other half of the rule; both live in `askFailureEarnsRetry`.
					 */
					const retryable = askFailureEarnsRetry(outcome.error);
					setOutcomes((current) => ({
						...current,
						[act.askId]: {
							sending: false,
							refused: askRefusalSentence(outcome.error),
							/*
							 * ONLY THE OWNER'S OWN REFUSAL CLOSES §10's CHANGE DOOR, and only a
							 * transport failure earns a Retry: an owner's verdict (`already
							 * answered`, `expired`) would refuse the same press again.
							 */
							refusedByOwner: byOwner,
							...(retryable ? { retry: () => run(act) } : {}),
						},
					}));
					return;
				}
				if (outcome.status === "refused") {
					/*
					 * Nothing left the client (the lock was taken, or the session id is
					 * gone): clear the in-flight flag so the card is not disabled for the
					 * mount's life, and record nothing else.
					 */
					setOutcomes((current) => ({
						...current,
						[act.askId]: { sending: false, refused: null },
					}));
					return;
				}
				setOutcomes((current) => ({
					...current,
					[act.askId]:
						act.kind === "changed"
							? { sending: false, refused: null, changed: true }
							: {
									sending: false,
									refused: null,
									...(act.kind === "dismissed" && act.reason !== undefined
										? { dismissed: act.reason }
										: {}),
									settled: {
										status: act.kind,
										at: now(),
										/*
										 * A SECRET'S TYPED VALUE NEVER REACHES STATE (agent review
										 * round 1, R1-1). The overlay paints this map on the settled
										 * card, and the first cut copied it verbatim, so the value a
										 * user typed into a secret field was drawn in clear until the
										 * next read replaced the row. The record keeps the masked key
										 * form core itself returns; the typed value lived only in
										 * `act.send`'s closure, which leaves state with `retry` below.
										 */
										...(act.answers === undefined
											? {}
											: {
													answers: askPaintableAnswers(
														act.questions ?? [],
														act.answers,
													),
												}),
										...(act.reason === undefined ? {} : { reason: act.reason }),
									},
								},
				}));
				accepted.current?.(act);
			})();
		},
		[lock, now],
	);

	return { lock, outcomes, answering, run };
};
