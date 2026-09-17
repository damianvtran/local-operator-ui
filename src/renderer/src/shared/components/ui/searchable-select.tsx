/**
 * The searchable select: a combobox that filters, commits a stored id, shows a
 * different label, and always still accepts free text.
 *
 * ## Why this lives in `ui/`
 *
 * It was written for the hosting and model pickers and has been the app's one
 * searchable single-select since; the settings registry's provider and model
 * rows needed the same control, and a second combobox beside it is the
 * "a second implementation is a defect" case `docs/branding.md` § 9.1 names.
 * It moved here rather than being copied, and
 * `shared/components/hosting/searchable-select.tsx` is now a one-line
 * re-export so the call sites that predate the move did not churn.
 *
 * The move carries one layering wart, stated rather than hidden: `Spinner`
 * comes from `shared/components/common/spinner`, and this directory is the
 * primitive layer. A spinner is a primitive too, so this is a wart rather than
 * a violation, and inlining one to satisfy the layering would be worse.
 *
 * ## Stored value and shown text are two different things
 *
 * `option.id` is what `onSelect` hands back; `option.name` is what the input
 * displays and the only thing the filter matches. That separation is the whole
 * reason one component can serve a field that stores a bare model id while
 * showing a `provider/model` selector, without a controlled-text mode: the
 * component never has to reconcile "what the user typed" with "what is
 * stored", because the field's text IS the shown label and the owner says
 * which row that is.
 *
 * ## MUI's `Autocomplete` has no counterpart in the primitive layer
 *
 * One may not be added there, so the combobox is assembled from `Popover` +
 * `Input` + a hand-rolled listbox. The primitive `Select` is the wrong shape:
 * a model list runs to several hundred entries and type-to-filter is the only
 * way anyone finds one. ARIA is written out rather than inherited, because the
 * keyboard contract IS the control here: `combobox` / `listbox` / `option`
 * plus `aria-activedescendant`, which is what lets the active row move while
 * focus stays in the text field.
 */

import { Spinner } from "@shared/components/common/spinner";
import { cn } from "@shared/lib/utils";
import { ChevronDown, X } from "lucide-react";
import type { FC, KeyboardEvent, ReactNode } from "react";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
/*
 * Imported from their own modules rather than from this directory's barrel.
 * `index.ts` re-exports this file, so going through it would make the two
 * modules circular for no gain.
 */
import { Button } from "./button";
import { Input } from "./input";
import { Popover, PopoverAnchor, PopoverContent } from "./popover";
import { Tooltip } from "./tooltip";

export type SearchableOption = {
	/** The value handed back on selection. Unique within `options`. */
	id: string;
	/** The label, and the only thing the filter matches against. */
	name: string;
	/** Second line of the row. */
	description?: ReactNode;
	/** Rendered after the name — the model picker's "recommended" star. */
	adornment?: ReactNode;
	/**
	 * Heading this row sits under. A heading is emitted whenever the group
	 * changes from the previous row, so `options` must already be in group
	 * order; nothing here sorts.
	 */
	group?: string;
};

export type SearchableSelectProps = {
	/**
	 * The label above the field. Required in the labelled variant only: a
	 * caller that renders its own label passes `showLabel={false}` and names
	 * the input with `ariaLabel` instead.
	 */
	label?: string;
	/** Rendered before the label. */
	icon?: ReactNode;
	/** Explains the field. Attached to the label, as it was under MUI. */
	labelTooltip?: ReactNode;
	placeholder: string;
	options: SearchableOption[];
	/** The row to show as chosen, or `null` for an empty field. */
	selected: SearchableOption | null;
	onSelect: (option: SearchableOption) => void;
	/**
	 * Enter on text that matches no option. Omit to reject free text, which is
	 * what `allowCustom={false}` means at the call sites.
	 *
	 * This is also the CLEAR path: an owner that wants an explicit clear
	 * affordance supplies `onClear` below, which commits the empty value
	 * through this same route rather than through a second write path.
	 */
	onCustomSubmit?: (text: string) => void;
	helperText?: ReactNode;
	/**
	 * Swaps the chevron for a spinner, and makes the LIST say so: while the
	 * options are on their way the list carries a loading row instead of the
	 * empty text, because "nothing matches" is a claim about a query that has
	 * not answered yet. See the list's own rendering below.
	 */
	busy?: boolean;
	/** What `busy` means. The spinner has no adjacent text to borrow. */
	busyLabel: string;
	disabled?: boolean;
	/**
	 * Called on every open/close transition, so an owner can fetch its options
	 * lazily on the FIRST open rather than on mount. A model catalogue is
	 * several hundred kilobytes and most visits to a settings page never ask a
	 * model question; a field that paints immediately and fetches inside the
	 * gesture that asked for it does not stall anything.
	 */
	onOpenChange?: (open: boolean) => void;
	/**
	 * Renders an explicit clear affordance, committing the empty value.
	 *
	 * Distinct from deleting the text by hand on purpose: a field that
	 * `empty_unsets` needs "unset" and "matched nothing" to be two different
	 * outcomes, and a control that only ever writes what the user typed cannot
	 * express the first one. Omitted everywhere that distinction does not
	 * exist, which is why the three older call sites are unaffected.
	 */
	onClear?: () => void;
	/** The accessible name, when there is no rendered `<label>` to be it. */
	ariaLabel?: string;
	/** Extra ids the input describes itself by (the registry row's help). */
	ariaDescribedBy?: string;
	/**
	 * Renders the label block, or not. Default true, i.e. the behaviour every
	 * call site had before the settings rows arrived; they render their own
	 * label, warning and help and therefore pass false.
	 */
	showLabel?: boolean;
	/** What the list says when the filter matches nothing. */
	emptyText?: string;
	/**
	 * A line at the TOP of the list saying what the list is a list OF.
	 *
	 * The filter is not the only thing that can narrow a list: an owner may
	 * narrow it on its own (the settings model field is narrowed by the provider
	 * above it), and a narrowing nobody states is a narrowing the user has to
	 * infer from row text. Silent when the scope is obvious, which is what makes
	 * it worth reading when it is there.
	 */
	listNotice?: ReactNode;
	/**
	 * Renders a LAST row carrying the text in the field, and names it. Opt-in,
	 * because committing free text is the owner's decision (`onCustomSubmit`) and
	 * a field that rejects free text must not offer the row.
	 *
	 * It exists so that "assist, never constrain" stays true without the trap it
	 * otherwise sets: Enter takes the row the list is showing, so the typed value
	 * needs a row of its own to be committable deliberately.
	 */
	customRowLabel?: (text: string) => string;
};

/**
 * Case- and accent-insensitive, matching what `createFilterOptions()` did by
 * default. Dropping the accent fold would quietly break "Gemini Ultra" style
 * names that arrive from the API with combining marks.
 */
export const fold = (text: string): string =>
	text
		.normalize("NFD")
		// biome-ignore lint/suspicious/noMisleadingCharacterClass: combining marks
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase();

/**
 * The rows a query admits, in the order they were given.
 *
 * Exported and pure so the filter is assertable without a browser: it is one
 * of the two rules this control's behaviour rests on (the other is
 * exact-name-beats-free-text, in `resolveEnter` below), and a rule stated only
 * inside a `useMemo` is a rule nothing can fail.
 */
export function filterSearchableOptions(
	options: SearchableOption[],
	query: string,
	selectedName: string,
): SearchableOption[] {
	const typed = query.trim();
	// Once the text equals the current selection there is nothing to filter
	// by — this is what makes clicking the field show the whole list instead
	// of the one row already chosen. `Autocomplete` did the same thing
	// internally; the old code approximated it with an `isUserTyping` ref.
	if (!typed || typed === selectedName) return options;
	const needle = fold(typed);
	return options.filter((option) => fold(option.name).includes(needle));
}

/**
 * One row of the listbox: a heading, an option, or the row that carries the
 * text the user typed.
 *
 * `index` is the row's position in the KEYBOARD's own numbering — options
 * first, the typed-text row last — which is what `aria-activedescendant` names
 * and what every resolver below is written in. Headings carry no index because
 * the keyboard cannot land on one.
 */
/** A row the keyboard can land on, which is every row but a heading. */
export type ComboboxOptionRow =
	| { kind: "option"; option: SearchableOption; index: number }
	| { kind: "custom"; text: string; index: number };

export type ComboboxRow = { kind: "group"; label: string } | ComboboxOptionRow;

/**
 * The rows the listbox draws, in order: the options the filter admits, grouped,
 * then - when this field commits free text - one LAST row carrying the typed
 * text.
 *
 * ## Why the typed value is a row of its own, and not just a fallback
 *
 * "Assist, never constrain" means a value no listing knows must still be
 * committable, and Enter is how this control commits. That makes Enter
 * ambiguous on exactly the gesture a searchable list exists for: type `ant`,
 * see one row, press Enter. The row is the answer the user is looking at, so
 * that is what Enter takes - and the typed text gets its own row at the END, so
 * committing it stays a visible, deliberate act rather than the invisible
 * consequence of a keystroke nobody could see the effect of.
 *
 * The row is built only when the caller sets `customRow` (a field that rejects
 * free text has nothing for it to carry) and only when the text is not already
 * an option's own name, because then the option's row IS the typed value.
 */
export function buildComboboxRows(
	options: SearchableOption[],
	query: string,
	selectedName: string,
	customRow: boolean,
): ComboboxRow[] {
	const visible = filterSearchableOptions(options, query, selectedName);
	const out: ComboboxRow[] = [];
	let currentGroup: string | undefined;
	visible.forEach((option, index) => {
		if (option.group && option.group !== currentGroup) {
			currentGroup = option.group;
			out.push({ kind: "group", label: option.group });
		}
		out.push({ kind: "option", option, index });
	});
	const typed = query.trim();
	if (
		customRow &&
		typed &&
		!visible.some((option) => fold(option.name) === fold(typed))
	) {
		out.push({ kind: "custom", text: typed, index: visible.length });
	}
	return out;
}

/** How many rows the keyboard can reach. A heading is not a row. */
export const navigableRowCount = (rows: ComboboxRow[]): number =>
	rows.reduce((count, row) => (row.kind === "group" ? count : count + 1), 0);

/**
 * The row the keyboard is on: the stored highlight, or the row this filter's
 * own gesture implies.
 *
 * `activeIndex` is what the arrow keys last set and it is -1 until they do, and
 * that -1 must not be resolved blindly into "row 0", because two states look
 * alike and mean opposite things:
 *
 * - **the field at rest** - opened with its own value in it, so the filter is
 *   showing every row. The first row of an unnarrowed list is arbitrary, and
 *   resolving Enter to it would let "click the field, press Enter" silently
 *   replace the value. Nothing is resolved: no row is marked, Enter is nobody's.
 * - **a query narrowing the list** - typed text that is not the current
 *   selection's own name. Whatever the user is looking at is the answer, so the
 *   first row is resolved; an exact name match wins instead, because typing a
 *   whole name is a deliberate act and the filter can admit a longer name ahead
 *   of the shorter one that matches exactly.
 *
 * This is the half of the fix the keyboard contract rests on: it is what makes
 * "type three characters, press Enter" commit the row the list is showing
 * rather than the three characters.
 */
export function resolveActiveIndex(
	rows: ComboboxRow[],
	query: string,
	selectedName: string,
	activeIndex: number,
): number {
	const navigable = navigableRowCount(rows);
	if (navigable === 0) return -1;
	if (activeIndex >= 0 && activeIndex < navigable) return activeIndex;
	const typed = query.trim();
	if (!typed || fold(typed) === fold(selectedName)) return -1;
	const exact = rows.find(
		(row): row is ComboboxOptionRow =>
			row.kind === "option" && fold(row.option.name) === fold(typed),
	);
	return exact ? exact.index : 0;
}

/**
 * What Enter commits: the resolved active row, whether that is an option or the
 * row carrying the typed text. The rules that decide WHICH row that is live in
 * `buildComboboxRows` and `resolveActiveIndex` above; this reads the answer.
 */
export function resolveEnter(
	rows: ComboboxRow[],
	activeIndex: number,
):
	| { kind: "option"; option: SearchableOption }
	| { kind: "custom"; text: string }
	| { kind: "none" } {
	if (activeIndex < 0) return { kind: "none" };
	const row = rows.find(
		(candidate) =>
			candidate.kind !== "group" && candidate.index === activeIndex,
	);
	if (!row || row.kind === "group") return { kind: "none" };
	if (row.kind === "custom") return { kind: "custom", text: row.text };
	return { kind: "option", option: row.option };
}

export const SearchableSelect: FC<SearchableSelectProps> = ({
	label,
	icon,
	labelTooltip,
	placeholder,
	options,
	selected,
	onSelect,
	onCustomSubmit,
	helperText,
	busy = false,
	busyLabel,
	disabled = false,
	onOpenChange,
	onClear,
	ariaLabel,
	ariaDescribedBy,
	showLabel = true,
	emptyText = "No matches",
	listNotice,
	customRowLabel,
}) => {
	const baseId = useId();
	const inputId = `${baseId}-input`;
	const listId = `${baseId}-listbox`;
	const helperId = `${baseId}-helper`;

	const anchorRef = useRef<HTMLDivElement>(null);
	const optionRefs = useRef<(HTMLLIElement | null)[]>([]);

	const [open, setOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(-1);

	/**
	 * Every open/close goes through here, because the owner's notification and
	 * this component's state must not be able to disagree: the lazy model
	 * fetch hangs off "the list is open", and a path that set the state without
	 * telling the owner would leave the list open on an empty field forever.
	 */
	const setOpenState = useCallback(
		(next: boolean) => {
			setOpen(next);
			onOpenChange?.(next);
		},
		[onOpenChange],
	);

	const selectedName = selected?.name ?? "";
	const [query, setQuery] = useState(selectedName);

	// The field is not a free-text box that happens to have a list: whatever the
	// owner says is selected wins, so a save that resolves to a different id
	// (or fails and reverts) is reflected in the text.
	useEffect(() => {
		setQuery(selectedName);
	}, [selectedName]);

	/*
	 * The rows on screen, and the two numbers the keyboard is written in:
	 * `navigable` counts the rows it can reach (a heading is not a row, and the
	 * typed-text row is one), and `resolvedIndex` is the row it is ON - the
	 * stored highlight, or the first row of a list a query has narrowed.
	 */
	const rows = useMemo(
		() =>
			buildComboboxRows(
				options,
				query,
				selectedName,
				Boolean(onCustomSubmit && customRowLabel),
			),
		[options, query, selectedName, onCustomSubmit, customRowLabel],
	);
	const navigable = navigableRowCount(rows);
	/*
	 * The rows that are MATCHES, which is not the same as the rows the keyboard
	 * can reach: the typed-value row is a fallback offered BESIDE the filter's
	 * result, not a result. The empty message is keyed on this rather than on
	 * `navigable`, so a query that matched nothing still says so above the row
	 * that offers to commit it - otherwise adding that row would silently delete
	 * the one sentence the list exists to say.
	 */
	const optionCount = rows.filter((row) => row.kind === "option").length;
	const resolvedIndex = resolveActiveIndex(
		rows,
		query,
		selectedName,
		activeIndex,
	);

	optionRefs.current.length = navigable;

	// A stale highlight after the list narrows would put Enter on a row the user
	// can no longer see. Only the STORED highlight is dropped here; what the
	// keyboard is on afterwards is the resolver's answer, not this reset's.
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the list
	useEffect(() => {
		setActiveIndex(-1);
	}, [rows]);

	useEffect(() => {
		if (!open || resolvedIndex < 0) return;
		optionRefs.current[resolvedIndex]?.scrollIntoView({ block: "nearest" });
	}, [open, resolvedIndex]);

	const commit = useCallback(
		(option: SearchableOption) => {
			setOpenState(false);
			setQuery(option.name);
			onSelect(option);
		},
		[onSelect, setOpenState],
	);

	/** Committing the typed text, which is the row at the end of the list. */
	const commitCustom = useCallback(
		(text: string) => {
			setOpenState(false);
			if (onCustomSubmit && text !== selectedName) onCustomSubmit(text);
		},
		[onCustomSubmit, selectedName, setOpenState],
	);

	const revert = useCallback(() => {
		setOpenState(false);
		setQuery(selectedName);
	}, [selectedName, setOpenState]);

	const move = (delta: number) => {
		if (navigable === 0) return;
		setActiveIndex((previous) => {
			const next = previous + delta;
			if (next < 0) return navigable - 1;
			if (next >= navigable) return 0;
			return next;
		});
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		switch (event.key) {
			case "ArrowDown":
			case "ArrowUp": {
				event.preventDefault();
				if (!open) {
					setOpenState(true);
					return;
				}
				move(event.key === "ArrowDown" ? 1 : -1);
				return;
			}
			case "Home":
			case "End": {
				if (!open || navigable === 0) return;
				event.preventDefault();
				setActiveIndex(event.key === "Home" ? 0 : navigable - 1);
				return;
			}
			case "Enter": {
				// Unconditional: this control lives inside forms, and a bare Enter
				// that submits one while the list is open is not what was meant.
				event.preventDefault();
				/*
				 * `resolvedIndex` rather than `activeIndex`: the row Enter takes is the
				 * row the list is SHOWING as active, so a filter that admits one row
				 * commits that row instead of the text that found it. `open`
				 * gates it, because a closed list has nothing on screen to take -
				 * which is what keeps Enter on a closed field inert rather than a
				 * silent re-pick of whatever row happens to be first.
				 */
				const outcome = resolveEnter(rows, open ? resolvedIndex : -1);
				if (outcome.kind === "option") {
					commit(outcome.option);
					return;
				}
				// The field is a text mode, not a popup that happens to accept
				// typing. A popup that was open closes on a free-text commit.
				if (outcome.kind === "custom") commitCustom(outcome.text);
				return;
			}
			case "Escape": {
				if (!open) return;
				// Stop here rather than let the dismissable layer also see it: a
				// second listener would close whatever dialog contains the field.
				event.preventDefault();
				event.stopPropagation();
				revert();
				return;
			}
			default:
		}
	};

	const activeOptionId =
		open && resolvedIndex >= 0
			? `${baseId}-option-${resolvedIndex}`
			: undefined;

	/**
	 * The accessible name, and the two ways it can be supplied.
	 *
	 * The three call sites that predate the move render a `<label>`; the
	 * settings rows render theirs and pass `ariaLabel`, which preserves the
	 * name their plain text input already carried rather than introducing one.
	 */
	const name = ariaLabel ?? label;
	const labelled = showLabel && Boolean(label);
	/*
	 * `aria-describedby` is a LIST, and both halves can be present at once:
	 * the row's own help sentence (passed in) and this component's helper text.
	 * Emitting one and dropping the other is how a field ends up described by
	 * the less useful of the two.
	 */
	const describedBy =
		[ariaDescribedBy, helperText ? helperId : undefined]
			.filter(Boolean)
			.join(" ") || undefined;
	const clearable = Boolean(onClear) && Boolean(selected) && !disabled;

	return (
		/* No outer margin: the container owns the gap between fields. A component
		   that ships one stacks with every parent that has a `gap`, and the
		   result is still spacing, just the wrong tier — which is how the settings
		   forms ended up with 32px between two fields of the same group. */
		<div className="relative">
			{labelled ? (
				<Tooltip content={labelTooltip}>
					<label
						htmlFor={inputId}
						className="mb-1.5 flex w-fit items-center gap-2 text-body-sm text-ink-muted"
					>
						{icon}
						{label}
					</label>
				</Tooltip>
			) : null}

			<Popover
				open={open}
				onOpenChange={(next) => {
					if (next) setOpenState(true);
					else revert();
				}}
			>
				<PopoverAnchor asChild>
					<div ref={anchorRef} className="relative">
						<Input
							id={inputId}
							role="combobox"
							aria-expanded={open}
							aria-controls={listId}
							aria-autocomplete="list"
							aria-activedescendant={activeOptionId}
							aria-label={labelled ? undefined : name}
							aria-describedby={describedBy}
							autoComplete="off"
							// The trailing slot holds the clear button beside the chevron,
							// so the field has to reserve both: `pr-8` is one affordance's
							// width and would put long text under the second one.
							className={cn(clearable ? "pr-14" : "pr-8")}
							placeholder={placeholder}
							disabled={disabled}
							value={query}
							onChange={(event) => {
								setQuery(event.target.value);
								setOpenState(true);
							}}
							onFocus={(event) => {
								// `selectOnFocus`: the whole point of tabbing here is to
								// replace the value, not to append to it.
								event.currentTarget.select();
								setOpenState(true);
							}}
							onBlur={revert}
							// Focus fires only once; without this, clicking an
							// already-focused field after a selection can't reopen the list.
							onClick={() => setOpenState(true)}
							onKeyDown={handleKeyDown}
						/>
						<span className="pointer-events-none absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
							{clearable ? (
								/* A real button, not a decorative icon: clearing is a
								   WRITE — it commits the empty value through the row's own
								   draft path — and it is deliberately separate from
								   deleting the text by hand so that "unset" and "typed
								   something that matched nothing" stay two outcomes.
								   `pointer-events-auto` because the slot it sits in is
								   pointer-transparent for the chevron's sake. It shares
								   the row's accessible name so a page with four of these
								   does not render four identical controls. */
								<Button
									variant="ghost"
									size="icon-sm"
									type="button"
									className="pointer-events-auto"
									aria-label={
										/*
										 * Named for what the gesture does to THIS row, in the row's own
										 * vocabulary. "Clear Default provider" reads as a command about a
										 * noun; the clear button only ever renders where a row passes
										 * `onClear`, which is the settings rows and their sentence-case
										 * labels, so lowering the first word is safe here.
										 */
										name ? `Clear the ${name.toLowerCase()}` : "Clear value"
									}
									onMouseDown={(event) => event.preventDefault()}
									onClick={() => {
										onClear?.();
										setOpenState(false);
									}}
								>
									<X aria-hidden="true" />
								</Button>
							) : null}
							{busy ? (
								<Spinner size="sm" label={busyLabel} />
							) : (
								<ChevronDown
									/*
									 * Steps to `ink-disabled` with the field it belongs to. The sibling
									 * `Select` in the same rows does exactly this (`select.tsx`), and a
									 * chevron that keeps its enabled ink on a disabled field is the one
									 * part of the control that still looks live.
									 */
									className={cn(
										"size-4",
										disabled ? "text-ink-disabled" : "text-ink-dim",
									)}
									aria-hidden="true"
								/>
							)}
						</span>
					</div>
				</PopoverAnchor>

				<PopoverContent
					align="start"
					className="w-(--radix-popover-trigger-width) p-1"
					// Focus stays in the text field; that is the difference between a
					// combobox and a popover holding a list.
					onOpenAutoFocus={(event) => event.preventDefault()}
					onCloseAutoFocus={(event) => event.preventDefault()}
					// Clicking the field while the list is open must not dismiss it —
					// the field is the anchor, so Radix counts it as "outside".
					onPointerDownOutside={(event) => {
						if (anchorRef.current?.contains(event.target as Node)) {
							event.preventDefault();
						}
					}}
					onFocusOutside={(event) => {
						if (anchorRef.current?.contains(event.target as Node)) {
							event.preventDefault();
						}
					}}
					// Keeps the field focused when a row is clicked, so `onBlur` stays
					// free to mean "the user left the control".
					onMouseDown={(event) => event.preventDefault()}
				>
					{/* biome-ignore lint/a11y/useFocusableInteractive: the text input keeps focus; the list is reached through aria-activedescendant, so it must not be in the tab order. */}
					<ul
						id={listId}
						// biome-ignore lint/a11y/useSemanticElements: a type-to-filter combobox with grouped rows cannot be a native <select>.
						// biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the listbox role is the WAI-ARIA combobox pattern for a popup driven from a text input.
						role="listbox"
						aria-label={name}
						/*
						 * The cap is deliberately the SHARED one (`max-h-72`, 288px, ~5.9 two-line
						 * rows) and NOT the chat picker's `min(50vh,420px)`. Those pickers open
						 * inside a dialog that owns the viewport; these rows sit in the settings
						 * page's own scroll column, where a taller list pushes the rows under it -
						 * the tier fields, `Save` and `Save all` - off the screen. The TUI caps its
						 * own suggestions for exactly this reason and at eight rows
						 * (`settings_ui`'s `_SUGGEST_ROWS`): a settings list is a field's picker,
						 * not a browsing surface. Recorded here because the next reader will
						 * compare the two caps and needs the reason the difference is deliberate.
						 */
						className="max-h-72 overflow-y-auto"
					>
						{listNotice ? (
							// The list's own scope, above its first row: what this list is a
							// list OF, when the owner narrowed it for a reason the rows cannot
							// show. Same register as a group heading, because that is what it
							// is - the heading of everything under it.
							<li
								role="presentation"
								className="px-2 pt-2 pb-1 text-meta text-ink-dim"
							>
								{listNotice}
							</li>
						) : null}
						{optionCount === 0 && (
							/*
							 * One slot, two facts, and they must not read as each other. While the
							 * options are on their way the list says SO, because "nothing matches"
							 * is a claim about a query that has not answered yet - the shape
							 * `docs/branding.md` records as "a loading state is not an empty
							 * state". Once the query has answered, the empty text is chosen from
							 * the OUTCOME by the owner (nothing matched / nothing listed yet /
							 * the listing failed), which is why it is a prop rather than a
							 * constant here.
							 *
							 * `role="presentation"`: this is a message, not an option that
							 * cannot be chosen, and announcing it as one is a dead end for a
							 * screen reader.
							 */
							<li
								role="presentation"
								className="px-2 py-1.5 text-body-sm text-ink-dim"
							>
								{busy ? `${busyLabel}…` : emptyText}
							</li>
						)}
						{rows.map((row) =>
							row.kind === "group" ? (
								<li
									key={`group-${row.label}`}
									role="presentation"
									className="px-2 pt-2 pb-1 text-meta text-ink-dim"
								>
									{row.label}
								</li>
							) : row.kind === "option" ? (
								/* biome-ignore lint/a11y/useFocusableInteractive: focus stays in the combobox input; the active option is announced through aria-activedescendant. */
								/* biome-ignore lint/a11y/useKeyWithClickEvents: Arrow keys, Enter and Escape are handled on the combobox input, not on the option. */
								<li
									key={`option-${row.option.id}-${row.index}`}
									id={`${baseId}-option-${row.index}`}
									// biome-ignore lint/a11y/useSemanticElements: a combobox option cannot be a native <option>.
									// biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the option role is part of the combobox listbox pattern.
									role="option"
									aria-selected={row.option.id === selected?.id}
									ref={(node) => {
										optionRefs.current[row.index] = node;
									}}
									className={cn(
										"cursor-pointer rounded-sm px-2 py-1.5",
										"transition-colors duration-fast ease-out-quart",
										/*
										 * The active row's mark is a wash PLUS a structural edge, and the edge is
										 * the half that matters. The wash is `accent-wash`, which collapses onto
										 * the popover's `elevated` ground in obsidian (a measured dE00 of under
										 * 1, i.e. no visible mark at all) and is under dE00 4 in three more
										 * palettes, so a wash-only highlight silently disappears for whoever
										 * runs one of those themes. The 1px `outline-control` edge clears the
										 * 3:1 structural floor on every ground BY CONSTRUCTION - it is the
										 * same fix, for the same measured reason, that the chat picker's
										 * pointer mark carries - and `pnpm check-themes` asserts both the role
										 * (the `combobox option active mark` row) and this call site (its pin).
										 */
										row.index === resolvedIndex &&
											"bg-accent-wash outline-solid outline-1 -outline-offset-1 outline-control",
									)}
									onMouseEnter={() => setActiveIndex(row.index)}
									onClick={() => commit(row.option)}
								>
									<div className="flex items-center gap-2">
										<span className="text-body-sm text-ink">
											{row.option.name}
										</span>
										{row.option.adornment}
									</div>
									{row.option.description ? (
										<div className="text-meta text-ink-muted">
											{row.option.description}
										</div>
									) : null}
								</li>
							) : (
								/*
								 * The typed-text row: last in the list, the only row that commits what is
								 * IN THE FIELD rather than an option, and the reason "assist, never
								 * constrain" can hold without the trap it otherwise sets - Enter taking
								 * the visible match would otherwise take away the only way to save a value
								 * no listing knows.
								 *
								 * Styled as a row rather than as a button on purpose: it is reached by the
								 * same Arrow keys as every other row, and it is announced as the option it
								 * is.
								 */
								/* biome-ignore lint/a11y/useFocusableInteractive: focus stays in the combobox input; this row is announced through aria-activedescendant. */
								/* biome-ignore lint/a11y/useKeyWithClickEvents: Arrow keys, Enter and Escape are handled on the combobox input, not on the row. */
								<li
									key={`custom-${row.text}`}
									id={`${baseId}-option-${row.index}`}
									// A hook rather than a class: a scene that counts "the rows the filter
									// produced" must exclude this one, and excluding it by copy would break the
									// day the copy changes.
									data-combobox-row="typed"
									// biome-ignore lint/a11y/useSemanticElements: a combobox option cannot be a native <option>.
									// biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the option role is part of the combobox listbox pattern.
									role="option"
									aria-selected={false}
									ref={(node) => {
										optionRefs.current[row.index] = node;
									}}
									className={cn(
										"cursor-pointer rounded-sm px-2 py-1.5",
										"transition-colors duration-fast ease-out-quart",
										row.index === resolvedIndex &&
											"bg-accent-wash outline-solid outline-1 -outline-offset-1 outline-control",
									)}
									onMouseEnter={() => setActiveIndex(row.index)}
									onClick={() => commitCustom(row.text)}
								>
									<div className="flex items-center gap-2">
										<span className="text-body-sm text-ink">
											{customRowLabel ? customRowLabel(row.text) : row.text}
										</span>
									</div>
									<div className="text-meta text-ink-muted">
										Not in any listing; saved as typed.
									</div>
								</li>
							),
						)}
					</ul>
				</PopoverContent>
			</Popover>

			{helperText ? (
				<p id={helperId} className="mt-1 text-meta text-ink-dim">
					{helperText}
				</p>
			) : null}
		</div>
	);
};

SearchableSelect.displayName = "SearchableSelect";
