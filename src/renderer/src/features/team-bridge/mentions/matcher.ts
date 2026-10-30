/**
 * @-mention matching for the Team Bridge composer: WHEN the popover opens, and
 * WHICH rows it offers in what order.
 *
 * WHY A PURE MODULE. The popover must open on the keystroke with no network
 * wait, from data the page already holds (the directory query and the open
 * conversation's members). Keeping the decision pure means the boundary rule,
 * the ranking and the grouping are executed by unit tests rather than inferred
 * from a rendered list, and the hook that wires them stays thin.
 *
 * Ranking contract (operator brief): conversation members first, then the rest
 * of the organization; inside each section humans before agents (Slack's
 * grouping); inside each group, exact prefix of the full name, then prefix of
 * any word, then substring, then fuzzy subsequence. Ties keep the input order,
 * which is the directory's server-side order (no client re-sort of the roster,
 * see `teamBridgeDirectorySchema`).
 */

export type MentionKind = "human" | "agent";

/** One person or agent the popover can offer. Built by `mentionCandidates`. */
export type MentionCandidate = {
	kind: MentionKind;
	accountId: string;
	/** Agents only: the hub endpoint (`bep_…`), required by the wire contract. */
	endpointId?: string;
	/** The name inserted after `@` and shown on the row. */
	label: string;
	/**
	 * Extra searchable strings (an agent's owner name, the "X's chief of staff"
	 * line). The label's own words are always searched.
	 */
	aliases?: readonly string[];
	/** Secondary line: a person's title, or "chief of staff of X" for an agent. */
	secondary?: string;
	/** An active or invited member of THIS conversation. */
	member: boolean;
	/** The person's (or the agent owner's) bridge is off: they cannot be reached. */
	bridgeOff: boolean;
	/** The owner muted this agent here: an @-mention will not wake it. */
	muted?: boolean;
};

/**
 * Where an `@query` is being typed, if anywhere.
 *
 * `start` is the index of the `@`, `end` the caret. A query may contain spaces
 * ("@Ben Tr") because display names do: the HOOK closes the popover when a
 * space produces zero matches, which is the brief's rule, so the scanner only
 * refuses what can never be a mention: a newline, a second `@`, or an overlong
 * run that is clearly prose.
 */
export type MentionQuery = { start: number; end: number; query: string };

/** Longest `@query` still treated as a name being typed. */
const MAX_QUERY = 48;

/*
 * THE WORD BOUNDARY. `@` opens only at the start of the text or after
 * whitespace or opening punctuation. Anything word-like before it (a letter, a
 * digit, `.`, `_`, `-`, `+`) is an email or handle such as `ben@minerva.ai`,
 * and opening there would hijack Enter in the middle of an address.
 */
const OPENS_BEFORE = /[\s([{"'“‘«<,;:!?]/u;

export function isMentionBoundary(text: string, at: number): boolean {
	if (at === 0) return true;
	return OPENS_BEFORE.test(text.charAt(at - 1));
}

export function findMentionQuery(
	text: string,
	caret: number,
): MentionQuery | null {
	const floor = Math.max(0, caret - MAX_QUERY - 1);
	for (let index = caret - 1; index >= floor; index -= 1) {
		const char = text.charAt(index);
		if (char === "\n") return null;
		if (char === "@") {
			if (!isMentionBoundary(text, index)) return null;
			const query = text.slice(index + 1, caret);
			// A leading space is "@ " typed as prose, not a name.
			if (query.startsWith(" ")) return null;
			return { start: index, end: caret, query };
		}
	}
	return null;
}

/** Case- and accent-insensitive comparison form. */
export function fold(value: string): string {
	return value
		.normalize("NFKD")
		.replace(COMBINING_MARKS, "")
		.toLocaleLowerCase();
}

const WORD_SPLIT = /[\s()[\],.'’"-]+/u;
const COMBINING_MARKS = /\p{M}/gu;
const WHITESPACE = /\s+/g;

function words(value: string): string[] {
	return fold(value)
		.split(WORD_SPLIT)
		.filter((word) => word.length > 0);
}

function isSubsequence(needle: string, haystack: string): boolean {
	let at = 0;
	for (const char of haystack) {
		if (char === needle[at]) at += 1;
		if (at === needle.length) return true;
	}
	return needle.length === 0;
}

/**
 * The match tier: 0 exact prefix of the full name, 1 prefix of any word, 2
 * substring, 3 fuzzy subsequence; null when nothing matches. An empty query
 * matches everything at tier 0 (the popover right after `@`).
 */
export function matchTier(
	query: string,
	candidate: Pick<MentionCandidate, "label" | "aliases">,
): 0 | 1 | 2 | 3 | null {
	const q = fold(query).trim();
	if (q === "") return 0;
	const names = [candidate.label, ...(candidate.aliases ?? [])];
	const folded = names.map(fold);
	if (folded.some((name) => name.startsWith(q))) return 0;
	// A multi-word query ("ben tr") is a word-prefix match when it prefixes the
	// name starting at any word, so "Tran B" style partials still rank high.
	if (
		names.some((name) => {
			const parts = words(name);
			return parts.some((_, index) =>
				parts.slice(index).join(" ").startsWith(q),
			);
		})
	)
		return 1;
	if (folded.some((name) => name.includes(q))) return 2;
	const compact = q.replace(WHITESPACE, "");
	if (
		folded.some((name) => isSubsequence(compact, name.replace(WHITESPACE, "")))
	)
		return 3;
	return null;
}

export type MentionSectionId =
	| "member-human"
	| "member-agent"
	| "org-human"
	| "org-agent";

export type MentionSection = {
	id: MentionSectionId;
	rows: MentionCandidate[];
};

const SECTION_ORDER: readonly MentionSectionId[] = [
	"member-human",
	"member-agent",
	"org-human",
	"org-agent",
];

function sectionOf(candidate: MentionCandidate): MentionSectionId {
	return `${candidate.member ? "member" : "org"}-${candidate.kind}`;
}

/**
 * Filter and order the candidates into non-empty sections.
 *
 * `flat` is the keyboard order (the order ↑/↓ walks), which is the sections
 * read top to bottom; the popover renders the sections and indexes rows
 * against `flat`, so the active row is the same in both.
 */
export function rankMentionCandidates(
	query: string,
	candidates: readonly MentionCandidate[],
): { sections: MentionSection[]; flat: MentionCandidate[] } {
	const scored = candidates.flatMap((candidate, index) => {
		const tier = matchTier(query, candidate);
		return tier === null ? [] : [{ candidate, tier, index }];
	});
	const sections: MentionSection[] = [];
	for (const id of SECTION_ORDER) {
		const rows = scored
			.filter((entry) => sectionOf(entry.candidate) === id)
			.sort((a, b) => a.tier - b.tier || a.index - b.index)
			.map((entry) => entry.candidate);
		if (rows.length > 0) sections.push({ id, rows });
	}
	return { sections, flat: sections.flatMap((section) => section.rows) };
}

/** Stable identity of a mentionable: the wire's own key. */
export function mentionKey(
	candidate: Pick<MentionCandidate, "kind" | "accountId">,
): string {
	return `${candidate.kind}:${candidate.accountId}`;
}
