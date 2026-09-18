/**
 * @file publication-validation.ts
 * @description What the publish dialog can refuse itself, before it submits.
 *
 * Three checks, in the order the contract asks for them (§6.3): the document's
 * own shape, the names the local built-ins reserve, and — from the dialog, since
 * it is a network round trip — whether the hub already holds the name. Only the
 * first two live here, because they are pure: every rule is the hub's own,
 * imported from the desktop contract rather than restated, so a refusal this
 * layer shows and a refusal the hub returns are the same sentence about the same
 * field.
 *
 * Nothing here is authoritative. The hub is, and it may refuse a document this
 * layer accepted (a name taken a second ago, a category not in its enum); what
 * this layer buys is that the common refusals are visible while the field is
 * still editable, instead of after a round trip and a moderation review.
 */

import {
	publicationDescriptionRule,
	publicationInstructionsRule,
	publicationNameKey,
	publicationNameRule,
	publicationToolsRule,
} from "../../../../../shared/desktop-contract";

/** A document field the dialog can name as blocked. */
export type PublicationField =
	| "name"
	| "description"
	| "instructions"
	| "tools";

/** One reason the dialog will not submit, and the field it belongs to. */
export type PublicationIssue = {
	field: PublicationField;
	/**
	 * The sentence the blocked-field list shows.
	 *
	 * Built from the field's label and the hub's own rule text, so a user reading
	 * "The instruction body must be at most 8000 characters." here and the hub's
	 * refusal of the same document reads one rule rather than two.
	 */
	message: string;
};

/**
 * The agent fields the publish path reads, as the dialog sees them.
 *
 * These are the fields the local backend puts in the document, so a check that
 * does not have them cannot say whether the publication is publishable.
 * `instructions` is nullable because it is fetched separately from the agent's
 * `system_prompt.md`: while it is loading (or if that read failed) the dialog
 * cannot check the body, and it says so rather than pretending the body is fine.
 */
export type PublicationDraft = {
	name: string;
	description: string;
	instructions: string | null;
	tools: readonly string[] | null;
};

/** How each field is named in a sentence a person reads. */
const FIELD_LABEL: Record<PublicationField, string> = {
	name: "Name",
	description: "Description",
	instructions: "The instruction body",
	tools: "Tools",
};

/**
 * Every reason the document as it stands cannot be published.
 *
 * All of them, not the first: the dialog disables its submit button and shows
 * WHY, and a list that revealed one problem per attempt would make an agent with
 * two short fields take two opens to diagnose.
 */
export function publicationIssues(draft: PublicationDraft): PublicationIssue[] {
	const issues: PublicationIssue[] = [];
	const add = (field: PublicationField, rule: string | null) => {
		if (rule) issues.push({ field, message: `${FIELD_LABEL[field]} ${rule}.` });
	};
	add("name", publicationNameRule(draft.name));
	add("description", publicationDescriptionRule(draft.description));
	// `null` is "not known yet", which is not a violation: the hub still checks the
	// body, and refusing to submit because a separate read has not come back would
	// block a publish the hub would accept.
	if (draft.instructions !== null)
		add("instructions", publicationInstructionsRule(draft.instructions));
	add("tools", publicationToolsRule(draft.tools ?? []));
	return issues;
}

/**
 * Whether a name belongs to a built-in agent, checked without a network call.
 *
 * The hub reserves the built-ins' names (contract §5.4), and the same list is
 * already on this machine: `profiles.list` includes the built-in rows, which is
 * the list the server reserves from. So the reservation is answered before the
 * user ever submits, and — unlike the availability check — it is answered
 * offline, in the state where the app has no credential at all.
 *
 * Compared by `name_key`, not by exact string, for the reason the hub compares
 * that way: `Reviewer` and `reviewer` are one reserved name, and a client check
 * stricter or looser than the server's is a bug report either way.
 */
export function isReservedBuiltinName(
	name: string,
	builtinNames: readonly string[],
): boolean {
	const key = publicationNameKey(name);
	return builtinNames.some((builtin) => publicationNameKey(builtin) === key);
}

/**
 * The tool surface an agent row will publish, decoded from its tags.
 *
 * The local registry carries `tools:`/`effort:`/`delegate:` in the agent's tags
 * as `key:value` (`profile_from_agent`, `agent_profiles.py:354-395`) because
 * `AgentData` is a persisted, API-exposed model shared with the desktop UI, and a
 * column would force a migration on every reader of it. That encoding is also why
 * the publication path strips those keys from the published `tags` and puts them
 * in the document's own fields — this decode mirrors the same split, so the tools
 * the dialog checks are the tools that will be published.
 *
 * `null` means "no tool surface stated", which is what an absent `tools:` tag
 * means locally, and it is not the same as an empty list: an explicit empty list
 * is treated as unset upstream (a child with no tools can do nothing).
 */
export function toolsFromAgentTags(
	tags: readonly string[] | null | undefined,
): string[] | null {
	for (const tag of tags ?? []) {
		// The first colon splits the pair, exactly as the registry reads it: a tool
		// name carrying its own colon must not be able to move the split.
		const separator = tag.indexOf(":");
		if (separator < 0) continue;
		if (tag.slice(0, separator).trim().toLowerCase() !== "tools") continue;
		const tools = tag
			.slice(separator + 1)
			.split(",")
			.map((tool) => tool.trim())
			.filter(Boolean);
		return tools.length > 0 ? tools : null;
	}
	return null;
}

/**
 * The local agent this name would land beside, or `null` when it is free.
 *
 * The same question the hub's duplicate check asks, asked of the local registry:
 * a pulled agent whose name some row here already holds is a SECOND row for one
 * name, and the resolver then picks between them by nothing the user can see.
 * Local lookup is exact and case-sensitive, so this compares `name_key`s instead
 * — `Coder` beside `coder` is exactly the collision that is invisible today.
 *
 * Returns the name it collided with, because that is what the message has to
 * quote: "you already have an agent called \"Coder\"" is actionable, "the name
 * is taken" is not.
 */
export function localNameCollision(
	name: string,
	existingNames: readonly string[],
): string | null {
	const key = publicationNameKey(name);
	return (
		existingNames.find((existing) => publicationNameKey(existing) === key) ??
		null
	);
}
