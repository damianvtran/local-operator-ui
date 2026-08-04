/**
 * Category picker rendered as dismissible chips.
 *
 * Unlike the tag input, values can only come from the allow-list, so the input
 * is a combobox over the remaining categories rather than free text: typing
 * narrows the list, Enter or a click takes the active row, Escape closes it.
 * Keyboard behaviour is the contract, so the active row is tracked in state
 * and published with `aria-activedescendant` instead of moving DOM focus.
 */

import { ALLOWED_AGENT_CATEGORIES } from "@shared/api/local-operator/types";
import {
	Badge,
	Label,
	Popover,
	PopoverAnchor,
	PopoverContent,
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FC, KeyboardEvent } from "react";

/**
 * Map snake_case category to Normal Capital Case for display.
 */
const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
	ALLOWED_AGENT_CATEGORIES.map((cat) => [
		cat,
		cat
			.split("_")
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
			.join(" "),
	]),
);

type CategoriesInputChipsProps = {
	/** Current categories */
	value: string[];
	/** Label for the field */
	label: string;
	/** Callback when categories change */
	onChange: (categories: string[]) => void;
	/** Placeholder for the input */
	placeholder?: string;
	/** Disabled state */
	disabled?: boolean;
	/** Optional icon */
	icon?: React.ReactNode;
};

export const CategoriesInputChips: FC<CategoriesInputChipsProps> = ({
	value,
	label,
	onChange,
	placeholder = "Add category...",
	disabled = false,
	icon,
}) => {
	const [inputValue, setInputValue] = useState("");
	const [isOpen, setIsOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(0);

	const inputRef = useRef<HTMLInputElement>(null);
	const optionRefs = useRef<(HTMLDivElement | null)[]>([]);
	const inputId = useId();
	const listboxId = useId();

	const availableOptions = useMemo(() => {
		const query = inputValue.trim().toLowerCase();
		return ALLOWED_AGENT_CATEGORIES.filter(
			(opt) =>
				!value.includes(opt) &&
				(!query || CATEGORY_LABELS[opt].toLowerCase().includes(query)),
		);
	}, [value, inputValue]);

	// Keep the active row inside the scroll viewport.
	useEffect(() => {
		if (!isOpen) return;
		optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
	}, [activeIndex, isOpen]);

	const selectOption = (category: string) => {
		if (!value.includes(category)) {
			onChange([...value, category]);
		}
		setInputValue("");
		setIsOpen(false);
		inputRef.current?.focus();
	};

	const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
		setInputValue(event.target.value);
		setActiveIndex(0);
		setIsOpen(true);
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		switch (event.key) {
			case "ArrowDown":
				event.preventDefault();
				if (!isOpen) {
					setActiveIndex(0);
					if (availableOptions.length > 0) setIsOpen(true);
				} else {
					setActiveIndex((activeIndex + 1) % availableOptions.length);
				}
				break;
			case "ArrowUp":
				event.preventDefault();
				if (!isOpen) {
					setActiveIndex(availableOptions.length - 1);
					if (availableOptions.length > 0) setIsOpen(true);
				} else {
					setActiveIndex(
						(activeIndex - 1 + availableOptions.length) %
							availableOptions.length,
					);
				}
				break;
			case "Enter":
				if (isOpen && availableOptions[activeIndex]) {
					event.preventDefault();
					selectOption(availableOptions[activeIndex]);
				}
				break;
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
					setActiveIndex(availableOptions.length - 1);
				}
				break;
			default:
				break;
		}
	};

	const handleDelete = (cat: string) => {
		onChange(value.filter((c) => c !== cat));
	};

	const activeOptionId =
		isOpen && availableOptions[activeIndex]
			? `${listboxId}-option-${activeIndex}`
			: undefined;

	return (
		/* No outer margin: the container owns the gap between fields. */
		<div>
			<Label
				htmlFor={inputId}
				className="mb-1.5 flex items-center gap-2 text-ink-muted"
			>
				{icon}
				{label}
			</Label>
			<div
				className={cn(
					"flex min-h-11 flex-wrap items-center gap-2 rounded-sm border border-control bg-surface p-2",
					// See tags-input-chips: the inner field suppresses its own outline,
					// so this wrapper owns the ring. `outline-solid` is required
					// because `outline-none` on the input pins the style token to none.
					"has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-2",
					"has-[:focus-visible]:outline-accent has-[:focus-visible]:outline-offset-2",
					disabled && "border-hairline bg-sunken",
				)}
			>
				{value.map((cat) => (
					<Badge key={cat} className="gap-1 pr-1 text-ink">
						{CATEGORY_LABELS[cat] || cat}
						<button
							type="button"
							aria-label={`Remove category ${CATEGORY_LABELS[cat] || cat}`}
							disabled={disabled}
							onClick={() => handleDelete(cat)}
							className={cn(
								"rounded-xs text-ink-dim",
								"transition-colors duration-fast ease-out-quart",
								"hover:text-danger disabled:text-ink-disabled",
							)}
						>
							<X />
						</button>
					</Badge>
				))}
				<Popover open={isOpen} onOpenChange={setIsOpen}>
					<PopoverAnchor asChild>
						<input
							id={inputId}
							ref={inputRef}
							type="text"
							role="combobox"
							aria-expanded={isOpen}
							aria-controls={listboxId}
							aria-autocomplete="list"
							aria-activedescendant={activeOptionId}
							autoComplete="off"
							value={inputValue}
							placeholder={placeholder}
							disabled={disabled}
							aria-label={label}
							onChange={handleInputChange}
							onKeyDown={handleKeyDown}
							onClick={() => {
								if (availableOptions.length > 0) setIsOpen(true);
							}}
							className={cn(
								"min-w-20 flex-1 bg-transparent px-1 py-0.5 outline-none",
								"text-body-sm text-ink placeholder:text-ink-dim",
								"disabled:text-ink-disabled disabled:placeholder:text-ink-disabled",
							)}
						/>
					</PopoverAnchor>
					<PopoverContent
						align="start"
						sideOffset={4}
						// Focus stays in the input; the active row is announced through
						// `aria-activedescendant`.
						onOpenAutoFocus={(event) => event.preventDefault()}
						className="max-h-60 w-(--radix-popover-trigger-width) overflow-y-auto p-1"
					>
						{/* biome-ignore lint/a11y/useFocusableInteractive: the input keeps focus; the listbox is reached through aria-activedescendant, so it must not be in the tab order. */}
						{/* biome-ignore lint/a11y/useSemanticElements: a select-like combobox popup cannot be a native <select>. */}
						<div id={listboxId} role="listbox" aria-label={label}>
							{availableOptions.map((option, index) => (
								/* biome-ignore lint/a11y/useFocusableInteractive: focus stays in the combobox input; the active option is announced through aria-activedescendant. */
								/* biome-ignore lint/a11y/useKeyWithClickEvents: Arrow keys, Enter and Escape are handled on the combobox input, not on the option. */
								/* biome-ignore lint/a11y/useSemanticElements: a combobox option cannot be a native <option>. */
								<div
									key={option}
									id={`${listboxId}-option-${index}`}
									ref={(node) => {
										optionRefs.current[index] = node;
									}}
									// biome-ignore lint/a11y/useSemanticElements: a combobox option cannot be a native <option>.
									role="option"
									aria-selected={index === activeIndex}
									onMouseDown={(event) => {
										// The input must not lose focus to the list.
										event.preventDefault();
									}}
									onMouseEnter={() => setActiveIndex(index)}
									onClick={() => selectOption(option)}
									className={cn(
										"cursor-pointer rounded-sm px-3 py-1.5 font-medium text-body-sm",
										index === activeIndex ? "bg-accent-wash" : undefined,
										"text-ink",
									)}
								>
									{CATEGORY_LABELS[option] || option}
								</div>
							))}
						</div>
					</PopoverContent>
				</Popover>
			</div>
			{value.length === 0 && (
				<span className="mt-1 ml-1 block text-ink-dim text-meta">
					No categories selected
				</span>
			)}
		</div>
	);
};
