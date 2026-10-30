/**
 * The SHIPPED agent's one-line description, as this app reads it and says it.
 *
 * WHY THIS MODULE EXISTS. The description of a packaged agent travels inside the
 * agent DEFINITION (`local_operator/agent_seeds/*.md` frontmatter, projected by
 * the seed manifest), not in a catalogue: the backend serves `description` as
 * metadata, so a fully translated Agents page printed twelve English sentences
 * and every coverage checker called the screen complete, because no UI key was
 * ever involved. Shipped descriptions are product copy and must localize through
 * the catalogue like any other rendered sentence.
 *
 * TWO SENTENCES, NOT ONE, and that is the defect this module now names. The
 * registry keeps a single `description` field per profile, and install writes
 * the seed's ROUTING text into it (`when_to_use`), not the blurb: that field is
 * what `search` embeds and matches against, so persisting the blurb made an
 * installed role undiscoverable (local_operator/agent_profiles.py, the
 * `_fields` comment beside the write). Every shipped seed carries a
 * `when_to_use`, so an INSTALLED seed serves the routing sentence while an
 * UNINSTALLED one serves the blurb - two families, two key sets, one field. A
 * resolver that only knew the blurb keyed every pristine built-in row and
 * dropped every installed one back to English, which is exactly what happened:
 * installing an agent visibly un-translated its card.
 *
 * THE OTHER HALF IS A CONSTRAINT, NOT A SIDE NOTE. The same field carries what
 * the OPERATOR wrote: an uploaded agent's description, and an installed agent's
 * description after somebody edited it, is user data and must render exactly as
 * written - never translated, never replaced by shipped copy. So this module
 * answers "is this string still a shipped sentence, for a shipped identity?"
 * and only then reads a catalogue:
 *
 *  1. the row's registry NAME is one of the twelve seeds. Identity comes from the
 *     name rather than from `seed_origin` because a rename by the operator drops
 *     the backend's provenance tag (it validates the tag against the row's own
 *     name), and `source` alone cannot tell an installed-then-edited row from a
 *     pristine one - `installed` covers both.
 *  2. its description is the shipped English sentence of one of its two
 *     families, IDENTICAL UP TO WHITESPACE RUNS (both sides are folded by
 *     `comparable()`; nothing else is forgiven). This is the
 *     load-bearing check: the description is editable after install, so a
 *     touched sentence stops matching and falls back to raw, which is the safe
 *     direction for anything an operator may have typed.
 *  3. only `source` "builtin" and "installed" may resolve a key. "custom" is
 *     refused outright - an uploaded agent is the operator's own text even in
 *     the corner case where it repeats a seed's sentence word for word - and so
 *     is a row whose `source` is missing or is a value this module has never
 *     heard of: the rule fails CLOSED, so a row of unknown provenance cannot
 *     borrow the shipped-copy path by omission (agent review round 2, R2-2).
 *
 * THE ENGLISH CATALOGUE IS THE ORACLE, never a second copy of the strings. The
 * comparison reads `bundledEnglish`, which the generator builds from the same
 * catalogue a translator edits, so a shipped sentence cannot drift from its key
 * silently: if the seed text changes and the catalogue does not, the match fails
 * and the row renders its raw English (visible, not wrong) instead of a stale
 * translation of a sentence nobody ships any more.
 *
 * THE MATCH IS FUZZY ONLY ABOUT WHITESPACE. The seed prose is authored in YAML
 * frontmatter and reaches this app through a projection, so a folded line or a
 * trailing space is a transport artefact rather than a different sentence;
 * collapsing whitespace on BOTH sides buys that tolerance without letting a
 * reworded sentence through. Nothing else is normalised - case, punctuation and
 * wording are the identity this check is built on.
 *
 * NOTHING HERE TOUCHES THE INSTRUCTIONS BODY. The prompt beside the description
 * is model-facing and stays English (see `docs/I18N.md`: technical and
 * model-facing documentation stays English; rendered product copy is keyed).
 */

import type { ReusableProfile } from "@shared/api/local-operator/profile-hooks";
import { t } from "@shared/i18n";
import type { WithoutParams } from "@shared/i18n";
import { bundledEnglish } from "../../../../../i18n/keys.gen";

/**
 * Seed id (its registry name, which is also the file stem in the core's
 * `agent_seeds/`) to the key that now owns its shipped description.
 *
 * `WithoutParams` rather than `MessageKey` validates two things at once: the key
 * exists, and it takes no arguments - these sentences carry no placeholders, so
 * a future one that did would fail this declaration rather than silently render
 * braces.
 */
export const SEED_DESCRIPTION_KEYS = {
	aida: "ui.agents.descriptions.aida",
	architect: "ui.agents.descriptions.architect",
	coder: "ui.agents.descriptions.coder",
	"copy-reviewer": "ui.agents.descriptions.copy_reviewer",
	designer: "ui.agents.descriptions.designer",
	librarian: "ui.agents.descriptions.librarian",
	manager: "ui.agents.descriptions.manager",
	"qa-tester": "ui.agents.descriptions.qa_tester",
	reviewer: "ui.agents.descriptions.reviewer",
	scout: "ui.agents.descriptions.scout",
	"tui-designer": "ui.agents.descriptions.tui_designer",
	"ux-reviewer": "ui.agents.descriptions.ux_reviewer",
} as const satisfies Record<string, WithoutParams>;

/** The seed names the map knows. */
export type SeedAgentName = keyof typeof SEED_DESCRIPTION_KEYS;

/**
 * Seed id to the key that owns its shipped ROUTING sentence - the `when_to_use`
 * text the registry stores as a profile's `description` on install.
 *
 * The same twelve names as `SEED_DESCRIPTION_KEYS`, deliberately a second map
 * rather than a tuple per seed: each family is a namespace of its own for the
 * translators, and a seed that gains one family without the other is then a
 * one-line diff instead of a shape change. `WithoutParams` carries the same
 * two guarantees as its sibling.
 *
 * NOT EVERY INSTALLED ROW IS HERE EITHER: a row the operator edited stops
 * matching, and the routing text is what search embeds, so an edit to it is a
 * row whose discoverability the operator chose to change.
 */
export const SEED_ROUTING_KEYS = {
	aida: "ui.agents.routing.aida",
	architect: "ui.agents.routing.architect",
	coder: "ui.agents.routing.coder",
	"copy-reviewer": "ui.agents.routing.copy_reviewer",
	designer: "ui.agents.routing.designer",
	librarian: "ui.agents.routing.librarian",
	manager: "ui.agents.routing.manager",
	"qa-tester": "ui.agents.routing.qa_tester",
	reviewer: "ui.agents.routing.reviewer",
	scout: "ui.agents.routing.scout",
	"tui-designer": "ui.agents.routing.tui_designer",
	"ux-reviewer": "ui.agents.routing.ux_reviewer",
} as const satisfies Record<string, WithoutParams>;

/**
 * The fields the decision reads.
 *
 * `source` is typed `string | null | undefined` because two call sites read
 * untyped wire rows (the session's `commands.entities` agent arm, the composer's
 * `/agent` list) where the field is present at runtime but not in the type. That
 * is safe ONLY because the resolver fails closed: a missing or unrecognised
 * `source` resolves to no key and the raw text renders, so a caller that cannot
 * say whether a row is user text (`AgentDetails` rows carry no provenance) still
 * never borrows the shipped-copy path by omission.
 *
 * `description` tolerates a null/absent value because the wire does: the roster
 * and the detail pane used to spell `|| ""` at their call sites, and the one
 * place that owns the rule is now the return below rather than three callers.
 */
export type DescribedAgent = Pick<ReusableProfile, "name"> & {
	source?: string | null;
	description?: string | null;
};

/**
 * The form both comparisons use: the sentence with every run of whitespace
 * folded to one space and the ends trimmed, or `null` for a value that is not a
 * string at all.
 *
 * WHY NORMALISE. The shipped prose is authored in the core's YAML frontmatter
 * and arrives through a seed projection and a registry row, so a folded line
 * between two words is a transport artefact, not a different sentence. Collapsing
 * whitespace tolerates that without loosening anything that carries meaning; the
 * `typeof` guard closes the other trap, where `undefined === undefined` would
 * match a row whose description is absent against a catalogue entry that does
 * not exist.
 *
 * BOTH FAMILIES GO THROUGH IT - one helper, one rule, so a future third family
 * cannot arrive with a subtly different notion of "the same sentence".
 */
function comparable(text: string | null | undefined): string | null {
	return typeof text === "string" ? text.replace(/\s+/g, " ").trim() : null;
}

/**
 * The catalogue key whose English value is this row's shipped sentence, or
 * `null` when the row is not a pristine shipped seed (the caller renders the raw
 * string).
 *
 * WHICH FAMILY. A row serves exactly one of the two sentences, so the answer is
 * whichever one it serves: the blurb for a seed that was never installed, the
 * routing text for one that was. A seed whose two sentences are identical (none
 * today) resolves to its DESCRIPTION key, which is the family an uninstalled row
 * serves and therefore the one a reader of the seed sees first; either key would
 * print the same sentence in every locale, so the tie only decides which
 * namespace the row is attributed to.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: it does not decide from the name alone.
 * Identity up to whitespace runs is the whole safeguard for a row the operator may have rewritten,
 * so an installed seed with an edited description - including one edited to
 * exactly the routing text another reader would call "shipped" - renders as
 * written unless the edit reproduces the shipped sentence character for
 * character. That is the same trade the single-family check made, now made once
 * per family.
 */
export function seedTextKey(profile: DescribedAgent): WithoutParams | null {
	/* Allow-list, not a deny-list: only the two sources that can hold a pristine
	 * seed resolve. `custom` (an upload) and anything absent or unknown stay raw. */
	if (profile.source !== "builtin" && profile.source !== "installed") {
		return null;
	}
	const served = comparable(profile.description);
	if (served === null) return null;
	const name = profile.name as SeedAgentName;
	/* The two families in precedence order: description first (see above). The
	 * `Record` cast is the lookup's honest type - a row may carry any name, and the
	 * map's own `as const` shape would claim every name is present. */
	const families = [
		(SEED_DESCRIPTION_KEYS as Record<string, WithoutParams>)[name],
		(SEED_ROUTING_KEYS as Record<string, WithoutParams>)[name],
	];
	for (const key of families) {
		if (key !== undefined && comparable(bundledEnglish[key]) === served) {
			return key;
		}
	}
	return null;
}

/**
 * What the roster row, its tooltip and the detail pane print for `profile`: the
 * catalogue's sentence for a pristine shipped seed, the raw description for
 * everything else - and therefore the operator's own words, untouched, for a
 * user-uploaded or edited agent.
 *
 * Reads `t()` at CALL time, so a language switch repaints wherever the caller
 * already re-renders (`useI18nLocale()` on the Agents page and the detail pane).
 */
export function agentDescriptionText(profile: DescribedAgent): string {
	const key = seedTextKey(profile);
	return key === null ? (profile.description ?? "") : t(key);
}

/**
 * `row` with its `description` replaced by what `agentDescriptionText` prints,
 * for a picker whose rows are registry projections (`value` is the slug, `name`
 * may be absent on a thin row), such as the in-session `/agent` picker fed by
 * `commands.entities`. Everything else on the row passes through.
 */
export function withAgentDescriptionText<
	T extends {
		value: string;
		name?: string;
		source?: string | null;
		description?: string | null;
	},
>(row: T): T {
	return {
		...row,
		description: agentDescriptionText({
			name: row.name ?? row.value,
			source: row.source,
			description: row.description,
		}),
	};
}
