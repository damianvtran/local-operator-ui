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
 */

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import type { FC } from "react";
import { BOARD_WINDOWS, type BoardWindow } from "../project-model";

export const BoardWindowSelect: FC<{
	value: BoardWindow;
	onChange: (value: BoardWindow) => void;
}> = ({ value, onChange }) => (
	<Select value={value} onValueChange={(next) => onChange(next as BoardWindow)}>
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
		<SelectContent>
			{BOARD_WINDOWS.map((entry) => (
				<SelectItem key={entry.value} value={entry.value}>
					{entry.label}
				</SelectItem>
			))}
		</SelectContent>
	</Select>
);
