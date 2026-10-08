/**
 * The sidebar's view popover: one panel, four labelled groups, the active row
 * of each marked.
 *
 * WHY IT IS ITS OWN COMPONENT, when the band that opens it stays in
 * `chat-sidebar.tsx`: the sidebar cannot be rendered by this repository's
 * `node:test` suite, so everything inside this panel would be reachable only
 * from a driver frame - and a Storybook story is how the design round looks at
 * a popover without a live backend behind it. The band is one row of state the
 * panel does not need to know about; the panel is a pure function of a
 * `SidebarView` and one callback.
 *
 * THE FOUR GROUPS ARE THE OPERATOR'S REFERENCE (dsh's sidebar, 2026-09-25) plus
 * the one the operator asked for on 2026-09-28: a popover of muted small-caps
 * group labels, one icon + label per row, a checkmark on the active row, and a
 * hairline between groups. `Group by`, `Time basis` and `Order by` are each a
 * single choice and carry the check; `Sections` is a list of switches, and it
 * is where the operator's "showing and hiding sections, reordering" lives.
 *
 * WHY `Time basis` IS ITS OWN GROUP AND NOT A FOURTH RADIO IN `Group by`. It is
 * a third axis of the view, not a way OF grouping: it changes which clock the
 * time sections and the numbers beside the titles read - time since the
 * conversation last moved against time since it was created - and, since the
 * operator's 2026-10-08 instruction, the clock the list is ARRANGED by below
 * the running lift (`chat-sidebar-view.ts`'s `pageOrder`: his report was that the
 * rows did not sort within a section by the basis he had chosen, and "in that
 * case it should show what we have selected/expect"). It was documented here as
 * "orthogonal to how rows are grouped and ordered" until the same day, and that
 * sentence is why the shell of this control never moved when the rule reversed:
 * the group's own copy is unchanged, and a reader looking for "which date do
 * these bins use" still does not look under `Group by`. The label never says
 * "bin" - the operator's own word for the control is "how that works", and the
 * sections keep their names.
 *
 * WHY REORDER IS ARROW BUTTONS RATHER THAN A DRAG, AND WHY THE ARROWS ARE
 * THE ONLY ROUTE TO A CHANGED SECTION ORDER. The operator asked for reordering
 * here as "a redundant/alternate way over drag and drop and clicking the arrow
 * switches in the divider". A drag inside a popover fights the popover's own
 * pointer handling and cannot be driven by a keyboard; two small buttons per
 * row can, and they say which direction they move in their own names. And no
 * drag-and-drop reorder ships anywhere in this sidebar at this head (the
 * recorded decision is `docs/design/sidebar-sections.md`), so this pair is not
 * an alternate to a gesture that exists - it is the route, and it writes
 * `view.order`, which SECTION draws first.
 *
 * A DIFFERENT AXIS THAN THE DIVIDER'S CONTROLS, deliberately. The divider's
 * chevrons collapse/expand the two REGIONS and its swap glyph reorders them
 * (`setChatSidebarOrder`, `chat-sidebar.tsx`), while this panel's arrows write
 * the section order above. The two cannot disagree because they never write
 * the same field, not because they share one order. (An earlier revision of
 * this comment claimed the pair rode the divider's order and was "an alternate
 * to drag and drop"; neither held - review round 3, R14. See `moveSection` in
 * `chat-sidebar-view.ts` for the same correction in the model's own words.)
 *
 * THE ARROWS ARE BOUNDED BY WHAT IS SHOWN AND BY WHAT CAN MOVE, which is
 * `canMoveSection`'s rule rather than this file's: "up" means the adjacent
 * SHOWN section above the one the reader can see, so the first drawn section's
 * up-arrow is disabled rather than jumping a hidden neighbour - and since
 * 2026-09-28 a chat section's arrow is enabled only when that neighbour is
 * another DRAWN CHAT section (running/today/week/older). Pinned draws no pair
 * at all (the column always draws it first, so a press moved nothing on
 * screen), and neither do the entity rows. That is the one place this panel
 * could disagree with the model, so it asks the model for the answer instead of
 * computing one.
 */

import type { SidebarBasis } from "@features/chat/chat-list-sections";
import {
	SIDEBAR_SECTION_LABEL,
	type SidebarGroupBy,
	type SidebarOrderBy,
	type SidebarSectionKey,
	type SidebarView,
	canMoveSection,
	isChatSection,
	isEntitySection,
	isSectionShown,
	moveSection,
	toggleSection,
} from "@features/chat/chat-sidebar-view";
import { Button } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import {
	Activity,
	Bot,
	Calendar,
	Check,
	ChevronDown,
	ChevronUp,
	History,
	Layers,
	List,
	SlidersHorizontal,
	Users,
} from "lucide-react";
import type { ReactNode } from "react";

/** A row's trailing count, when the caller has one. `undefined` draws nothing. */
export type ViewMenuCounts = Partial<Record<SidebarSectionKey, number>>;

type Props = {
	view: SidebarView;
	counts?: ViewMenuCounts;
	/** Called with the WHOLE next view - the model returns complete values. */
	onView: (view: SidebarView) => void;
};

/** The muted small-caps group label, with the hairline the reference draws. */
const group = (label: string, last = false) => (
	<div
		className={cn(
			"px-1 pt-3 pb-1 font-medium text-ink-dim text-meta uppercase tracking-wide",
			!last && "mb-2 border-hairline border-b",
		)}
	>
		{label}
	</div>
);

/** One row of a single-choice group: icon, label, and the check on the active one. */
const choice = (
	key: string,
	icon: ReactNode,
	label: string,
	active: boolean,
	onPress: () => void,
	/*
	 * The row's evidence hook, and why it is a parameter: `Group by` and `Order by`
	 * carry the generic `data-sidebar-view-choice`, while the Time basis rows asked
	 * for their own `data-sidebar-view-basis` (design direction, 2026-09-28) so the
	 * design rig can drive them without matching a value that could name either
	 * group's row. A caller that passes nothing keeps the generic one.
	 */
	dataAttribute: Record<string, string> = { "data-sidebar-view-choice": key },
) => (
	<button
		key={key}
		type="button"
		role="menuitemradio"
		aria-checked={active}
		{...dataAttribute}
		onClick={onPress}
		className={cn(
			"flex h-7 w-full items-center gap-2 rounded-md px-1 text-left text-body-sm",
			"transition-colors duration-fast ease-out-quart",
			active ? "text-ink" : "text-ink-muted hover:bg-row-hover hover:text-ink",
		)}
	>
		<span className="flex size-4 shrink-0 items-center justify-center">
			{icon}
		</span>
		<span className="min-w-0 flex-1 truncate">{label}</span>
		{/*
		 * The check is the tick the reference draws, and it is `aria-hidden`
		 * because the SELECTION is the radio's own `aria-checked`: a tick that
		 * also announced itself would say the same thing twice.
		 */}
		<Check
			aria-hidden="true"
			className={cn("size-3.5 shrink-0", !active && "opacity-0")}
		/>
	</button>
);

export function ChatSidebarViewMenu({ view, counts, onView }: Props) {
	/*
	 * WHETHER A SECTION WOULD DRAW, for `canMoveSection` (round 1's m1/U1): a
	 * chat section with no loaded rows draws no label in the column
	 * (`chat-sidebar.tsx`: "An empty section contributes no label"), so a swap
	 * with one moves the stored order and this panel while the column stands
	 * still. The counts are the sidebar's own per-section numbers - the same
	 * ones the rows below print and the headers draw - so the disabled state
	 * and the drawn column cannot disagree. A caller with no counts gets the
	 * geometric rule, which is the most that caller can honestly answer.
	 */
	const draws = counts
		? (key: SidebarSectionKey) => (counts[key] ?? 0) > 0
		: undefined;
	const groupBy: { key: SidebarGroupBy; label: string; icon: ReactNode }[] = [
		{
			key: "section",
			label: "Time section",
			icon: <Layers aria-hidden="true" className="size-3.5" />,
		},
		{
			key: "agent",
			label: "Agent and team",
			icon: <Bot aria-hidden="true" className="size-3.5" />,
		},
		{
			key: "flat",
			label: "In one list",
			icon: <List aria-hidden="true" className="size-3.5" />,
		},
	];
	const basis: { key: SidebarBasis; label: string; icon: ReactNode }[] = [
		{
			key: "active",
			// The operator's words for the two, verbatim: "last active" and "creation date".
			label: "Last active",
			icon: <History aria-hidden="true" className="size-3.5" />,
		},
		{
			key: "created",
			label: "Created",
			/*
			 * A plain calendar, not `CalendarPlus` (design round 1, D3): the plus
			 * reads "add to calendar", an action - the row is a fact about the record's
			 * own clock, so it takes the action-less glyph.
			 */
			icon: <Calendar aria-hidden="true" className="size-3.5" />,
		},
	];
	const orderBy: { key: SidebarOrderBy; label: string; icon: ReactNode }[] = [
		{
			key: "active-first",
			// The operator's own word for this: "sorting active to the top".
			label: "Active first",
			icon: <Activity aria-hidden="true" className="size-3.5" />,
		},
		{
			key: "recent",
			label: "Most recent",
			icon: <ChevronDown aria-hidden="true" className="size-3.5" />,
		},
	];

	return (
		/*
		 * THE MENU FILLS THE PANEL IT IS MOUNTED IN, and that is the fix rather than a
		 * default (design round 4's D31): the root carried its own `w-64` while
		 * `PopoverContent` draws a `w-60` card, so every row's trailing control - the
		 * selection tick, the sections' move chevrons - was painted past the card's
		 * own edge, on the dimmed backdrop, in all twelve palettes. One owner for the
		 * width: the panel sets it, this fills it, and the two cannot diverge again.
		 */
		<div data-sidebar-view-menu className="w-full">
			{group("Group by")}
			{/*
			 * A `fieldset`, not a `div role="group"`: it IS the semantic element for a
			 * labelled group of controls, so the grouping survives without an ARIA role
			 * restating what the markup already says - the same swap `ask-options.tsx`
			 * and the canvas view tabs make for their own groups. The UA box is reset by
			 * the utilities below (`border-0 p-0 min-w-0`; a fieldset's `min-inline-size`
			 * is `min-content`, which would stop the long option labels wrapping). Its
			 * name comes from the `sr-only` legend rather than from `aria-label`, because
			 * a fieldset's accessible name is the legend.
			 */}
			<fieldset className="min-w-0 space-y-0.5 border-0 p-0">
				<legend className="sr-only">Group by</legend>
				{groupBy.map((option) =>
					choice(
						option.key,
						option.icon,
						option.label,
						view.groupBy === option.key,
						() => onView({ ...view, groupBy: option.key }),
					),
				)}
			</fieldset>
			{/*
			 * THE TIME BASIS, between the two arrangement groups because it is neither:
			 * it decides which clock the time sections and the row labels read (see
			 * `chat-list-sections.ts`), not how rows are grouped or ordered. A press
			 * writes the whole next view and keeps the panel open, exactly like the
			 * groups above and below (`switches`/`reorder` parity, design direction).
			 */}
			{group("Time basis")}
			{/* The same fieldset + sr-only legend shape as the groups either side. */}
			<fieldset className="min-w-0 space-y-0.5 border-0 p-0">
				<legend className="sr-only">Time basis</legend>
				{basis.map((option) =>
					choice(
						option.key,
						option.icon,
						option.label,
						view.basis === option.key,
						() => onView({ ...view, basis: option.key }),
						{ "data-sidebar-view-basis": option.key },
					),
				)}
			</fieldset>
			{/*
			 * THE ONE LINE THE BASIS NEEDS (UX review round 1, C1; the wording is
			 * design round 2's D2 - "this clock" had no antecedent and read as a
			 * caption of the `Created` row, so it names the SELECTED clock). The
			 * arrangement made this control decide the ORDER as well as what the dates
			 * read (2026-10-08), and nothing in the panel said so - a reader switching
			 * clocks watched the list re-sort with no explanation. One subtext in the
			 * same voice as the hidden-sections sentence below; the group's two
			 * labels and its structure are untouched.
			 */}
			<p className="px-1 pt-0.5 pb-1 text-meta text-ink-dim">
				Dates and ordering follow the selected clock.
			</p>
			{group("Order by")}
			{/* The same group, for the same reason - see the comment above. */}
			<fieldset className="min-w-0 space-y-0.5 border-0 p-0">
				<legend className="sr-only">Order by</legend>
				{orderBy.map((option) =>
					choice(
						option.key,
						option.icon,
						option.label,
						view.orderBy === option.key,
						() => onView({ ...view, orderBy: option.key }),
					),
				)}
			</fieldset>
			{/*
			 * THE SECTION SWITCHES, over the VIEW's own order rather than over the
			 * canonical one: a list that re-sorted itself here would undo the
			 * reorder the row above it was just used for.
			 *
			 * The entity sections are switches like the rest, and their state is
			 * `view.hidden` like the rest: the tick, the press and the sentence under
			 * the list all read one field the store owns. The `Agents`/`Teams` rows'
			 * own chevrons are a DIFFERENT question - whether a drawn row's children
			 * are on screen - and the pair cannot disagree, because a section this
			 * switch took off the column has no chevron left to disagree with.
			 * `ENTITY_SECTIONS` carries the correction and the report it came from.
			 */}
			{group("Sections")}
			<div className="space-y-0.5">
				{view.order.map((key) => {
					const on = isSectionShown(view, key);
					/*
					 * THE PAIR IS DRAWN ONLY ON THE CHAT SECTIONS, and a press is offered
					 * only where the move can land (2026-09-28, D1): Pinned is drawn first
					 * whatever this list says and the entity region draws in fixed source
					 * order, so a pair on either moved the stored order and this menu while
					 * the column stood still - the popover then described a column that did
					 * not exist. `canMoveSection` is the model's rule, asked rather than
					 * re-derived; the disabled state IS the "adjacent shown section is a chat
					 * section" answer - and where this panel has counts (it does), the same
					 * numbers the section headers draw are asked whether BOTH ends of the
					 * move would draw, so an empty section's pair is disabled rather than
					 * moving something no one can see (round 1's m1/U1).
					 */
					return (
						<div
							key={key}
							className="flex h-7 items-center gap-1 rounded-md pl-1 text-body-sm"
						>
							<button
								type="button"
								role="menuitemcheckbox"
								aria-checked={on}
								data-sidebar-view-section={key}
								onClick={() => onView(toggleSection(view, key))}
								className={cn(
									"flex h-7 min-w-0 flex-1 items-center gap-2 text-left",
									on ? "text-ink" : "text-ink-muted",
								)}
							>
								<span className="flex size-4 shrink-0 items-center justify-center">
									{isEntitySection(key) ? (
										<Users aria-hidden="true" className="size-3.5" />
									) : (
										<SlidersHorizontal
											aria-hidden="true"
											className="size-3.5"
										/>
									)}
								</span>
								<span className="min-w-0 flex-1 truncate">
									{SIDEBAR_SECTION_LABEL[key]}
								</span>
								{/*
								 * The section's row count, when the caller has one: a
								 * switch that says what it is switching off is the same
								 * convention the section headers already follow, and a
								 * count of zero draws nothing rather than a `0` badge.
								 */}
								{counts?.[key] ? (
									<span className="shrink-0 font-mono text-ink-dim text-mono-sm">
										{counts[key]}
									</span>
								) : null}
								{/*
								 * `on` is drawn as a filled eye-like mark rather than greyed
								 * text: a list of seven switches where "off" is only a
								 * lighter colour is a list the reader has to compare with
								 * itself, and this panel's whole job is showing state.
								 */}
								<Check
									aria-hidden="true"
									className={cn("size-3.5 shrink-0", !on && "opacity-0")}
								/>
							</button>
							{/*
							 * The reorder pair, at the panel's trailing edge, labelled
							 * in the row's own name so a screen reader hears which
							 * section moves and which way.
							 *
							 * DRAWN ON THE CHAT SECTIONS ALONE (D1 above). The pair's
							 * whole rule is that a control which moves a section moves it
							 * WHERE THE READER SEES IT; on Pinned and the entity rows that
							 * was false (the column pins its own order for both), so the
							 * honest form is not to draw it.
							 */}
							{isChatSection(key) && (
								<>
									<Button
										variant="ghost"
										size="icon-sm"
										data-sidebar-view-move={`${key}:up`}
										aria-label={`Move ${SIDEBAR_SECTION_LABEL[key]} up`}
										disabled={!canMoveSection(view, key, -1, draws)}
										className="size-6"
										onClick={() => onView(moveSection(view, key, -1))}
									>
										<ChevronUp aria-hidden="true" className="size-3" />
									</Button>
									<Button
										variant="ghost"
										size="icon-sm"
										data-sidebar-view-move={`${key}:down`}
										aria-label={`Move ${SIDEBAR_SECTION_LABEL[key]} down`}
										disabled={!canMoveSection(view, key, 1, draws)}
										className="size-6"
										onClick={() => onView(moveSection(view, key, 1))}
									>
										<ChevronDown aria-hidden="true" className="size-3" />
									</Button>
								</>
							)}
						</div>
					);
				})}
			</div>
			{/*
			 * The hidden count is a sentence rather than a badge, because the
			 * number of hidden sections is not a thing to act on - the switches
			 * above are - and dsh's own panel says nothing at all here. This one
			 * says it because a reader who hid four sections a week ago has no
			 * other place to learn why their list looks short.
			 */}
			{view.hidden.length > 0 && (
				<p className="mt-2 px-1 text-meta text-ink-dim">
					{view.hidden.length === 1
						? "1 section hidden"
						: `${view.hidden.length} sections hidden`}
				</p>
			)}
		</div>
	);
}
