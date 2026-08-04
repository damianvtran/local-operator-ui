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
	/** Content revealed when open. Rendered only while open. */
	children: ReactNode;
	/** Initial open state. Default closed, per § 7 — detail is one click away. */
	defaultOpen?: boolean;
	/**
	 * Chevron placement. `leading` (default) is the app idiom; `trailing` is
	 * for full-width rows whose leading slot already carries an icon.
	 */
	chevron?: "leading" | "trailing";
	/** Extra classes on the outer wrapper. */
	className?: string;
	/** Extra classes on the trigger button. */
	triggerClassName?: string;
	/** Extra classes on the revealed content region. */
	contentClassName?: string;
	/** Renders the summary without a button when there is nothing to reveal. */
	disabled?: boolean;
};

export const Disclosure = ({
	summary,
	children,
	defaultOpen = false,
	chevron = "leading",
	className,
	triggerClassName,
	contentClassName,
	disabled = false,
}: DisclosureProps) => {
	const [isOpen, setIsOpen] = useState(defaultOpen);
	const contentId = useId();

	if (disabled) {
		return <div className={className}>{summary}</div>;
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
					"flex w-full cursor-pointer select-none items-center gap-1.5 text-left",
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
				<div id={contentId} className={contentClassName}>
					{children}
				</div>
			)}
		</div>
	);
};
