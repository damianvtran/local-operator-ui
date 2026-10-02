import { cn } from "@shared/lib/utils";
import type { FC } from "react";

/**
 * The one indeterminate-progress affordance in the app.
 *
 * It exists because `CircularProgress` appeared in 39 files, each picking its
 * own `size` and `thickness`, so "waiting" looked like four different states
 * depending on which screen you were on. Four sizes, no other knobs.
 *
 * ## Announcing, or deliberately not
 *
 * A bare spinning div announces nothing, so `label` is not decoration: passing
 * it makes the spinner a live region with visually-hidden text, which is the
 * only thing a screen reader can read. Omitting it marks the element
 * `aria-hidden` instead — correct when the spinner sits beside text that
 * already says "Checking for updates", because a labelled spinner there
 * announces the same fact twice.
 *
 * So: standalone spinner -> pass `label`. Spinner inside a button or beside its
 * own caption -> omit it.
 *
 * ## Paint
 *
 * The ring is a `control` track with a single `accent` quadrant rather than
 * a full accent ring: a full ring reads as a filled shape at small sizes,
 * and the gap is what makes the rotation legible. Borders rather than an SVG
 * arc, so there is nothing to colour outside the role palette.
 *
 * THE TRACK IS `control` AND NOT `hairline` (design round 1 on the
 * composer's acknowledgment, D3). `hairline` is the decorative line: it owes
 * being seen and carries no floor at all, and the three decorative quarters
 * of this ring measured 1.23:1 on `localOperatorDark` and 1.44:1 on
 * `localOperatorLight` - a progress affordance whose whole visible shape sat
 * below the 3:1 non-text floor. `control` is the role this system gives that
 * floor to ("the sole visual boundary of an input, select, checkbox, or
 * outlined button. Floor 3:1 on all four grounds" - branding § 2), and the
 * contract row that asserts it is `CONTROLS` in `scripts/contrast-contract.mjs`.
 *
 * The role is set HERE rather than by a call site, and that is measured rather
 * than stylistic: `cn` merges the track and the quadrant as one border-colour
 * group, so a caller passing a stronger track (`border-control`) silently
 * flattened the accent quadrant too - the ring came back `#837c6d` on both
 * sides, i.e. a circle with nothing visibly rotating in it.
 *
 * Under `prefers-reduced-motion` the global cap in `styles/index.css` freezes
 * the rotation. That is deliberate, and it is the other reason `label` carries
 * the meaning: when the animation is gone, the accessibility tree is all that
 * is left saying the app is busy.
 */
export type SpinnerProps = {
	/** Diameter step. Defaults to `md` (20px), the inline-with-body-text size. */
	size?: "xs" | "sm" | "md" | "lg";
	className?: string;
	/**
	 * What is loading, announced to assistive technology. Omit only when
	 * adjacent visible text already says it — the spinner is then hidden from
	 * the accessibility tree rather than left unnamed.
	 */
	label?: string;
};

const SIZES = {
	xs: "size-3.5 border",
	sm: "size-4 border",
	md: "size-5 border-2",
	lg: "size-8 border-2",
} as const;

const RING =
	"inline-block shrink-0 animate-spin rounded-full border-control border-t-accent";

export const Spinner: FC<SpinnerProps> = ({
	size = "md",
	className,
	label,
}) => {
	if (!label) {
		return (
			<span aria-hidden="true" className={cn(RING, SIZES[size], className)} />
		);
	}

	/*
	 * `role="status"` goes on the wrapper, not the ring, so the live region
	 * contains the text. On the ring itself the region would be empty and
	 * announce nothing on update.
	 */
	return (
		// biome-ignore lint/a11y/useSemanticElements: there is no semantic element for a live region that carries only hidden text; role=status on the wrapper is the pattern itself.
		<span role="status" className="inline-flex items-center">
			<span aria-hidden="true" className={cn(RING, SIZES[size], className)} />
			<span className="sr-only">{label}</span>
		</span>
	);
};

Spinner.displayName = "Spinner";
