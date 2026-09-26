import { cn } from "@shared/lib/utils";
import type { FC, ReactNode } from "react";

/**
 * Empty state panel for the canvas.
 *
 * An empty state that only reports emptiness is a dead end, so this one takes
 * the actions that would resolve it. The copy names what the user does next
 * rather than what is absent.
 *
 * IT IS A MODULE OF ITS OWN BECAUSE IT HAS TWO CALLERS, and that is design review
 * round 1's D7: the `Goals` viewer re-implemented this box with byte-identical
 * classes rather than importing it, because the pane that owned it is also the
 * module that imports the viewer — an import back the other way would be a cycle.
 * The pixels matched and the pane's one empty-state idiom still had two writers,
 * which is the drift the repo's one-idiom rule exists to prevent; the box moved
 * here so the second caller can import it instead of copying it.
 *
 * The description's measure is `max-w-80` (320px) rather than `max-w-72`. It was
 * 288px, which broke the documents view's two-line sentence into three with an
 * orphaned word at the dock's default width, and the difference is safe for the
 * other states this component renders: 320px of text plus this box's `p-6` is
 * 368px, inside the 400px minimum dock, so no canvas empty state can overflow the
 * panel it sits in.
 */
export const EmptyState: FC<{
	title: string;
	description: string;
	children?: ReactNode;
}> = ({ title, description, children }) => (
	<div
		className={cn(
			"flex h-full flex-col items-center justify-center gap-2 bg-canvas p-6 text-center",
		)}
	>
		<h3 className={cn("text-heading text-ink")}>{title}</h3>
		<p className={cn("max-w-80 text-body-sm text-ink-muted")}>{description}</p>
		{children ? (
			/*
			 * `w-full flex-wrap justify-center`: the actions WRAP rather than paint into
			 * this box's own `p-6`.
			 *
			 * At the dock's 400px floor the canvas empty states' three buttons measure
			 * 374px in a 351px content box, so the row was 13px and 12px from the pane's
			 * edges where the padding asks for 24 and 24 - the labels sitting on the
			 * padding, inside a `nowrap` row in an `overflow: hidden` pane, with 9px a
			 * side left at `Browse files (341)` and 4px at `Browse files (1,204)`. Full
			 * width and wrapping means the row gives something up (a second line) before
			 * the padding does, which is what every other panel in this dock does (UX
			 * round 1, U3).
			 */
			<div
				className={cn(
					"mt-2 flex w-full flex-wrap items-center justify-center gap-2",
				)}
			>
				{children}
			</div>
		) : null}
	</div>
);
