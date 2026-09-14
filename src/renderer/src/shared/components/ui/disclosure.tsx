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

import { TEXT_SURFACE_ATTR } from "@shared/components/ui/text-surface";
import { cn } from "@shared/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	useId,
	useRef,
	useState,
} from "react";
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
	/**
	 * Extra classes on the trigger button: layout, ink and hover ground.
	 *
	 * Ink counts as well as layout, and that is worth stating rather than leaving to
	 * be discovered: a caller whose chip must sit among controls of one species
	 * legitimately overrides the row's resting ink to match theirs, and `cn`'s
	 * last-wins makes that deterministic. The composer's status row is that caller
	 * (`text-ink-muted hover:text-ink`), argued in `docs/composer-status-tabs.md`
	 * § 4.1: a second ink prop for one call site would be a bigger change than the
	 * override it replaces. What this prop is NOT for is the trigger's SIZE - a
	 * different row height belongs on `rowClassName`, which reaches both branches.
	 */
	triggerClassName?: string;
	/**
	 * Where the trigger's marks sit against a wrapping summary. Default
	 * `center`; `firstLine` pins them to the summary's first line (see
	 * `FIRST_LINE_MARK`).
	 */
	summaryAlign?: SummaryAlign;
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

/**
 * Where a 14px mark sits when a summary WRAPS, so it stays on the first line.
 *
 * A wrapping row's marks used to be centred over the whole block, which put the
 * glyph and the chevron in the middle of their own message: measured at 420px, a
 * three-line incident row carried no mark on its first line at all (both sat on
 * line 2), and in a run of them the gutter zig-zagged line-1, line-2, line-3. In
 * the ledger that reads as the row having no kind.
 *
 * `self-start` puts the mark's top on the line box's top; the half-step lifts it
 * onto that line's optical centre, because a 14px glyph in a 20px line box sits
 * high without it. Exported rather than written twice: the row's own identity
 * glyph and this trigger's chevron share one rail, so they have to share the
 * one number that keeps them on it.
 *
 * THE PAIR THIS NUMBER IS FOR: a `size-3.5` (14px) mark in the ledger's 20px
 * first line box. The mark's size is written in two places — the chevron below
 * and `TraceGlyph` in `trace-rail.tsx` — so a change to either size has to come
 * back here, or both marks sit off the line they were pinned to.
 */
export const FIRST_LINE_MARK = "self-start mt-0.5";

/**
 * How a trigger's own marks sit against its summary.
 *
 * `center` is the default and is right for a one-line summary. `firstLine`
 * exists for the rows whose summary IS a message and therefore wraps: there the
 * mark belongs on the line carrying the label, not adrift in the middle of the
 * paragraph.
 */
export type SummaryAlign = "center" | "firstLine";

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
	summaryAlign = "center",
	rowClassName,
	disabled = false,
	triggerLabel,
	triggerTooltip,
	onOpenChange,
}: DisclosureProps) => {
	const [isOpen, setIsOpen] = useState(defaultOpen);
	const contentId = useId();
	const buttonRef = useRef<HTMLButtonElement>(null);
	// The chevron slot, and the mark inside it, take the first line's height when
	// the summary wraps — see `FIRST_LINE_MARK`.
	const mark = cn("shrink-0", summaryAlign === "firstLine" && FIRST_LINE_MARK);
	/*
	 * Only ever OVERRIDES `ROW`'s own `items-center`, and only when the summary
	 * wraps. A `cn` that restated the default emitted a different class string on
	 * every tool row — tailwind-merge normalised it, so the pixels were the same,
	 * but a markup diff then looked like a change nothing had caused (round 2's
	 * Q4).
	 */
	const rowAlign = summaryAlign === "firstLine" ? "items-start" : null;

	/*
	 * A text gesture must not toggle the row; a click on the row's chrome must.
	 *
	 * The gesture decides, not the selection:
	 *
	 * - A press on a TEXT SURFACE the summary marked that ends with a selection
	 *   live was the user dragging across the message or pressing inside a
	 *   selection they had already made. The row is not what they clicked, so that
	 *   click does not toggle it. Every part of a summary that reads as text is
	 *   marked — the narration, the `object` slot and the verb label — so a drag
	 *   across a row is suppressed throughout it (round 3's U17).
	 * - A click on the chrome around that text — chevron, gutter — IS a row action
	 *   and toggles with the selection live: a reader who has just copied a message
	 *   has to be able to collapse the row under it. The LABEL is text now, not
	 *   chrome, so it behaves like the narration: a press on it with a selection
	 *   live is suppressed. That is the trade U17 took to make the row copy whole.
	 * - The FIRST click of a double-click cannot be told from a single click at the
	 *   moment it fires, so it toggles, and the SECOND PRESS takes that back
	 *   (`onMouseDown`, where `detail > 1`) — which leaves the row exactly as it
	 *   was, and the word the gesture selected selected, because the narration node
	 *   does not move. It is the press and not the `dblclick` because Chrome
	 *   dispatches the press even when the release lands outside this trigger,
	 *   which `dblclick` never does (round 4's R12). A double-click that is NOT on
	 *   a text surface is two ordinary toggles that cancel out on their own, so it
	 *   is left alone.
	 * - The keyboard path is not gated at all (below): a reader with a selection
	 *   had a row that ignored the mouse AND Enter, with no way out.
	 *
	 * The first version of this guard asked `window.getSelection()` on a plain
	 * `onClick`, which has neither of those properties: `select-none` chrome never
	 * clears a selection, so the state that suppressed the click was preserved by
	 * the suppression itself and the row swallowed every click and every keypress
	 * until something else cleared it.
	 */
	const pressOnText = useRef(false);
	/*
	 * Whether a selection was live when the press landed, which is NOT the same
	 * question as whether one is live when the click fires: a mousedown inside a
	 * selection collapses it, so the click that ends that gesture is exactly the
	 * one with no selection left to test. Reading it here is what stops that
	 * click from toggling the row as well as collapsing the selection — one
	 * action per click (round 2's requirement 6).
	 */
	const heldSelection = useRef(false);
	const undo = useRef<boolean | null>(null);

	/**
	 * Whether a press landed on a text surface the summary marked as such.
	 *
	 * `[data-text-surface]` rather than a `user-select` query, deliberately: the
	 * question is "is this part of the summary something a reader can select and
	 * copy?", and a computed style answers a different one — it said `text` for
	 * the narration and `none` for the label beside it, which is how a drag
	 * across a row came to copy everything except the label that says what the
	 * row IS (round 3's U17). The marker is the summary's own statement of which
	 * parts are text, so making the label selectable does not re-open U7.
	 */
	const isTextSurface = (target: EventTarget | null): boolean => {
		for (
			let node = target instanceof Element ? target : null;
			node && node !== buttonRef.current;
			node = node.parentElement
		) {
			if (node.hasAttribute(TEXT_SURFACE_ATTR)) return true;
		}
		return false;
	};

	const onMouseDown = (event: ReactMouseEvent<HTMLButtonElement>) => {
		pressOnText.current = isTextSurface(event.target);
		heldSelection.current = Boolean(window.getSelection()?.toString());
		/*
		 * Where the toggle a multi-click has to take back is undone, and why it is
		 * here rather than on `dblclick`:
		 *
		 * - a press that STARTS a gesture (`detail <= 1`) invalidates any toggle an
		 *   earlier one left pending, so nothing stale is taken back later;
		 * - a SECOND press on the same text (`detail > 1`) is that gesture's
		 *   continuation, and Chrome dispatches this `mousedown` even when the
		 *   release lands outside the trigger — the residual a `dblclick` handler
		 *   cannot reach, because that event fires only when the whole gesture
		 *   stays inside the trigger. Measured: the second press arrives with
		 *   `detail` 2, and without this the row is left toggled.
		 */
		if (event.detail <= 1) {
			undo.current = null;
			return;
		}
		if (pressOnText.current && undo.current !== null) {
			setIsOpen(undo.current);
			onOpenChange?.(undo.current);
			undo.current = null;
		}
	};

	const onClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
		/*
		 * `detail === 0` is the click the browser synthesises from Enter or Space
		 * on a focused button. The keyboard must never be gated on what happens to
		 * be selected — that was round 2's U8, where a live selection left the row
		 * unreachable by mouse and by key alike.
		 */
		const fromKeyboard = event.detail === 0;
		const selecting =
			heldSelection.current || Boolean(window.getSelection()?.toString());
		/*
		 * `detail > 1` is the second or later click of a MULTI-click, and on text
		 * that gesture is always a selection (a word, then a paragraph). The first
		 * click of it cannot be told from a single click when it fires, so the row
		 * may have toggled — `onMouseDown` has already taken that back — and this
		 * click must not toggle again, or a double-click ends with one net toggle,
		 * which is what the earlier round's guard did (measured: closed ->
		 * double-click -> open).
		 */
		if (
			!fromKeyboard &&
			pressOnText.current &&
			(selecting || event.detail > 1)
		) {
			return;
		}
		undo.current = isOpen;
		// Preserve the upstream composer's state report after the selection guard
		// accepts a toggle. Keep callbacks outside React's replayable updater.
		setIsOpen(!isOpen);
		onOpenChange?.(!isOpen);
	};

	/**
	 * The only keyboard exit a reader with a selection has.
	 *
	 * `select-none` chrome never clears a selection by itself and a focused
	 * button gets no native cancel from Escape, so without this the reader's
	 * selection is stuck until they click somewhere: round 2's U8 measured
	 * Escape leaving an 82-character selection intact. Scoped to a selection this
	 * trigger OWNS, so Escape is not taken from the rest of the app.
	 */
	const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
		if (event.key !== "Escape") return;
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed) return;
		if (!buttonRef.current?.contains(selection.anchorNode)) return;
		selection.removeAllRanges();
	};

	// The chevron slot is reserved rather than dropped: losing 20px of gutter
	// is exactly the jog this shares a constant to avoid. Interactive
	// affordances come off, and `triggerClassName` is not applied — a hover
	// ground on a row that does not respond to a click is a lie. `triggerLabel`
	// and `triggerTooltip` come off with it and for the same reason: there is no
	// control here for a name to name or a tooltip to describe.
	if (disabled) {
		return (
			<div className={className}>
				<div className={cn(ROW, rowAlign, "text-ink-dim", rowClassName)}>
					{chevron === "leading" && (
						<span className={cn("size-3.5", mark)} aria-hidden={true} />
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
			<Tooltip content={triggerTooltip} side="top">
				<button
					type="button"
					aria-expanded={isOpen}
					aria-controls={contentId}
					aria-label={triggerLabel}
					ref={buttonRef}
					onMouseDown={onMouseDown}
					onClick={onClick}
					onKeyDown={onKeyDown}
					className={cn(
						ROW,
						rowAlign,
						"cursor-pointer select-none",
						"text-ink-dim transition-colors duration-fast ease-out-quart hover:text-ink-muted",
						rowClassName,
						triggerClassName,
					)}
				>
					{chevron === "leading" && (
						<span className={cn("flex text-ink-disabled", mark)}>{glyph}</span>
					)}
					<span className="min-w-0 flex-1">{summary}</span>
					{chevron === "trailing" && (
						<span className={cn("flex text-ink-disabled", mark)}>{glyph}</span>
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
