import type { DesktopHistoryPage } from "../../../../../shared/desktop-session-contract";
import { journalOrderIdBatch } from "../../../../../shared/journal-order-query";
import {
	type JournalOrderRead,
	currentOrderRevision,
	journalLookupIds,
	journalOrderRead,
} from "./journal-order";
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
	commit: (response: T, revision: number, read: JournalOrderRead) => void;
	/** Exact fixed target/query of the existing GET lookup route. */
	lookupPath: string;
}): Promise<
	| { kind: "complete"; transcript: TranscriptState }
	| { kind: "waiting" | "stale" }
> {
	const attempted = new Set<string>();
	let attemptedGeneration = deps.getTranscript().journalGeneration;
	let wanted = deps.getTranscript().orderDemand;
	for (;;) {
		if (!deps.isCurrent()) return { kind: "stale" };
		const before = deps.getTranscript();
		const read = journalOrderRead(before);
		const revision = read.revision;
		const ids = journalOrderIdBatch(
			journalLookupIds(before).filter((id) => !attempted.has(id)),
			deps.lookupPath,
			new URLSearchParams({ journal_order: "1" }),
		);
		const response = await deps.read(ids);
		if (
			!deps.isCurrent() ||
			currentOrderRevision(deps.getTranscript()) !== revision
		)
			return { kind: "stale" };
		deps.commit(response, revision, read);
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
				if (latest.orderDemand === wanted) return { kind: "waiting" };
				wanted = latest.orderDemand;
				continue;
			}
			if (journalLookupIds(latest).some((id) => !attempted.has(id))) continue;
			return { kind: "complete", transcript: latest };
		}
		// Preserve a ready notification that raced the cold response. One new
		// equality domain earns one sequential read, not an unbounded retry.
		if (!latest.orderNeedsReconcile || latest.orderDemand === wanted)
			return { kind: "waiting" };
		wanted = latest.orderDemand;
	}
}
