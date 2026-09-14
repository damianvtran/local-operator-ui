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
import { Tooltip } from "./tooltip";

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
	 * Extra classes on the ROW BOX, applied in both the interactive and the
	 * `disabled` branch.
	 *
	 * This exists for one reason: a caller that needs a different row HEIGHT
	 * needs it on both branches, and `triggerClassName` structurally cannot
	 * reach the `disabled` one. A dense list (the transcript's tool ledger) mixes
	 * rows that have output to disclose with rows that have none, and if only the
	 * first kind tightened, the column would alternate between two heights — the
	 * exact defect the shared `ROW` constant below exists to prevent.
	 *
	 * Scoped override, NOT a new default: `ROW`'s `min-h-6` is the app-wide
	 * disclosure idiom and other surfaces depend on it. Pass this only when the
	 * row type genuinely has its own density, and pass the same value from every
	 * call site that paints that row type.
	 */
	rowClassName?: string;
	/**
	 * Renders the summary as a static row when there is nothing to reveal —
	 * same height, same chevron gutter, no button and no hover. A list that
	 * mixes expandable and complete rows uses this rather than hand-building
	 * the second kind.
	 */
	disabled?: boolean;
	/**
	 * The trigger's ACCESSIBLE NAME, when the visible summary is abbreviated.
	 *
	 * A summary is a preview: `Goal: <a truncated snippet>` is the whole visible
	 * text, and the value behind the ellipsis has to be readable without
	 * operating the control. The name is where that goes, because it is the one
	 * string a screen reader reads before the press and the pointer reads on
	 * hover beside `triggerTooltip`.
	 *
	 * Not a `title` and not a second visible line: the trigger is a 24px chip and
	 * a `title` answers neither keyboard focus nor the app's own tooltip idiom.
	 */
	triggerLabel?: string;
	/**
	 * The app's tooltip over the TRIGGER, for the same class of caller.
	 *
	 * The primitive owns the button, so a caller whose summary truncates cannot
	 * attach `Tooltip` to it from outside — the wrapper this component renders is
	 * the caller's flex ITEM, and a tooltip anchored there would answer for the
	 * empty space beside the chip as well as for the chip. Passing the content
	 * here is the only way to put the app's tooltip on the control without
	 * reimplementing the trigger, which `docs/branding.md` § Disclosure forbids
	 * outside the two named button-in-button cases.
	 */
	triggerTooltip?: ReactNode;
	/**
	 * Reports the open state, for copy that has to state its VERB.
	 *
	 * A caller whose `triggerLabel`/`triggerTooltip` names the action needs the
	 * state this component owns — `Expand the session goal` collapsed,
	 * `Collapse the session goal` open — and there is no way to derive it from
	 * outside without duplicating the state. The report is one-way by design: it
	 * never controls the component, so the two cannot disagree.
	 */
	onOpenChange?: (open: boolean) => void;
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
//
// `min-h-6` + `py-0.5` is the COMFORTABLE default, for disclosures that sit
// alone or in short lists. A caller painting a dense run overrides it through
// `rowClassName` rather than editing this line — see that prop's docs.
const ROW = "flex min-h-6 w-full items-center gap-1.5 py-0.5 text-left";

export const Disclosure = ({
	summary,
	children,
	defaultOpen = false,
	chevron = "leading",
	className,
	triggerClassName,
	rowClassName,
	disabled = false,
	triggerLabel,
	triggerTooltip,
	onOpenChange,
}: DisclosureProps) => {
	const [isOpen, setIsOpen] = useState(defaultOpen);
	const contentId = useId();

	// The chevron slot is reserved rather than dropped: losing 20px of gutter
	// is exactly the jog this shares a constant to avoid. Interactive
	// affordances come off, and `triggerClassName` is not applied — a hover
	// ground on a row that does not respond to a click is a lie. `triggerLabel`
	// and `triggerTooltip` come off with it and for the same reason: there is no
	// control here for a name to name or a tooltip to describe.
	if (disabled) {
		return (
			<div className={className}>
				<div className={cn(ROW, "text-ink-dim", rowClassName)}>
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
			{/*
			 * `Tooltip` renders its child BARE when it has no content, so this is not
			 * a second branch: a caller that passes no `triggerTooltip` gets the
			 * trigger unwrapped with no extra node, which is what every existing call
			 * site does.
			 */}
			<Tooltip content={triggerTooltip} side="top">
				<button
					type="button"
					aria-expanded={isOpen}
					aria-controls={contentId}
					aria-label={triggerLabel}
					onClick={() => {
						/*
						 * Reported OUTSIDE the state updater: React may invoke an updater
						 * more than once for one press (StrictMode does), and a callback that
						 * runs inside it would then be called twice for one toggle.
						 */
						setIsOpen(!isOpen);
						onOpenChange?.(!isOpen);
					}}
					className={cn(
						ROW,
						"cursor-pointer select-none",
						"text-ink-dim transition-colors duration-fast ease-out-quart hover:text-ink-muted",
						rowClassName,
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
			</Tooltip>
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
