import { cn } from "@shared/lib/utils";
import type { HTMLAttributes } from "react";

/**
 * Loading placeholder.
 *
 * `sunken` because a skeleton stands in for content, and content sits on
 * `surface`; the recessed step reads as an empty well rather than as a solid
 * block that might be real. The shared `placeholder` role keeps this solid
 * fallback, but becomes the derived selected-row ink step on covered glass:
 * an opaque sunken swatch would punch a hole through the loading pane.
 *
 * `animate-pulse-visible` keeps the existing shared 0.7 opacity floor. The
 * default Tailwind pulse reaches 0.5, which makes the glass placeholder step
 * disappear below its visibility budget even though its resting fill is safe.
 * This is an opacity animation, which is inside the motion budget,
 * and `styles/index.css` caps it under `prefers-reduced-motion` rather than
 * cancelling it — a cancelled pulse can strand the element at its transparent
 * keyframe, and an invisible skeleton is worse than a static one.
 */
export const Skeleton = ({
	className,
	...props
}: HTMLAttributes<HTMLDivElement>) => (
	<div
		data-glass-placeholder=""
		className={cn("animate-pulse-visible rounded-sm bg-placeholder", className)}
		{...props}
	/>
);
Skeleton.displayName = "Skeleton";
