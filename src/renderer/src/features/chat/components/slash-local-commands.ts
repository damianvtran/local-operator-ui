import type { SlashCommandMeta } from "./slash-commands";

/**
 * The ONE command the desktop owns rather than the backend catalogue.
 *
 * WHY THIS EXISTS AT ALL: `commands.list` is the shared slash registry
 * (`local_operator/slash_commands.py`), and every word the popup offers is one
 * of its rows — that is the rule `slash-commands.tsx` states at the top and the
 * reason a second React-side vocabulary was refused. `/tag` cannot obey it yet:
 * the backend has no such command and no desktop destination to carry one. The
 * tag store and its assignment API are merged and shipped, so the user-visible
 * capability exists with no slash spelling, and the operator requires exactly
 * that spelling in this client.
 *
 * It is therefore an ADDITIVE renderer row, injected only when the backend
 * advertises `session_tags` AND the pane addresses a conversation. It carries
 * no tag authority: the words, ids, order, primary and every write come from
 * `useChatTagAssignment` over `useSessionTagsStore`, the same surface the merged
 * dialog uses. Delete this row the day `commands.list` publishes a row with
 * destination `session.tags`; `withTagCommand` already defers to such a row
 * rather than shadowing it.
 *
 * The description reuses the audited `ui.chat.tags.label` key rather than
 * spending a new catalogue entry (and its independent audit) on one word the
 * command list can read without a new sentence.
 */
export function tagCommand(description: string): SlashCommandMeta {
	return {
		name: "tag",
		description,
		aliases: [],
		/*
		 * `optional` and `any`: `/tag work` is this command's argument, not
		 * prose, and `prefixes_text` says the same to the planner. The word list
		 * is empty because a tag name is not a closed vocabulary.
		 */
		arguments: "optional",
		echo: true,
		consumes_prompt: false,
		prefixes_text: true,
		argument_shape: "any",
		argument_words: [],
		destination: "session.tags",
		execution: "native",
	};
}

/**
 * The catalogue this pane should offer, with the renderer-owned `/tag` row
 * appended when it applies.
 *
 * Returns the INPUT array unchanged whenever the row does not apply, so a
 * backend without the tag store, or a pane with no conversation, cannot pay for
 * a second array identity in every memo keyed on the registry. A catalogue that
 * already names the destination wins: the local row must never shadow a real
 * backend command.
 */
export function withTagCommand(
	commands: SlashCommandMeta[],
	enabled: boolean,
	description: string,
): SlashCommandMeta[] {
	if (!enabled) return commands;
	if (
		commands.some(
			(command) =>
				command.name.toLowerCase() === "tag" ||
				command.destination === "session.tags",
		)
	)
		return commands;
	return [...commands, tagCommand(description)];
}
