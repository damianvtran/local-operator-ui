import type { DesktopHistoryPage } from "../../../../../shared/desktop-session-contract";
import { currentOrderRevision, journalLookupIds } from "./journal-order";
import type { TranscriptState } from "./transcript-reducer";

/**
 * Resolve cached IDs in bounded same-source batches on the existing snapshot
 * route. A 512-ID wire limit is not a limit on the cache's ordering guarantee.
 * Missing IDs are tried once per sweep; building/unsupported responses stop
 * unless a distinct ready-domain fact arrived during the read. Never poll on
 * tokens or guess positions for a backend that cannot attest to this source.
 */
export async function repairJournalOrder<T>(deps: {
	getTranscript: () => TranscriptState;
	isCurrent: () => boolean;
	read: (ids: string[]) => Promise<T>;
	page: (response: T) => DesktopHistoryPage;
	commit: (response: T, revision: number) => void;
}): Promise<
	| { kind: "complete"; transcript: TranscriptState }
	| { kind: "waiting" | "stale" }
> {
	const attempted = new Set<string>();
	let attemptedGeneration = deps.getTranscript().journalGeneration;
	let wanted = deps.getTranscript().orderWantedGeneration;
	for (;;) {
		if (!deps.isCurrent()) return { kind: "stale" };
		const before = deps.getTranscript();
		const revision = currentOrderRevision(before);
		const ids = journalLookupIds(before)
			.filter((id) => !attempted.has(id))
			.slice(0, 512);
		const response = await deps.read(ids);
		if (
			!deps.isCurrent() ||
			currentOrderRevision(deps.getTranscript()) !== revision
		)
			return { kind: "stale" };
		deps.commit(response, revision);
		if (!deps.isCurrent()) return { kind: "stale" };
		const latest = deps.getTranscript();
		const page = deps.page(response);
		if (
			page.journal_order_state === "ready" &&
			page.journal_generation === latest.journalGeneration
		) {
			if (page.journal_generation !== attemptedGeneration) {
				attempted.clear();
				attemptedGeneration = page.journal_generation;
			}
			for (const id of ids) attempted.add(id);
			if (
				latest.orderNeedsReconcile &&
				latest.orderWantedGeneration !== undefined &&
				latest.orderWantedGeneration !== page.journal_generation
			) {
				if (latest.orderWantedGeneration === wanted) return { kind: "waiting" };
				wanted = latest.orderWantedGeneration;
				continue;
			}
			if (journalLookupIds(latest).some((id) => !attempted.has(id))) continue;
			return { kind: "complete", transcript: latest };
		}
		// Preserve a ready notification that raced the cold response. One new
		// equality domain earns one sequential read, not an unbounded retry.
		if (!latest.orderNeedsReconcile || latest.orderWantedGeneration === wanted)
			return { kind: "waiting" };
		wanted = latest.orderWantedGeneration;
	}
}
