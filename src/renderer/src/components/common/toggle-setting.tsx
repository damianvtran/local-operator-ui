/**
 * Toggle Setting Component
 *
 * A component for toggling boolean settings with a clean, modern UI
 */

import type { IconDefinition } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Box,
	CircularProgress,
	Paper,
	Switch,
	Typography,
	alpha,
	styled,
} from "@mui/material";
import { useState } from "react";
import type { FC } from "react";

type ToggleSettingProps = {
	/**
	 * Current value of the setting
	 */
	value: boolean;

	/**
	 * Label for the setting
	 */
	label: string;

	/**
	 * Description of what the setting does
	 */
	description?: string;

	/**
	 * Callback function when the value is changed
	 * @param value - The new value
	 */
	onChange: (value: boolean) => Promise<void>;

	/**
	 * Optional icon to display next to the label
	 */
	icon?: IconDefinition;

	/**
	 * Whether the setting is currently being saved
	 */
	isSaving?: boolean;
};

const SettingContainer = styled(Paper)(({ theme }) => ({
	padding: theme.spacing(2.5),
	borderRadius: theme.shape.borderRadius * 2,
	backgroundColor: alpha(theme.palette.background.default, 0.7),
	transition: "all 0.2s ease",
	"&:hover": {
		backgroundColor: alpha(theme.palette.background.default, 0.9),
		boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
	},
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	marginBottom: theme.spacing(2),
}));

const ContentBox = styled(Box)({
	flexGrow: 1,
});

const LabelText = styled(Typography)(({ theme }) => ({
	marginBottom: theme.spacing(0.5),
	display: "flex",
	alignItems: "center",
	color: theme.palette.text.primary,
	fontWeight: 600,
}));

const IconWrapper = styled(Box)(({ theme }) => ({
	marginRight: theme.spacing(1.5),
	opacity: 0.8,
}));

const DescriptionText = styled(Typography)(({ theme }) => ({
	fontSize: "0.875rem",
	lineHeight: 1.5,
	maxWidth: "90%",
	color: theme.palette.text.secondary,
}));

const ControlBox = styled(Box)({
	display: "flex",
	alignItems: "center",
});

const StyledSwitch = styled(Switch)(({ theme }) => ({
	"& .MuiSwitch-switchBase.Mui-checked": {
		color: theme.palette.primary.main,
	},
	"& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track": {
		backgroundColor: theme.palette.primary.main,
	},
}));

/**
 * Toggle Setting Component
 *
 * A component for toggling boolean settings with a clean, modern UI
 *
 * @param props - ToggleSettingProps
 */
export const ToggleSetting: FC<ToggleSettingProps> = ({
	value,
	label,
	description,
	onChange,
	icon,
	isSaving = false,
}) => {
	const [isOn, setIsOn] = useState(value);

	/**
	 * Handles toggling the switch
	 */
	const handleToggle = async () => {
		if (isSaving) return;

		const newValue = !isOn;
		setIsOn(newValue);

		try {
			await onChange(newValue);
		} catch (error) {
			// If there's an error, revert the UI state
			setIsOn(!newValue);
			console.error("Error toggling setting:", error);
		}
	};

	return (
		<SettingContainer elevation={0}>
			<ContentBox>
				<LabelText variant="subtitle2">
					{icon && (
						<IconWrapper>
							<FontAwesomeIcon icon={icon} />
						</IconWrapper>
					)}
					{label}
				</LabelText>

				{description && (
					<DescriptionText variant="body2">{description}</DescriptionText>
				)}
			</ContentBox>

			<ControlBox>
				{isSaving ? (
					<CircularProgress size={24} sx={{ mr: 1 }} />
				) : (
					<StyledSwitch
						checked={isOn}
						onChange={handleToggle}
						color="primary"
					/>
				)}
			</ControlBox>
		</SettingContainer>
	);
};
