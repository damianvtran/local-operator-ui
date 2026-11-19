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
 * THE SURFACE RULE, AND WHY IT IS NOT THE TUI'S. `planSkillMentions` decides
 * WHAT fires; `expands` decides WHERE a fire is possible on this host, and the
 * two are separate because the hosts differ. Enter on `/team delivery
 * $research` hands the argument to `sessions.command`; the backend admits the
 * receipt's request itself, and the composer's submit seam — the only place
 * that expands a skill — never runs. The TUI closes that split with
 * `command_picker.skill_scan_region` plus `SKILL_SUBMIT_COMMANDS`: it expands
 * the argument tail of `/team`, `/agent`, `/goal` and `/aida` as its own
 * prompt. The desktop cannot port that faithfully. `/goal`'s argument is ALSO
 * the stored goal text, so appending a block would mutate a durable operand;
 * `/team` and `/agent` are admitted from a receipt the renderer does not
 * compose; `/aida` sends through a branch with no skill plan. Expanding a
 * command OPERAND is not the same act as expanding the message the composer
 * sends, so the honest fallback is: no ink on a draft Enter dispatches as a
 * command. The caller supplies `expands` from the same slash planner Enter
 * uses, so the paint and the key cannot disagree.
 *
 * A leading slash word that is NOT a dispatchable command is prose on the
 * desktop — the planner answers `send` and the text reaches the submit seam —
 * so its mentions still paint, exactly as the TUI's `skill_scan_region`
 * returns the whole buffer for the same shape.
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
	/**
	 * Whether Enter SENDS this draft as a message — the one surface on this
	 * host where a `$name` expands. Read from the same slash planner the Enter
	 * key reads; a draft that dispatches a command paints no skill ink.
	 */
	expands: boolean;
};

export function skillHighlightRuns({
	draft,
	vocabulary,
	settled,
	picking,
	expands,
}: SkillHighlightArgs): SlashHighlightRun[] {
	// Loading, no vocabulary yet, or errored: no claims at all, and no dim
	// flash while the read is in flight. `expands` is the surface gate: a
	// slash command's line never reaches the seam that expands a skill.
	if (!settled || !expands) return [];
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
