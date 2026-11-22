import type {
	DiscardSnapshotEntry,
	HoldReceipt,
} from "./team-bridge-holds-model";

export type DiscardBatchResult = {
	entry: DiscardSnapshotEntry;
	/** True only after a matching local-record receipt. False also includes a
	 * lost response: it must never be presented as proof that no write occurred.
	 */
	recorded: boolean;
	error: string | null;
};

/** Sequentially spend only the frozen proofs the person confirmed. There is no
 * list fetch in this loop: new arrivals can never join an irreversible action.
 * A failed row does not abort accounting for the rest; an owner fence failure
 * records the remaining rows as failures without issuing more requests.
 */
export async function discardSnapshot(
	entries: readonly DiscardSnapshotEntry[],
	decide: (entry: DiscardSnapshotEntry) => Promise<HoldReceipt>,
	isCurrentOwner: () => boolean,
	refusal: (error: unknown, entry: DiscardSnapshotEntry) => string,
	onResult: (result: DiscardBatchResult) => void,
): Promise<DiscardBatchResult[]> {
	const results: DiscardBatchResult[] = [];
	for (const entry of entries) {
		let result: DiscardBatchResult;
		try {
			if (!isCurrentOwner()) throw new Error("Owner scope changed"); // i18n: ignore internal fence diagnostic, mapped to fixed refusal
			const receipt = await decide(entry);
			// HTTP success is not enough for per-row accounting. Core's discard
			// receipt names this exact message and says "discarded"; that means
			// recorded locally, never proof of hub application or notification.
			if (
				receipt.state !== "discarded" ||
				receipt.message_id !== entry.item.message_id
			)
				throw new Error("Discard receipt did not match"); // i18n: ignore internal response diagnostic, mapped to fixed refusal
			result = { entry, recorded: true, error: null };
		} catch (error) {
			result = { entry, recorded: false, error: refusal(error, entry) };
		}
		results.push(result);
		onResult(result);
	}
	return results;
}
