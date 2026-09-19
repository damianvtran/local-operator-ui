import { ConfirmationModal } from "@shared/components/common/confirmation-modal";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { type FC, useEffect, useRef, useState } from "react";
import {
	DELETE_LIVE_REMEDY,
	deleteConversationMessage,
} from "../delete-conversation";

/**
 * The ONE permanent-delete confirmation, asked for from wherever the user asked.
 *
 * WHY IT LIVES IN A STORE-BACKED DIALOG rather than beside the control that opens
 * it: two surfaces ask this question — the header's conversation menu and a typed
 * `/delete` — and they are in different subtrees (the menu is in the chat pane's
 * header, the dispatcher runs under the composer). Both publish a candidate id to
 * the canonical sessions store (`requestSessionDelete`), and this component is
 * the single reader, so there is one dialog, one copy and one delete path rather
 * than two confirmations kept in step by hand.
 *
 * The wire cannot confirm for the user: `sessions.delete` requires
 * `confirmed: true`, and this dialog is the only thing in the app that sends it.
 *
 * WHERE A REFUSAL IS SHOWN. A live session is refused by the route with a 409 and
 * a sentence naming the guard, and that sentence belongs in the dialog that asked
 * — not in a toast over a dialog that has already closed, which is how the user
 * would read a refusal as "the delete happened and something else went wrong".
 * So the dialog stays open with the backend's own words in the danger ink, and
 * the user can cancel out of it.
 */
export const DeleteConversationDialog: FC<{
	/**
	 * The open conversation's title, used only when the store holds no row for the
	 * candidate: a conversation found through search may be off this client's
	 * catalogue page, and the dialog still has to name what it is asking about.
	 */
	title: string;
	/** Whether the addressed session started subagent runs; see the copy module. */
	hasSubagentRuns: boolean;
}> = ({ title, hasSubagentRuns }) => {
	const candidate = useCanonicalSessionsStore((state) => state.deleteCandidate);
	const sessions = useCanonicalSessionsStore((state) => state.sessions);
	const requestDelete = useCanonicalSessionsStore(
		(state) => state.requestSessionDelete,
	);
	const deleteSession = useCanonicalSessionsStore(
		(state) => state.deleteSession,
	);
	/*
	 * A refusal belongs to the candidate that was refused, and it is TRACKED BY ID
	 * rather than cleared by an effect: opening the dialog on another conversation
	 * (or reopening it on the same one) must not inherit a sentence about a
	 * different request, and a stored id compares rather than races - an effect that
	 * resets on `candidate` would leave one frame in which the previous refusal is
	 * drawn under the new question.
	 *
	 * `live` is carried because the CAUSE changes what has to be said: a hold the
	 * route refuses for needs the remedy this window can actually offer, and a
	 * transport failure does not.
	 */
	const [refusal, setRefusal] = useState<{
		candidate: string;
		detail: string;
		live: boolean;
	} | null>(null);
	const shownRefusal =
		refusal && refusal.candidate === candidate ? refusal : null;
	/*
	 * A COUNTER rather than a boolean, because the modal takes the signal as a
	 * CHANGE (`focusCancelSignal`): a second refusal has to move the keyboard back
	 * to the safe action again, and a boolean that is already true would be no
	 * change at all.
	 */
	const [refusalSeq, setRefusalSeq] = useState(0);
	/*
	 * WHAT HAD THE KEYBOARD WHEN THE DIALOG OPENED.
	 *
	 * A dialog that closes without returning focus leaves the reader on `<body>` and
	 * the next Tab restarts at the top of the document - twelve stops from where
	 * they were (UX round 1, U9). Captured when the candidate is staged rather than
	 * in the component that stages it, so both routes (the header's menu and a typed
	 * `/delete`) are covered by one rule.
	 *
	 * The header's menu closes when this dialog opens, so the element that had focus
	 * is usually unmounted by the time it closes: the fallback is the trigger that
	 * own control belongs to (`data-conversation-actions`), which is the successor
	 * of the same act. The typed route's opener is the composer, which survives, so
	 * it gets its own focus back.
	 */
	const opener = useRef<HTMLElement | null>(null);
	useEffect(() => {
		if (candidate !== null) {
			opener.current =
				document.activeElement instanceof HTMLElement
					? document.activeElement
					: null;
			return;
		}
		const element = opener.current;
		opener.current = null;
		if (!element) return;
		if (element.isConnected) {
			element.focus();
			return;
		}
		document.querySelector<HTMLElement>("[data-conversation-actions]")?.focus();
	}, [candidate]);
	const candidateTitle =
		sessions.find((row) => row.session_id === candidate)?.title || title;
	return (
		<ConfirmationModal
			open={candidate !== null}
			title="Delete this conversation?"
			message={
				<>
					<p>{deleteConversationMessage(candidateTitle, hasSubagentRuns)}</p>
					{shownRefusal && (
						<p className="pt-2 text-danger">{shownRefusal.detail}</p>
					)}
					{/*
					 * The REMEDY, in the quieter ink: the refusal above is the failure, this is
					 * what can be done about it, and only the live refusal has one (UX round 1,
					 * U3 - the route's own sentence sends the reader to a Stop control this pane
					 * does not have).
					 */}
					{shownRefusal?.live && (
						<p className="pt-2 text-ink-muted">{DELETE_LIVE_REMEDY}</p>
					)}
				</>
			}
			confirmText="Delete"
			cancelText="Cancel"
			isDangerous
			/*
			 * The refusal is the only thing this dialog can be told that makes the SAFE
			 * action the one the keyboard should hold: the request was refused, nothing
			 * was deleted, and the next Enter must not repeat it.
			 */
			focusCancelSignal={refusalSeq}
			onConfirm={() => {
				if (!candidate) return;
				void (async () => {
					const outcome = await deleteSession(candidate);
					/*
					 * Success needs nothing here: the store dropped the row, which is
					 * also what cleared the candidate. A failure keeps the dialog up
					 * with its own sentence, which is the only surface that can still
					 * say what happened - and hands the keyboard back to Cancel.
					 */
					if (!outcome.ok) {
						setRefusal({
							candidate,
							detail: outcome.detail,
							live: outcome.live,
						});
						setRefusalSeq((seq) => seq + 1);
					}
				})();
			}}
			onCancel={() => requestDelete(null)}
		/>
	);
};
