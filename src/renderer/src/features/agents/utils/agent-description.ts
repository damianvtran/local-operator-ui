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
 * THE OTHER HALF IS A CONSTRAINT, NOT A SIDE NOTE. The same field carries what
 * the OPERATOR wrote: an uploaded agent's description, and an installed agent's
 * description after somebody edited it, is user data and must render exactly as
 * written - never translated, never replaced by shipped copy. So this module
 * answers "is this string still the shipped sentence, for a shipped identity?"
 * and only then reads a catalogue:
 *
 *  1. the row's registry NAME is one of the twelve seeds. Identity comes from the
 *     name rather than from `seed_origin` because a rename by the operator drops
 *     the backend's provenance tag (it validates the tag against the row's own
 *     name), and `source` alone cannot tell an installed-then-edited row from a
 *     pristine one - `installed` covers both.
 *  2. its description is BYTE-IDENTICAL to the English catalogue value. This is
 *     the load-bearing check: the description is editable after install, so a
 *     touched sentence stops matching and falls back to raw, which is the safe
 *     direction for anything an operator may have typed.
 *  3. `source === "custom"` is refused outright: an uploaded agent is the
 *     operator's own text even in the corner case where it repeats a seed's
 *     sentence word for word.
 *
 * THE ENGLISH CATALOGUE IS THE ORACLE, never a second copy of the strings. The
 * comparison reads `bundledEnglish`, which the generator builds from the same
 * catalogue a translator edits, so a shipped description cannot drift from its
 * key silently: if the seed text changes and the catalogue does not, the match
 * fails and the row renders its raw English (visible, not wrong) instead of a
 * stale translation of a sentence nobody ships any more.
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
 * The fields the decision reads.
 *
 * `source` is REQUIRED, and deliberately not optional-with-a-default: a caller
 * that cannot say whether a row is user text (`AgentDetails` rows carry no
 * provenance) must not borrow the shipped-copy path by omission.
 *
 * `description` tolerates a null/absent value because the wire does: the roster
 * and the detail pane used to spell `|| ""` at their call sites, and the one
 * place that owns the rule is now the return below rather than three callers.
 */
export type DescribedAgent = Pick<ReusableProfile, "name" | "source"> & {
	description?: string | null;
};

/**
 * The catalogue key whose English value is this row's shipped description, or
 * `null` when the row is not a pristine shipped seed (the caller renders the raw
 * string).
 */
export function seedDescriptionKey(
	profile: DescribedAgent,
): WithoutParams | null {
	if (profile.source === "custom") return null;
	const key = SEED_DESCRIPTION_KEYS[profile.name as SeedAgentName] ?? null;
	if (key === null) return null;
	return bundledEnglish[key] === profile.description ? key : null;
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
	const key = seedDescriptionKey(profile);
	return key === null ? (profile.description ?? "") : t(key);
}
