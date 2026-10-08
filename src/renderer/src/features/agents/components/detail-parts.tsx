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
 * NO RULES BETWEEN SECTIONS (design spec D11). A hairline over every block made a
 * read view of three rules and three boxes; the page's `space-y-8` (32 px, the
 * section tier of the spacing scale) between sections and `space-y-2` (8 px)
 * between a heading and its content already say where one ends, which is the
 * brand's "remove a border or a background" before "add one". The gap is owned by
 * the CONTAINER, not by a margin here, so a section that is the first or last
 * child needs no special case.
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
		<section className={cn("space-y-2", className)}>
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
 * THE 24 PX TARGET FLOOR FOR A LINK-STYLE BUTTON, WITHOUT MOVING ANYTHING
 * (design review round 1 D2 = UX U7).
 *
 * The `link` variant is `h-auto p-0`, so "Show all" measured 48x17.4 and the
 * Manager name 54x19.5 - the smallest targets on the page, next to 36 px rows.
 * `min-h-6` gives the element its own 24 px box (the target a pointer and an
 * auditor both measure), and the call site cancels the surplus with a negative
 * margin so the section pitch does not move. It is a class constant rather than
 * a variant change because `link` is also the inline-in-prose style elsewhere
 * in the app, where a 24 px box would break the line.
 */
export const LINK_HIT_AREA = "min-h-6";

/**
 * THE HEIGHT OF THE TITLE'S OWN LINE BOX, DERIVED FROM THE TYPE TOKEN (agent
 * review round 1 nit 6).
 *
 * The header's action cluster is this tall so its 32 px buttons centre on the
 * TITLE line and not on the title-plus-meta block. It was `h-6.5`, a hand copy of
 * `--text-title` (1.25rem) x `--text-title--line-height` (1.3) = 26 px that would
 * have silently stopped centring if either token moved. The calc reads the same
 * two tokens, so it is exact by construction (measured 26 px at the default
 * root size, in both headers); `1lh` was rejected because the cluster is a
 * sibling of the heading, not its parent, so its own `lh` is the body line.
 */
export const TITLE_LINE_HEIGHT =
	"h-[calc(var(--text-title)*var(--text-title--line-height))]";

/**
 * Prose, at reading weight, with a bound and a way past it.
 *
 * THIS IS THE FIX FOR THE READ VIEW'S CENTRAL DEFECT (design consult D1). The
 * instructions used to be a `<textarea disabled>`, which is not a reading
 * surface at all: the reviewer measured 206 of 699 px of the reviewer prompt
 * visible (29.5%), a keyboard user unable to scroll it (a disabled textarea is
 * not focusable), and - the part that made the whole read view a lie - a fill and
 * border identical to an editable field's, so a built-in's read view looked like
 * a form the user was not allowed to type into.
 *
 * IT IS NOT A BOX AND NOT A SCROLLER ANY MORE (design spec D5, D11). The first
 * replacement was a bordered, filled, `max-h-64` scroll container with a tab
 * stop: it still looked like the input it replaced, and it nested a second scroll
 * context inside the pane's (a wheel gesture was trapped in it, and its focus
 * outline sat against a clipped box). Prose is now plain text at the column's own
 * left edge, clamped to ten lines, with a link-style "Show all" that expands it
 * IN FLOW - one scroll context per region. Keyboard reach is unchanged in the
 * way that matters: the expand control is a real button, and expanded text is
 * ordinary page content that the pane's own scroll reaches.
 *
 * WHY `line-clamp`, AND WHAT IT DOES TO THE MEASUREMENT. A clamped element keeps
 * its full `scrollHeight` while its `clientHeight` is the clamped height, so the
 * same `scrollHeight > clientHeight + 1` test that decided the old `max-h-64`
 * still answers "is text hidden", with no character threshold (which would show
 * "Show all" on text that fits at a wide window). Prose is NOT narrowed below the
 * column's measure: a second, inner edge is what `chat-measure.ts` warns about.
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
	 * column's width, which changes with the window AND with the sidebar drag, and
	 * a character threshold would show "Show all" on text that already fits at
	 * 1380px.
	 *
	 * A RESIZEOBSERVER, NOT A MEASURE-ONCE (agent review round 1 #2 = QA round 1
	 * Q1). `line-clamp` cuts the text, unlike the old `max-h-64` scroller that was
	 * still scrollable behind a stale flag, so a flag measured at mount and never
	 * again left clamped text with no way to reach it after the column narrowed
	 * (and a dead "Show all" after it widened). The observer fires on the clamped
	 * element's own box changing - width is what moves the line count, and the
	 * box itself changes height when the text goes from fitting to clamped - and
	 * the effect still re-runs on `text`, because new text at an unchanged size
	 * changes `scrollHeight` without any resize to observe. The callback only ever
	 * sets a boolean that React bails out of when unchanged, and showing the button
	 * does not resize the observed element, so it cannot loop.
	 *
	 * The measurement is skipped while expanded ON PURPOSE, so `overflows` keeps
	 * its last clamped value - which is what keeps "Show less" on screen once the
	 * block has been expanded (an unclamped block never overflows, so re-measuring
	 * would hide the only control that can put it back). The observer is therefore
	 * only attached while collapsed.
	 */
	useEffect(() => {
		if (expanded) return;
		const element = ref.current;
		if (!element) return;
		// `text` is read by the MEASUREMENT rather than by the arithmetic: the
		// bound has to be re-measured when the content changes, and this is the
		// dependency that says so (the empty-text branch below returns before the
		// element exists at all).
		const measure = () =>
			setOverflows(
				Boolean(text) && element.scrollHeight > element.clientHeight + 1,
			);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [text, expanded]);

	if (!text.trim()) {
		return <p className="text-body-sm text-ink-muted">{empty}</p>;
	}

	return (
		<div>
			<div
				ref={ref}
				className={cn(
					"whitespace-pre-wrap text-body text-ink",
					!expanded && "line-clamp-10",
					mono && "font-mono text-meta",
				)}
			>
				{text}
			</div>
			{overflows ? (
				<Button
					variant="link"
					size="sm"
					// The 24 px box is centred on the 17 px text, so 3 px of it sits above and
					// below; the margins give those back so the text keeps the 4 px it had
					// under the block and the section pitch is unchanged (`LINK_HIT_AREA`).
					className={cn("mt-px -mb-[3px]", LINK_HIT_AREA)}
					aria-expanded={expanded}
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
	const label = sourceLabel(source);
	if (appearance === "text") {
		return <span className="shrink-0 text-meta text-ink-dim">{label}</span>;
	}
	// `neutral` for every source on purpose: this is a statement of fact, not a
	// warning, and a colour step per source would rank three equally valid states.
	return <Badge variant="neutral">{label}</Badge>;
}

/**
 * The word for a definition's source, spelled once.
 *
 * It has three readers - the roster's right edge, the chip, and the detail
 * header's meta line - and three spellings of "Built-in" would be the kind of
 * drift the shared roster / detail vocabulary exists to prevent.
 */
export function sourceLabel(
	source: "builtin" | "installed" | "custom",
): string {
	return source === "builtin"
		? "Built-in"
		: source === "installed"
			? "Installed"
			: "Custom";
}

/**
 * WHETHER THE PAGE-LEVEL "Discard your unsaved changes?" BAR IS OPEN, owned by the
 * page (`agents-page.tsx` sets it while the bar renders) and read by a pane's
 * `useEscapeToCancel` and its footer's Cancel AT PRESS TIME. A roster click or a
 * tab switch with a dirty edit opens that bar; the pane has its own Cancel
 * question, and both answer Escape. One question at a time: while the bar is open
 * the pane's Escape stands down and the page closes the bar, and a press on the
 * pane's own Cancel withdraws the bar before the pane asks (UX review round 3, U4).
 *
 * A module flag rather than a prop or context, like `headingFocusPending` below:
 * the hook is called from two panes the page renders several levels apart, and it
 * is read inside the key handler so no re-registration or render ordering can
 * matter - the failure this replaces was exactly a race between two window
 * listeners.
 *
 * ONE OWNER: the flag is a boolean (and `withdrawPageDiscardBar` one callback), so
 * it is only correct while a single `AgentsPage` is mounted - which the app
 * guarantees (`app.tsx` mounts one route element; the stories mount one at a time).
 * A second page instance would let the first one's bar closing clear the flag
 * under the second's open bar, and the answer is then an owner-keyed counter or a
 * context provided by the page, not a second module variable. Under Vite HMR a
 * re-evaluated module hands a new pane a fresh `false` while an old effect clears
 * the old module's variable: dev-only, one extra stacked question, self-healing.
 */
let pageDiscardBarOpen = false;
let withdrawPageDiscardBar: (() => void) | null = null;
export function setPageDiscardBarOpen(open: boolean, withdraw?: () => void) {
	pageDiscardBarOpen = open;
	withdrawPageDiscardBar = open ? (withdraw ?? null) : null;
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
			// The page's own question is open and Escape belongs to IT (UX review round
			// 2, U2): raising this pane's question as well stacked two differently
			// worded "discard?" prompts for one intent. Reading the page's flag instead
			// of relying on listener order is the point - the two listeners are on the
			// same window and their order flips whenever either effect re-registers.
			if (pageDiscardBarOpen) return;
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
	const wasConfirming = useRef(false);
	useEffect(() => {
		if (isConfirming) {
			keepEditingRef.current?.focus();
		} else if (
			wasConfirming.current &&
			document.activeElement === document.body
		) {
			/*
			 * THE QUESTION CLOSED BY ESCAPE (UX review round 1 U5): "Keep editing"
			 * unmounted with its row while it held focus, so the caret fell to `BODY`
			 * and the next Tab started from the top of the page. The button path
			 * already focuses Save; this is the same landing for the key path. Only
			 * when focus really is on `body`, so a close that moved focus somewhere
			 * deliberate (Discard, a roster click) is left alone.
			 */
			primaryRef.current?.focus();
		}
		wasConfirming.current = isConfirming;
	}, [isConfirming]);
	const footerRef = useRef<HTMLDivElement>(null);

	/*
	 * THE SCROLLER LEARNS HOW TALL THIS FOOTER IS (UX review round 1 U1).
	 *
	 * The footer is `sticky bottom-0` INSIDE the pane's scroller, so any control
	 * whose natural position falls in the last footer-height of the viewport is
	 * painted under it. At rest "Add member" sat at y 509..541 behind a bar that
	 * starts at 502, a click at its centre landed on Save, and Tab did not scroll
	 * because the browser only scrolls a focused element that is outside the
	 * scrollport - and under a sticky bar it is inside. `scroll-padding-bottom` on
	 * the scroller is the property that moves that edge (focus and scrollIntoView
	 * both honour it), but it has to equal the footer's real height, which is not
	 * a constant: it is 57 px at rest and grows when the discard question wraps
	 * onto a second line at a narrow column. So the footer reports its own height
	 * to the nearest pane scroller as a custom property that `agents-page.tsx`
	 * reads (`scroll-pb-*`), and removes it on the way out so a read view does not
	 * keep padding for a bar that is gone. No bottom PADDING is added to the
	 * content as well: the footer is the last child of the column, so at the end
	 * of the scroll the last control already rests above it, and padding would put
	 * the band of scrolling sections under the bar that the page's note forbids.
	 */
	useEffect(() => {
		const footer = footerRef.current;
		const scroller = footer?.closest<HTMLElement>("[data-agents-pane]");
		if (!footer || !scroller) return;
		const publish = () =>
			scroller.style.setProperty(
				"--lo-pane-footer-h",
				`${footer.getBoundingClientRect().height}px`,
			);
		publish();
		const observer = new ResizeObserver(publish);
		observer.observe(footer);
		return () => {
			observer.disconnect();
			scroller.style.removeProperty("--lo-pane-footer-h");
		};
	}, []);
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
		/*
		 * THE FOOTER LIVES INSIDE THE COLUMN (design spec s4, D12). It used to cancel
		 * the scroller's side padding with `-mx-6` so its rule ran the pane's full
		 * width, which made it the one object in the pane with a different left edge
		 * from everything above it: Save sat 24 px left of the Name field at 1440.
		 * Inside the measure wrapper the rule, Save and the fields share one edge, and
		 * the scroller carries no bottom padding (see the page's note), which is what
		 * keeps content from showing in a band under the bar.
		 *
		 * `data-lo-pane-footer` is how the pane's bottom edge fade stands down: the
		 * footer is `sticky` INSIDE the scroller, so a mask on the scroller would dim
		 * the Save button itself (`index.css`). Its replacement is the footer's own
		 * `::before` (also `index.css`): a 24 px canvas fade on the bar's top edge while
		 * the pane has more below, so a control that rests wholly under the bar at the
		 * top of the scroll ("Add member", 32 of 32 px hidden at 1024x725) is hinted at
		 * rather than invisible (UX review round 2, U1a).
		 */
		<div
			ref={footerRef}
			data-testid="edit-footer"
			data-lo-pane-footer
			className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-hairline border-t bg-canvas py-3"
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
					onClick={() => {
						/*
						 * ONE QUESTION (UX review round 3, U4). With the page's discard bar up
						 * - a roster click or a tab switch asked first - pressing THIS Cancel
						 * raised a second, differently worded question under the first. The
						 * press says what the operator wants now (end this edit), so the bar's
						 * pending navigation is withdrawn and this footer asks.
						 */
						if (pageDiscardBarOpen) withdrawPageDiscardBar?.();
						if (dirty) requestConfirming(true);
						else onCancel();
					}}
					disabled={pending}
				>
					Cancel
				</Button>
			)}
			{dirty && !isConfirming ? (
				<span className="ml-auto text-meta text-ink-dim">Unsaved changes</span>
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
				<Skeleton key={key} className="h-12 w-full" />
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
	// The same measure wrapper the settled panes use, so the column does not jump
	// when the record lands (the page supplies it around every non-hero state).
	return (
		<div className="space-y-8" aria-hidden="true">
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
