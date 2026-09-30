/**
 * The board's time-window control: the model's ladder drawn as a Select.
 *
 * WHY A SELECT AND NOT A SECOND SEGMENTED CONTROL: the view switcher beside it
 * chooses a MODE (list / board / timeline) the reader moves between, while the
 * window is a VALUE picked off a named ladder - the app's compact-value idiom
 * for that shape (an `aria-label` and a fixed width, no visible label:
 * `text-style-dropdown.tsx`, the schedules dialog's repeat unit). Five rungs
 * as a segmented row would read as a second view switcher, and at the
 * window's 800px floor it would squeeze the switcher it sits beside.
 *
 * THE TRIGGER'S WIDTH IS FIXED (`w-36`), overriding the primitive's `w-full`:
 * the row's left half is the switcher, and a full-width trigger would swallow
 * it. `w-36` is wide enough for the longest rung ("Last 24 hours"); the
 * trigger's own `[&>span]:truncate` is the primitive's overflow answer if a
 * future label outgrows it.
 *
 * The panel is the shipped Select panel (elevated, one shadow, the check on
 * the current item), and the keyboard behaviour - arrows, typeahead, Escape -
 * is the Radix combobox's, unchanged; no bespoke overlay styling rides along.
 *
 * THE PANEL DOES NOT EXPLAIN THE WINDOW, SO A TOOLTIP DOES (design round 1,
 * D1). The trigger shows the rung's label and nothing else, and the board is
 * then free to contradict it - a frame reading "Last 24 hours" above a card
 * whose own progress line says "reported 12d ago" reads as a broken filter
 * rather than as a stale report, so the sentence says what the window IS: a
 * filter on the project's own update, and that older rows are HIDDEN rather
 * than absent. On the app's one tooltip primitive, which opens on hover and on
 * FOCUS, so the dimension is reachable without the pointer.
 */

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@shared/components/ui";
import { Tooltip } from "@shared/components/ui/tooltip";
import { cn } from "@shared/lib/utils";
import type { FC } from "react";
import { BOARD_WINDOWS, type BoardWindow } from "../project-model";

/**
 * What the window control is filtering on. Exported so the story and the rig
 * read the same sentence the panel paints.
 */
export const BOARD_WINDOW_HINT =
	"Shows projects last updated within this window; older ones are hidden.";

export const BoardWindowSelect: FC<{
	value: BoardWindow;
	onChange: (value: BoardWindow) => void;
}> = ({ value, onChange }) => (
	<Select value={value} onValueChange={(next) => onChange(next as BoardWindow)}>
		<Tooltip
			/*
			 * NULL AT THE FULL LADDER (design round 2, D6). The sentence says older
			 * rows are HIDDEN, and at `all` nothing is: the panel was still claiming a
			 * filter the board had stopped applying (visible in the `board-window-
			 * widened` frame, where "Show all time" had just handed the caret back to
			 * this control). The primitive renders `children` alone for a null
			 * `content`, so the control stays - only the claim goes.
			 */
			content={value === "all" ? null : BOARD_WINDOW_HINT}
			side="bottom"
			/*
			 * CLOSES ON LEAVE, the same rule the card title's tooltip carries (QA round
			 * 1, Q1): the primitive's default waits for the pointer to enter the panel
			 * to close it, and these panels are `pointer-events: none`, so a hint about
			 * a control the pointer left would stay painted over the board. Escape and
			 * blur still dismiss it.
			 */
			disableHoverableContent
		>
			<SelectTrigger
				aria-label="Projects updated within"
				/*
				 * `cn`, not a bare className: the primitive's base carries `w-full`,
				 * and only tailwind-merge (which `cn` registers the app's scales
				 * with) can drop it in favour of the fixed width.
				 */
				className={cn("w-36 shrink-0")}
				data-tour-tag="projects-board-window"
			>
				<SelectValue />
			</SelectTrigger>
		</Tooltip>
		<SelectContent>
			{BOARD_WINDOWS.map((entry) => (
				<SelectItem key={entry.value} value={entry.value}>
					{entry.label}
				</SelectItem>
			))}
		</SelectContent>
	</Select>
);
