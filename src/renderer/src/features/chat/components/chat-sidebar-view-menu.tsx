/**
 * The sidebar's view popover: one panel, three labelled groups, the active row
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
 * THE THREE GROUPS ARE THE OPERATOR'S REFERENCE (dsh's sidebar, 2026-09-25): a
 * popover of muted small-caps group labels, one icon + label per row, a
 * checkmark on the active row, and a hairline between groups. `Group by` and
 * `Order by` are single-choice and carry the check; `Sections` is a list of
 * switches, and it is where the operator's "showing and hiding sections,
 * reordering" lives.
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
 * THE ARROWS ARE BOUNDED BY WHAT IS SHOWN, which is `moveSection`'s rule rather
 * than this file's: "up" means the section above the one the reader can see, so
 * the first drawn section's up-arrow is disabled rather than jumping a hidden
 * neighbour. That is the one place this panel could disagree with the model, so
 * it asks the model for the answer instead of computing one.
 */

import {
	SIDEBAR_SECTION_LABEL,
	type SidebarGroupBy,
	type SidebarOrderBy,
	type SidebarSectionKey,
	type SidebarView,
	isEntitySection,
	isSectionShown,
	moveSection,
	shownSections,
	toggleSection,
} from "@features/chat/chat-sidebar-view";
import { Button } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import {
	Activity,
	Bot,
	Check,
	ChevronDown,
	ChevronUp,
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

/** One row of `Group by` or `Order by`: icon, label, and the check on the active one. */
const choice = (
	key: string,
	icon: ReactNode,
	label: string,
	active: boolean,
	onPress: () => void,
) => (
	<button
		key={key}
		type="button"
		role="menuitemradio"
		aria-checked={active}
		data-sidebar-view-choice={key}
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
	const shown = shownSections(view);
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
			 * The entity sections are switches like the rest, and their state is the
			 * DISCLOSURE the Agents and Teams rows already own (see
			 * `ENTITY_SECTIONS`): one decision, one spelling, so the popover's tick
			 * and the row's chevron can never disagree about whether Agents is open.
			 */}
			{group("Sections")}
			<div className="space-y-0.5">
				{view.order.map((key) => {
					const on = isSectionShown(view, key);
					const at = shown.indexOf(key);
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
							 * NOT OFFERED ON THE TWO ENTITY ROWS (UX round 3's U23). The
							 * pair's rule is that a control which moves a section moves it
							 * WHERE THE READER SEES IT, and the entity region draws its two
							 * sections in fixed source order (Agents above Teams - the
							 * region's own anatomy, like the header and the search field
							 * above it). An arrow there moved only the stored order and this
							 * menu: offered, pressed, and inert in the region it named. The
							 * honest form of the rule is not to draw it, so the entity rows
							 * keep the switch and the tick and no pair.
							 */}
							{!isEntitySection(key) && (
								<>
									<Button
										variant="ghost"
										size="icon-sm"
										data-sidebar-view-move={`${key}:up`}
										aria-label={`Move ${SIDEBAR_SECTION_LABEL[key]} up`}
										disabled={at <= 0 || !shown.includes(key)}
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
										disabled={
											!shown.includes(key) || at < 0 || at >= shown.length - 1
										}
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
