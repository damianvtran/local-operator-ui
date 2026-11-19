/**
 * The priority glyph (design.md § 0.4, § 4): signal bars, 3 filled = High,
 * 2 = Normal, 1 = Low, unfilled bars in `ink-disabled`, High drawn in `warning`.
 *
 * WHY BARS AND NOT A COLOUR. Priority has to read without colour: the bar
 * COUNT carries the level, the High chip carries the word, and the accessible
 * name states it. Colour is the redundant third cue. Strokes in `currentColor`
 * also survive forced-colours mode (design § 14).
 */
import { cn } from "@shared/lib/utils";
import type { FC } from "react";
import type { DesktopNotificationPriority } from "../../../../../shared/desktop-control-contract";

const FILLED: Record<DesktopNotificationPriority, number> = {
	high: 3,
	normal: 2,
	low: 1,
};

export const PriorityBars: FC<{
	priority: DesktopNotificationPriority;
	className?: string;
}> = ({ priority, className }) => {
	const filled = FILLED[priority];
	return (
		<svg
			width="14"
			height="12"
			viewBox="0 0 14 12"
			aria-hidden="true"
			data-priority-bars={priority}
			className={cn(
				"shrink-0",
				priority === "high" ? "text-warning" : "text-ink-dim",
				className,
			)}
		>
			{[0, 1, 2].map((index) => (
				<rect
					key={index}
					x={1 + index * 4.5}
					y={8 - index * 3.5}
					width="3"
					height={3 + index * 3.5}
					rx="0.75"
					className={index < filled ? "fill-current" : "fill-ink-disabled"}
				/>
			))}
		</svg>
	);
};
