/**
 * The searchable select behind the hosting and model pickers.
 *
 * MUI's `Autocomplete` has no counterpart in the primitive layer and one may
 * not be added there, so the combobox is assembled here from `Popover` +
 * `Input` + a hand-rolled listbox. The primitive `Select` is the wrong shape:
 * the model list runs to several hundred entries and type-to-filter is the only
 * way anyone finds one.
 *
 * ARIA is written out rather than inherited from a primitive, because that is
 * the whole keyboard contract for this control: `combobox` / `listbox` /
 * `option` plus `aria-activedescendant`, which is what lets the active row move
 * while focus stays in the text field.
 */

import { Spinner } from "@shared/components/common/spinner";
import {
	Input,
	Popover,
	PopoverAnchor,
	PopoverContent,
	Tooltip,
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { ChevronDown } from "lucide-react";
import type { FC, KeyboardEvent, ReactNode } from "react";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";

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
	label: string;
	/** Rendered before the label. */
	icon: ReactNode;
	/** Explains the field. Attached to the label, as it was under MUI. */
	labelTooltip: ReactNode;
	placeholder: string;
	options: SearchableOption[];
	/** The row to show as chosen, or `null` for an empty field. */
	selected: SearchableOption | null;
	onSelect: (option: SearchableOption) => void;
	/**
	 * Enter on text that matches no option. Omit to reject free text, which is
	 * what `allowCustom={false}` means at the call sites.
	 */
	onCustomSubmit?: (text: string) => void;
	helperText?: string;
	/** Swaps the chevron for a spinner. */
	busy?: boolean;
	/** What `busy` means. The spinner has no adjacent text to borrow. */
	busyLabel: string;
	disabled?: boolean;
};

/**
 * Case- and accent-insensitive, matching what `createFilterOptions()` did by
 * default. Dropping the accent fold would quietly break "Gemini Ultra" style
 * names that arrive from the API with combining marks.
 */
const fold = (text: string): string =>
	text
		.normalize("NFD")
		// biome-ignore lint/suspicious/noMisleadingCharacterClass: combining marks
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase();

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
}) => {
	const baseId = useId();
	const inputId = `${baseId}-input`;
	const listId = `${baseId}-listbox`;
	const helperId = `${baseId}-helper`;

	const anchorRef = useRef<HTMLDivElement>(null);
	const optionRefs = useRef<(HTMLLIElement | null)[]>([]);

	const [open, setOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(-1);

	const selectedName = selected?.name ?? "";
	const [query, setQuery] = useState(selectedName);

	// The field is not a free-text box that happens to have a list: whatever the
	// owner says is selected wins, so a save that resolves to a different id
	// (or fails and reverts) is reflected in the text.
	useEffect(() => {
		setQuery(selectedName);
	}, [selectedName]);

	const visible = useMemo(() => {
		const typed = query.trim();
		// Once the text equals the current selection there is nothing to filter
		// by — this is what makes clicking the field show the whole list instead
		// of the one row already chosen. `Autocomplete` did the same thing
		// internally; the old code approximated it with an `isUserTyping` ref.
		if (!typed || typed === selectedName) return options;
		const needle = fold(typed);
		return options.filter((option) => fold(option.name).includes(needle));
	}, [options, query, selectedName]);

	optionRefs.current.length = visible.length;

	// A stale highlight after the list narrows would put Enter on a row the user
	// can no longer see.
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the list
	useEffect(() => {
		setActiveIndex(-1);
	}, [visible]);

	useEffect(() => {
		if (!open || activeIndex < 0) return;
		optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
	}, [open, activeIndex]);

	const rows = useMemo(() => {
		const out: Array<
			| { kind: "group"; label: string }
			| { kind: "option"; option: SearchableOption; index: number }
		> = [];
		let currentGroup: string | undefined;
		visible.forEach((option, index) => {
			if (option.group && option.group !== currentGroup) {
				currentGroup = option.group;
				out.push({ kind: "group", label: option.group });
			}
			out.push({ kind: "option", option, index });
		});
		return out;
	}, [visible]);

	const commit = useCallback(
		(option: SearchableOption) => {
			setOpen(false);
			setQuery(option.name);
			onSelect(option);
		},
		[onSelect],
	);

	const revert = useCallback(() => {
		setOpen(false);
		setQuery(selectedName);
	}, [selectedName]);

	const move = (delta: number) => {
		if (visible.length === 0) return;
		setActiveIndex((previous) => {
			const next = previous + delta;
			if (next < 0) return visible.length - 1;
			if (next >= visible.length) return 0;
			return next;
		});
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		switch (event.key) {
			case "ArrowDown":
			case "ArrowUp": {
				event.preventDefault();
				if (!open) {
					setOpen(true);
					return;
				}
				move(event.key === "ArrowDown" ? 1 : -1);
				return;
			}
			case "Home":
			case "End": {
				if (!open || visible.length === 0) return;
				event.preventDefault();
				setActiveIndex(event.key === "Home" ? 0 : visible.length - 1);
				return;
			}
			case "Enter": {
				// Unconditional: this control lives inside forms, and a bare Enter
				// that submits one while the list is open is not what was meant.
				event.preventDefault();
				if (open && activeIndex >= 0) {
					commit(visible[activeIndex]);
					return;
				}
				const typed = query.trim();
				if (!typed) return;
				// An exact name match beats free text, so typing a model's full name
				// selects that model rather than saving the name as a custom id.
				const match = options.find(
					(option) => fold(option.name) === fold(typed),
				);
				if (match) {
					commit(match);
					return;
				}
				if (onCustomSubmit && typed !== selectedName) {
					setOpen(false);
					onCustomSubmit(typed);
				}
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
		open && activeIndex >= 0 ? `${baseId}-option-${activeIndex}` : undefined;

	return (
		/* No outer margin: the container owns the gap between fields. A component
		   that ships one stacks with every parent that has a `gap`, and the
		   result is still spacing, just the wrong tier — which is how the settings
		   forms ended up with 32px between two fields of the same group. */
		<div className="relative">
			<Tooltip content={labelTooltip}>
				<label
					htmlFor={inputId}
					className="mb-1.5 flex w-fit items-center gap-2 text-body-sm text-ink-muted"
				>
					{icon}
					{label}
				</label>
			</Tooltip>

			<Popover
				open={open}
				onOpenChange={(next) => {
					if (next) setOpen(true);
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
							aria-describedby={helperText ? helperId : undefined}
							autoComplete="off"
							className="pr-8"
							placeholder={placeholder}
							disabled={disabled}
							value={query}
							onChange={(event) => {
								setQuery(event.target.value);
								setOpen(true);
							}}
							onFocus={(event) => {
								// `selectOnFocus`: the whole point of tabbing here is to
								// replace the value, not to append to it.
								event.currentTarget.select();
								setOpen(true);
							}}
							onBlur={revert}
							// Focus fires only once; without this, clicking an
							// already-focused field after a selection can't reopen the list.
							onClick={() => setOpen(true)}
							onKeyDown={handleKeyDown}
						/>
						<span className="pointer-events-none absolute top-1/2 right-2 flex -translate-y-1/2 items-center">
							{busy ? (
								<Spinner size="sm" label={busyLabel} />
							) : (
								<ChevronDown
									className="size-4 text-ink-dim"
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
						aria-label={label}
						className="max-h-72 overflow-y-auto"
					>
						{rows.length === 0 && (
							<li
								role="presentation"
								className="px-2 py-1.5 text-body-sm text-ink-dim"
							>
								No matches
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
							) : (
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
										row.index === activeIndex && "bg-accent-wash",
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
