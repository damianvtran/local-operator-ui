import type { FC } from "react";
import {
	Select,
	MenuItem,
} from "@mui/material";
import { styled } from "@mui/material/styles";

const StyledSelect = styled(Select)(() => ({
	minWidth: "120px",
	height: "32px",
	"& .MuiSelect-select": {
		padding: "4px 8px",
		fontSize: "0.875rem",
	},
}));

type TextType = "paragraph" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

type TextStyleDropdownProps = {
	currentTextType: TextType;
	onTextTypeChange: (type: TextType) => void;
};

export const TextStyleDropdown: FC<TextStyleDropdownProps> = ({
	currentTextType,
	onTextTypeChange,
}) => {
	return (
		<StyledSelect
			value={currentTextType}
			onChange={(e) => onTextTypeChange(e.target.value as TextType)}
			size="small"
		>
			<MenuItem value="paragraph">Paragraph</MenuItem>
			<MenuItem value="h1">Heading 1</MenuItem>
			<MenuItem value="h2">Heading 2</MenuItem>
			<MenuItem value="h3">Heading 3</MenuItem>
			<MenuItem value="h4">Heading 4</MenuItem>
			<MenuItem value="h5">Heading 5</MenuItem>
			<MenuItem value="h6">Heading 6</MenuItem>
		</StyledSelect>
	);
};
