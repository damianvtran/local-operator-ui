import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import type { FC } from "react";

type TextType = "paragraph" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

type TextStyleDropdownProps = {
	currentTextType: TextType;
	onTextTypeChange: (type: TextType) => void;
};

const TEXT_TYPES = (): { value: TextType; label: string }[] => [
	{ value: "paragraph", label: t("ui.canvas.text_style_dropdown.paragraph") },
	{ value: "h1", label: t("ui.canvas.text_style_dropdown.heading_1") },
	{ value: "h2", label: t("ui.canvas.text_style_dropdown.heading_2") },
	{ value: "h3", label: t("ui.canvas.text_style_dropdown.heading_3") },
	{ value: "h4", label: t("ui.canvas.text_style_dropdown.heading_4") },
	{ value: "h5", label: t("ui.canvas.text_style_dropdown.heading_5") },
	{ value: "h6", label: t("ui.canvas.text_style_dropdown.heading_6") },
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
	useI18nLocale();
	return (
		<Select
			value={currentTextType}
			onValueChange={(value) => onTextTypeChange(value as TextType)}
		>
			<SelectTrigger
				aria-label={t("ui.canvas.text_style_dropdown.text_style")}
				className={cn("w-30")}
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{TEXT_TYPES().map((textType) => (
					<SelectItem key={textType.value} value={textType.value}>
						{textType.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
};
