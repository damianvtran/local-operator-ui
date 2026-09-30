import { ConfirmationModal } from "@shared/components/common/confirmation-modal";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { type FC, useEffect, useRef } from "react";
import {
	ARCHIVE_CONFIRM_MESSAGE,
	ARCHIVE_CONFIRM_VERB,
	archiveRowBox,
	focusRowAfterRemoval,
} from "../archive-confirm";

/**
 * The ONE archive confirmation, asked for from wherever the user asked.
 *
 * WHY IT LIVES IN A STORE-BACKED DIALOG rather than beside the control that opens
 * it is the delete dialog's reason, five times over: the row's hover control, the
 * row's context menu, the `⌘⇧A` chord (which presses that control), a typed
 * `/archive` and the pane header's menu item are ONE act reached from three
 * subtrees, and the menu is in the pane's header while the dispatcher runs under
 * the composer. Both of the other two doors publish a candidate to the canonical
 * sessions store (`requestArchiveConfirm`), and this component is the single
 * reader - so the act gained a question without gaining a second behaviour, which
 * is the register the archive has already been corrected for once (UX round 1, U2:
 * "one act, one register").
 *
 * UNARCHIVE NEVER COMES THROUGH HERE. The restore is one press on every surface
 * that offers it - the row's control, the header's `Archived` pill and
 * `/unarchive` - because a question in front of the act that puts a conversation
 * BACK would be a confirmation for the safe half.
 *
 * WHAT IT IS NOT, and this is a decision rather than an omission (the manager's
 * brief of 2026-09-30, D3): there is NO busy state and NO in-dialog refusal
 * rendering, unlike the delete dialog beside it. The dialog closes on confirm and
 * the write proceeds with the store's existing settle semantics - the optimistic
 * fact, the Undo offer raised by the store in the update that settles it, and the
 * ordinary toast lane for a refusal (`archiveFailure`). The reason is that this
 * keeps the refusal behaviour pinned by the existing tests exactly as it is, in one
 * register rather than two, for a dialog whose act is REVERSIBLE: the delete dialog
 * holds a write the user must be told about because it cannot be undone, and this
 * one has a band that answers it a moment later.
 */
export const ArchiveConversationDialog: FC<{
	/**
	 * The open conversation's title, used only when the store holds no row for the
	 * candidate: a conversation found through search may be off this client's
	 * catalogue page, and the dialog still has to name what it is asking about. The
	 * delete dialog's fallback, for the same reason.
	 */
	title: string;
}> = ({ title }) => {
	const candidate = useCanonicalSessionsStore(
		(state) => state.archiveCandidate,
	);
	const sessions = useCanonicalSessionsStore((state) => state.sessions);
	const requestArchiveConfirm = useCanonicalSessionsStore(
		(state) => state.requestArchiveConfirm,
	);
	const setSessionArchived = useCanonicalSessionsStore(
		(state) => state.setSessionArchived,
	);
	/*
	 * WHAT SENDS FOCUS BACK WHERE IT BELONGS, and why the ROW door needs its own arm.
	 *
	 * `BaseDialog` captures the opener while the dialog is open and refocuses it
	 * after it closes, and that is the whole rule for the doors whose opener is
	 * VISIBLE: the composer a typed `/archive` came from, and the header menu's
	 * trigger. The ROW's control is a REVEAL - `hidden` at rest,
	 * `group-hover:flex`/`group-focus-within:flex` - and `focus()` on a
	 * `display: none` element is a no-op, so the restore would leave the reader on
	 * `<body>` with the next Tab starting at the top of the document: the very
	 * defect the restore exists for. So a row door falls back to the row's own
	 * BUTTON, the visible element in the same row.
	 *
	 * The row the candidate named is remembered because it is read AFTER the
	 * candidate has been cleared - and a CONFIRMED archive takes that row out of the
	 * list, so the fallback has to answer `null` rather than throw when it is gone.
	 * On the confirm arm the successor correction below is what moves the caret; this
	 * fallback answers the cancel arm and the case where the row has already left.
	 */
	const opener = useRef<HTMLElement | null>(null);
	const askedFor = useRef<string | null>(null);
	useEffect(() => {
		if (candidate !== null) {
			askedFor.current = candidate.sessionId;
			opener.current =
				document.activeElement instanceof HTMLElement
					? document.activeElement
					: null;
			return;
		}
		const element = opener.current;
		const row = askedFor.current;
		opener.current = null;
		askedFor.current = null;
		/*
		 * `preventScroll` ON EVERY HANDBACK, because a focus call is also a scroll: the
		 * row's button the reader pressed may be only partly inside the list's clip, and
		 * `focus()` would scroll it fully into view as the dialog closed - a press that
		 * moved the reader's place by 23px in the scene's scrolled arrival (84 -> 107.5),
		 * which is the one thing the archive's press is pinned never to do (design round
		 * 8, D27: the press changes the intent, not the list's scroll). Where the focus
		 * lands is the restore's whole job; where the list stands is not its to change.
		 */
		if (element?.isConnected) {
			element.focus({ preventScroll: true });
			/*
			 * A focus that TOOK is the whole job: the reader is back on the control
			 * (or in the composer, or on the menu trigger) they opened this with.
			 */
			if (document.activeElement === element) return;
		}
		const fallback =
			row === null
				? null
				: archiveRowBox(row)?.querySelector<HTMLElement>("[data-chat-row]");
		/*
		 * The header's own trigger is the last resort, and it is the delete dialog's
		 * `[data-conversation-actions]`: that menu is where the header's archive item
		 * lives, and it is the successor of the same act.
		 */
		(
			fallback ??
			document.querySelector<HTMLElement>("[data-conversation-actions]")
		)?.focus({ preventScroll: true });
	}, [candidate]);
	const candidateTitle =
		sessions.find((row) => row.session_id === candidate?.sessionId)?.title ||
		title;
	return (
		<ConfirmationModal
			open={candidate !== null}
			/*
			 * THE QUESTION NAMES THE CONVERSATION, and the NAME is the only part that
			 * gives when it does not fit: it sits in its own box inside the dialog's
			 * title row with `min-w-0 truncate`, while the verb and the question mark
			 * are `shrink-0` around it. A title that truncated the whole question would
			 * eventually leave "Archive…" - not a question - on screen, which is the
			 * rule `archiveOfferedName` already carries for the row's control label,
			 * applied to the modal.
			 */
			title={
				<span className="flex min-w-0 items-center">
					<span className="shrink-0">{`${ARCHIVE_CONFIRM_VERB}\u00a0`}</span>
					<span className="min-w-0 truncate">{`“${candidateTitle}”`}</span>
					<span className="shrink-0">?</span>
				</span>
			}
			message={<p>{ARCHIVE_CONFIRM_MESSAGE}</p>}
			confirmText="Archive"
			cancelText="Cancel"
			/*
			 * NOT DANGEROUS, and that is the design's whole point (`isDangerous={false}`
			 * is also this component's default, so it is spelled for the reader rather
			 * than for the compiler): archiving is reversible and the danger role is
			 * reserved for the act that is not. The delete dialog beside it is the
			 * sibling precedent, and the two are meant to be told apart at a glance.
			 */
			isDangerous={false}
			onConfirm={() => {
				if (!candidate) return;
				const { sessionId, fromRow } = candidate;
				/*
				 * THE DIALOG CLOSES ON CONFIRM (D3 above), so the candidate is cleared
				 * first: everything after this is the store's own settle semantics, and
				 * nothing about them is rendered here.
				 */
				requestArchiveConfirm(null);
				/*
				 * THE SUCCESSOR'S PLACE IS TAKEN NOW, BEFORE THE WRITE, and only for the
				 * row door: the reader was standing in the list, the pressed control is
				 * about to unmount with its row, and the caret has to land on whatever
				 * slides up. It is resolved from the ROW BOX rather than from a press
				 * event, because there is no press to read one confirm later.
				 *
				 * `focusRowAfterRemoval` snapshots and returns a callback rather than
				 * moving focus itself, so a REFUSED write still moves nothing: the row
				 * stays, and so does the reader.
				 */
				const row = fromRow ? archiveRowBox(sessionId) : null;
				const restoreFocus = row === null ? null : focusRowAfterRemoval(row);
				void setSessionArchived(
					sessionId,
					true,
					sessions.find((entry) => entry.session_id === sessionId)?.title ??
						undefined,
				).then((accepted) => {
					/*
					 * THE UNDO OFFER IS THE STORE'S (design round 8, D27), raised in the
					 * update that settles this write, so the accepted departure and the
					 * band that answers it land in one commit.
					 *
					 * A refusal needs nothing here either, deliberately: the store's
					 * `archiveFailure` is already drawn as one sentence in the panel's
					 * ordinary toast lane, and the dialog it was asked from has closed.
					 * That is D3, and it is the behaviour the existing refusal tests pin.
					 */
					if (!accepted) return;
					restoreFocus?.();
				});
			}}
			onCancel={() => requestArchiveConfirm(null)}
		/>
	);
};
