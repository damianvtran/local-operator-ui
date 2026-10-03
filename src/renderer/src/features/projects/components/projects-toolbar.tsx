/**
 * The Projects tab's search/filter toolbar: the search field, the Filters
 * button and popover, the result count, and the chips row under the switcher.
 *
 * WHY IT IS TWO COMPONENTS AND NOT ONE ROW: the switcher row and the chips row
 * are two lines of one block (`ProjectsSearchControls` renders the right
 * cluster INSIDE the switcher row; `ProjectsFilterChips` renders the second
 * line), and the difference is load-bearing — the ux round's U1 ruling moved
 * the result count into the switcher row precisely so that NO new row mounts
 * on the first keystroke: the row's height is a function of STATE (a facet or
 * a sort chosen), never of how much has been typed.
 *
 * THE CHIPS ROW'S TWO FACTS: a chip exists per active FACET (the ux round's
 * "one chip per active facet"; its label is `Facet · first option +N`, and
 * removing it clears that facet), and the SORT chip (U6) exists whenever an
 * explicit column sort is set — including when the sorted column has been shed
 * by a narrow window, which is the case U6 exists for. `Clear all` clears the
 * query, every facet and the sort (→ Default; design round 2, D7 — it used to
 * leave the sort standing, which read as a no-op on a sort-only chips row).
 *
 * THE HANDOFFS ARE THE FEATURE'S OWN PATTERN (U4, and
 * `projects-page.tsx`'s "Show all time" comment): the control that is pressed
 * here may unmount in the same commit that performs its effect, and the
 * browser drops focus to `<body>` when the focused element leaves the DOM — so
 * every removal names its destination and a post-commit effect waits for the
 * node before focusing it (`useMoveFocusHandoff`'s shape, local because the
 * destinations are selectors across two components rather than one card).
 */

import { KeyboardShortcut } from "@shared/components/common/keyboard-shortcut";
import {
	Badge,
	Button,
	Input,
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@shared/components/ui";
import { useDebouncedValue } from "@shared/hooks/use-debounced-value";
import { cn } from "@shared/lib/utils";
import { ArrowDown, ArrowUp, ListFilter, Search, X } from "lucide-react";
import type { FC, ReactNode, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import type { DesktopProject } from "../../../../../shared/desktop-control-contract";
import { clearSearch } from "../../chat/clear-search";
import {
	FACET_LABELS,
	FACET_ORDER,
	type FilterFacetKey,
	type FilterOptionValue,
	type FilterState,
	activeSelectionCount,
	filterOptionLabel,
	isFilterEmpty,
	toggleFilterValue,
} from "../project-filters";
import type { SortSpec } from "../project-sort";
import { sortColumnLabel, sortDirectionWords } from "../project-sort";
import {
	FilterPopoverScroll,
	ProjectFiltersPanel,
} from "./project-filters-panel";

/* ------------------------------------------------------- search controls -- */

export type ProjectsSearchControlsProps = {
	/**
	 * The popover's count population: the rows the current query ADMITS (the
	 * page hands the search's own row set, not the whole listing), so a count
	 * always answers "how many would I see if I picked this?" over exactly the
	 * rows the list beside it draws from. Derived only while the panel is open.
	 */
	projects: DesktopProject[];
	query: string;
	onQueryChange: (query: string) => void;
	filters: FilterState;
	onFiltersChange: (next: FilterState) => void;
	/** The popover header's Clear all: the query, every facet and the sort (D7). */
	onClearAll: () => void;
	todayMs: number;
	/** `12 of 74 projects` (or the Board's windowed count); `null` hides the line. */
	resultText: string | null;
	/**
	 * The class that reveals the count at the width its own row can hold it
	 * (see the count's comment): List and Timeline reveal at 37rem of
	 * container, the Board at 47rem, whose row also carries the window
	 * control. The default is the List/Timeline constant.
	 */
	countRevealClass?: string;
	/** The board's window select, when the Board is the view. */
	trailing?: ReactNode;
	/**
	 * The listing read FAILED: the Filters door closes (design §2.3 — filtering
	 * a set that failed to load is meaningless), while the field stays enabled
	 * so a reader's query survives the retry (and a later success answers it).
	 * Disabled changes colour, never opacity (branding §2).
	 */
	disabled?: boolean;
	/** The page's handle for `/`, ⌘F and the body's Clear all. */
	searchFieldRef: RefObject<HTMLInputElement>;
};

export const ProjectsSearchControls: FC<ProjectsSearchControlsProps> = ({
	projects,
	query,
	onQueryChange,
	filters,
	onFiltersChange,
	onClearAll,
	todayMs,
	resultText,
	countRevealClass = "@[37rem]:inline",
	trailing,
	disabled = false,
	searchFieldRef,
}) => {
	const [filtersOpen, setFiltersOpen] = useState(false);
	/* Set by the popover header's Clear all; read once by the close-focus
	 * guard below so the suppressed restore applies only to that path. */
	const headerClearRef = useRef(false);
	const activeCount = activeSelectionCount(filters);
	/*
	 * The count ANNOUNCED is the settled one (the ux round's N4 fold, 300 ms
	 * trailing): the visible line answers every keystroke, but a live region
	 * that repeated it per character would talk over the reader's typing. The
	 * debounced copy rides a separate `sr-only` `<output>`, which is the
	 * element this app already uses for an announcement.
	 */
	const settledResult = useDebouncedValue(resultText ?? "", 300);
	const showCount = query.trim() !== "" || !isFilterEmpty(filters);
	return (
		<div className="ml-auto flex min-w-0 items-center gap-3">
			<div className="relative w-full min-w-0 max-w-[400px]">
				<Search
					size={16}
					className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-dim"
					aria-hidden="true"
				/>
				<Input
					ref={searchFieldRef}
					inputSize="sm"
					value={query}
					onChange={(event) => onQueryChange(event.target.value)}
					onKeyDown={(event) => {
						/*
						 * Escape clears when there is something to clear, else
						 * blurs — and it does NOT touch the facets (Clear all is
						 * their one door), so Escape stays available to whatever
						 * else may want it the moment the field is empty.
						 */
						if (event.key !== "Escape") return;
						if (query) onQueryChange("");
						else event.currentTarget.blur();
					}}
					placeholder="Search projects"
					aria-label="Search projects"
					autoComplete="off"
					spellCheck={false}
					className="pl-9"
				/>
				{query ? (
					<Button
						variant="ghost"
						size="icon-sm"
						className="absolute top-1/2 right-1 -translate-y-1/2"
						onClick={() => clearSearch(searchFieldRef.current, onQueryChange)}
						aria-label="Clear search"
					>
						<X aria-hidden="true" />
					</Button>
				) : (
					/*
					 * The `/` hint (the ux round's folded N2): the one house idiom
					 * for advertising a chord is `KeyboardShortcut`, and the field's
					 * right edge is the one place on this row that can carry it
					 * without moving anything — the clear control takes the slot the
					 * moment there is something to clear.
					 */
					<span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-ink-dim">
						<KeyboardShortcut shortcut="/" />
					</span>
				)}
			</div>
			<Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
				<PopoverTrigger asChild>
					{/*
					    Radix puts aria-haspopup and aria-expanded on this button; the
					    content is a dialog-role popover, which is why the design's
					    `aria-haspopup="menu"` sketch is not reproduced — a menu is
					    not what opens here. Disabled with the failed read (R2).
					*/}
					<Button
						variant="secondary"
						size="sm"
						disabled={disabled}
						data-project-filters-button=""
					>
						<ListFilter size={14} aria-hidden="true" />
						Filters
						{activeCount > 0 && <Badge variant="neutral">{activeCount}</Badge>}
					</Button>
				</PopoverTrigger>
				<PopoverContent
					align="end"
					aria-label="Filters"
					className="w-80 p-0"
					/* U12: after a header Clear all the handoff owns focus; Radix's
					 * default close restore would drag it back to the trigger. */
					onCloseAutoFocus={(event) => {
						if (headerClearRef.current) {
							headerClearRef.current = false;
							event.preventDefault();
						}
					}}
				>
					<FilterPopoverScroll>
						<ProjectFiltersPanel
							projects={projects}
							state={filters}
							query={query}
							todayMs={todayMs}
							onToggle={(facet, value) =>
								onFiltersChange(toggleFilterValue(filters, facet, value))
							}
							onClearAll={() => {
								/* U12: this door cleared the state but dropped focus to
								 * <body>, while the chips row's and the no-match block's
								 * both take the handoff to the search field. Close the
								 * popover (its subject is cleared) and take the same
								 * handoff; the close-focus restore is suppressed for this
								 * path or it would take focus back to the trigger. */
								onClearAll();
								headerClearRef.current = true;
								setFiltersOpen(false);
								/* The field never unmounts, so the handoff is direct
								 * (the no-match block's own shape) rather than the
								 * wait-for-commit kind the chips row needs. */
								searchFieldRef.current?.focus();
							}}
						/>
					</FilterPopoverScroll>
				</PopoverContent>
			</Popover>
			{showCount && resultText !== null && (
				/*
				 * SHED BELOW THE ROW'S OWN FIT WIDTH (U7): the count is the one item
				 * in this cluster that appears on the first keystroke, and below its
				 * fit width it pushed the cluster past the row — the first character
				 * wrapped the switcher row (32 -> 72px on the List) and moved the
				 * content below down with it, the same jump U1 was raised to remove.
				 * The reveal is the MEASURED fit boundary per row: the List/Timeline
				 * row fits the count from 592px of container (572 wrapped, 592 fit),
				 * the Board's from 752px (732 wrapped, 752 fit) because it carries
				 * the window control as well; the page passes the Board's constant
				 * down. Below the boundary the row stays single-line in state 0 AND
				 * state 1. The sr-only announcement above stays unconditional — the
				 * shed is a layout decision, not an information one.
				 */
				<span
					className={cn(
						"hidden whitespace-nowrap text-meta text-ink-dim",
						countRevealClass,
					)}
					data-project-count=""
				>
					{resultText}
				</span>
			)}
			<output className="sr-only" aria-live="polite">
				{settledResult}
			</output>
			{trailing}
		</div>
	);
};

/* --------------------------------------------------------------- chips -- */

/** One chip's model: a facet chip or the sort chip (see the header). */
type ChipModel =
	| {
			kind: "facet";
			facet: FilterFacetKey;
			label: string;
			ariaLabel: string;
			clear: () => void;
	  }
	| {
			kind: "sort";
			spec: SortSpec;
			label: string;
			ariaLabel: string;
			clear: () => void;
	  };

export type ProjectsFilterChipsProps = {
	filters: FilterState;
	sort: SortSpec | null;
	onFiltersChange: (next: FilterState) => void;
	onSortChange: (next: SortSpec | null) => void;
	/** Clear the query and every facet (the sort chip has its own door). */
	onClearAll: () => void;
	/** The no-match block carries its own Clear all; while it is up, this
	 * row's copy would be the second identically labelled button on the
	 * screen (U14), so the page hides it. */
	hideClearAll?: boolean;
	searchFieldRef: RefObject<HTMLInputElement>;
};

export const ProjectsFilterChips: FC<ProjectsFilterChipsProps> = ({
	filters,
	sort,
	onFiltersChange,
	onSortChange,
	onClearAll,
	hideClearAll = false,
	searchFieldRef,
}) => {
	/*
	 * The post-commit focus handoff (see the header). `chip` targets the chip
	 * that took the removed one's slot — the row re-renders without it in the
	 * same commit, so the effect below runs against the settled list — with a
	 * fallback to the Filters button for the last-chip case, which unmounts
	 * the whole row.
	 */
	const [handoff, setHandoff] = useState<
		{ kind: "chip"; index: number } | { kind: "search" } | null
	>(null);
	useEffect(() => {
		if (!handoff) return;
		let node: HTMLElement | null = null;
		if (handoff.kind === "search") {
			node = searchFieldRef.current;
		} else {
			node = document.querySelector<HTMLElement>(
				`[data-project-chip="${handoff.index}"]`,
			);
			if (!node)
				node = document.querySelector<HTMLElement>("[data-project-chip]");
			if (!node)
				node = document.querySelector<HTMLElement>(
					"[data-project-filters-button]",
				);
		}
		if (!node) return; // not committed yet; the next render retries
		node.focus();
		setHandoff(null);
	});

	const chips: ChipModel[] = [];
	for (const facet of FACET_ORDER) {
		const values = filters[facet] as FilterOptionValue[];
		if (values.length === 0) continue;
		const labels = values.map((value) => filterOptionLabel(facet, value));
		const first = labels[0];
		const label =
			labels.length > 1
				? `${FACET_LABELS[facet]} · ${first} +${labels.length - 1}`
				: `${FACET_LABELS[facet]} · ${first}`;
		chips.push({
			kind: "facet",
			facet,
			label,
			ariaLabel: `Remove filter: ${FACET_LABELS[facet]} · ${labels.join(", ")}`,
			clear: () => onFiltersChange({ ...filters, [facet]: [] }),
		});
	}
	if (sort) {
		chips.push({
			kind: "sort",
			spec: sort,
			label: `Sort: ${sortColumnLabel(sort.key)}`,
			ariaLabel: `Remove sort: ${sortColumnLabel(sort.key)}, ${sortDirectionWords(sort.key, sort.direction)}`,
			clear: () => onSortChange(null),
		});
	}
	if (chips.length === 0) return null;

	const removeChip = (index: number, chip: ChipModel) => {
		chip.clear();
		const remaining = chips.length - 1;
		if (remaining === 0) setHandoff({ kind: "chip", index: 0 });
		else setHandoff({ kind: "chip", index: Math.min(index, remaining - 1) });
	};

	return (
		<div className="flex flex-wrap items-center gap-2">
			{chips.map((chip, index) => (
				<Badge
					key={chip.kind === "facet" ? chip.facet : "sort"}
					asChild
					variant="neutral"
					className="gap-1 pr-1 text-ink"
				>
					<button
						type="button"
						className="group"
						data-project-chip={index}
						aria-label={chip.ariaLabel}
						onClick={() => removeChip(index, chip)}
					>
						{chip.kind === "sort" &&
							(chip.spec.direction === "asc" ? (
								<ArrowUp
									size={10}
									className="text-ink-muted"
									aria-hidden="true"
								/>
							) : (
								<ArrowDown
									size={10}
									className="text-ink-muted"
									aria-hidden="true"
								/>
							))}
						<span className="truncate">{chip.label}</span>
						<X
							className={cn(
								"text-ink-dim transition-colors duration-fast ease-out-quart",
								"group-hover:text-danger",
							)}
							aria-hidden="true"
						/>
					</button>
				</Badge>
			))}
			{!hideClearAll && (
				<Button
					variant="link"
					size="sm"
					onClick={() => {
						onClearAll();
						setHandoff({ kind: "search" });
					}}
				>
					Clear all
				</Button>
			)}
		</div>
	);
};
