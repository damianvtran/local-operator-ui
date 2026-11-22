import { BrandMark } from "@shared/components/common/brand-mark";
import { useEffect, useRef } from "react";
import { trackNewChatHorizon } from "./new-chat-horizon-motion";
import "./new-chat-horizon.css";

const WIDTH = 640;
const HEIGHT = 160;
const ROWS = 16;
const COLUMNS = 48;
const INKS = [0.09, 0.2, 0.33, 0.49];

// Keep the curved horizon as four static paths, not hundreds of SVG nodes or
// a canvas that redraws when the mouse moves. Staggering the rows softens the
// grid; the quadratic spacing compresses the far points into a luminous belt.
const POINT_PATHS = INKS.map(() => [] as string[]);
for (let row = 0; row < ROWS; row += 1) {
	const depth = row / (ROWS - 1);
	for (let column = 0; column < COLUMNS; column += 1) {
		const side = ((column + (row % 2) * 0.5) / COLUMNS) * 2 - 1;
		const x = WIDTH / 2 + side * (251 + 66 * depth);
		const y = 56 + 14 * depth + 56 * depth ** 2 + (11 - 23 * depth) * side ** 2;
		const edge = (1 - Math.abs(side) ** 2) ** 1.8;
		// Feather the foreground out of the greeting's measure. The last dots
		// read as the curve's edges, not texture immediately below the mark.
		const clearCopy =
			1 - Math.max(0, (depth - 0.72) / 0.28) * (1 - Math.abs(side));
		const belt = Math.sin(Math.PI * depth) ** 0.72;
		const ink = edge * belt * clearCopy;
		if (ink < 0.1) continue;
		const level = Math.min(INKS.length - 1, Math.floor(ink * INKS.length));
		// A tiny stroke with round ends is a dot, while a single move/line pair
		// keeps each intensity band one paint primitive.
		POINT_PATHS[level].push(`M${x.toFixed(1)} ${y.toFixed(1)}h.01`);
	}
}
const STIPPLE = POINT_PATHS.map((points) => points.join(""));

export function NewChatHorizon({
	splash,
	quiet,
}: {
	splash: HTMLElement | null;
	quiet: boolean;
}) {
	const paint = useRef<SVGSVGElement>(null);
	useEffect(() => {
		if (!splash || !paint.current || quiet) return;
		return trackNewChatHorizon(splash, paint.current);
	}, [quiet, splash]);

	return (
		<div className="new-chat-horizon">
			<span
				className="new-chat-horizon__scene"
				data-quiet={quiet ? "" : undefined}
			>
				<svg
					ref={paint}
					aria-hidden="true"
					className="new-chat-horizon__paint"
					viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
					fill="none"
					stroke="currentColor"
					strokeLinecap="round"
				>
					{STIPPLE.map((path, index) => (
						<path
							key={INKS[index]}
							d={path}
							strokeOpacity={INKS[index]}
							strokeWidth={0.95 + index * 0.13}
						/>
					))}
				</svg>
			</span>
			{/* This selector is also how the first-send driver detects the splash.
			    The real shared mark stays still and below the greeting in ink weight. */}
			<span data-lo-empty-mark="" className="relative flex">
				<BrandMark className="size-12" tone="ink-muted" />
			</span>
		</div>
	);
}
