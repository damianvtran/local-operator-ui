/**
 * What a chat-search result does to the sidebar's list: who is admitted, in
 * what order, and why.
 *
 * The search itself is the backend's (`sessions.search`), deliberately: it is
 * the same mechanic the CLI's `/resume` picker and the phone run, over an index
 * of the conversations' own text, and a renderer that re-implemented "what
 * matches" could only match on what it happens to hold — which is exactly the
 * sidebar's old behaviour: a title filter that could not find a conversation by
 * anything SAID in it.
 *
 * So this module is the JOIN, and nothing else: it decides which of the rows on
 * screen survive a query, where the ones the backend found belong in a list
 * grouped by agent and team, and which need a marker saying the CONVERSATION is
 * why they surfaced. Pure and synchronous, so it is cheap to run on every paint
 * and can be tested without a browser.
 */
import type { CanonicalSessionRow } from "@shared/store/canonical-sessions-store";
import type { SessionSearchHit } from "../../../../shared/desktop-session-contract";

/**
 * Relevance tiers, mirroring `local_operator.session.session_search`'s
 * `RANK_*` constants. Duplicated as numbers on purpose rather than fetched:
 * they are a wire contract between two languages, and a test asserts the
 * ordering this file relies on instead of trusting the copy.
 */
export const SESSION_RANK_NAME = 0;
export const SESSION_RANK_ID = 1;
export const SESSION_RANK_BODY = 2;
export const SESSION_RANK_SOFT = 3;

/**
 * The tier a row matched in when the MATCH IS LOCAL: its title, or the agent or
 * team it is bound to.
 *
 * Tier 0 — the same tier as a name hit — because it is the same kind of signal.
 * An agent or team name is a sentence the user wrote and a label already on
 * screen, and the sidebar has always searched it ("Search chats and agents"):
 * typing `architect` is how a user finds that agent's chats, and demoting it
 * below a body match would bury the rows the query names in favour of rows that
 * merely mention it.
 */
export const SESSION_RANK_LABEL = SESSION_RANK_NAME;

export type ChatSearchOutcome = {
	/** Rows admitted by the query, best first; every row unchanged when it is empty. */
	rows: CanonicalSessionRow[];
	/**
	 * Ids on screen because the CONVERSATION matched rather than the visible
	 * name or label. Drives the row marker — without it a highlighted row with
	 * nothing in common with the query reads as a bug in the filter.
	 */
	conversationMatches: Set<string>;
};

/** A row's own searchable text, the same fields the pre-search filter used. */
function labelHaystack(row: CanonicalSessionRow): string {
	return `${row.title ?? ""} ${row.binding?.agent ?? ""} ${row.binding?.team ?? ""}`.toLocaleLowerCase();
}

/**
 * Whether the LOCAL fields answer the query — a case-insensitive substring of
 * the title, agent or team.
 *
 * Deliberately exact substring and deliberately not folded into the backend
 * search: those fields are what the sidebar shows, the backend does not know a
 * row's agent or team, and this is the half of the search that must keep working
 * when the backend cannot answer at all (an older backend, a failed request).
 */
export function matchesLabel(row: CanonicalSessionRow, query: string): boolean {
	const needle = query.trim().toLocaleLowerCase();
	if (!needle) return false;
	return labelHaystack(row).includes(needle);
}

/**
 * The rows a query admits, best first, with the conversation-matched ids.
 *
 * `hits` is the backend's answer for THIS query — the caller must not pass the
 * previous query's hits (see `useChatSearch`), and `null` means "no backend
 * answer", which degrades to the local label search rather than to an empty
 * list: a search field that silently stops finding chats is worse than one that
 * finds fewer.
 *
 * Ordering is `(tier, recency)` — the tiers above, then the order the rows
 * arrived in, which the catalogue already ranks newest-first. The sort is
 * stable in every engine we target (ECMAScript 2019 required it), so a group of
 * equally-relevant rows keeps the catalogue's order instead of shuffling
 * between two identical renders. Nothing else is reordered: an empty query
 * returns the input array untouched.
 */
export function searchChats(
	rows: CanonicalSessionRow[],
	query: string,
	hits: SessionSearchHit[] | null,
): ChatSearchOutcome {
	const needle = query.trim();
	if (!needle) {
		return { rows, conversationMatches: new Set() };
	}
	const byId = new Map((hits ?? []).map((hit) => [hit.id, hit]));
	const conversationMatches = new Set<string>();
	const admitted: { row: CanonicalSessionRow; rank: number }[] = [];
	for (const row of rows) {
		const hit = byId.get(row.session_id);
		const labelMatch = matchesLabel(row, needle);
		if (!hit && !labelMatch) continue;
		if (hit?.body_match) conversationMatches.add(row.session_id);
		admitted.push({
			row,
			// A local label hit and a backend name hit are the same tier, so a row
			// that is both keeps the lower number rather than being promoted.
			rank: Math.min(
				hit?.rank ?? SESSION_RANK_LABEL,
				labelMatch ? SESSION_RANK_LABEL : Number.POSITIVE_INFINITY,
			),
		});
	}
	return {
		rows: admitted
			.map((entry, index) => ({ entry, index }))
			.sort((a, b) => a.entry.rank - b.entry.rank || a.index - b.index)
			.map(({ entry }) => entry.row),
		conversationMatches,
	};
}

/**
 * Whether a backend answer belongs to `query`.
 *
 * Answers arrive out of order (each keystroke is its own request, and a slow one
 * can land after a fast later one), so the RESPONSE's echoed query is the only
 * thing that says which question it answers. Filtering a list by the wrong
 * query's hits is a search that lies about what it found, which is the failure
 * class the echoed field exists to prevent.
 */
export function hitsAnswerQuery(
	result: { query: string; sessions: SessionSearchHit[] } | undefined,
	query: string,
): result is { query: string; sessions: SessionSearchHit[] } {
	return Boolean(result) && result?.query === query.trim();
}
