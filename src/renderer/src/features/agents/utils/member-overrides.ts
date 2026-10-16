/**
 * The team member model override: its vocabulary, its wire mapping, and the
 * capability probe's verdict.
 *
 * WHY THIS IS A MODULE RATHER THAN CODE IN `team-detail.tsx`. Three of these
 * facts are decisions rather than rendering - which words the wire accepts, what
 * "inherit" means when it is written, and whether an absent `/effective` route
 * hides the controls or reports a failure - and a decision that lives inside a
 * component is one a test can only reach by mounting the page. They are the
 * three the model-override PR is judged on, so they are plain functions.
 *
 * WHAT IS NOT HERE: any copy. Every sentence the operator reads comes from the
 * catalogue (`t()`), and this module returns the KEY for a reading's layer
 * rather than a label, so a new layer word cannot ship as an untranslated
 * literal.
 */

import { backendErrorKind } from "@shared/api/local-operator/backend-error";
import type {
	MemberEffort,
	MemberTier,
	TeamEffective,
	TeamEffectiveEffortSource,
	TeamEffectiveMember,
	TeamEffectiveModelSource,
	TeamEffectiveSource,
	TeamMember,
} from "@shared/api/local-operator/profile-hooks";
import type { WithoutParams } from "../../../../../i18n/keys.gen";

/**
 * The tier words the wire and the tier map share (`CANONICAL_EFFORT_TIERS`).
 *
 * A MODEL tier, not a reasoning effort - the same three words the agent row's
 * `effort:<tier>` tag carries, which is what makes the two layers comparable.
 */
export const MEMBER_TIERS: readonly MemberTier[] = ["lo", "med", "hi"];

/**
 * The reasoning efforts a slot may name (`TIER_EFFORTS` on the backend):
 * `auto` plus the ladder.
 *
 * `auto` sits in this list because it is a VALUE - "use the model's own
 * default" - while clearing the field is a different act with a different name
 * (`INHERIT`). Collapsing the two is the mistake this vocabulary exists to
 * prevent: a team on tier `hi` that wants the model's default rather than the
 * tier map's `xhigh` has no other way to say so.
 */
export const MEMBER_EFFORTS: readonly MemberEffort[] = [
	"auto",
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

/** The select's own word for "no override on this layer". */
export const INHERIT = "inherit";

/** What a select shows for a field the wire left absent or null. */
export function overrideChoice(value: string | null | undefined): string {
	return value ?? INHERIT;
}

/**
 * What a tier select's choice writes to the wire.
 *
 * `inherit` becomes `null`, which the backend accepts as the same thing an
 * omitted key means. Deliberately not `undefined`: a null keeps the field PRESENT
 * in the payload, so clearing an override is an explicit act on a roster that
 * `members` replaces wholesale, and a reviewer reading the request can see the
 * difference between "cleared" and "never mentioned".
 */
export function tierOverrideValue(choice: string): MemberTier | null {
	return choice === INHERIT ? null : (choice as MemberTier);
}

/** The effort half of `tierOverrideValue`, whose vocabulary is longer. */
export function effortOverrideValue(choice: string): MemberEffort | null {
	return choice === INHERIT ? null : (choice as MemberEffort);
}

/** One slot's override, as the form holds it, applied to a wire member. */
export function withOverride<T extends TeamMember>(
	member: T,
	patch: { tier?: string; effort?: string },
): T {
	/*
	 * GENERIC OVER THE ROW, because the form's rows carry a `key` of their own and
	 * a function that returned a plain `TeamMember` would drop it - which the
	 * compiler caught as a `MemberRow` no longer being one.
	 */
	return {
		...member,
		...(patch.tier === undefined
			? {}
			: { tier: tierOverrideValue(patch.tier) }),
		...(patch.effort === undefined
			? {}
			: { effort: effortOverrideValue(patch.effort) }),
	};
}

/**
 * The reading for one slot of a team, or null when the route did not name it.
 *
 * MATCHED ON (kind, casefolded role), which is the key the backend itself
 * collapses a roster by (`parse_members`) - so a reading cannot be attributed to
 * the wrong slot of a team whose roster names two rows the same way. Null is a
 * real answer and not an error: an older server, or a member added since the
 * read, simply has no reading, and the caller renders the rest.
 */
export function effectiveFor(
	effective: TeamEffective | undefined,
	member: Pick<TeamMember, "kind" | "role">,
): TeamEffectiveMember | null {
	const wanted = `${member.kind}\u0000${member.role.toLocaleLowerCase()}`;
	return (
		(effective?.members ?? []).find(
			(reading) =>
				`${reading.kind}\u0000${reading.role.toLocaleLowerCase()}` === wanted,
		) ?? null
	);
}

/*
 * The catalogue keys for a reading's layer, one per `source` word.
 *
 * KEYED BY THE WIRE'S OWN LITERAL UNIONS rather than by a string, so a source
 * the backend adds later is a type error here instead of an empty label on
 * screen - the same reason `TeamEffectiveMember`'s sources are unions.
 */
const TIER_SOURCE_KEY: Record<TeamEffectiveSource, WithoutParams> = {
	team: "ui.agents.models.source.team",
	row: "ui.agents.models.source.row",
	none: "ui.agents.models.source.none",
};
const MODEL_SOURCE_KEY: Record<TeamEffectiveModelSource, WithoutParams> = {
	tier: "ui.agents.models.source.tier",
	session: "ui.agents.models.source.session",
};
const EFFORT_SOURCE_KEY: Record<TeamEffectiveEffortSource, WithoutParams> = {
	team: "ui.agents.models.source.team",
	tier: "ui.agents.models.source.tier",
	model_default: "ui.agents.models.source.model_default",
};

export const tierSourceKey = (source: TeamEffectiveSource): WithoutParams =>
	TIER_SOURCE_KEY[source];
export const modelSourceKey = (
	source: TeamEffectiveModelSource,
): WithoutParams => MODEL_SOURCE_KEY[source];
export const effortSourceKey = (
	source: TeamEffectiveEffortSource,
): WithoutParams => EFFORT_SOURCE_KEY[source];

/**
 * Whether the editor may offer per-member overrides at all.
 *
 * THE PROBE IS THE POINT, and its direction is the whole decision. A 404 on
 * `/effective` means the running backend predates the route - `backendErrorKind`
 * classifies that status as `outdated` - so it also ignores the member keys on a
 * write: an override editor there would be a control whose value is discarded in
 * silence, which is exactly the "didn't save" confusion this feature exists to
 * end. Every OTHER failure keeps the controls: a backend that is down, wedged or
 * refusing this app's bearer has not said anything about the route, and hiding a
 * working affordance on a transient error is the opposite mistake.
 */
export function overrideEditorVisible(failure: unknown): boolean {
	return backendErrorKind(failure) !== "outdated";
}
