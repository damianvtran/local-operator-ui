/**
 * The Projects tab's local text search: which rows a query admits, in what
 * order, and why — the v1 "degraded mode".
 *
 * WHAT v1 SEARCHES, AND WHAT IT HONESTLY CANNOT. The listing carries the
 * project's own fields; `updates[]` (and the progress text) are DETAIL-ONLY on
 * the wire by design, so a query here can never find a project by something
 * said in an update. That limit is stated to the reader in the no-match copy
 * rather than papered over, and the server-side `projects.search` op (the
 * architecture's PR-B2) is the path that will lift it. Matching inside update
 * text is deliberately NOT faked here.
 *
 * THE RANKING CONTRACT, copied from the app's own hand-rolled matchers rather
 * than a fuzzy-search dependency (there is none anywhere in `package.json`;
 * `at-rank.ts` and `slash-rank.ts` are the precedents):
 *
 *   - Bands: exact (4) > prefix (3) > word-prefix (2) > in-order subsequence
 *     (1) > no match (0). The subsequence band is suppressed below three
 *     characters, the floor `slash-rank.ts` states for its own fuzzy tail — a
 *     one-letter query would otherwise subsequence-match nearly every row and
 *     the list would read as unfiltered.
 *   - Field weights: title 3 > name 2.5 > description 2 > tags 1.5 >
 *     owner/team 1.5 > status 1. A row's score is its BEST field product, so
 *     an exact title hit (3x4) always outranks a subsequence hit anywhere.
 *   - Ties: `updated_at` desc, then display name, then the raw name and id —
 *     the trailing keys make the order TOTAL, so two rows sharing a score and
 *     a display name cannot swap between paints.
 *
 * The product math is the contract (`fieldScore = band x weight`), which is
 * what puts a subsequence in the title (3) above nothing in a weaker field
 * only when the bands say so — the tests pin the ordering pairs, not a
 * particular arithmetic.
 */

import type { DesktopProject } from "../../../../shared/desktop-control-contract";
import { projectDisplayName } from "./project-model";

/** Band scores, in the ordered set the header states. */
export const SEARCH_BAND_EXACT = 4;
export const SEARCH_BAND_PREFIX = 3;
export const SEARCH_BAND_WORD_PREFIX = 2;
export const SEARCH_BAND_SUBSEQUENCE = 1;

/**
 * The shortest query allowed into the fuzzy band — the Composer's own floor
 * (`slash-rank.ts`'s `FUZZY_MIN_QUERY_CHARS`), restated here rather than
 * imported because that module is a chat-composer detail and this one is a
 * page's; the number and its reasoning are the shared part.
 */
export const SEARCH_FUZZY_MIN_QUERY_CHARS = 3;

/**
 * Field weights, from the design's ranking table. The keys are the fields a
 * listing row carries — `updates` is absent because the wire does not carry it
 * (see the header), not because it is unimportant.
 */
export const SEARCH_FIELD_WEIGHTS = {
	title: 3,
	name: 2.5,
	description: 2,
	tags: 1.5,
	attribution: 1.5,
	status: 1,
} as const;

/** One band's score for one target text, 0..4. The query is pre-normalised. */
/* Hoisted because the rule is right (a literal re-allocated per call in a hot
 * matcher): one word splitter for both texts and one query splitter. */
const NON_WORD_RUN = /[^\p{L}\p{N}]+/u;
const WHITESPACE_RUN = /\s+/;

function bandScore(query: string, text: string): number {
	const target = text.trim().toLowerCase();
	if (!target) return 0;
	if (target === query) return SEARCH_BAND_EXACT;
	if (target.startsWith(query)) return SEARCH_BAND_PREFIX;
	const words = target.split(NON_WORD_RUN).filter(Boolean);
	const queryWords = query.split(WHITESPACE_RUN).filter(Boolean);
	if (
		queryWords.length > 0 &&
		queryWords.every((word) =>
			words.some((candidate) => candidate.startsWith(word)),
		)
	)
		return SEARCH_BAND_WORD_PREFIX;
	/*
	 * The subsequence band reads the query with its spaces removed: "pay mig"
	 * typed into a fuzzy matcher means the letters in that order, and a space
	 * that must appear in the target is a match nobody can type by accident.
	 */
	const needle = queryWords.join("");
	if (
		needle.length >= SEARCH_FUZZY_MIN_QUERY_CHARS &&
		isSubsequence(needle, target)
	)
		return SEARCH_BAND_SUBSEQUENCE;
	return 0;
}

/** Whether `needle`'s characters appear in `target` in order. */
function isSubsequence(needle: string, target: string): boolean {
	let at = 0;
	for (const character of needle) {
		at = target.indexOf(character, at);
		if (at < 0) return false;
		at += 1;
	}
	return true;
}

/**
 * How well one project answers the query, 0..12: the best `band x weight`
 * over the listing's own fields. 0 means the query does not match at all.
 */
export function searchMatch(project: DesktopProject, query: string): number {
	const normalized = query.trim().toLowerCase();
	if (!normalized) return 0;
	const candidates: [string | null | undefined, number][] = [
		[project.title, SEARCH_FIELD_WEIGHTS.title],
		[project.name, SEARCH_FIELD_WEIGHTS.name],
		[project.description, SEARCH_FIELD_WEIGHTS.description],
		[project.owner, SEARCH_FIELD_WEIGHTS.attribution],
		[project.team, SEARCH_FIELD_WEIGHTS.attribution],
		[project.status, SEARCH_FIELD_WEIGHTS.status],
	];
	let best = 0;
	for (const [text, weight] of candidates) {
		if (!text) continue;
		const score = bandScore(normalized, text) * weight;
		if (score > best) best = score;
	}
	for (const tag of project.tags) {
		const score = bandScore(normalized, tag) * SEARCH_FIELD_WEIGHTS.tags;
		if (score > best) best = score;
	}
	return best;
}

/**
 * The rows a query admits, best first — or the input untouched (same
 * reference) when the query is empty, which is the "no search" identity the
 * page's memo chain relies on.
 */
export function searchProjects(
	rows: DesktopProject[],
	query: string,
): DesktopProject[] {
	const normalized = query.trim();
	if (!normalized) return rows;
	const scored: { project: DesktopProject; score: number }[] = [];
	for (const project of rows) {
		const score = searchMatch(project, normalized);
		if (score > 0) scored.push({ project, score });
	}
	scored.sort((a, b) => {
		if (a.score !== b.score) return b.score - a.score;
		if (a.project.updated_at !== b.project.updated_at)
			return b.project.updated_at - a.project.updated_at;
		const display = projectDisplayName(a.project).localeCompare(
			projectDisplayName(b.project),
			undefined,
			{ sensitivity: "base" },
		);
		if (display !== 0) return display;
		const raw = a.project.name.localeCompare(b.project.name, undefined, {
			sensitivity: "base",
		});
		if (raw !== 0) return raw;
		return a.project.id < b.project.id
			? -1
			: a.project.id > b.project.id
				? 1
				: 0;
	});
	return scored.map((entry) => entry.project);
}
