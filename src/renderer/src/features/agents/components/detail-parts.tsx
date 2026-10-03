/**
 * The pieces a definition's detail pane is built from — one copy, for agents and
 * for teams.
 *
 * WHY THIS FILE EXISTS AT ALL. Scope A's finding (design consult D2/D3, UX U4) is
 * that the page was two stacked free-text forms: seven fields at equal weight,
 * no read view, no hierarchy. The replacement is a READ view per section with an
 * explicit Edit mode, and every part of that is the same for a profile and for a
 * team — the section frame, the bounded reading block, the sticky footer that
 * saves or cancels, the discard confirmation, and the state placeholders. Written
 * twice, the two panes drift: one gains a Cancel and the other does not, which is
 * exactly the "second way of doing things" this repo treats as a defect.
 */

import { Badge } from "@shared/components/ui/badge";
import { Button } from "@shared/components/ui/button";
import { Skeleton } from "@shared/components/ui/skeleton";
import { cn } from "@shared/lib/utils";
import { type ReactNode, useEffect, useRef, useState } from "react";

/**
 * One titled block of a detail pane.
 *
 * Sections rather than a field stack, because the operator's question is "what
 * does this agent do and what may it touch", not "what are the values" — and the
 * two need different reading weights: the instructions are prose, the tools are
 * a list, and the provenance is a footnote.
 *
 * The hairline rule between sections is decorative (never `border-control`,
 * which is a control's only boundary), and the first section drops it so the
 * pane does not open with a rule under the header.
 */
export function Section({
	title,
	description,
	actions,
	children,
	className,
}: {
	title: string;
	description?: ReactNode;
	actions?: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	return (
		<section
			className={cn(
				"space-y-2 border-hairline border-t pt-4 first:border-t-0 first:pt-0",
				className,
			)}
		>
			<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
				<h3 className="text-heading">{title}</h3>
				{actions}
			</div>
			{description ? (
				<p className="text-meta text-ink-muted">{description}</p>
			) : null}
			{children}
		</section>
	);
}

/**
 * Prose, at reading weight, with a bound and a way past it.
 *
 * THIS IS THE FIX FOR THE READ VIEW'S CENTRAL DEFECT (design consult D1). The
 * instructions used to be a `<textarea disabled>`, which is not a reading
 * surface at all: the reviewer measured 206 of 699 px of the reviewer prompt
 * visible (29.5%), a keyboard user unable to scroll it (a disabled textarea is
 * not focusable), and — the part that made the whole read view a lie — a fill and
 * border identical to an editable field's, so a built-in's read view looked like
 * a form the user was not allowed to type into.
 *
 * `tabIndex={0}` on the scroller is what makes it readable without a pointer: the
 * block itself is the scroll container, so arrow keys and Page Down work when it
 * has focus, and the app's own `:focus-visible` outline says where focus is. The
 * bound is `max-h-64`: tall enough for a real instruction set's opening
 * paragraphs, short enough that a 1,900-character prompt does not push every
 * other section off screen.
 */
export function ReadBlock({
	text,
	empty = "Nothing here yet.",
	mono = false,
}: {
	text: string;
	empty?: string;
	/** Machine voice (a packaged prompt shown for comparison), per branding §5. */
	mono?: boolean;
}) {
	const [expanded, setExpanded] = useState(false);
	const [overflows, setOverflows] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	/*
	 * Measured, not assumed from a character count: what overflows depends on the
	 * column's width, which changes with the window, and a character threshold
	 * would show "Show all" on text that already fits at 1380px.
	 *
	 * The measurement is skipped while expanded ON PURPOSE, so `overflows` keeps
	 * its last clamped value — which is what keeps "Show less" on screen once the
	 * block has been expanded (an unbounded block never overflows, so re-measuring
	 * would hide the only control that can put it back).
	 */
	useEffect(() => {
		if (expanded) return;
		const element = ref.current;
		if (!element) return;
		// `text` is read by the MEASUREMENT rather than by the arithmetic: the
		// bound has to be re-measured when the content changes, and this is the
		// dependency that says so (the empty-text branch above returns before the
		// scroller exists at all).
		setOverflows(
			Boolean(text) && element.scrollHeight > element.clientHeight + 1,
		);
	}, [text, expanded]);

	if (!text.trim()) {
		return <p className="text-body-sm text-ink-muted">{empty}</p>;
	}

	return (
		<div className="space-y-1">
			<div
				ref={ref}
				// biome-ignore lint/a11y/noNoninteractiveTabindex: this is a scroll container, which is the one non-interactive role a tab stop is for - a disabled textarea (what this replaced) could not be focused or scrolled at all, and arrow/PageDown only reach a long prompt once the block itself has focus.
				tabIndex={0}
				aria-label="The full text"
				className={cn(
					"whitespace-pre-wrap rounded-sm border border-hairline bg-surface px-3 py-2 text-body-sm text-ink",
					// A reading block is not a control: `hairline` bounds it, and the
					// app's focus ring (not a border colour) is what says it has focus.
					!expanded && "max-h-64 overflow-y-auto",
					mono && "font-mono text-meta",
				)}
			>
				{text}
			</div>
			{overflows ? (
				<Button
					variant="link"
					size="sm"
					onClick={() => setExpanded((value) => !value)}
				>
					{expanded ? "Show less" : "Show all"}
				</Button>
			) : null}
		</div>
	);
}

/**
 * The source of a definition, as a chip.
 *
 * The wire has carried `source` (`builtin | installed | custom`) all along and
 * the page threw it away in the list and reduced it to a 12px meta line in the
 * detail (D3). It is the first thing an operator needs before editing anything:
 * "will my change be overwritten by a hub pull" is answered by this chip.
 */
export function SourceChip({
	source,
	/**
	 * `text` is the roster's rendering: a dim 12 px word rather than a bordered
	 * box, which read as a control beside the outline chips and squeezed the
	 * description onto a second line (design review round 1, D11).
	 */
	appearance = "chip",
}: {
	source: "builtin" | "installed" | "custom";
	appearance?: "chip" | "text";
}) {
	const label =
		source === "builtin"
			? "Built-in"
			: source === "installed"
				? "Installed"
				: "Custom";
	if (appearance === "text") {
		return <span className="shrink-0 text-meta text-ink-dim">{label}</span>;
	}
	// `neutral` for every source on purpose: this is a statement of fact, not a
	// warning, and a colour step per source would rank three equally valid states.
	return <Badge variant="neutral">{label}</Badge>;
}

/**
 * Escape cancels the edit, the way every other editor in this app does it.
 *
 * `defaultPrevented` is checked because Radix's dismissable layers (the
 * `SearchableSelect` popup, a dialog) close themselves on Escape and call
 * `preventDefault` — without the guard, closing the manager picker with Escape
 * would also throw away the edit the user was in the middle of.
 */
export function useEscapeToCancel(onCancel: () => void, active: boolean) {
	useEffect(() => {
		if (!active) return;
		const handler = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			event.preventDefault();
			onCancel();
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [active, onCancel]);
}

/**
 * The edit footer: one primary action, one way out, and what it costs.
 *
 * THREE FINDINGS ARE ANSWERED HERE.
 *
 * - U3 / D5: Edit had no Cancel and no dirty protection, and every action
 *   carried the same weight, so leaving silently discarded typing. Cancel asks
 *   before discarding, and names what it would discard.
 * - D5's other half: the primary action sat BELOW the fold (measured at y=961 on
 *   a three-member team). The footer is sticky to the pane's foot, so Save is on
 *   screen at every scroll position and the sections scroll behind it.
 * - U8: a completed save said nothing and dropped focus to `body`, which is where
 *   a screen-reader user loses their place. The caller moves focus to the
 *   heading; this component's button holds focus until it unmounts.
 */
export function EditFooter({
	dirty,
	pending,
	onSave,
	onCancel,
	saveLabel = "Save changes",
	pendingLabel = "Saving…",
	dirtyHint,
	submit,
	confirming,
	onConfirmingChange,
}: {
	dirty: boolean;
	pending: boolean;
	onSave: () => void;
	onCancel: () => void;
	saveLabel?: string;
	pendingLabel?: string;
	dirtyHint?: string;
	/**
	 * Whether the primary button SUBMITS the surrounding form.
	 *
	 * The `Button` primitive defaults to `type="button"` (deliberately: an
	 * untyped button inside a form submits it), and every pane here is a `<form>`
	 * with a wired `onSubmit` — so pressing Enter in the Name field of a new agent
	 * did nothing at all, silently (UX U7). Opting the primary in gives the form
	 * the submitter it was missing.
	 */
	submit?: boolean;
	/**
	 * The discard confirmation, CONTROLLED when a caller owns another way into it.
	 *
	 * WHY IT IS NOT PRIVATE STATE ANY MORE. It was, and the Escape key went
	 * straight to `cancel` — so the keyboard path discarded a dirty draft with no
	 * question while the mouse path asked, which is the same defect (U3) arriving
	 * through the one input a keyboard user is most likely to reach for. The panes
	 * own the state so both entries ask the same question; a caller with only the
	 * button (the create pane) leaves it uncontrolled.
	 */
	confirming?: boolean;
	onConfirmingChange?: (next: boolean) => void;
}) {
	const [uncontrolledConfirming, setUncontrolledConfirming] = useState(false);
	const primaryRef = useRef<HTMLButtonElement>(null);
	const keepEditingRef = useRef<HTMLButtonElement>(null);
	const isControlled = confirming !== undefined;
	const isConfirming = isControlled ? confirming : uncontrolledConfirming;

	/*
	 * THE QUESTION TAKES THE FOCUS THE BUTTON THAT ASKED IT GAVE UP (UX review
	 * round 2, U1).
	 *
	 * `Cancel` is what opens the confirmation, and the confirmation REPLACES that
	 * button — so the focused node unmounted with its row and `document.activeElement`
	 * fell to `BODY`. The very next `Tab` then landed on the first control in the new
	 * row, which is the DESTRUCTIVE `Discard changes`, leaving a keyboard user one
	 * press from losing the draft they had just asked to keep. Focus is therefore
	 * moved into the question deterministically — onto the SAFE arm, "Keep editing" —
	 * rather than depending on whichever node happened to be focused when the row
	 * swapped. The Escape path into the same state (`requestCancel` in the panes)
	 * lands here too, which is what makes "Escape asks, Enter keeps" true for both
	 * entries.
	 */
	useEffect(() => {
		if (!isConfirming) return;
		keepEditingRef.current?.focus();
	}, [isConfirming]);
	const requestConfirming = (next: boolean) => {
		if (!isControlled) setUncontrolledConfirming(next);
		onConfirmingChange?.(next);
	};

	/*
	 * The deps are the three values the effect actually reads rather than the
	 * callback's identity: `requestConfirming` is rebuilt on every render, so
	 * listing it would re-run this effect on every render of a form whose whole
	 * point is to be typed into. Reading the two stable pieces directly says what
	 * the effect depends on (`onConfirmingChange` is a `useState` setter at every
	 * call site).
	 */
	useEffect(() => {
		// A footer that is no longer in a confirming state (the edit ended, the
		// draft became clean) must not come back mid-confirmation.
		if (dirty) return;
		if (!isControlled) setUncontrolledConfirming(false);
		onConfirmingChange?.(false);
	}, [dirty, isControlled, onConfirmingChange]);

	return (
		// `-mx-6` cancels the scroller's SIDE padding so the bar spans the pane's
		// full width; the scroller carries no bottom padding (see the page's own
		// note), which is what keeps content from showing in a band under the bar.
		<div
			data-testid="edit-footer"
			className="sticky bottom-0 z-10 -mx-6 mt-6 flex flex-wrap items-center gap-2 border-hairline border-t bg-canvas px-6 py-3"
		>
			<Button
				ref={primaryRef}
				type={submit ? "submit" : undefined}
				variant="primary"
				onClick={submit ? undefined : onSave}
				disabled={pending}
			>
				{pending ? pendingLabel : saveLabel}
			</Button>
			{isConfirming ? (
				<>
					<span className="text-body-sm text-ink-muted">
						{dirtyHint ?? "Discard your unsaved changes?"}
					</span>
					<Button variant="danger" onClick={onCancel}>
						Discard changes
					</Button>
					<Button
						ref={keepEditingRef}
						variant="ghost"
						onClick={() => {
							requestConfirming(false);
							/*
							 * "KEEP EDITING" PUTS THE CARET BACK. Dismissing the question used to
							 * drop focus to `body`, so the operator's next keystroke went nowhere
							 * (UX U8, review round 1).
							 */
							primaryRef.current?.focus();
						}}
					>
						Keep editing
					</Button>
				</>
			) : (
				<Button
					variant="ghost"
					onClick={() => (dirty ? requestConfirming(true) : onCancel())}
					disabled={pending}
				>
					Cancel
				</Button>
			)}
			{dirty && !isConfirming ? (
				<span className="text-meta text-ink-muted">Unsaved changes</span>
			) : null}
		</div>
	);
}

/**
 * A FOCUS HANDOFF BETWEEN TWO PANES, for the one transition React cannot see.
 *
 * After a successful Create the page navigates to the new record, which mounts a
 * DIFFERENT component; the create form cannot focus a heading that does not
 * exist yet, and the pane that mounts has no way to know it was opened by a
 * create rather than a click. Focus therefore fell to `body` on that path while
 * the edit-save path focused the heading correctly (QA round 1, Q7 / UX U8).
 *
 * A module-scope flag rather than a prop or a context, because the two ends are
 * siblings under a route the create changes; the flag is consumed exactly once,
 * on the next pane's mount, and a stray flag is harmless (the next pane focuses
 * its heading, which is what a keyboard user wants anyway).
 */
let headingFocusPending = false;

export function requestHeadingFocus(): void {
	headingFocusPending = true;
}

export function consumeHeadingFocus(): boolean {
	const pending = headingFocusPending;
	headingFocusPending = false;
	return pending;
}

/**
 * A list that is loading, at the row height it will settle to.
 *
 * The old page left the list column blank while the main pane already said
 * "Select a definition to view or edit it" (D4) — a sentence about a list that
 * had not arrived, next to an empty box. Skeletons at the roster's own height
 * keep the layout still when the rows land.
 */
export function RosterSkeleton({ rows = 6 }: { rows?: number }) {
	return (
		<div className="space-y-1" aria-hidden="true">
			{SKELETON_ROWS.slice(0, rows).map((key) => (
				<Skeleton key={key} className="h-11 w-full" />
			))}
		</div>
	);
}

/**
 * Stable identities for skeleton rows.
 *
 * NAMED RATHER THAN INDEXED because a skeleton is a placeholder list: an index
 * key is correct here in React's terms and flagged by this repo's lint, and the
 * cheap way to say "these are interchangeable placeholders" is to give them
 * identities that do not move.
 */
const SKELETON_ROWS = ["a", "b", "c", "d", "e", "f", "g", "h"];

/** A detail pane that is loading, shaped like the sections it will fill. */
export function DetailSkeleton() {
	return (
		<div className="max-w-3xl space-y-6" aria-hidden="true">
			<Skeleton className="h-7 w-64" />
			<Skeleton className="h-5 w-40" />
			<Skeleton className="h-28 w-full" />
			<Skeleton className="h-24 w-full" />
		</div>
	);
}

/**
 * A failed read, in the order branding §8 asks for: what happened, what it
 * means, what to do.
 *
 * WHY IT IS A COMPONENT RATHER THAN ONE `role="alert"` ON THE PAGE. The old page
 * collapsed a list failure, a team failure and a detail failure into a single
 * alert that replaced EVERYTHING, list included (D4) — so a failed detail read
 * destroyed a list that was fine, and a `profiles.list` 500 was rendered as
 * "Desktop controls need a compatible backend connection", which blames
 * compatibility for a server error. Each pane owns its own failure now, and the
 * caller supplies the plain-language cause.
 */
export function PaneError({
	title,
	what,
	meaning,
	onRetry,
	retrying = false,
}: {
	title: string;
	/** What happened, in one sentence. */
	what: string;
	/** What it means for the reader. */
	meaning: string;
	onRetry: () => void;
	retrying?: boolean;
}) {
	return (
		<div role="alert" className="max-w-xl space-y-2">
			<h2 className="text-heading">{title}</h2>
			<p className="text-body-sm text-ink">{what}</p>
			<p className="text-body-sm text-ink-muted">{meaning}</p>
			<Button variant="secondary" onClick={onRetry} disabled={retrying}>
				{retrying ? "Retrying…" : "Retry"}
			</Button>
		</div>
	);
}

/** The label above an editable field, with room for a field-level refusal. */
export function FieldLabel({
	label,
	htmlFor,
	error,
}: {
	label: string;
	htmlFor: string;
	error?: string | null;
}) {
	return (
		<div className="flex items-baseline justify-between gap-2">
			<label htmlFor={htmlFor} className="text-body-sm text-ink-muted">
				{label}
			</label>
			{error ? (
				<span className="text-meta text-danger" role="alert">
					{error}
				</span>
			) : null}
		</div>
	);
}
