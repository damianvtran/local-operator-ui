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
import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { MarkdownRenderer } from "../markdown-renderer";
import { formatDuration } from "./tool-row-model";
import { TraceGlyph } from "./trace-rail";

export type AgentReasoningProps = {
	/** Trigger label shown when the preference allows reasoning. */
	label?: string;
	/** The reasoning text. Empty or absent renders nothing. */
	content?: string;
	/**
	 * How long the thinking took, when the record carries one.
	 *
	 * §E4's whole point for a COLLAPSED line: `Thought for 12s` says something on
	 * its own, while a bare `Thought` says only that there was some. A live turn has
	 * no duration yet and passes nothing, which is the spec's `Thinking…` state.
	 *
	 * No call site supplies one today: the canonical record's `thinking` field
	 * carries the text and no clock, so the "for Ns" half is only reachable once a
	 * record reports one. Named on the PR rather than faked with a re-render timer,
	 * which would report the time the row has been MOUNTED as the time the agent
	 * thought.
	 */
	durationS?: number | null;
};

export const AgentReasoning = ({
	label = "Reasoning",
	content,
	durationS = null,
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
						{/*
						 * `text-body-sm`/13 rather than the `text-meta` step this carried:
						 * §E4 makes the reasoning line one of the transcript's ROWS, and a
						 * row's label is 13px (the ledger's own verbs moved off 12px in
						 * §E1 for the same reason). The ink stays `ink-dim` - this is the
						 * quietest tier of the hierarchy and it sits above every action.
						 */}
						<span className="text-ink-dim text-body-sm">
							{durationS !== null
								? `${label} for ${formatDuration(durationS)}`
								: label}
						</span>
					</span>
				</span>
			}
		>
			{/*
			 * Open, this has to stay quieter than the answer it sits under.
			 * Unwrapped, `MarkdownRenderer` renders at the answer's own register
			 * - 14px at full-strength ink, the same paint as the reply and the
			 * user's message, separated from them by nothing but the rail's
			 * 20px indent. That reads as a third voice of equal standing rather
			 * than as the agent's private thinking, which is the exact failure
			 * the docblock above names, and closed-by-default hid it rather
			 * than fixing it.
			 *
			 * `text-body-sm` on muted ink is what every other expanded row on
			 * this rail uses; the fifth tier of the hierarchy should not be the
			 * loudest thing a click can reveal.
			 */}
			{/*
			 * THE EXPANDED BODY TAKES `sunken` AT RADIUS 10 (§E4), where it used to be
			 * unboxed on the transcript's own ground.
			 *
			 * It was already muted at `text-body-sm`, which fixed the register - a
			 * private thought must not paint at the answer's own weight - but it left the
			 * body on the same ground as the prose above it, so opening the line produced
			 * a third voice on the page rather than a panel inside the row. `sunken` is
			 * the app's fourth ground and the one §E5 gives every machine payload;
			 * reasoning is the same kind of thing (the agent's own working, expanded on
			 * demand by the reader), two steps up the same hierarchy.
			 */}
			<div className={cn("rounded-md bg-sunken p-3")}>
				<MarkdownRenderer
					content={content}
					className="[--md-ink:var(--lo-ink-muted)]"
					styleProps={{
						fontSize: "var(--text-body-sm)",
						lineHeight: "var(--text-body-sm--line-height)",
					}}
				/>
			</div>
		</Disclosure>
	);
};
