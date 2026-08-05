import type { FC } from "react";

type RadientMarkProps = {
	/** Rendered size in pixels. Matches the lucide `size` prop. */
	size?: string | number;
	className?: string;
};

/**
 * The Radient mark as a monochrome outline glyph.
 *
 * The brand asset is a full-colour isometric cube: two light-blue faces, a
 * near-black top face, and a seven-node graph drawn inside it in three more
 * blues. That is five tones and about twenty shapes, and it was being rendered
 * at 16-20px in the settings rail, the settings section heading and the command
 * palette — rows where every other glyph is a one-colour lucide outline. At
 * that size the detail collapses: it read as a navy blob among outlines, which
 * made the one row it marked the loudest thing in the list and told the reader
 * nothing about what the row was.
 *
 * So the small sizes get a drawing made for them rather than a photograph
 * shrunk. It keeps what survives: the hexagonal cube silhouette and the radial
 * hub inside it. It is drawn on lucide's own grid — 24 units, 2-unit stroke,
 * round caps and joins, `currentColor` — so it takes the row's ink colour and
 * its active state like every glyph beside it, and needs no size fudge to sit
 * on the same optical line.
 *
 * The full-colour asset stays where its detail is legible: the onboarding
 * choice card at 40px and the low-credits dialog at 28 and 120.
 */
export const RadientMark: FC<RadientMarkProps> = ({
	size = 24, // px when numeric
	className,
}) => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth={2}
		strokeLinecap="round"
		strokeLinejoin="round"
		className={className}
		aria-hidden="true"
	>
		{/* The cube, read straight on: a pointy-top hexagon. */}
		<path d="M12 2 20.7 7 20.7 17 12 22 3.3 17 3.3 7Z" />
		{/* Six spokes from one hub, stopping short of the edge so the shape
		    still has air in it at 14px. */}
		<path d="M12 12V6.2" />
		<path d="m12 12 5-2.9" />
		<path d="m12 12 5 2.9" />
		<path d="M12 12v5.8" />
		<path d="m12 12-5 2.9" />
		<path d="m12 12-5-2.9" />
	</svg>
);
