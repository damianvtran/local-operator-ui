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
 * Missing IDs are tried once per sweep; a distinct ready fact, including a
 * generic correction, earns a fresh sweep. Each flight services at most ONE
 * additional wake; later facts remain owed for the caller's next admitted flight.
 * This bounds work under a continuously changing source without token polling.
 * Building/unsupported responses otherwise stop. Never poll on
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
	let wakeRetries = 0;
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
			if (latest.orderNeedsReconcile) {
				if (latest.orderDemand === read.demand || wakeRetries === 1)
					return { kind: "waiting" };
				wakeRetries++;
				// This response predates the new signal: its "missing" set cannot seal
				// identities the correction may now attest, even in the SAME domain.
				attempted.clear();
				continue;
			}
			if (journalLookupIds(latest).some((id) => !attempted.has(id))) continue;
			return { kind: "complete", transcript: latest };
		}
		// The same dispatch-identity rule covers a notification racing a cold
		// response; domain spelling alone is not notification provenance.
		if (
			!latest.orderNeedsReconcile ||
			latest.orderDemand === read.demand ||
			wakeRetries === 1
		)
			return { kind: "waiting" };
		wakeRetries++;
		attempted.clear();
	}
}
