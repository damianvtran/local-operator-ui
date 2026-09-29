import { Button } from "@shared/components/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type FC, useEffect, useRef } from "react";

/**
 * The hub grid's page footer.
 *
 * ## Why this is not `CompactPagination`
 *
 * `CompactPagination` is the SIDEBAR's stepper: a 52px sticky bar whose two
 * ghost icon buttons sit at opposite ends of a column 280px wide. Dropped under a
 * 968px grid inside a shrink-wrapping `justify-center` wrapper it rendered as a
 * small off-centre box (a box narrower than the grid it pages, with a ground of
 * its own and two arrows a thumb apart) - the operator's report of 2026-09-29,
 * "the spacing is off on the buttons with the pagination". Widening the shared
 * component would change the sidebar it was written for, so the hub gets a
 * footer of its own and the sidebar's is untouched.
 *
 * ## The shape
 *
 * A hairline top edge across the content column (the grid's own width, not a
 * box), the reader's position at the start and the two steps grouped at the end.
 * The steps are the app's standard `secondary` button at `sm`, with the word
 * beside the chevron: a bare arrow is a target the size of a glyph, and "Next" is
 * what a reader is looking for. Hover is `secondary`'s own colour step, disabled
 * is its colour change (never opacity), and the focus ring is the global one.
 *
 * ## Constraints the caller relies on
 *
 * - `min-h-13` (52px) is the height the page's `agent-hub-pager-placeholder`
 *   reserves while the page count is unknown, so the settled footer does not move
 *   the grid a second time (design round 1, D1). Change one, change both.
 * - Absent at one page, for `CompactPagination`'s reason: "Page 1 of 1" between
 *   two dead buttons can only report that it has nothing to do.
 * - FOCUS SURVIVES A BOUNDARY (UX round 1, U1; QA round 1, Q2). Pressing Next on
 *   the second-to-last page disables the very button that holds focus, and the
 *   browser answers that by dropping focus on `<body>`: the next Tab restarts at
 *   the top of the window, about thirty stops from the pager. The press records
 *   which control it is about to disable and the effect below hands focus to the
 *   surviving sibling once the new page has committed - the same read-the-DOM-
 *   after-the-render hand-off the page's retry and clear-filter paths use.
 * - The accessible names stay "Previous page" / "Next page": the stories' plays
 *   and assistive tech address the buttons by them, and each contains its visible
 *   word, so speech control ("click Next") still finds them.
 */
export const HubPager: FC<{
	page: number;
	count: number;
	onChange: (page: number) => void;
}> = ({ page, count, onChange }) => {
	const previousRef = useRef<HTMLButtonElement>(null);
	const nextRef = useRef<HTMLButtonElement>(null);
	/** The sibling that should take focus once the pressed button has disabled. */
	const handOffRef = useRef<"previous" | "next" | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `page` is the trigger - the hand-off is read AFTER the page that disabled the button has rendered.
	useEffect(() => {
		const target = handOffRef.current;
		handOffRef.current = null;
		if (target === "previous") previousRef.current?.focus();
		if (target === "next") nextRef.current?.focus();
	}, [page]);

	if (count <= 1) return null;
	return (
		<nav
			aria-label="Agent pages"
			className="mt-6 flex min-h-13 items-center justify-between gap-3 border-t border-hairline"
			data-testid="agent-hub-pager"
		>
			<span className="select-none text-meta text-ink-dim">
				Page {page} of {count}
			</span>
			<div className="flex items-center gap-2">
				<Button
					variant="secondary"
					size="sm"
					ref={previousRef}
					onClick={() => {
						if (page - 1 <= 1) handOffRef.current = "next";
						onChange(page - 1);
					}}
					disabled={page <= 1}
					aria-label="Previous page"
				>
					<ChevronLeft aria-hidden="true" />
					Previous
				</Button>
				<Button
					variant="secondary"
					size="sm"
					ref={nextRef}
					onClick={() => {
						if (page + 1 >= count) handOffRef.current = "previous";
						onChange(page + 1);
					}}
					disabled={page >= count}
					aria-label="Next page"
				>
					Next
					<ChevronRight aria-hidden="true" />
				</Button>
			</div>
		</nav>
	);
};
