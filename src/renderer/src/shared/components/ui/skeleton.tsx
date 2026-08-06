import { cn } from "@shared/lib/utils";
import type { HTMLAttributes } from "react";

/**
 * Loading placeholder.
 *
 * `sunken` because a skeleton stands in for content, and content sits on
 * `surface`; the recessed step reads as an empty well rather than as a solid
 * block that might be real.
 *
 * `animate-pulse` is an opacity animation, which is inside the motion budget,
 * and `styles/index.css` caps it under `prefers-reduced-motion` rather than
 * cancelling it — a cancelled pulse can strand the element at its transparent
 * keyframe, and an invisible skeleton is worse than a static one.
 */
export const Skeleton = ({
	className,
	...props
}: HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn("animate-pulse rounded-sm bg-sunken", className)}
		{...props}
	/>
);
Skeleton.displayName = "Skeleton";
