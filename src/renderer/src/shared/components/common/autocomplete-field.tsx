/**
 * Text input with a suggestion list, and an explicit save step.
 *
 * The combobox is built here rather than in the primitive layer: it is the only
 * one in the app, and a listbox that has to interleave group headers with
 * option descriptions is not the same component as a select. Keyboard
 * behaviour is the contract — arrows move the active option, Enter takes it,
 * Escape closes — so the active option is tracked in state and published with
 * `aria-activedescendant` instead of moving DOM focus, which would take focus
 * out of the input the user is still typing in.
 */
import { Spinner } from "@shared/components/common/spinner";
import {
	Button,
	Label,
	Popover,
	PopoverAnchor,
	PopoverContent,
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { Check, X } from "lucide-react";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import type { ChangeEvent, KeyboardEvent, ReactNode } from "react";

/**
 * Option type for autocomplete suggestions
 */
export type AutocompleteOption = {
	/** Unique identifier for the option */
	id: string;
	/** Display label for the option */
	label: string;
	/** Optional description for the option */
	description?: string;
	/** Optional group for categorizing options */
	group?: string;
	/** Optional disabled state */
	disabled?: boolean;
};

type AutocompleteFieldProps = {
	/**
	 * Current value of the field
	 */
	value: string;

	/**
	 * Label for the field
	 */
	label: string;

	/**
	 * Available options for autocomplete
	 */
	options: AutocompleteOption[];

	/**
	 * Callback function when the value is saved
	 * @param value - The new value
	 */
	onSave: (value: string) => Promise<void>;

	/**
	 * Placeholder text when field is empty
	 */
	placeholder?: string;

	/**
	 * Optional icon to display next to the label
	 */
	icon?: ReactNode;

	/**
	 * Whether the field is currently being saved
	 */
	isSaving?: boolean;

	/**
	 * Optional helper text to display below the field
	 */
	helperText?: string;

	/**
	 * Optional function to group options in the dropdown
	 */
	groupBy?: (option: AutocompleteOption) => string;

	/**
	 * Optional function to filter options based on input
	 * If not provided, default filtering will be used
	 */
	filterOptions?: (
		options: AutocompleteOption[],
		inputValue: string,
	) => AutocompleteOption[];

	/**
	 * Whether to allow free text input that's not in the options
	 * Default: true
	 */
	allowFreeText?: boolean;
};

/**
 * Autocomplete Field Component
 *
 * A component that provides text input with autocomplete dropdown functionality.
 * Users can select from suggestions or enter their own custom value.
 */
export const AutocompleteField = ({
	value,
	label,
	options,
	onSave,
	placeholder = "Enter value...",
	icon,
	isSaving = false,
	helperText,
	groupBy,
	filterOptions,
	allowFreeText = true,
}: AutocompleteFieldProps) => {
	const [inputValue, setInputValue] = useState(value);
	const [editValue, setEditValue] = useState(value);
	const [originalValue, setOriginalValue] = useState(value);
	const [isEditing, setIsEditing] = useState(false);
	const [isOpen, setIsOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(0);

	const inputRef = useRef<HTMLInputElement>(null);
	const optionRefs = useRef<(HTMLDivElement | null)[]>([]);
	const inputId = useId();
	const listboxId = useId();
	const helperId = useId();

	// Update the edit value when the value prop changes
	// biome-ignore lint/correctness/useExhaustiveDependencies: options.length is intentionally included to reset state when options change
	useEffect(() => {
		setEditValue(value);
		setInputValue(value);
		setOriginalValue(value);
	}, [value, options.length]);

	const visibleOptions = useMemo(() => {
		if (filterOptions) return filterOptions(options, inputValue);
		const query = inputValue.trim().toLowerCase();
		if (!query) return options;
		// Substring match on the label, which is what MUI's default filter did.
		return options.filter((option) =>
			option.label.toLowerCase().includes(query),
		);
	}, [options, inputValue, filterOptions]);

	/**
	 * Consecutive runs rather than a sort: the caller controls option order, and
	 * re-sorting by group would silently reorder a deliberately ranked list.
	 */
	const groups = useMemo(() => {
		if (!groupBy)
			return [{ group: null as string | null, options: visibleOptions }];
		const runs: { group: string | null; options: AutocompleteOption[] }[] = [];
		for (const option of visibleOptions) {
			const group = groupBy(option);
			const last = runs.length > 0 ? runs[runs.length - 1] : undefined;
			if (last && last.group === group) last.options.push(option);
			else runs.push({ group, options: [option] });
		}
		return runs;
	}, [visibleOptions, groupBy]);

	// Flattened in the same order the listbox renders, so the active index and
	// the rendered rows cannot drift apart.
	const flatOptions = useMemo(
		() => groups.flatMap((run) => run.options),
		[groups],
	);

	// Keep the active option inside the scroll viewport. `nearest` rather than
	// `center` so a mouse-driven hover does not yank the list around.
	useEffect(() => {
		if (!isOpen) return;
		optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
	}, [activeIndex, isOpen]);

	const openList = useCallback(() => {
		if (flatOptions.length === 0) return;
		setIsOpen(true);
	}, [flatOptions.length]);

	/**
	 * Moves the active option, skipping disabled ones and wrapping at both ends.
	 */
	const moveActive = useCallback(
		(delta: number) => {
			const count = flatOptions.length;
			if (count === 0) return;
			let next = activeIndex;
			for (let step = 0; step < count; step += 1) {
				next = (next + delta + count) % count;
				if (!flatOptions[next]?.disabled) {
					setActiveIndex(next);
					return;
				}
			}
		},
		[activeIndex, flatOptions],
	);

	const selectOption = (option: AutocompleteOption) => {
		if (option.disabled) return;
		setEditValue(option.id);
		setInputValue(option.label);
		setIsEditing(true);
		setIsOpen(false);
		inputRef.current?.focus();
	};

	const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
		const next = event.target.value;
		setInputValue(next);
		// Free text is the value itself; otherwise the value only changes when an
		// option is taken, so typing just narrows the list.
		if (allowFreeText) setEditValue(next);
		setIsEditing(true);
		setActiveIndex(0);
		setIsOpen(true);
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		switch (event.key) {
			case "ArrowDown":
				event.preventDefault();
				if (!isOpen) {
					setActiveIndex(0);
					openList();
				} else {
					moveActive(1);
				}
				break;
			case "ArrowUp":
				event.preventDefault();
				if (!isOpen) {
					setActiveIndex(flatOptions.length - 1);
					openList();
				} else {
					moveActive(-1);
				}
				break;
			case "Enter": {
				const active = isOpen ? flatOptions[activeIndex] : undefined;
				if (active) {
					event.preventDefault();
					selectOption(active);
				}
				break;
			}
			case "Escape":
				if (isOpen) {
					event.preventDefault();
					setIsOpen(false);
				}
				break;
			case "Home":
				if (isOpen) {
					event.preventDefault();
					setActiveIndex(0);
				}
				break;
			case "End":
				if (isOpen) {
					event.preventDefault();
					setActiveIndex(flatOptions.length - 1);
				}
				break;
			default:
				break;
		}
	};

	/**
	 * Cancels editing and reverts to the original value
	 */
	const handleCancel = () => {
		setEditValue(originalValue);
		setInputValue(originalValue);
		setIsEditing(false);
		setIsOpen(false);
	};

	/**
	 * Saves the current edit value
	 */
	const handleSave = async () => {
		try {
			await onSave(editValue);
			setOriginalValue(editValue);
			setIsEditing(false);
		} catch {
			// If save fails, revert to original value
			setEditValue(originalValue);
			setInputValue(originalValue);
		}
	};

	const hasChanged = editValue !== originalValue;
	const showActions = hasChanged && isEditing && !isSaving;
	const activeOptionId =
		isOpen && flatOptions[activeIndex]
			? `${listboxId}-option-${activeIndex}`
			: undefined;

	let renderIndex = -1;

	return (
		<div className="mb-6">
			<Label
				htmlFor={inputId}
				className="mb-2 flex items-center gap-3 text-ink-muted"
			>
				{icon}
				{label}
			</Label>

			<Popover open={isOpen} onOpenChange={setIsOpen}>
				<PopoverAnchor asChild>
					<div className="relative">
						<input
							id={inputId}
							ref={inputRef}
							type="text"
							role="combobox"
							aria-expanded={isOpen}
							aria-controls={listboxId}
							aria-autocomplete="list"
							aria-activedescendant={activeOptionId}
							aria-describedby={helperText ? helperId : undefined}
							autoComplete="off"
							value={inputValue}
							placeholder={placeholder}
							onChange={handleInputChange}
							onKeyDown={handleKeyDown}
							onClick={openList}
							className={cn(
								"h-8 w-full rounded-md border border-control bg-surface px-3",
								"text-body-sm text-ink placeholder:text-ink-dim",
								"transition-colors duration-fast ease-out-quart",
								showActions ? "pr-18" : isSaving ? "pr-10" : "pr-3",
							)}
						/>

						<div className="absolute top-1/2 right-1.5 z-10 flex -translate-y-1/2 items-center gap-1">
							{isSaving ? (
								<Spinner size="sm" label={`Saving ${label}`} />
							) : (
								showActions && (
									<>
										<Button
											variant="ghost"
											size="icon-sm"
											onClick={handleSave}
											title="Save changes"
											aria-label={`Save ${label}`}
											className="text-success hover:bg-success-wash hover:text-success"
										>
											<Check />
										</Button>
										<Button
											variant="ghost"
											size="icon-sm"
											onClick={handleCancel}
											title="Cancel"
											aria-label={`Cancel editing ${label}`}
											className="text-danger hover:bg-danger-wash hover:text-danger"
										>
											<X />
										</Button>
									</>
								)
							)}
						</div>
					</div>
				</PopoverAnchor>

				<PopoverContent
					align="start"
					sideOffset={4}
					// Focus stays in the input: the active option is announced through
					// `aria-activedescendant`, and moving focus here would end typing.
					onOpenAutoFocus={(event) => event.preventDefault()}
					className="max-h-60 w-(--radix-popover-trigger-width) overflow-y-auto p-1"
				>
					{/* biome-ignore lint/a11y/useFocusableInteractive: the input keeps focus; the listbox is reached through aria-activedescendant, so it must not be in the tab order. */}
					{/* biome-ignore lint/a11y/useSemanticElements: a type-to-filter combobox cannot be a native <select>. */}
					<div id={listboxId} role="listbox" aria-label={label}>
						{groups.map((run) => (
							<div
								key={run.group ?? "__ungrouped"}
								// biome-ignore lint/a11y/useSemanticElements: an option group with a heading, not a form fieldset.
								role="group"
								aria-label={run.group ?? undefined}
							>
								{run.group && (
									<div className="px-2 py-1 font-medium text-ink-dim text-meta">
										{run.group}
									</div>
								)}
								{run.options.map((option) => {
									renderIndex += 1;
									const index = renderIndex;
									return (
										/* biome-ignore lint/a11y/useFocusableInteractive: focus stays in the combobox input; the active option is announced through aria-activedescendant. */
										/* biome-ignore lint/a11y/useKeyWithClickEvents: Arrow keys, Enter and Escape are handled on the combobox input, not on the option. */
										<div
											key={option.id}
											id={`${listboxId}-option-${index}`}
											ref={(node) => {
												optionRefs.current[index] = node;
											}}
											// biome-ignore lint/a11y/useSemanticElements: a type-to-filter combobox option cannot be a native <option>.
											role="option"
											aria-selected={option.id === editValue}
											aria-disabled={option.disabled || undefined}
											onMouseDown={(event) => {
												// The input must not lose focus to the list.
												event.preventDefault();
											}}
											onMouseEnter={() => setActiveIndex(index)}
											onClick={() => selectOption(option)}
											className={cn(
												"cursor-pointer rounded-sm px-2 py-1.5 text-body-sm",
												index === activeIndex
													? "bg-accent-wash text-ink"
													: "text-ink",
												option.disabled && "cursor-default text-ink-disabled",
											)}
										>
											<div className="font-medium">{option.label}</div>
											{option.description && (
												<div className="text-ink-muted text-meta">
													{option.description}
												</div>
											)}
										</div>
									);
								})}
							</div>
						))}
					</div>
				</PopoverContent>
			</Popover>

			{helperText && (
				<p id={helperId} className="mt-1 text-ink-dim text-meta">
					{helperText}
				</p>
			)}
		</div>
	);
};
