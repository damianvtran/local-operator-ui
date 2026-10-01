/**
 * Which span of a draft is a `$skill` TOKEN rather than prose, for the
 * composer's syntax highlight.
 *
 * The `$` sibling of `slashHighlightRuns`, and deliberately a separate builder
 * rather than an arm inside it: the two sigils' rules differ in every dimension
 * that matters here. A slash run lives on the FIRST CONTENT LINE and starts
 * with `/`; a skill run is the LEADING token of the whole draft (whitespace-only
 * before it — `skillTokenIsLeading`'s rule, `skill-token.ts:108-110`) and may
 * sit after blank lines, which is why this scan has no first-content-line
 * restriction. The shared part is the OUTPUT: the same run object, so the
 * mirror keeps one pipeline (`segmentsOf`, `runInkClass`) and the two families
 * cannot drift into two painters.
 *
 * THE STATES, from spec-reconciliation.md §2 (the manager-ratified contract;
 * `design-spec.md` §1.1 carries the same classes):
 *
 *   - RESOLVED (`skill`): leading, and the name is an exact case-insensitive
 *     member of the SETTLED vocabulary. Paints even while the skill list is
 *     open on the token, because membership is a verdict, not a prefix — the
 *     list cannot change it. Extent is the RESOLVER's name class
 *     `[A-Za-z0-9][A-Za-z0-9._-]*` (`skill-invocation.ts`'s `INVOCATION_RE`,
 *     tracking `invoke.py:100`), which is the span the SUBMIT will fire:
 *     `$research,` inks `research` resolved (the comma is outside the class, so
 *     the invocation fires), while `$research.` inks `research.` attempted (the
 *     dot is IN the class, so the parse swallows it and the invocation does
 *     not fire). Both corners are pinned by `scripts/skill-highlight.test.mjs`
 *     so a later "fix" cannot silently flip an honesty call (UX U6).
 *   - NO INK while the list OWNS the token: an unresolved name under the open
 *     list is a prefix in progress, not a typo (the slash `picking`
 *     suppression, `slash-highlight.ts:84-88`, and UX U4b) — the dim arrives
 *     only after the list closes. A resolved name paints through.
 *   - NO INK while the answer cannot be believed: not settled (loading, or no
 *     vocabulary yet) or errored. `settled` folds both into one gate, because
 *     "do not flicker claims" is the same requirement in both states; the
 *     dim-at-rest must not flash while the load is in flight.
 *   - INERT (`skill-unknown`): leading, unresolved, the whole trimmed draft, a
 *     name carrying lowercase evidence (`$zzz` yes; `$5` and `$PATH` no —
 *     `skill-rank.ts`'s own inline-evidence rule, which is what keeps money and
 *     shell out). The whole-draft gate is load-bearing: in a longer sentence
 *     the same token could still be a sentence in progress, so it gets nothing.
 *   - NEUTRAL: everything else — money/shell, a `$` glued to its left context
 *     (`costs$5`, `a$b`), inline tokens in any state (only the anchor fires,
 *     `skill-invocation.ts:83-108`), and any token a slash context claims (a
 *     leading token cannot be claimed by construction: a claim needs a command
 *     word before it on the line, i.e. non-whitespace before the `$`).
 *
 * WHY THE CHARSET GATE IS NOT RE-TESTED: the design's `^[A-Za-z0-9._-]+$`
 * narrowing on the inert state is the extent's own definition here — the word
 * is read AS that class, greedily — so re-testing it would be a tautology. The
 * lowercase-evidence gate is the one the design lists that is NOT implied, and
 * it is read through `hasLowercaseEvidence` so this file and the picker cannot
 * disagree about what evidence is.
 *
 * Pure and I/O-free, like its sibling: the whole rule is executable in
 * `scripts/skill-highlight.test.mjs` on the code the app ships.
 */

import { hasLowercaseEvidence } from "./skill-rank";
import type { SlashHighlightRun } from "./slash-highlight";
import { pyTrim, pyTrimStart } from "./slash-token";

export type SkillHighlightArgs = {
	/** The draft the mirror paints, whole-buffer offsets. */
	draft: string;
	/** The vocabulary the popup reads — one answer, no second request. */
	vocabulary: readonly { name: string }[];
	/**
	 * Whether the vocabulary answer may be believed: the query has answered and
	 * is not in error. The caller folds "loading" and "errored" into this one
	 * flag — see the module note above.
	 */
	settled: boolean;
	/**
	 * Whether the skill list is open on the token. Suppresses the UNRESOLVED
	 * ink only; a resolved token paints through it.
	 */
	picking: boolean;
};

/** The first character of a resolvable name (`INVOCATION_RE`'s opening class). */
const NAME_START = /[A-Za-z0-9]/;
/** A name's continuation characters. */
const NAME_TAIL = /[A-Za-z0-9._-]/;

/**
 * The greedy `[A-Za-z0-9][A-Za-z0-9._-]*` run at `from`, or `null` when the
 * first character cannot start a name.
 *
 * Greedy on purpose, and the greedy read IS the resolver's: `parseSkillInvocation`
 * matches the same class with a trailing `*`, so `$research_extra` parses the
 * name `research_extra` (missing the vocabulary) rather than silently falling
 * back to `research` — the ink must mirror that swallow, not the shorter read.
 */
function nameExtent(draft: string, from: number): string | null {
	if (from >= draft.length || !NAME_START.test(draft[from])) return null;
	let end = from + 1;
	while (end < draft.length && NAME_TAIL.test(draft[end])) end++;
	return draft.slice(from, end);
}

export function skillHighlightRuns({
	draft,
	vocabulary,
	settled,
	picking,
}: SkillHighlightArgs): SlashHighlightRun[] {
	// Loading, no vocabulary yet, or errored: no claims at all, and no dim
	// flash while the read is in flight.
	if (!settled) return [];
	/*
	 * LEADING means whitespace-only before the token. Reading it as the length
	 * of the leading separator run — `draft.length - pyTrimStart(draft).length`,
	 * the same shape `firstContentLine` measures its start with — is the same
	 * question `skillTokenIsLeading` asks by `pyTrim`, with the offset in hand
	 * instead of a token; a character before the `$` that is not a Python
	 * separator makes the first non-separator position land elsewhere, so glued
	 * money (`costs$5`) and inline tokens (`fix this $research`) fail here for
	 * the same reason.
	 */
	const start = draft.length - pyTrimStart(draft).length;
	if (draft[start] !== "$") return [];
	const word = nameExtent(draft, start + 1);
	// A bare `$` (and `$-foo`): no name to judge. The picker may still open on
	// it; the ink has nothing to claim.
	if (word === null) return [];
	const end = start + 1 + word.length;
	const resolved = vocabulary.some(
		(row) => row.name.toLowerCase() === word.toLowerCase(),
	);
	if (resolved) return [{ start, end, kind: "skill" }];
	// Unresolved under the open list: a prefix in progress, not a typo.
	if (picking) return [];
	// The whole-draft gate: a token with text after it could be a sentence in
	// progress, so its inertness is not yet a fact.
	if (pyTrim(draft) !== draft.slice(start, end)) return [];
	// Lowercase evidence — the one gate the extent does not imply. `$ZZZ` and
	// `$5` stay unpainted; `$zzz` dims.
	if (!hasLowercaseEvidence(word)) return [];
	return [{ start, end, kind: "skill-unknown" }];
}
