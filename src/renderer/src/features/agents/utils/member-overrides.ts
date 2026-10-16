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
 * One member's COMPARISON signature: an override cleared to `null` and one that was
 * never set are the same absence here.
 *
 * WHY THE NORMALISATION IS ONLY FOR COMPARISONS. `members` replaces the roster
 * wholesale, so the PAYLOAD keeps the difference - a cleared field is an explicit
 * act (`withOverride`) and a key that was never mentioned is not. But the FORM must
 * not read that difference as work: a slot set to `hi` and back to `Inherit` holds
 * `tier: null`, which `JSON.stringify` sees as different from an absent key, so the
 * editor claimed unsaved changes for a round trip that changes nothing on disk
 * (`None` overrides are dropped on the backend's own dump).
 *
 * The `key` is the form's own row id, never part of the write.
 */
export function memberSignature(member: TeamMember): string {
	const {
		tier,
		effort,
		key: _key,
		...rest
	} = member as TeamMember & {
		key?: string;
	};
	return JSON.stringify({
		...rest,
		...(tier ? { tier } : {}),
		...(effort ? { effort } : {}),
	});
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
 * The three states the override editor can be in, derived from the probe alone.
 *
 * `absent` is the silent one and covers both "this backend predates the route" and
 * "we have not established that it has one": an in-flight read, and a create form
 * whose catalogue has no team to probe with. Silence is right for those - there is
 * nothing the operator can act on - while the controls stay hidden, because a
 * control whose value is discarded in silence is the defect this probe exists to
 * prevent (M1: an absent team or a pending read used to render the controls).
 *
 * `unavailable` is the one that SPEAKS: the probe failed and the failure was not
 * the route's absence, which is worth a sentence because the pane is otherwise
 * silent about a feature that is not there.
 */
export type OverrideEditorState = "available" | "absent" | "unavailable";

/** Which of the three states a probe's own result puts the editor in. */
export function overrideEditorState(probe: {
	isSuccess: boolean;
	isError: boolean;
	error: unknown;
}): OverrideEditorState {
	if (probe.isSuccess) return "available";
	if (probe.isError && overrideEditorVisible(probe.error)) return "unavailable";
	return "absent";
}

/**
 * Whether a FAILED probe leaves the override editor in place.
 *
 * THE PROBE IS THE POINT, and its direction is the whole decision. A 404 on
 * `/effective` means the running backend predates the route - `backendErrorKind`
 * classifies that status as `outdated` - so it also ignores the member keys on a
 * write: an override editor there would be a control whose value is discarded in
 * silence, which is exactly the "didn't save" confusion this feature exists to
 * end. Every OTHER failure keeps the controls: a backend that is down, wedged or
 * refusing this app's bearer has not said anything about the route, and hiding a
 * working affordance on a transient error is the opposite mistake.
 *
 * A 404 IS NOT ALWAYS "NO ROUTE": the route raises `KeyError` for an unknown team,
 * and the server maps that to the same status (local-operator
 * `server/utils/desktop_profiles.py:team_effective`). So a team that vanished
 * under an open pane reads as an older server. The reading is the same either way
 * - do not offer overrides you cannot show the resolution of - which is why this
 * stays one verdict rather than a second probe.
 *
 * WHAT THIS DOES NOT DECIDE IS WHETHER THE CONTROLS ARE SHOWN AT ALL. That is
 * `isSuccess` on the query, because a failure is not the only state before the
 * answer: an in-flight probe and a create form with no team to probe have no
 * error and no capability, and "no error" must never read as "supported"
 * (see `overrideEditorState`). So a 500 does NOT leave the controls up either:
 * it hides them AND says so, with a retry beside the sentence, because a form
 * that quietly lost a row is worse than one that explains itself (QA round 1,
 * Q2 - this comment used to claim the opposite).
 */
export function overrideEditorVisible(failure: unknown): boolean {
	return backendErrorKind(failure) !== "outdated";
}
