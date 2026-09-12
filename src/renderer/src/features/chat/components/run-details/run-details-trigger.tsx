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

const sameIds = (seen: SeenFailures, ids: string[]): boolean =>
	seen.size === ids.length && ids.every((id) => seen.has(id));

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
	 * The canvas wins the header while it is open (`§3.3`): with it open the chat
	 * column is narrowed and holds one action beside the title block, and this
	 * popover would open across the canvas pane. The cost is stated there and not
	 * hidden: a failure arriving while the canvas is open is not announced by the
	 * trigger, and the trigger returns with its dot when the canvas closes.
	 */
	useEffect(() => {
		if (isCanvasOpen) setOpen(false);
	}, [isCanvasOpen]);

	// Opening clears the dot. Recorded per failure id, and only while the panel is
	// open, so a failure that arrives while the user is reading is seen too.
	useEffect(() => {
		if (!open || !details) return;
		const failed = details.failedChildIds;
		setSeen((previous) =>
			sameIds(previous, failed) ? previous : new Set(failed),
		);
	}, [open, details]);

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
		<Popover open={open} onOpenChange={setOpen}>
			{/* Tooltip first: it needs the button as its child, and the popover's
			 * trigger is the same element — `Tooltip` and `PopoverTrigger` both
			 * clone through `asChild`, so the button ends up carrying both sets of
			 * props rather than one wrapping the other in the DOM. */}
			<Tooltip content={label} side="bottom">
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
