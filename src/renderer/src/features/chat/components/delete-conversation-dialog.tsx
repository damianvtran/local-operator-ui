import { ConfirmationModal } from "@shared/components/common/confirmation-modal";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { type FC, useState } from "react";
import { deleteConversationMessage } from "../delete-conversation";

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
	 */
	const [refusal, setRefusal] = useState<{
		candidate: string;
		detail: string;
	} | null>(null);
	const shownRefusal =
		refusal && refusal.candidate === candidate ? refusal.detail : null;
	const candidateTitle =
		sessions.find((row) => row.session_id === candidate)?.title || title;
	return (
		<ConfirmationModal
			open={candidate !== null}
			title="Delete this conversation?"
			message={
				<>
					<p>{deleteConversationMessage(candidateTitle, hasSubagentRuns)}</p>
					{shownRefusal && <p className="pt-2 text-danger">{shownRefusal}</p>}
				</>
			}
			confirmText="Delete"
			cancelText="Cancel"
			isDangerous
			onConfirm={() => {
				if (!candidate) return;
				void (async () => {
					const outcome = await deleteSession(candidate);
					/*
					 * Success needs nothing here: the store dropped the row, which is
					 * also what cleared the candidate. A failure keeps the dialog up
					 * with its own sentence, which is the only surface that can still
					 * say what happened.
					 */
					if (!outcome.ok) setRefusal({ candidate, detail: outcome.detail });
				})();
			}}
			onCancel={() => requestDelete(null)}
		/>
	);
};
