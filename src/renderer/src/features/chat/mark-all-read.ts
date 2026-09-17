import type { CanonicalSessionRow } from "@shared/store/canonical-sessions-store";

/*
 * The two decisions behind the sidebar's bulk read receipt, kept out of the
 * component for the reason the panel's other decisions are (`chat-search.ts`,
 * `sidebar-catalogue-gate.ts`): a JSX condition and a template literal are not
 * things a test can drive, and both of these have to be exactly right rather
 * than approximately right.
 *
 * The receipt copy in particular is the honest half of the feature. The backend
 * answers a bulk acknowledgement per item, and only the `read` bucket means a
 * mark actually moved; a sentence that said "all done" over a batch the store
 * partly refused would put a cleared mark in the operator's head that is still
 * unread on screen. `docs/design`'s no-silent-partial-success rule, at the one
 * surface that renders it.
 */

/**
 * The rows the bulk acknowledgement can name, in the store's own terms.
 *
 * `unseen` AND a `completion_token`: a mark with no token names no completion,
 * so the backend has nothing to match it against and would answer `unknown` for
 * it — sending it would only inflate the batch and put a number in the receipt
 * that no row's story explains. The token is what makes the write TOKEN-bound
 * (a completion published after this enumeration is not in it and stays unread),
 * which is the property the whole per-item verdict exists to protect.
 *
 * Read off the STORE's rows rather than off the rendered list so the count the
 * control shows and the set `markAllRead` sends are the same fact: a search
 * filter over the sidebar must not be able to make the visible count disagree
 * with what a click clears.
 */
export const unreadAckableRows = (
	rows: CanonicalSessionRow[],
): CanonicalSessionRow[] =>
	rows.filter(
		(row) =>
			row.attention?.unseen === true &&
			typeof row.attention.completion_token === "string" &&
			row.attention.completion_token.length > 0,
	);

/** How many rows a click would name; zero hides the control entirely. */
export const unreadAckableCount = (rows: CanonicalSessionRow[]): number =>
	unreadAckableRows(rows).length;

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
 */
export const markAllReadReceipt = (
	receipt: MarkAllReadReceipt,
): { tone: "success" | "warning"; message: string } => {
	if (receipt.attempted === 0)
		return { tone: "success", message: "Nothing unread." };
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
