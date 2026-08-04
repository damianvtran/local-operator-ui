/**
 * Internal reasoning — the fifth and least prominent tier of § 7.
 *
 * "This is the agent talking to itself, and showing it at prose weight is
 * the single biggest reason the app reads as technical." Reasoning is hidden
 * by default at the preference level: with `showAgentReasoning` off (the
 * default) this renders nothing at all — not even a collapsed disclosure,
 * which would still be chrome on every turn. With the preference on, the
 * content sits behind the quiet disclosure, closed by default.
 *
 * Covers all three reasoning carriers: the `thinking` field, and `plan` /
 * `reflection` turns. The label is call-site chosen so a reflection turn can
 * read "Reasoning" while a thinking field on an answer reads "Thinking".
 */

import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { MarkdownRenderer } from "../markdown-renderer";
import { Disclosure } from "./disclosure";

export type AgentReasoningProps = {
	/** Trigger label shown when the preference allows reasoning. */
	label?: string;
	/** The reasoning text. Empty or absent renders nothing. */
	content?: string;
};

export const AgentReasoning = ({
	label = "Reasoning",
	content,
}: AgentReasoningProps) => {
	const showAgentReasoning = useUiPreferencesStore(
		(state) => state.showAgentReasoning,
	);

	if (!showAgentReasoning || !content) {
		return null;
	}

	return (
		<Disclosure
			summary={<span className="text-ink-dim text-meta">{label}</span>}
			triggerClassName="min-h-6 py-0.5"
			contentClassName="ml-5 mt-1 border-hairline border-l-2 pl-3 pb-1"
		>
			<MarkdownRenderer content={content} />
		</Disclosure>
	);
};
