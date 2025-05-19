/**
 * Unset Slider Setting Component
 *
 * Displays a "Not set" state with a button to set the value
 */

import { Box, Button, Typography, alpha, styled } from "@mui/material";
import type { FC } from "react";
import {
	DescriptionText,
	LabelText,
	LabelWrapper,
	UnsetContainer,
} from "./chat-options-sidebar-styled";

// Styled button similar to shadcn secondary/ghost
const StyledButton = styled(Button)(({ theme }) => ({
	color: theme.palette.text.secondary,
	backgroundColor: "transparent",
	border: `1px solid ${theme.palette.divider}`,
	padding: theme.spacing(0.5, 1.5),
	fontSize: "0.8rem",
	textTransform: "none", // Keep text case as is
	boxShadow: "none",
	"&:hover": {
		backgroundColor: alpha(theme.palette.action.hover, 0.04),
		borderColor: theme.palette.grey[500],
		boxShadow: "none",
	},
	"&:active": {
		boxShadow: "none",
		backgroundColor: alpha(theme.palette.action.selected, 0.08),
	},
}));

type UnsetSliderSettingProps = {
	/**
	 * Label for the setting
	 */
	label: string;

	/**
	 * Description of the setting
	 */
	description: string;

	/**
	 * Default value to set when button is clicked
	 */
	defaultValue: number;

	/**
	 * Callback when the value is set
	 */
	onSetValue: (value: number) => Promise<void>;

	/**
	 * Optional icon to display next to the label
	 */
	icon?: React.ReactNode;
};

/**
 * Unset Slider Setting Component
 *
 * Displays a "Not set" state with a button to set the value
 */
export const UnsetSliderSetting: FC<UnsetSliderSettingProps> = ({
	label,
	description,
	defaultValue,
	onSetValue,
	icon,
}) => {
	return (
		<UnsetContainer elevation={0}>
			<LabelWrapper>
				<LabelText variant="subtitle2">
					{icon && icon}
					{label}
				</LabelText>
				<DescriptionText variant="body2" color="text.secondary">
					{description}
				</DescriptionText>
			</LabelWrapper>
			<Box
				sx={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
				}}
			>
				{/* Adjusted Typography for "Not set yet" */}
				<Typography variant="caption" color="text.disabled">
					Not set yet
				</Typography>
				{/* Use the StyledButton */}
				<StyledButton
					onClick={async () => {
						await onSetValue(defaultValue);
					}}
				>
					Set to default ({defaultValue})
				</StyledButton>
			</Box>
		</UnsetContainer>
	);
};
