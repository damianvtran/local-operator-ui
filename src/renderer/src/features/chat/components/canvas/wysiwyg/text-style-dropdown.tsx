import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import type { FC } from "react";

type TextType = "paragraph" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

type TextStyleDropdownProps = {
	currentTextType: TextType;
	onTextTypeChange: (type: TextType) => void;
};

const TEXT_TYPES: { value: TextType; label: string }[] = [
	{ value: "paragraph", label: "Paragraph" },
	{ value: "h1", label: "Heading 1" },
	{ value: "h2", label: "Heading 2" },
	{ value: "h3", label: "Heading 3" },
	{ value: "h4", label: "Heading 4" },
	{ value: "h5", label: "Heading 5" },
	{ value: "h6", label: "Heading 6" },
];

/**
 * Block-type picker for the editor toolbar.
 *
 * The primitive reports the new value directly rather than through a change
 * event, so the cast back to `TextType` happens here and the component's own
 * `onTextTypeChange` signature is unchanged.
 */
export const TextStyleDropdown: FC<TextStyleDropdownProps> = ({
	currentTextType,
	onTextTypeChange,
}) => {
	return (
		<Select
			value={currentTextType}
			onValueChange={(value) => onTextTypeChange(value as TextType)}
		>
			<SelectTrigger aria-label="Text style" className={cn("w-30")}>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{TEXT_TYPES.map((textType) => (
					<SelectItem key={textType.value} value={textType.value}>
						{textType.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
};
