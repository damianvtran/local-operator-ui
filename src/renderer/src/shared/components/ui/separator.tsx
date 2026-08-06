import { cn } from "@shared/lib/utils";
import { Separator as SeparatorPrimitive } from "radix-ui";
import {
	type ComponentPropsWithoutRef,
	type ElementRef,
	forwardRef,
} from "react";

/**
 * A rule between things.
 *
 * `hairline`, always: this is the decorative line role, the one with no
 * contrast floor, because a divider carries no information a sighted user
 * needs to read. If a line is the only thing telling someone where a control
 * begins, it is not a separator — it is `border-control` on that control.
 *
 * Defaults to `decorative`, which drops it from the accessibility tree. A
 * screen reader announcing "separator" between every settings row is noise.
 */
export const Separator = forwardRef<
	ElementRef<typeof SeparatorPrimitive.Root>,
	ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(
	(
		{ className, orientation = "horizontal", decorative = true, ...props },
		ref,
	) => (
		<SeparatorPrimitive.Root
			ref={ref}
			orientation={orientation}
			decorative={decorative}
			className={cn(
				"shrink-0 bg-hairline",
				orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
				className,
			)}
			{...props}
		/>
	),
);
Separator.displayName = "Separator";
