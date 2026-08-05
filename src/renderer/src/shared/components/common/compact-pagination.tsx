/**
 * Page stepper for the sidebars.
 *
 * Sticky, and always rendered even at one page, so paging does not shift the
 * list under the pointer.
 *
 * A `hairline` top edge and no shadow: the bar has not left the flow, it is
 * pinned inside it, and the rule is what says "the list continues above this".
 * The old `0 -2px 8px rgba(0,0,0,.15)` was doing the same job twice.
 */

import { Button } from "@shared/components/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { FC } from "react";

/**
 * Props for the CompactPagination component
 */
type CompactPaginationProps = {
	/** Current page number */
	page: number;
	/** Total number of pages */
	count: number;
	/** Callback for page change */
	onChange: (page: number) => void;
};

/**
 * Compact Pagination Component
 *
 * A sleek, minimal pagination component designed for sidebars
 */
export const CompactPagination: FC<CompactPaginationProps> = ({
	page,
	count,
	onChange,
}) => {
	const handlePrevious = () => {
		if (page > 1) {
			onChange(page - 1);
		}
	};

	const handleNext = () => {
		if (page < count) {
			onChange(page + 1);
		}
	};
	/* One page is not a pagination state - the chrome renders "Page 1 of 1"
	   between two dead arrows, which is a control that can only tell the reader
	   it has nothing to do. The list is the whole content in that case, so the
	   bar takes its 52px back. */
	if (count <= 1) return null;

	return (
		<div className="sticky bottom-0 left-0 right-0 z-10 flex min-h-13 items-center justify-between border-t border-hairline bg-surface px-4 py-2">
			<Button
				variant="ghost"
				size="icon-sm"
				onClick={handlePrevious}
				disabled={page <= 1}
				aria-label="Previous page"
			>
				<ChevronLeft />
			</Button>

			<span className="select-none text-meta text-ink-dim">
				Page {page} of {count}
			</span>

			<Button
				variant="ghost"
				size="icon-sm"
				onClick={handleNext}
				disabled={page >= count}
				aria-label="Next page"
			>
				<ChevronRight />
			</Button>
		</div>
	);
};
