/**
 * The detail page's inline editing, as a pure model: the per-field rules the
 * wire will enforce, checked before any request; the changed-fields
 * computation the estimate row needs (it edits two wire fields as one); and
 * the refusal sentences for the replies a project write can get back.
 *
 * WHY IT IS A MODULE rather than closures inside `project-editors.tsx`, the
 * same reason `project-model.ts` gives: a rule stated as a pure function over
 * wire shapes can be bundled and executed by
 * `scripts/projects-inline-edit.test.mjs` in Node, so the sentence a reader
 * sees beside a field and the sentence the test pins are the same code. The
 * create sheet's own validate() was the surface these rules lived in; it now
 * reads them from here, because the detail edits field-by-field and a second
 * copy of "Titles are at most 80 characters" would be the defect.
 *
 * THE RULES ARE THE WIRE'S, NOT INVENTIONS: every bound here is the bound the
 * request schema in `shared/desktop-contract.ts` validates, and `projectKey`
 * reuses `projectNameRule` and `projectTagRule` directly rather than
 * re-spelling the grammar. What is deliberately NOT here: anything the backend
 * owns as a STATE question (a name already taken, a row written by a newer
 * build, the done-gate against the milestone list) — those stay refusals with
 * the backend's own words, rendered beside the field.
 */

import {
	PROJECT_DESCRIPTION_MAX_CHARS,
	projectTagRule,
} from "../../../../shared/desktop-contract";
import type { ProjectEditFields } from "./hooks/use-projects-queries";
import { PROJECT_DAY_FIELD_PATTERN, refusalCopy } from "./project-model";

/** The comma text a tags field holds, as the wire's list. Moved here from the
 * create sheet (`parseProjectTags`), which is now one of its two callers: the
 * inline tags editor and the create form must split the same way, or a paste
 * into one would differ from a paste into the other. */
export function parseProjectTags(raw: string): string[] {
	return raw
		.split(",")
		.map((tag) => tag.trim())
		.filter((tag) => tag.length > 0);
}

/** The store's `TITLE_MAX`, said where a field can name it. */
export const PROJECT_TITLE_MAX_CHARS = 80;

/** The store's tag cap (`≤8 tags`); the grammar lives in `projectTagRule`. */
export const PROJECT_TAGS_MAX = 8;

/** A title is free text, capped as the wire caps it. `""` clears it. */
export function projectTitleRule(title: string): string | null {
	if (title.trim().length > PROJECT_TITLE_MAX_CHARS)
		return `Titles are at most ${PROJECT_TITLE_MAX_CHARS} characters.`;
	return null;
}

/** The description's one local rule; the counter in the editor reads the same cap. */
export function projectDescriptionRule(description: string): string | null {
	if (description.length > PROJECT_DESCRIPTION_MAX_CHARS)
		return `Keep the description within ${PROJECT_DESCRIPTION_MAX_CHARS} characters.`;
	return null;
}

/**
 * The owner/team attribution rule: the same 80-character ceiling the wire
 * enforces (`ATTRIBUTION_MAX`), said in the field rather than after a round
 * trip. Newlines are not checked - the wire trims and accepts short
 * single-line labels, and a stray newline in a label is a refusal the
 * backend's own sentence explains better than one invented here (the create
 * sheet's own rule, moved here).
 */
export function projectAttributionRule(
	value: string,
	field: "owner" | "team",
): string | null {
	if (value.trim().length > 80)
		return `${field === "owner" ? "Owners" : "Teams"} are at most 80 characters.`;
	return null;
}

/** One planning date: `YYYY-MM-DD`, or empty to clear. */
export function projectDateFieldRule(day: string): string | null {
	if (!PROJECT_DAY_FIELD_PATTERN.test(day))
		return "Dates are YYYY-MM-DD, or empty.";
	return null;
}

/**
 * The pair rule, checked from EITHER date's editor: both fields are on screen,
 * both are edited one at a time, and a save that made the range backwards is
 * refused by the backend ('target_date must not precede start_date') — so it
 * is refused here first, beside the field that moved.
 */
export function projectDateOrderRule(
	startDate: string,
	targetDate: string,
): string | null {
	if (startDate && targetDate && targetDate < startDate)
		return "The target date is before the start date.";
	return null;
}

/**
 * The estimate number as an editor holds it: a string that may be empty.
 *
 * AN EMPTIED NUMBER IS NOT A CLEAR. The backend's edit model merges an
 * estimate only when one is present (`if fields.estimate is not None`), so a
 * client cannot return the field to "unknown"; the sheet has said so since
 * review round 1 and this rule keeps the same honesty. `""` is therefore
 * VALID (the save will keep the current value), and only a non-empty value
 * that is not a number in `(0, 1000]` is refused.
 */
export function projectEstimateNumberRule(number: string): string | null {
	const trimmed = number.trim();
	if (trimmed === "") return null;
	const value = Number(trimmed);
	if (!Number.isFinite(value) || !(value > 0) || value > 1000)
		return "Estimates are greater than 0 and at most 1000.";
	return null;
}

/** The tags field, parsed and checked: the list to send, or the sentence. */
export function projectTagsFieldRule(raw: string): {
	tags: string[];
	error: string | null;
} {
	const tags = parseProjectTags(raw);
	if (tags.length > PROJECT_TAGS_MAX)
		return { tags, error: `Up to ${PROJECT_TAGS_MAX} tags.` };
	for (const tag of tags) {
		const error = projectTagRule(tag);
		if (error) return { tags, error };
	}
	return { tags, error: null };
}

/** The store's own conflict category, declared on the wire (`detail.code`). */
export const PROJECT_NAME_CONFLICT_CODE = "project_name_exists";

/**
 * A refused project write, as the sentence to show beside the field.
 *
 * The name conflict gets the app's crafted sentence because the backend's own
 * is `project 'x' already exists` - true but addressed to a caller sending a
 * create, while the reader here renamed a Key field. 422 sentences pass
 * through `refusalCopy`, which re-speaks the done-gate tail (the `force_done`
 * door this surface has no key to). Anything else is shown as written; an
 * empty message falls back to the app's own sentence rather than nothing.
 */
export function projectRefusalCopy(input: {
	code?: string | null;
	message: string;
}): string {
	if (input.code === PROJECT_NAME_CONFLICT_CODE)
		return "A project with this key already exists.";
	return refusalCopy(input.message) || "The project was not saved.";
}

/** The estimate row's editing value: a number text and its unit together. */
export type ProjectEstimateDraft = {
	number: string;
	unit: "points" | "days";
};

/** The record's own shape for the same row. */
export type ProjectEstimateBase = {
	estimate: number | null;
	unit: string;
};

/**
 * The estimate row's draft identity, for the machine's dirty derivation: the
 * draft LIST compares unit-for-unit, and a number compares by VALUE (so
 * "13.0" is not a change from "13") with one exception - an EMPTIED number
 * reads as "keep the current value" (the rule above), so it equals whatever
 * it is compared against. That exception is what makes the field close
 * quietly on blur instead of claiming a save the wire cannot make, with the
 * editor's hint having already said why.
 */
export function estimateDraftEquals(
	a: ProjectEstimateDraft,
	b: ProjectEstimateDraft,
): boolean {
	if (a.unit !== b.unit) return false;
	const left = a.number.trim();
	const right = b.number.trim();
	if (left === "" || right === "") return true;
	return Number(left) === Number(right);
}

/**
 * The tags row's draft identity: the draft LIST against the record's list, so
 * a whitespace-only edit ("q4, payments" -> "q4,payments") is unchanged and
 * the machine sends no request - the wire's own no-op rule, applied before the
 * wire - while a real change is a change.
 */
export function tagsDraftEquals(baseTags: string[], raw: string): boolean {
	const draft = parseProjectTags(raw);
	if (draft.length !== baseTags.length) return false;
	return draft.every((tag, index) => tag === baseTags[index]);
}

/**
 * The changed-fields computation for the estimate row, and the ONLY place the
 * detail sends two keys for one edit. Unit-only changes travel alone (`the
 * wire can carry a unit on its own` - `estimate_unit` merges independently),
 * a changed number travels with no unit unless the unit also moved, and an
 * emptied number contributes nothing at all.
 *
 * `null` means the draft asks for no write; the caller resolves without a
 * request, which is the same "no request when unchanged" rule the machine
 * applies to every other field.
 */
export function estimateChangedFields(
	base: ProjectEstimateBase,
	draft: ProjectEstimateDraft,
): ProjectEditFields | null {
	const fields: ProjectEditFields = {};
	const trimmed = draft.number.trim();
	if (trimmed !== "") {
		const value = Number(trimmed);
		if (base.estimate === null || base.estimate !== value)
			fields.estimate = value;
	}
	if (draft.unit !== base.unit) fields.estimate_unit = draft.unit;
	return Object.keys(fields).length > 0 ? fields : null;
}
