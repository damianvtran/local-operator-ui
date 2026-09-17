import {
	type CanonicalSessionRow,
	unreadAckableCount,
	unreadAckableRows,
} from "@shared/store/canonical-sessions-store";

/*
 * The decisions behind the sidebar's bulk read receipt, kept out of the
 * component for the reason the panel's other decisions are (`chat-search.ts`,
 * `sidebar-catalogue-gate.ts`): a JSX condition and a template literal are not
 * things a test can drive, and both of these have to be exactly right rather
 * than approximately right.
 *
 * The receipt copy in particular is the honest half of the feature. The backend
 * answers a bulk acknowledgement per item, and only the `read` bucket means a
 * mark actually moved; a sentence that said "all done" over a batch the store
 * partly refused would put a cleared mark in the operator's head that is still
 * unread on screen. The no-silent-partial-success rule, at the one surface that
 * renders it.
 */

/*
 * The predicate is RE-EXPORTED, not re-spelled: the store's `markAllRead`
 * enumerates through the same function the control counts with, so the label's
 * number is the set the request will carry by construction rather than by
 * convention (agent review round 1, R1).
 */
export { unreadAckableCount, unreadAckableRows };

/**
 * Everything the control says, derived from the rows it would clear.
 *
 * THE EXTENT IS STATED BEFORE THE CLICK, and this is where that is decided. The
 * gesture is catalogue-wide (the enumeration rule is deliberately the store's,
 * not the rendered list's, so a filter cannot make the number disagree with the
 * outcome), and an acknowledgement cannot be withdrawn — so the number the
 * request will carry belongs in the control's own words, not only in a tooltip
 * (UX round 1, U1; design D3), and the rows it reaches OUTSIDE the section the
 * control is drawn in are named too.
 *
 * `elsewhere` counts the ackable rows rendered under "Previous chats". The
 * control sits in the Active chats header, so those rows are the ones a reader
 * may not have on screen at all — the case the operator's own report does not
 * cover and the one that makes the extent worth a sentence.
 */
export type MarkAllReadCopy = {
	count: number;
	/** The visible label: the number IS the set the request will send. */
	label: string;
	/**
	 * The tooltip. States the full scope, and the one limit a reader cannot
	 * otherwise see: marks with no completion token name no completion and are not
	 * sent, so they would keep their check with nothing on screen explaining it
	 * (design N5).
	 */
	scope: string;
	/**
	 * The accessible name's tail — the rows this control reaches outside its own
	 * section. Empty when there are none, so the ordinary case adds no words.
	 */
	nameSuffix: string;
};

export const markAllReadCopy = (
	rows: CanonicalSessionRow[],
): MarkAllReadCopy => {
	const ackable = unreadAckableRows(rows);
	const count = ackable.length;
	const elsewhere = ackable.filter((row) => !row.active).length;
	const chat = count === 1 ? "chat" : "chats";
	/*
	 * A mark the batch cannot name: `unseen` with no token. Named only when one
	 * exists, because the clause is noise in the ordinary case and the invariant
	 * it protects is that the label's number is the whole set the click sends.
	 */
	const tokenless = rows.filter(
		(row) => row.attention?.unseen === true && !row.attention?.completion_token,
	).length;
	return {
		count,
		label: `Mark all ${count} read`,
		scope: [
			`Mark ${count} unread ${chat} as read`,
			elsewhere > 0 ? `, including ${elsewhere} in Previous chats` : ".",
			tokenless > 0
				? ` ${tokenless} unread ${tokenless === 1 ? "mark" : "marks"} with no completion token cannot be cleared.`
				: "",
		].join(""),
		nameSuffix:
			elsewhere > 0 ? `, including ${elsewhere} in Previous chats` : "",
	};
};

/** The verdict `markAllRead` resolves with, as the surface reads it. */
export type MarkAllReadReceipt = {
	attempted: number;
	cleared: number;
	superseded: number;
	unknown: number;
};

/**
 * The receipt sentence for a bulk acknowledgement.
 *
 * `warning` rather than `success` when NOTHING was cleared: the request
 * succeeded, the write did not happen, and a success toast over an empty result
 * is the misreport this function exists to prevent. The remainder sentences
 * mirror the TUI's `/notifications read` receipt (`Marked 36 completions read. 2
 * have newer results and stay unread.`), so the two surfaces describe one
 * backend decision the same way.
 *
 * The TONE is a glyph and not a different ground, and the words carry the
 * register: `ThemedToastContainer` does not enable sonner's rich colours, so a
 * warning receipt and a success one share their ground, border and ink (design
 * N2). That is why the sentences below lead with the outcome — "Nothing was
 * cleared." — rather than leaving it to the icon.
 */
export const markAllReadReceipt = (
	receipt: MarkAllReadReceipt,
): { tone: "success" | "warning"; message: string } => {
	/*
	 * A claim about the REQUEST, not about the store: the shipped gate hides the
	 * control at zero, so this is the unreachable arm — and "Nothing unread."
	 * would be the one sentence in this contract able to contradict a screen
	 * still showing marks (design N3).
	 */
	if (receipt.attempted === 0)
		return { tone: "success", message: "Nothing to clear." };
	const remainder = [
		receipt.superseded > 0
			? `${receipt.superseded} ${
					receipt.superseded === 1
						? "has a newer result and stays"
						: "have newer results and stay"
				} unread.`
			: null,
		receipt.unknown > 0
			? `${receipt.unknown} could not be cleared and ${
					receipt.unknown === 1 ? "stays" : "stay"
				} unread.`
			: null,
	].filter((sentence): sentence is string => sentence !== null);
	if (receipt.cleared === 0)
		return {
			tone: "warning",
			message: ["Nothing was cleared.", ...remainder].join(" "),
		};
	return {
		tone: "success",
		message: [
			`Marked ${receipt.cleared} ${
				receipt.cleared === 1 ? "chat" : "chats"
			} as read.`,
			...remainder,
		].join(" "),
	};
};
