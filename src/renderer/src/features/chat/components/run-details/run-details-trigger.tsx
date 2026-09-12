/**
 * The header trigger and its popover (`docs/run-details.md` § 6, § 7).
 *
 * **Icon: `Activity`.** Not `Users`, not `ListChecks` — those two glyphs already
 * mean *a specific tool* everywhere else in this app (they are the ledger rows
 * for `task`/`agent` and for `todo`), and a header button wearing one of them
 * would read as that tool rather than as the view over both. One new symbol is
 * cheaper than re-teaching an existing one.
 *
 * Icon-only, with the meaning carried by the tooltip and the `aria-label` — the
 * same contract as the canvas button beside it. No count badge: a badge that
 * ticks from 2 to 3 draws the eye to something the user is not going to act on,
 * and the count is the first thing the tooltip already says.
 *
 * The trigger renders when, and only when, `hasRunDetails && !isCanvasOpen`
 * (`§3.3`) — with one term added by `§6.3`: an already-OPEN panel keeps the
 * trigger mounted, so the panel is never unmounted by the data settling under
 * the reader. Both halves are here rather than in the header because both are
 * facts about this surface: the header's job is only to place it.
 */

import {
	Button,
	Popover,
	PopoverContent,
	PopoverTrigger,
	ScrollArea,
	Tooltip,
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { Activity } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	type RunDetails,
	type SeenFailures,
	acknowledgedOnOpen,
	hasRunDetails,
	hasUnseenFailure,
	runDetailTriggerLabel,
} from "./run-detail-model";
import { RunDetailsPanel } from "./run-details-panel";

export type RunDetailsTriggerProps = {
	/** The derived view model, or `null` when the session has none. */
	details: RunDetails | null;
	/**
	 * Stories and previews open the panel without a click.
	 *
	 * It seeds the open state (and the failure acknowledgement with it), which is
	 * the only honest way to photograph the panel from a capture rig: clicking a
	 * control the rig cannot see is a state the rig would have to fake.
	 */
	defaultOpen?: boolean;
};

/**
 * The selector the document's own tab order is read from.
 *
 * The usual list minus anything that cannot take focus; `[tabindex]` is included
 * because the header's controls are plain buttons and the cluster's neighbours
 * may not be, and `:not([tabindex="-1"])` because that is precisely the container
 * this walk exists to leave.
 */
const TABBABLE_SELECTOR = [
	"a[href]",
	"button:not([disabled])",
	"input:not([disabled])",
	"select:not([disabled])",
	"textarea:not([disabled])",
	'[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Move focus out of the open panel, in the direction Tab was pressed.
 *
 * **Why this is not left to the browser.** The panel is Radix's portal, so it is
 * the LAST element in `<body>`: the document's own tab order puts it after every
 * header control, and a Tab from the container leaves the header entirely rather
 * than reaching the canvas button 8px to its right. It also cannot reach it by
 * walking inwards — the rows are not interactive (`§4.3`), so the content holds
 * no tabbable element at all.
 *
 * So the move is made against the TRIGGER, which is the element Radix already
 * uses as the panel's anchor and the element the keyboard user came from: the
 * next tabbable after it in document order, or the previous one for Shift+Tab.
 * That is the rest of the header cluster, which is where `§7` says focus goes.
 *
 * Returns whether focus was moved, so the caller only suppresses the browser's
 * own handling when this actually handled the press.
 */
const moveFocusOutOfPanel = (
	trigger: HTMLElement | null,
	backwards: boolean,
): boolean => {
	if (!trigger?.isConnected) return false;
	const candidates = Array.from(
		document.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR),
	).filter(
		(element) =>
			/*
			 * `getClientRects()` rather than `offsetParent`: the portal is fixed
			 * positioned, and `offsetParent` is null for anything fixed, which
			 * would drop the header itself out of its own tab order.
			 */
			element.getClientRects().length > 0,
	);
	const index = candidates.indexOf(trigger);
	if (index === -1) return false;
	/*
	 * At either end of the document's order the walk has nothing to offer, and
	 * the trigger is the honest destination: it is where Escape already returns
	 * focus, and it is 8px from the panel rather than a whole document away.
	 */
	const destination = candidates[index + (backwards ? -1 : 1)] ?? trigger;
	destination.focus();
	return document.activeElement === destination;
};

export const RunDetailsTrigger = ({
	details,
	defaultOpen = false,
}: RunDetailsTriggerProps) => {
	const isCanvasOpen = useUiPreferencesStore((state) => state.isCanvasOpen);
	const [open, setOpen] = useState(defaultOpen);
	/**
	 * The failures this trigger has shown, which is the whole of the "unseen"
	 * state (`§3.3`). Ids rather than a count or a boolean, so a SECOND child
	 * failing after the panel was opened raises the dot again — with a boolean
	 * "has been opened", the last failure of a turn is the one nobody sees.
	 */
	const [seen, setSeen] = useState<SeenFailures>(
		() => new Set(defaultOpen ? (details?.failedChildIds ?? []) : []),
	);
	const contentRef = useRef<HTMLDivElement | null>(null);
	/**
	 * The trigger button itself, which is the anchor the panel's focus moves are
	 * measured from.
	 *
	 * Taken from the DOM rather than from a second `useRef` on the `Button`
	 * because Radix owns the trigger element: `PopoverTrigger asChild` clones it
	 * and `Tooltip asChild` clones the same node again, so an element read here is
	 * the one the popover is actually anchored to rather than a copy of it.
	 */
	const triggerRef = useRef<HTMLButtonElement | null>(null);

	/**
	 * The canvas wins the header while it is open (`§3.3`): with it open the chat
	 * column is narrowed and holds one action beside the title block, and this
	 * popover would open across the canvas pane. The cost is stated there and not
	 * hidden: a failure arriving while the canvas is open is not announced by the
	 * trigger, and the trigger returns with its dot when the canvas closes.
	 */
	useEffect(() => {
		if (isCanvasOpen) setOpen(false);
	}, [isCanvasOpen]);

	/**
	 * Opening clears the dot for the failures THAT WERE ON SCREEN, and only those
	 * (`§3.3`).
	 *
	 * Bound to the transition rather than to a `[open, details]` effect, which is
	 * the difference between acknowledging a failure and hiding it: the effect
	 * re-recorded the whole failure set on every change while the panel was open,
	 * so a child that failed while the reader was scrolled down in the plan was
	 * marked seen without ever having been displayed — and the trigger's failure
	 * clause was gone when they closed it. Bound here, a failure that arrives
	 * while the panel is open keeps its dot for the next view.
	 *
	 * The rule is `acknowledgedOnOpen` in the model, so it is asserted rather than
	 * described; this callback only supplies the instant it is asked about.
	 *
	 * `details` is read through a ref rather than closed over, because the ref is
	 * the render that is current when the CLICK happens rather than the render
	 * that installed the handler — Radix keeps the callback it was given and a
	 * failure can land between the two. The write happens during render, which is
	 * safe for a mirror of the props and is why the mirror is one line rather
	 * than a `useEffect`: an acknowledged failure must not be missed because the
	 * effect had not run yet.
	 */
	const detailsRef = useRef(details);
	detailsRef.current = details;
	const handleOpenChange = (next: boolean) => {
		if (next) {
			setSeen((previous) =>
				acknowledgedOnOpen(detailsRef.current?.failedChildIds ?? [], previous),
			);
		}
		setOpen(next);
	};

	/*
	 * The visibility gate, which is `hasRunDetails && !isCanvasOpen` (`§3.3`) plus
	 * one term: **an open panel is never unmounted by the data settling
	 * underneath it.**
	 *
	 * `open` outlives `hasRunDetails` because the two answer different questions.
	 * `hasRunDetails` says whether there is anything to OPEN FOR — a child or to-do
	 * still asking for something, or a failure nobody has read. `open` says the
	 * reader is looking at the panel right now, and the panel must not vanish out
	 * from under them: that is what happened when the last open child or to-do
	 * settled mid-read (the trigger nulled, and the portal went with it).
	 *
	 * It also closes the state the failure dot exists for. With the dot lit and
	 * nothing else open, opening the panel acknowledges the failure in the same
	 * commit that shows it — `hasRunDetails` goes false, and without this term the
	 * panel unmounted in that commit, so the one state the dot announces could
	 * never be read. Worse, `open` then stayed true, so the panel re-rendered open
	 * and re-focused the next time any work started.
	 *
	 * The `!details` term is the null case, not a second visibility rule: an open
	 * panel always has details behind it, but the compiler cannot know that, and a
	 * non-null check is cheaper than a cast.
	 *
	 * `isCanvasOpen` stays a HARD close. That one is deliberate and is stated with
	 * its cost in `§3.3`: the canvas wins the header while it is open, and a
	 * failure arriving under it is announced by the transcript instead.
	 */
	if (isCanvasOpen || !details || !(hasRunDetails(details, seen) || open))
		return null;

	// One string for both the tooltip and the accessible name: the canvas button
	// beside it does the same, and two copies of a sentence that must agree is
	// how a label and its tooltip end up describing different counts.
	const label = runDetailTriggerLabel(details, seen);

	return (
		<Popover open={open} onOpenChange={handleOpenChange}>
			{/* Tooltip first: it needs the button as its child, and the popover's
			 * trigger is the same element — `Tooltip` and `PopoverTrigger` both
			 * clone through `asChild`, so the button ends up carrying both sets of
			 * props rather than one wrapping the other in the DOM. */}
			<Tooltip content={label} side="top">
				<PopoverTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						/*
						 * `relative` for the failure dot only. The header's own
						 * geometry is unchanged: the cluster beside this button holds
						 * the `ml-auto` the canvas button used to carry.
						 */
						className={cn("relative")}
						aria-label={label}
						/*
						 * The panel's Tab move is measured from this element, which is the one
						 * Radix anchors the popover to (`§7`).
						 */
						ref={triggerRef}
						/*
						 * Inert hook for the stories and for whatever drives this next. The
						 * label is derived — it carries a count per state — so it is the wrong
						 * thing to select on, and an element a capture rig cannot find is an
						 * element it photographs shut.
						 */
						data-run-details-trigger=""
					>
						<Activity aria-hidden={true} />
						{hasUnseenFailure(details, seen) && (
							/*
							 * A single 8px `danger` dot at the button's top-right corner.
							 * It is not decoration and it is not a count: it says a child
							 * failed and nobody has looked (`§6.1`), and it clears when the
							 * panel opens. `rounded-full` is reserved for avatars, status
							 * dots and pill badges, which is exactly what this is.
							 */
							<span
								aria-hidden={true}
								className={cn(
									"absolute -top-0.5 -right-0.5 size-2 rounded-full bg-danger",
								)}
							/>
						)}
					</Button>
				</PopoverTrigger>
			</Tooltip>
			<PopoverContent
				ref={contentRef}
				align="end"
				side="bottom"
				sideOffset={6}
				data-run-details-panel=""
				/*
				 * The panel container is the focus target on open (`§7`), not the
				 * first row: the rows are not interactive, and focusing one would
				 * imply they are.
				 */
				tabIndex={-1}
				className={cn(
					// 384px, `p-0`: the primitive ships `p-4` for content-shaped
					// popovers, and this one is a list whose rows must reach the panel
					// edge so the section rules and the row grounds can.
					"w-96 overflow-hidden p-0",
					/*
					 * `outline-none` because this element takes focus PROGRAMMATICALLY on
					 * open (`§7`), which is the case `styles/index.css:355-370` names as
					 * legitimate: "focus is moved there programmatically and a ring would
					 * be noise", and one that has to be visible in the component.
					 *
					 * Without it the app's unlayered `html :focus-visible` rule
					 * (`:345-352`) paints a 2px accent ring around the whole panel — the
					 * loudest line on a surface whose own hairline is 1.19:1 — and nicks
					 * the header's bottom rule with it. It is a scroll container, not a
					 * control: the ring marks nothing actionable, and the keyboard user
					 * still sees the ring on the trigger they tabbed to.
					 *
					 * `shadow-overlay!` is the second half of the same problem and it is
					 * why the elevation `§5` promises never painted: that same rule sets
					 * `box-shadow: none !important` on any `:focus-visible` element, so the
					 * panel's one shadow was suppressed by the ring's rule. The `!` is
					 * required rather than tidy — the ring is an unlayered `!important`
					 * declaration fighting MUI's own shadow rings, and a plain utility
					 * cannot outrank it. Removing the ring is what makes the shadow the
					 * boundary again, which is the elevation the evidence set had been
					 * missing while claiming it.
					 */
					"outline-none shadow-overlay!",
				)}
				/*
				 * The panel is a dialog with no name otherwise: Radix renders
				 * `role="dialog"` on this element, and an accessible name is required for
				 * it to be announced as anything but "dialog" (axe's
				 * `aria-dialog-name`). A label rather than a `labelledby` pointing at the
				 * first section heading, because the sections are conditional — with no
				 * children on screen the only heading is `To-dos`, and a name that
				 * changes with the contents names the contents rather than the surface.
				 */
				aria-label="Run details"
				/*
				 * Tab LEAVES the panel (`§7`), and it has to be moved by hand.
				 *
				 * The container is the focus target on open and the content holds no
				 * tabbable element (the rows are not interactive), so the browser's own
				 * Tab has no next stop inside the panel — and the panel is the LAST
				 * element in `<body>`, so it walks out of the header rather than into
				 * the cluster 8px away.
				 *
				 * `moveFocusOutOfPanel` puts focus on the trigger's next tabbable
				 * neighbour (its previous one for Shift+Tab), and reports whether it
				 * moved anything: when the trigger is not in the document — a story
				 * that mounts the panel without a header — the press is left to the
				 * browser rather than swallowed by a handler that did nothing.
				 */
				onKeyDown={(event) => {
					if (event.key !== "Tab") return;
					if (event.altKey || event.ctrlKey || event.metaKey) return;
					if (!moveFocusOutOfPanel(triggerRef.current, event.shiftKey)) return;
					event.preventDefault();
					event.stopPropagation();
				}}
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					contentRef.current?.focus();
				}}
			>
				{/*
				 * Radix's viewport is content-sized, so `max-h` on the Root alone
				 * CLIPS rather than scrolls — the panel would end mid-row with no way
				 * to reach the rest. Copying the cap onto the viewport is what makes
				 * `min(60vh, 480px)` a scroll ceiling, which is what `§5` asks for: a
				 * long plan scrolls inside the panel rather than growing past the
				 * viewport.
				 */}
				<ScrollArea
					/*
					 * `type="auto"` rather than Radix's default `hover` (`§5`).
					 *
					 * The panel's overflow state has to be visible WITHOUT a pointer: a
					 * still has no cursor, so a `hover`-only scrollbar means no committed
					 * frame can ever show that the panel scrolls at all — the only cue left
					 * is a row sliced by the panel's bottom edge, which reads as damage
					 * rather than as "about 260px more follows". `auto` paints the thumb
					 * whenever the content overflows and nothing when it does not, so a
					 * short panel gains no chrome and a long one says what it is.
					 *
					 * `always` was the alternative and is rejected: a scrollbar on a panel
					 * that fits is a control for something that cannot be done.
					 */
					type="auto"
					className={cn(
						"max-h-[min(60vh,480px)]",
						"[&>[data-radix-scroll-area-viewport]]:max-h-[inherit]",
						/*
						 * The scrollbar's lane, reserved in the content rather than spent out
						 * of the padding (`§5`).
						 *
						 * Radix paints the bar as an OVERLAY pinned to the viewport's right
						 * edge, so while it is up it lands inside the panel's 12px right
						 * padding: the header's tally — and a truncated row's ellipsis with
						 * it — then sat 3px from the thumb where the panel's own gutter is
						 * 12, and a tally budgeted on that 12px would reach under the thumb.
						 * The bar cannot move out of the padding (the panel IS the edge) and
						 * a narrower thumb would be a control you cannot grab, so the lane
						 * comes out of the content instead: 10px off the viewport's width
						 * for exactly as long as the bar is painted. `:has()` keys on
						 * Radix's own live scrollbar, so a panel that fits gains no gutter
						 * and every other frame is untouched. The section rule ends where
						 * the lane does, one pixel short of the thumb, and the track is
						 * transparent, so it still reads as reaching the boundary.
						 */
						"[&:has(>[data-orientation=vertical][data-state=visible])>[data-radix-scroll-area-viewport]]:pr-2.5",
						/*
						 * The viewport's own content wrapper is `display: table; min-width:
						 * 100%` — it is how Radix measures the scroll range — which sizes to
						 * MAX-CONTENT, so every `truncate` inside it silently stops
						 * truncating and a row overflows the 384px panel instead. The first
						 * capture of this surface showed exactly that: a long label pushed the
						 * whole numbers run past the panel's right edge. `!block` is required
						 * rather than `block`, because the `table` is an inline style and no
						 * plain utility outranks one.
						 */
						"[&>[data-radix-scroll-area-viewport]>div]:!block",
					)}
				>
					<RunDetailsPanel details={details} />
				</ScrollArea>
			</PopoverContent>
		</Popover>
	);
};
