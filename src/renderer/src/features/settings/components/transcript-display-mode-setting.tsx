/**
 * The transcript display-mode setting: a labelled row whose control is the
 * app's own segmented one (`Tabs`/`TabsList`/`TabsTrigger`, the shape
 * `projects-view-switcher.tsx` uses for its view choice) rather than a bespoke
 * pair of buttons, so selection reads as the same lightness step as every other
 * segmented control and arrow keys move within the group for free.
 *
 * WHY A ROW COMPONENT AND NOT ANOTHER `ToggleSetting`. The choice has two or more
 * values rather than a boolean, and the row's geometry — label and description on
 * the left, control on the right, borderless and margin-free so the section's
 * `gap` owns the spacing — is `ToggleSetting`'s for the same reasons its doc gives.
 * The control sits in a fixed-height box, as `ToggleSetting`'s does, so a longer
 * label in another theme cannot reflow the row.
 *
 * THE DESCRIPTION STATES THE SCOPE, which is half of what the issue asks for:
 * this preference changes how *responses* are drawn, and the neighbouring
 * `showAgentReasoning` switch hides *reasoning* only — mid-turn narration the
 * agent writes as prose is transcript content, not reasoning, so it is never
 * REMOVED by either mode: `by turn` folds it behind the turn's bars (the shipped
 * condensation), `by response` keeps it on screen. Stating the fold is the point
 * — "neither mode hides it" would be the opposite claim, and the transcript
 * would contradict the very sentence that describes it.
 *
 * THE VISIBLE LABEL NAMES THE CONTROL (agent review round 1, n5). The row's own
 * text is what a reader sees; naming the tablist by it with `aria-labelledby` - an
 * id from `useId` rather than a prop, because there is exactly one such row per
 * settings page and a caller-supplied id was a knob nobody ever turned - is what
 * makes the control announced as "Transcript display" instead of by a duplicate
 * `aria-label` that could drift from the visible words.
 */

import {
	TRANSCRIPT_DISPLAY_MODE_OPTIONS,
	type TranscriptDisplayMode,
	parseTranscriptDisplayMode,
} from "@features/chat/transcript-display-mode";
import { Tabs, TabsList, TabsTrigger } from "@shared/components/ui";
import { type FC, useId } from "react";

type TranscriptDisplayModeSettingProps = {
	/** The active mode. */
	value: TranscriptDisplayMode;

	/** Called with the mode the reader chose. */
	onChange: (mode: TranscriptDisplayMode) => void;
};

export const TranscriptDisplayModeSetting: FC<
	TranscriptDisplayModeSettingProps
> = ({ value, onChange }) => {
	const labelId = useId();
	return (
		<div className="flex items-start justify-between gap-4">
			<div className="min-w-0 flex-1">
				<span
					id={labelId}
					className="flex min-h-6 items-center text-body text-ink"
				>
					Transcript display
				</span>
				<p className="mt-0.5 max-w-2xl text-body-sm text-ink-muted">
					By turn condenses each turn to its answer. By response keeps every
					settled response on screen, with the turn's final answer still marked.
				</p>
			</div>
			{/* Fixed height, matching `ToggleSetting`: swapping control shapes between
			    modes must not move the row's own baseline. */}
			<div className="flex h-6 shrink-0 items-center">
				<Tabs
					value={value}
					/*
					 * The chosen token is PARSED on the way out, the same rule the header's
					 * submenu states (agent review round 1, m4): every writer of this field
					 * judges its value, so a control driven by a list that later gains or
					 * renames a value cannot write a token nothing understands.
					 */
					onValueChange={(next) => onChange(parseTranscriptDisplayMode(next))}
				>
					<TabsList aria-labelledby={labelId}>
						{TRANSCRIPT_DISPLAY_MODE_OPTIONS.map((option) => (
							<TabsTrigger key={option.value} value={option.value}>
								{option.label}
							</TabsTrigger>
						))}
					</TabsList>
				</Tabs>
			</div>
		</div>
	);
};
