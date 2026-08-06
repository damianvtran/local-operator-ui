/**
 * The one disclosure idiom for agent work.
 *
 * docs/branding.md § 7: "Prefer one disclosure idiom app-wide. Two competing
 * expand/collapse patterns is a bug, not a style choice." This replaces both
 * former idioms — `ExpandableActionElement` (tinted card with a collapse bar)
 * and `CollapsibleMessage` ("Show technical details" in accent text) — and is
 * the only expander the trace hierarchy uses: tool detail, reasoning, and
 * security-check payload all sit behind it, closed by default.
 *
 * Deliberately minimal:
 * - The chevron swaps instantly rather than rotating: § 5 permits transform
 *   transitions only for entrances, and a rotate-on-toggle is not one.
 * - Content mounts on open with no height animation. The old MUI Collapse
 *   animated height, which reads as chrome; opening is a colour-less state
 *   change, not an entrance worth 240ms.
 * - Focus comes from the global `:focus-visible` outline in styles/index.css;
 *   nothing is redeclared here.
 * - The trigger's geometry and the expanded content's are the component's,
 *   not the caller's. There is no `contentClassName`: four call sites had it
 *   and invented three different treatments of the same idiom in one vertical
 *   column — two rule weights and no rule — which is the composition half of
 *   the "one disclosure idiom" rule above. A fifth call site inherits instead
 *   of choosing.
 * - Disclosed content is indented by one chevron column and carries **no left
 *   rule**. The indent already says the content belongs to the row above, so
 *   by § 2's boundary test the rule loses no information and § 5's "remove a
 *   border before you tighten the spacing" applies. It also keeps the trace
 *   column from growing another vertical edge.
 */

import { cn } from "@shared/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

export type DisclosureProps = {
	/**
	 * The always-visible trigger content. For a trace line this is the line
	 * itself; for a quiet disclosure it is a short text label.
	 */
	summary: ReactNode;
	/**
	 * Content revealed when open. Rendered only while open, and optional only
	 * because the `disabled` branch structurally cannot render it — a caller
	 * with nothing to disclose would otherwise have to pass `children={null}`,
	 * which is the type describing a shape the component does not have. Omit
	 * it only together with `disabled`.
	 */
	children?: ReactNode;
	/** Initial open state. Default closed, per § 7 — detail is one click away. */
	defaultOpen?: boolean;
	/**
	 * Chevron placement. `leading` (default) is the app idiom; `trailing` is
	 * for full-width rows whose leading slot already carries an icon.
	 */
	chevron?: "leading" | "trailing";
	/** Extra classes on the outer wrapper. */
	className?: string;
	/** Extra classes on the trigger button. Layout and hover ground only. */
	triggerClassName?: string;
	/**
	 * Renders the summary as a static row when there is nothing to reveal —
	 * same height, same chevron gutter, no button and no hover. A list that
	 * mixes expandable and complete rows uses this rather than hand-building
	 * the second kind.
	 */
	disabled?: boolean;
};

// One chevron column: the 14px glyph plus the trigger's 6px gap. Content hangs
// off the chevron the way a tree view indents children by one twisty, not off
// whatever the summary happens to start with — a summary that also carries an
// identity glyph (the trace rows do) pushes its text further right, and a
// shared primitive cannot depend on a feature's rail width to stay aligned.
// A trailing chevron leaves no leading gutter, so the content is flush.
const CONTENT_INDENT = "ml-5";

// The row box, shared by the trigger and the `disabled` branch. A trace line
// that has finished sits directly above one still running, so a row with
// nothing to reveal has to be the same height and start on the same rail as
// one that does; keeping both branches on this constant is what stops that
// from being two numbers maintained by hand in two files.
const ROW = "flex min-h-6 w-full items-center gap-1.5 py-0.5 text-left";

export const Disclosure = ({
	summary,
	children,
	defaultOpen = false,
	chevron = "leading",
	className,
	triggerClassName,
	disabled = false,
}: DisclosureProps) => {
	const [isOpen, setIsOpen] = useState(defaultOpen);
	const contentId = useId();

	// The chevron slot is reserved rather than dropped: losing 20px of gutter
	// is exactly the jog this shares a constant to avoid. Interactive
	// affordances come off, and `triggerClassName` is not applied — a hover
	// ground on a row that does not respond to a click is a lie.
	if (disabled) {
		return (
			<div className={className}>
				<div className={cn(ROW, "text-ink-dim")}>
					{chevron === "leading" && (
						<span className="size-3.5 shrink-0" aria-hidden={true} />
					)}
					<span className="min-w-0 flex-1">{summary}</span>
				</div>
			</div>
		);
	}

	const glyph = isOpen ? (
		<ChevronDown className="size-3.5" aria-hidden={true} />
	) : (
		<ChevronRight className="size-3.5" aria-hidden={true} />
	);

	return (
		<div className={className}>
			<button
				type="button"
				aria-expanded={isOpen}
				aria-controls={contentId}
				onClick={() => setIsOpen((previous) => !previous)}
				className={cn(
					ROW,
					"cursor-pointer select-none",
					"text-ink-dim transition-colors duration-fast ease-out-quart hover:text-ink-muted",
					triggerClassName,
				)}
			>
				{chevron === "leading" && (
					<span className="flex shrink-0 text-ink-disabled">{glyph}</span>
				)}
				<span className="min-w-0 flex-1">{summary}</span>
				{chevron === "trailing" && (
					<span className="flex shrink-0 text-ink-disabled">{glyph}</span>
				)}
			</button>
			{isOpen && (
				<div
					id={contentId}
					className={cn(
						"mt-1 flex flex-col gap-2 pb-1",
						chevron === "leading" && CONTENT_INDENT,
					)}
				>
					{children}
				</div>
			)}
		</div>
	);
};
