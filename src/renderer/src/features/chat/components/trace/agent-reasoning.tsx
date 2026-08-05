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
 *
 * The row sits on the trace column's rail like every other row: chevron,
 * then the identity slot, then the label. The identity slot is empty because
 * reasoning is not an action and there is nothing to name — the label's 12px
 * sans against the monospace action labels already says the row is a
 * different kind of thing. `trace-rail.tsx` has the reasoning for reserving
 * the box anyway.
 */

import { Disclosure } from "@shared/components/ui/disclosure";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { MarkdownRenderer } from "../markdown-renderer";
import { TraceGlyph } from "./trace-rail";

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
			summary={
				<span className="flex min-w-0 items-center gap-2">
					<TraceGlyph />
					{/* Same two-span shape as a trace row: the outer span inherits the
					 * 14px body strut so this row is the same height as the action
					 * rows beside it, the inner one carries the type step. */}
					<span className="truncate">
						<span className="text-ink-dim text-meta">{label}</span>
					</span>
				</span>
			}
		>
			<MarkdownRenderer content={content} />
		</Disclosure>
	);
};
