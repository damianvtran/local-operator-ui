/**
 * The Projects tab's LOCAL text search: which rows a query admits, in what
 * order, and why — the compatibility engine and the in-flight fallback.
 *
 * TWO ENGINES, ONE VISIBLE LIST. The primary engine is the backend's derived
 * index (`GET /v1/desktop/projects/search`, advertised as `projects` version 2;
 * `use-projects-search.ts` holds the wire half). This module is what the page
 * paints when that engine cannot serve: a backend older than version 2 has no
 * route to answer, and a request that is still in flight or that failed leaves
 * the box needing an answer NOW. It is deliberately kept rather than retired —
 * the compatibility path is the whole reason the page composes two engines
 * instead of replacing one.
 *
 * WHAT THIS ENGINE SEARCHES, AND WHAT IT HONESTLY CANNOT. The listing carries
 * the project's own fields; `updates[]` (and the progress text) are DETAIL-ONLY
 * on the wire by design, so a query here can never find a project by something
 * said in an update. That limit is stated to the reader in the no-match copy —
 * but only while THIS engine is the one on screen, because the backend's index
 * does read update text and a sentence claiming otherwise would be false the
 * moment it served (`projects-page.tsx` holds the two strings). Matching inside
 * update text is deliberately NOT faked here.
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
 *
 * THIS ENGINE'S MEMBERSHIP IS NOT THE INDEX'S, in either direction, and the
 * difference is a fact the surfaces have to live with rather than paper over:
 * this one admits in-order subsequences and matches on `status`, and the index
 * admits bounded typos and reads updates and progress. So the two answers to one
 * box can differ, and whose answer is on screen is a question the page answers
 * once (`searchEngine`) rather than a distinction a row could draw.
 */

import { PROJECTS_SEARCH_MAX_CHARS } from "../../../../shared/desktop-contract";
import type {
	DesktopProject,
	DesktopProjectSearchHit,
} from "../../../../shared/desktop-control-contract";
import { projectDisplayName } from "./project-model";

/**
 * THE ONE STRING BOTH ENGINES ARE ASKED, and the reason it is a function rather
 * than a slice at each call site.
 *
 * The route bounds `q` at {@link PROJECTS_SEARCH_MAX_CHARS}, and the box carries
 * no `maxLength` because a paste must be SEARCHED rather than silently dropped.
 * So the bound is applied by cutting the string here, once — and the SAME string
 * has to reach the client matcher, or the two engines answer different
 * questions: a 300-character paste would be searched in full by the fallback and
 * in its first 256 characters by the index, and the list would change the moment
 * the index's answer landed, for a reason that has nothing to do with the store.
 * That was review round 1's MINOR-2, and the fix is this function plus every
 * caller using it: the hook asks it and the page's fallback ranks it.
 *
 * Trimmed as well as cut, because the route's own empty-`q` arm is not a search
 * and the box's whitespace is not a question. The result is what the echo is
 * compared against, so the gate, the wire and the fallback cannot disagree.
 */
export function projectsSearchQuery(box: string): string {
	return box.trim().slice(0, PROJECTS_SEARCH_MAX_CHARS);
}

/**
 * The NO-MATCH subline, PER ENGINE — because one sentence cannot be true of
 * both and the shipped one was only ever true of the fallback.
 *
 * "Update text is not searched" is a fact about THIS module: `updates[]` and the
 * progress snippet are detail-only on the wire, so a query ranked here can never
 * reach them. The backend's index reads both. So the sentence is not a string
 * used under two engines, it is each engine's own statement about what it
 * searched, and the block that renders it asks which engine produced the empty
 * result rather than guessing (`projects-page.tsx`'s `searchEngine`).
 *
 * WHAT STAYS SHARED IS THE SECOND CLAIM — "Clearing the search and filters
 * restores the list" — because both engines are the same box over the same
 * listing: an empty result under either is undone by the same clear.
 *
 * Neither sentence enumerates its engine's fields exhaustively, and neither
 * claims to: each names the fields a reader would look for, so neither is false
 * about the fields it does not name (the client engine also matches on `status`,
 * the index on the project id).
 */
export const SEARCH_SUBLINE: Record<"client" | "backend", string> = {
	client:
		"Searches names, descriptions, tags, owners and teams. Update text is not searched. Clearing the search and filters restores the list.",
	backend:
		"Searches names, descriptions, tags, owners, teams and update text. Clearing the search and filters restores the list.",
};

/**
 * The `projects` capability version that advertises the derived search index
 * and the timeline document (`routes/capabilities.py`: `"projects": 2`).
 *
 * ONE number for the two new reads, stated where the client matcher lives so a
 * reader of either engine sees the gate beside the fallback it gates. Version 1
 * is every backend that can serve the tab at all; a version-1 client never asks
 * for either read, which is what makes the bump additive rather than a second
 * capability key (the backend's own register argues the same split).
 */
export const PROJECTS_SEARCH_MIN_VERSION = 2;

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

/**
 * The rows a backend answer names, in the ANSWER's own rank order.
 *
 * The wire carries ids and ranks, not rows: the index ranks over the same store
 * the listing reads, so the client paints its own `DesktopProject` for each id
 * and the answer stays small. The order is taken as given and never re-sorted —
 * a hit's `score` is comparable within one answer only (the weights are
 * tunable server-side), so the order the backend put the rows in IS the ranking,
 * and re-deriving one here would be a second, disagreeing model.
 *
 * An id the listing does not hold is DROPPED rather than synthesized: this route
 * ranks over the store the listing just read, so an id with no row means the
 * store moved under the answer (a project deleted between the two reads), and
 * the honest rendering of that is one row fewer, not a constructed card.
 */
export function projectsForHits(
	rows: DesktopProject[],
	hits: Pick<DesktopProjectSearchHit, "id">[],
): DesktopProject[] {
	if (hits.length === 0) return [];
	const byId = new Map(rows.map((row) => [row.id, row]));
	const out: DesktopProject[] = [];
	for (const hit of hits) {
		const row = byId.get(hit.id);
		if (row !== undefined) out.push(row);
	}
	return out;
}
