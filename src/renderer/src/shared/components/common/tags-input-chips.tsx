/**
 * Free-form tag input rendered as dismissible chips.
 *
 * Enter adds the trimmed, lowercased tag; Backspace on an empty input removes
 * the last one. Tags are lowercased on the way in because they are matched
 * case-sensitively downstream, and "Research" and "research" arriving as two
 * tags is the defect that normalisation prevents.
 */

import { Badge, Button, Label } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { Plus, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { ChangeEvent, FC, KeyboardEvent } from "react";

type TagsInputChipsProps = {
	/** Current tags */
	value: string[];
	/** Label for the field */
	label: string;
	/** Callback when tags change */
	onChange: (tags: string[]) => void;
	/** Placeholder for the input */
	placeholder?: string;
	/** Disabled state */
	disabled?: boolean;
	/** Optional icon */
	icon?: React.ReactNode;
};

export const TagsInputChips: FC<TagsInputChipsProps> = ({
	value,
	label,
	onChange,
	placeholder = "Add tag...",
	disabled = false,
	icon,
}) => {
	const [input, setInput] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const inputId = useId();

	const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
		setInput(e.target.value);
	};

	const commitInput = () => {
		const newTag = input.trim().toLowerCase();
		if (newTag && !value.includes(newTag)) {
			onChange([...value, newTag]);
		}
		setInput("");
	};

	const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter" && input.trim()) {
			e.preventDefault();
			commitInput();
		} else if (e.key === "Backspace" && !input && value.length > 0) {
			// Remove last tag if input is empty and backspace is pressed
			onChange(value.slice(0, -1));
		}
	};

	const handleDelete = (tag: string) => {
		onChange(value.filter((t) => t !== tag));
	};

	return (
		<div className="mb-4">
			<Label
				htmlFor={inputId}
				className="mb-1.5 flex items-center gap-2 text-ink-muted"
			>
				{icon}
				{label}
			</Label>
			<div
				className={cn(
					"flex min-h-11 flex-wrap items-center gap-2 rounded-md border border-control bg-surface p-2",
					disabled && "border-hairline bg-sunken",
				)}
			>
				{value.map((tag) => (
					<Badge key={tag} className="gap-1 pr-1 text-ink">
						{tag}
						<button
							type="button"
							aria-label={`Remove tag ${tag}`}
							disabled={disabled}
							onClick={() => handleDelete(tag)}
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
				<input
					id={inputId}
					ref={inputRef}
					type="text"
					value={input}
					onChange={handleInputChange}
					onKeyDown={handleInputKeyDown}
					placeholder={placeholder}
					disabled={disabled}
					aria-label={label}
					className={cn(
						"min-w-20 flex-1 bg-transparent px-1 py-0.5 outline-none",
						"text-body-sm text-ink placeholder:text-ink-dim",
						"disabled:text-ink-disabled disabled:placeholder:text-ink-disabled",
					)}
				/>
				{input.trim() && (
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Add tag"
						disabled={disabled}
						onClick={() => {
							commitInput();
							inputRef.current?.focus();
						}}
						className="text-accent hover:text-accent"
					>
						<Plus />
					</Button>
				)}
			</div>
			{value.length === 0 && !input && (
				<span className="mt-1 ml-1 block text-ink-dim text-meta">
					No tags added
				</span>
			)}
		</div>
	);
};
