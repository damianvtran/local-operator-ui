/**
 * Ranking and ordering for the composer's `@` list.
 *
 * WHY a ranker rather than a prefix filter. The reference surface this feature
 * copies searches fuzzily and descends (`docs/design/composer-file-mentions.md`
 * § 2.1: `@src/com` returns `components` AND its four children), and the slash
 * popup in this same composer already made the same move for commands
 * (`slash-rank.ts`, a port of the TUI's `autocomplete.py`). So the two lists over
 * one field behave alike, and the fuzzy bands are not re-invented: they are
 * imported from `slash-rank.ts`, which is where this repository keeps the
 * measured argument for them (`FUZZY_MIN_QUERY_CHARS` and why).
 *
 * THE ORDERING CONTRACT, stated once so the popup and its tests cannot disagree:
 *
 *   1. Score: exact 1000 > prefix 900 > fuzzy subsequence 1..40 > 0, from
 *      `scoreCommandTextMatch`. An EMPTY query scores 0 for every candidate and
 *      is not a filter — a bare `@` asks "what is here".
 *   2. Two bounded boosts, applied to candidates that are ALREADY in the list,
 *      never as extra rows: a recent acceptance outranks an equal-scoring
 *      neighbour, and a common entry gets a smaller nudge. Neither can lift a
 *      candidate past a better band (40 + 50 < 900), which is what keeps a
 *      recent file from outranking an exact name match.
 *   3. Directories before files at equal score, then the shorter NAME, then
 *      alphabetical by name. The chain ends in a total order over
 *      (name, path), so no ordering can depend on the enumeration order of a
 *      directory listing: a list that reorders on every keystroke is unreadable,
 *      and `readdir` order is a filesystem's business, not this list's.
 */

import { scoreCommandTextMatch } from "./slash-rank";

/**
 * One row of the `@` list.
 *
 * `path` is relative to the working directory — the exact string the token
 * writes and the harness resolves (paths outside the workspace are emitted
 * absolute by the harness, which is the resolver's own rule; see `at-row.ts`'s
 * note on the chip's label). `name` is the entry's own name, which is what the
 * first column shows and what the matcher scores.
 */
export type AtRow = {
	/** Path relative to the working directory, as the token will write it. */
	path: string;
	/** The entry's own name. */
	name: string;
	/** Where the row lives, relative to the LISTING being shown (`./` for itself). */
	parent: string;
	directory: boolean;
};

/**
 * The recents boost, and why it is this size.
 *
 * Recents outrank an equal-scoring SCOPE entry (the design's rule) without ever
 * outranking a better match band: the largest fuzzy score is 40, so 50 clears
 * every fuzzy candidate and is still 850 short of a prefix match. A magnitude
 * rather than a rank is what keeps "recent" a tiebreak between neighbours rather
 * than a promotion of something the user did not type.
 */
export const RECENT_BOOST = 50;

/**
 * The common pool's boost, below the recents boost on purpose.
 *
 * The design's rule is that the pool "contribut[es] a boost to entries that
 * exist in the scope, not extra rows": a pool entry the directory does not have
 * contributes nothing, so the list can never show a name the user cannot choose.
 * Being weaker than recency is the point — evidence about what this operator
 * actually references outranks a guess about what is usually worth referencing.
 */
export const COMMON_BOOST = 20;

/**
 * The named, bounded common pool. Names, not paths: the pool is a set of things
 * worth reaching for in whatever directory is being listed, which is why a
 * `package.json` under a nested directory is boosted exactly like the root one.
 */
export const COMMON_NAMES: readonly string[] = [
	"README.md",
	"package.json",
	"AGENTS.md",
	"src",
	"docs",
	"tests",
];

/** How many rows the list will render, before the region starts scrolling. */
export const AT_ROW_LIMIT = 200;

/** The score a candidate carries, before the tiebreak chain. */
function boost(
	name: string,
	path: string,
	recents: ReadonlySet<string>,
): number {
	let score = 0;
	if (recents.has(path)) score += RECENT_BOOST;
	if (COMMON_NAMES.some((entry) => entry.toLowerCase() === name.toLowerCase()))
		score += COMMON_BOOST;
	return score;
}

/**
 * The whole ordering, as one comparator.
 *
 * Exported because the picker sorts once and the tests pin the property
 * directly; a second sort somewhere else is how two views of one list come to
 * disagree about which row is second.
 */
export function compareAtRows(
	a: { row: AtRow; score: number },
	b: { row: AtRow; score: number },
): number {
	if (a.score !== b.score) return b.score - a.score;
	if (a.row.directory !== b.row.directory) return a.row.directory ? -1 : 1;
	if (a.row.name.length !== b.row.name.length)
		return a.row.name.length - b.row.name.length;
	const byName = a.row.name.localeCompare(b.row.name);
	if (byName !== 0) return byName;
	// A total order needs the last term to be unique, or `readdir` order leaks
	// through two rows with the same name in different directories.
	return a.row.path.localeCompare(b.row.path);
}

/**
 * The ranked rows for one listing.
 *
 * `rows` is the directory's own entries — the scope, as the harness's
 * `split_token` defines it — and the query is the part after the last `/`. An
 * empty query keeps every row, which is the bare-`@` list.
 */
export function rankAtRows(
	rows: readonly AtRow[],
	query: string,
	recents: ReadonlySet<string> = new Set(),
): AtRow[] {
	const scored = rows.map((row) => ({
		row,
		// An empty query is not a match of nothing: it is the whole listing, in the
		// tiebreak order below. Scoring it as a miss would empty the bare-`@` list,
		// which is the state the picker is opened for.
		score: query ? scoreCommandTextMatch(query, row.name) : 0,
	}));
	return scored
		.filter((entry) => entry.score > 0 || !query)
		.map((entry) => ({
			row: entry.row,
			score: entry.score + boost(entry.row.name, entry.row.path, recents),
		}))
		.sort(compareAtRows)
		.slice(0, AT_ROW_LIMIT)
		.map((entry) => entry.row);
}

/**
 * The rows of the `@` list, from the listing the main process returned.
 *
 * `listingDir` is the token's own directory part (what `splitToken` cut off), so
 * every row's `path` is EXACTLY the string accepting it writes and the harness
 * resolves: the directory survives, and the name is appended to it — the
 * harness's own rule (`command_picker.py:_file_span_replacement`: "replacing the
 * whole span with the row name would drop the directory: `@src/` + `app.py`
 * became `@app.py`, a path that does not exist"). An absolute `listingDir` (the
 * user typed `@/Users/…`) produces absolute row paths for the same reason.
 *
 * `parent` is where the row lives, relative to the working directory, with `./`
 * for the directory the listing itself is of — the reference's own rule, and it
 * is derived here rather than passed in so the middle column cannot describe a
 * directory the row is not in.
 */
export function rowsFromListing(
	entries: readonly { name: string; directory: boolean }[],
	listingDir: string,
): AtRow[] {
	return entries.map((entry) => {
		const path = `${listingDir}${entry.name}`;
		const cut = path.lastIndexOf("/");
		return {
			path,
			name: entry.name,
			parent: cut === -1 ? "./" : `${path.slice(0, cut + 1)}`,
			directory: entry.directory,
		};
	});
}

/**
 * The rows of one DESCENDED directory — the reference's `@src/com` arithmetic.
 *
 * A matched directory's children are listed under the directory's own path with
 * a trailing `/`, and their parent column therefore reads that directory — which
 * is why the reference's parent column exists at all.
 */
export function descendRows(
	entries: readonly { name: string; directory: boolean }[],
	directoryPath: string,
): AtRow[] {
	return rowsFromListing(
		entries,
		directoryPath.endsWith("/") ? directoryPath : `${directoryPath}/`,
	);
}

/** How many directories one query may descend into, and one level each. */
export const DESCEND_LIMIT = 2;

/**
 * The directory rows a query should descend into.
 *
 * The reference's `@src/com` -> `components` + its children, bounded: the top
 * `DESCEND_LIMIT` MATCHING directory rows, by the same ordering the list uses.
 * Without a bound this is a tree walk on every keystroke (`slash-rank.ts`'s
 * measured argument against a walk applies here unchanged); with it the cost is
 * one listing per matched directory, and the caller caches by path.
 *
 * Only rows that MATCHED are descended into: a directory that neither the query
 * nor the tiebreak chain selected is one the user is not looking at.
 */
export function atDescendTargets(
	ranked: readonly AtRow[],
	query: string,
): AtRow[] {
	if (!query) return [];
	return ranked
		.filter(
			(row) => row.directory && scoreCommandTextMatch(query, row.name) > 0,
		)
		.slice(0, DESCEND_LIMIT);
}

/**
 * Splice each matched directory's children in after its own row.
 *
 * `children` is keyed by the directory row's `path`, and each list comes back
 * already ordered by the caller (`rankAtRows(children, "", recents)`), because
 * the children are not filtered by the query: the reference shows them all. A
 * matched directory with no children (an empty one, or a listing that failed)
 * contributes nothing and its row stays where it is.
 */
export function interleaveDescend(
	ranked: readonly AtRow[],
	children: ReadonlyMap<string, readonly AtRow[]>,
): AtRow[] {
	if (children.size === 0) return [...ranked];
	const out: AtRow[] = [];
	for (const row of ranked) {
		out.push(row);
		const nested = children.get(row.path);
		if (nested) out.push(...nested);
	}
	return out.slice(0, AT_ROW_LIMIT);
}
