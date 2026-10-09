/**
 * The renderer's READING of an open-frame page (`docs/DESKTOP_API.md`, "The
 * open frame"): the wire fields turned into the two facts this client can act
 * on, and nothing else.
 *
 * WHY A MODULE. Two consumers want these fields and they want DIFFERENT halves
 * of them - `turn-collapse-model.ts` wants the per-run counts so a head-cut
 * bar states the turn's own figure on the first contentful commit, and
 * `use-canonical-session.ts` wants the page's attested START so a reopen whose
 * held rows lie inside the page owes no `/history` read. Both must agree about
 * what "the facts are here" means, and the disagreements are exactly the ones
 * that would cost the operator something: a reader that treated `building` as
 * "facts are coming, wait" would delay a first paint, and a reader that treated
 * an absent `runs` as "no facts" but a `head_cut` page as "attested start"
 * would skip the walk a cap-bound page still needs.
 *
 * THE THREE RULES, stated once, here:
 *
 * 1. `runs_state: "ready"` is the ONLY value with facts. `building` (a refresh
 *    was started, this answer carries none), `unavailable`, `unsupported` and
 *    an ABSENT `runs` are the same fact to every reader below - today's page,
 *    today's behaviour - and none of them is ever waited on: facts refine a
 *    bar, they never gate a paint. `unsupported` is what a peer-owned
 *    conversation answers, and the contract requires it to be treated exactly
 *    like an absent field.
 *
 * 2. A COUNT IS READ ONLY OFF A SETTLED RUN. `settled: false` means the run is
 *    still in flight, so its tool rows are still arriving and any number taken
 *    now is one this client would have to correct after the paint - the
 *    after-paint change the whole contract exists to remove. A live tail
 *    therefore keeps the client's own fold, exactly as an old backend does.
 *
 * 3. A FACT IS USED ONLY IF IT IS WHOLE. A settled run whose `action_count` is
 *    absent is not a run with zero actions - it is a fact this build cannot
 *    read, and the honest move is the fallback (the loaded-rows fold) rather
 *    than an exact-looking `0 actions` claim. Same for the run key: absent or
 *    empty names no run this client can match.
 *
 * A `complete: false` run IS used, deliberately: the count is then a LOWER
 * BOUND rather than the run's figure, which is a fact the bar already has
 * vocabulary for (`TurnSummaryFacts.partial`, the `N+` marker).
 */

import type {
	DesktopHistoryPage,
	DesktopOpenFrameRun,
} from "../../../../../shared/desktop-session-contract";
import type { RunFact, RunFactLookup } from "./turn-collapse-model";

/** What a page's open-frame fields give this client, or nothing. */
export type OpenFrameFacts = {
	/**
	 * The facts, reachable under EVERY id the contract lets a client match them
	 * by: `run_key`, `opening_user_id` and `closing_answer_id` all map to the same
	 * fact.
	 *
	 * WHY ALIASES AND NOT JUST `run_key` (docs/DESKTOP_API.md, the two
	 * `head_cut` consequences). The contract states the match as `run_key`,
	 * `opening_user_id` OR `closing_answer_id`, and the three are NOT the same
	 * string in the case this whole lane exists for: a head-cut run's client key
	 * is the answer row the LOADED span elected, while the wire's `run_key` is the
	 * run's own closing answer - a row the page may not carry at all. A lookup
	 * keyed by `run_key` alone therefore misses exactly the run whose bar most
	 * needs the facts, which was measured: on the S3 fixture the walk kept
	 * fetching against a page that already stated the run's size.
	 *
	 * The aliases cost one map entry each and no behaviour: a client looks a run
	 * up by an id it is holding, and an id it is not holding cannot be hit by
	 * accident (`Row` ids are unique).
	 */
	runs: RunFactLookup;
	/**
	 * Whether the turn-aligned extension was refused by the hard cap, so the
	 * page is the plain `limit`-row tail and its oldest run has no opening user
	 * row. Read by the reconciliation gate, which needs a page whose START is
	 * attested before it may compare a held row against it.
	 */
	headCut: boolean;
};

/** A count off the wire, or null when the field is not a whole number. */
function wireCount(value: number | null | undefined): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	return Math.max(0, Math.trunc(value));
}

/** The run's reported work: null is "nothing reported a figure" (rule 3's sibling). */
function wireSeconds(value: number | null | undefined): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
		return null;
	return value;
}

/**
 * The page's facts, or `null` when there is nothing to read (rule 1).
 *
 * `null` is a complete answer and every caller keeps today's behaviour on it:
 * an old backend, a `building` answer, a peer's conversation and a page with no
 * settled run all land here, and none of them is distinguishable from the
 * others by anything a reader should do differently.
 */
export function openFrameFacts(
	page: DesktopHistoryPage | null | undefined,
): OpenFrameFacts | null {
	if (!page || page.runs_state !== "ready") return null;
	const runs = page.runs;
	if (!runs || runs.length === 0) return null;
	const lookup = new Map<string, RunFact>();
	for (const run of runs) {
		if (!run.settled) continue;
		if (typeof run.run_key !== "string" || run.run_key.length === 0) continue;
		const actions = wireCount(run.action_count);
		if (actions === null) continue;
		const fact: RunFact = {
			actions,
			workedSeconds: wireSeconds(run.worked_seconds),
			failed: wireCount(run.failed_count) ?? 0,
			complete: run.complete !== false,
			/*
			 * NORMALISED TO NULL, NOT TO "": the model's whole use of this field is the
			 * question "is the row my span opens at the run's OWN opener?", and an empty
			 * string would answer it with a `false` that means the same thing as null
			 * while reading like an id. One spelling for "the wire did not name one".
			 */
			openingUserId:
				typeof run.opening_user_id === "string" &&
				run.opening_user_id.length > 0
					? run.opening_user_id
					: null,
		};
		lookup.set(run.run_key, fact);
		if (fact.openingUserId !== null) lookup.set(fact.openingUserId, fact);
		if (
			typeof run.closing_answer_id === "string" &&
			run.closing_answer_id.length > 0
		)
			lookup.set(run.closing_answer_id, fact);
	}
	if (lookup.size === 0) return null;
	return { runs: lookup, headCut: page.head_cut === true };
}

/**
 * The page's own START, when the open-frame facts ATTEST it - the id and
 * instant of the oldest run's opening user row - or null when they do not.
 *
 * WHAT "ATTESTED" MEANS, and why the check is not decoration: the page's first
 * entry is a run's opening user row only if the turn-aligned extension ran and
 * was not refused. `head_cut: true` is the page SAYING it was refused (the cap
 * bound), and a page that opens on a run whose `opening_user_id` is null (a run
 * that opens off a non-user row) attests nothing either. Both cases answer
 * null, and a caller that wanted a run boundary gets today's behaviour back.
 *
 * WHY A CALLER WANTS IT AT ALL (`use-canonical-session`'s reconciliation gate):
 * an attested start turns "does this page connect to the rows the pane holds?"
 * into "are the held rows at or after a row this page is known to begin with?",
 * which is answerable from ids and one instant instead of by walking pages.
 */
export function openFrameAttestedStart(
	page: DesktopHistoryPage | null | undefined,
): { id: string; tsMs: number } | null {
	if (!page || page.runs_state !== "ready") return null;
	if (page.head_cut === true) return null;
	const runs: DesktopOpenFrameRun[] | undefined = page.runs;
	const first = page.entries[0];
	const oldest = runs?.[0];
	if (!first || !oldest) return null;
	if (oldest.opening_user_id !== first.id) return null;
	const tsMs = Math.round((first.ts ?? 0) * 1000);
	if (!(tsMs > 0)) return null;
	return { id: first.id, tsMs };
}

/**
 * Whether this page's own SPAN covers every row the pane holds, so no
 * reconciliation walk is owed - or null when the page attests nothing (an old
 * backend, a `building` answer, a peer's conversation, a cap-refused
 * `head_cut`): the three states in which the caller must fall back to its own
 * connection proof rather than read a page it cannot place.
 *
 * WHY THIS IS NOT THE ID OVERLAP THE CALLER ALREADY HAS. A walk exists to close
 * a seam between what the pane holds and the page in hand, and an id overlap is
 * one proof that there is none. The page's own span is the other, and it is the
 * one a turn-aligned cut is built to give: the start is a row the FACTS name as
 * a run's opening user row, so everything at or below that instant belongs to
 * the page's own range (`docs/DESKTOP_API.md`: the cut "extends back to the
 * oldest included run's opening user row"). A held row inside that range is
 * therefore inside the page, whether or not its id happens to be one the page's
 * entries spell the same way - which is the case a key-mapping difference
 * between a row and its entry (`entryRecordKey`) turns into a spurious walk.
 *
 * WHY THE BOUNDS ARE STRICT, on both ends, and why that is the whole safety of
 * this function:
 *
 *  - a held row whose instant is at or BEFORE the start may be the row the page
 *    begins with, or a row on the other side of a second boundary - it is the
 *    #876/#883 seam ("a cached block hours behind a journal-tail page"), and
 *    the walk is exactly what fills it;
 *  - a held row at or AFTER the page's newest entry is the live tail, and rows
 *    journaled between that entry and the held row are precisely the ones a
 *    cut-at-a-cursor page can omit (#876's steer drain: the page's newest row
 *    is old while newer rows are already durable). Trusting the span there is
 *    how a range gets dropped, which is the guarantee #883 exists to keep.
 *
 * So the function answers true only for the case that cannot hide anything: a
 * held row strictly INSIDE a span whose own start is attested. Everything else
 * returns false, and a false costs the caller today's walk - the conservative
 * direction, never a dropped range.
 */
export function openFrameCoversHeld(
	page: DesktopHistoryPage | null | undefined,
	held: ReadonlyMap<string, number>,
	/**
	 * The record keys of the page's own entries, as `entryRecordKey` spells them
	 * (`use-canonical-session` owns that mapping — a tool entry keys by its CALL
	 * id — and this function must not grow a second spelling of it).
	 */
	carried: ReadonlySet<string>,
): boolean {
	const start = openFrameAttestedStart(page);
	const entries = page?.entries;
	if (start === null || !entries || entries.length === 0) return false;
	const end = Math.round((entries[entries.length - 1].ts ?? 0) * 1000);
	if (!(end > start.tsMs)) return false;
	for (const [id, ts] of held) {
		if (carried.has(id)) continue;
		if (!(ts > start.tsMs) || !(ts < end)) return false;
	}
	return true;
}
