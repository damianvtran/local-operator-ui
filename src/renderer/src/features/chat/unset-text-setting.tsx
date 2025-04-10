/**
 * Unset Text Setting Component
 *
 * Displays a "Not set" state with a button to set the value for text-based settings
 */

import { Box, Button, Typography } from "@mui/material";
import type { FC } from "react";
import {
	DescriptionText,
	LabelText,
	LabelWrapper,
	UnsetContainer,
} from "./chat-options-sidebar-styled";

type UnsetTextSettingProps = {
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
	defaultValue: string | string[] | number;

	/**
	 * Display text for the default value
	 */
	defaultDisplayText: string;

	/**
	 * Callback when the value is set
	 */
	onSetValue: () => Promise<void>;

	/**
	 * Optional icon to display next to the label
	 */
	icon?: React.ReactNode;
};

/**
 * Unset Text Setting Component
 *
 * Displays a "Not set" state with a button to set the value for text-based settings
 */
export const UnsetTextSetting: FC<UnsetTextSettingProps> = ({
	label,
	description,
	defaultDisplayText,
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
				<Typography variant="body2" color="text.secondary" fontStyle="italic">
					Not set yet
				</Typography>
				<Button
					variant="outlined"
					size="small"
					onClick={async () => {
						await onSetValue();
					}}
				>
					Set to default ({defaultDisplayText})
				</Button>
			</Box>
		</UnsetContainer>
	);
};
