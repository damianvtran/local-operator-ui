/**
 * Which spans of a draft are `$skill` TOKENS rather than prose, for the
 * composer's syntax highlight.
 *
 * The `$` sibling of `slashHighlightRuns`, and deliberately a separate builder
 * rather than an arm inside it: a slash run lives on the FIRST CONTENT LINE and
 * starts with `/`, while a skill token may sit anywhere a word boundary allows
 * and there may be several in one draft. The shared part is the OUTPUT: the
 * same run object, so the mirror keeps one pipeline (`segmentsOf`,
 * `runInkClass`) and the two families cannot drift into two painters.
 *
 * THE TRIGGER IS THE SUBMIT'S OWN. `planSkillMentions` (the desktop port of
 * `sigils.skill_mentions` plus `plan_attachments`' block idempotence) decides
 * which tokens fire — boundary, name class, trailing-punctuation trim, case
 * rule, dedupe and already-attached names all included — so a token
 * cannot be painted resolved here and be prose at Enter. That is the whole
 * reason this file does not re-derive the grammar: the previous version read
 * only the leading token, and an inline `$research` that the send now expands
 * would otherwise stay unpainted.
 *
 * THE STATES, from spec-reconciliation.md §2 (the manager-ratified contract;
 * `design-spec.md` §1.1 carries the same classes):
 *
 *   - RESOLVED (`skill`): a mention the plan accepts, ANYWHERE in the
 *     draft. Paints even while the skill list is open on the token, because
 *     membership is a verdict, not a prefix — the list cannot change it. Extent
 *     is the resolver's: `$research,` inks `research` resolved (the comma is
 *     outside the name class) while `$research.` now inks `research` too,
 *     because the resolver trims the trailing dot and fires; the dot stays
 *     prose. Both corners are pinned by `scripts/skill-highlight.test.mjs`.
 *   - NO INK while the list OWNS the token: an unresolved token under the open
 *     list is a prefix in progress, not a typo (the slash `picking`
 *     suppression, `slash-highlight.ts:84-88`, and UX U4b) — the dim arrives
 *     only after the list closes. A resolved name paints through.
 *   - NO INK while the answer cannot be believed: not settled (loading, or no
 *     vocabulary yet) or errored. `settled` folds both into one gate, because
 *     "do not flicker claims" is the same requirement in both states; the
 *     dim-at-rest must not flash while the load is in flight.
 *   - INERT (`skill-unknown`): unresolved, and the token IS the whole trimmed
 *     draft, and it carries lowercase evidence (`$zzz` yes; `$5` and `$PATH` no
 *     — `skill-rank.ts`'s own inline-evidence rule, which is what keeps money
 *     and shell out). The whole-draft gate is load-bearing: in a longer
 *     sentence the same token could still be a sentence in progress, so it gets
 *     nothing. This is the TUI's own inert rule
 *     (`widgets/editor.py:_compute_skill_runs`).
 * - Neutral: everything else — money/shell, and a `$` glued to its left
 *   context (`costs$5`, `a$b`), which the boundary rule never returns as a
 *   token at all.
 *
 * WHAT IS DELIBERATELY NOT HERE: a slash claim. The desktop's picker suppresses
 * the `$` list whenever a slash context is live at the caret
 * (`skill-picker.tsx`), but that is a property of the CARET, not of the text —
 * the TUI's own scan region has no desktop equivalent because the desktop's
 * slash arguments live in dialogs rather than composer text. The submit-side
 * trigger reads the whole message with no slash exemption
 * (`local_operator/sigils.py` has none either), so the ink must not invent one:
 * painting `/team delivery $research` resolved is honest, because Enter does
 * expand it.
 *
 * Pure and I/O-free, like its sibling: the whole rule is executable in
 * `scripts/skill-highlight.test.mjs` on the code the app ships.
 */

import { planSkillMentions, skillNameSpans } from "./skill-invocation";
import { hasLowercaseEvidence } from "./skill-rank";
import type { SlashHighlightRun } from "./slash-highlight";
import { pyTrim } from "./slash-token";

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
	 * The PLAN, not the raw mentions: a token inside a block that arrived with
	 * the draft will not attach at submit, and a name the block already carries
	 * will not attach a second time. Painting either resolved would be an ink
	 * claim the send does not honour — the same reason this file reads the
	 * submit's trigger at all.
	 */
	const mentions = planSkillMentions(
		draft,
		vocabulary.map((row) => row.name),
	);
	const runs: SlashHighlightRun[] = mentions.map((mention) => ({
		start: mention.start,
		end: mention.end,
		kind: "skill",
	}));
	// Unresolved under the open list: a prefix in progress, not a typo.
	if (picking) return runs;
	/*
	 * The inert pass reads the raw spans, because the plan only returns
	 * tokens that resolve. A token whose start the trigger accepted is skipped
	 * so the two inks cannot paint the same characters.
	 */
	const resolvedStarts = new Set(mentions.map((mention) => mention.start));
	const trimmed = pyTrim(draft);
	for (const span of skillNameSpans(draft)) {
		if (resolvedStarts.has(span.start)) continue;
		// The whole-draft gate: a token with text around it could be a sentence
		// in progress, so its inertness is not yet a fact.
		if (draft.slice(span.start, span.end) !== trimmed) continue;
		// Lowercase evidence — the one gate the extent does not imply. `$ZZZ`
		// and `$5` stay unpainted; `$zzz` dims.
		if (!hasLowercaseEvidence(span.name)) continue;
		runs.push({ start: span.start, end: span.end, kind: "skill-unknown" });
	}
	return runs;
}
