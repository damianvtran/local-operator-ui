import { faDownload } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Card, CardContent, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import { CheckForUpdatesButton } from "../common/update-notification";

const StyledCard = styled(Card)(() => ({
	marginBottom: 32,
	backgroundColor: "background.paper",
	borderRadius: 8,
	boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
}));

const StyledCardContent = styled(CardContent)(({ theme }) => ({
	[theme.breakpoints.down("sm")]: {
		padding: 16,
	},
	[theme.breakpoints.up("sm")]: {
		padding: 24,
	},
}));

const CardTitle = styled(Typography)(() => ({
	marginBottom: 16,
	display: "flex",
	alignItems: "center",
	gap: 8,
}));

const CardDescription = styled(Typography)(() => ({
	marginBottom: 24,
	color: "text.secondary",
}));

/**
 * Application updates section for the settings page
 */
export const AppUpdates = () => {
	return (
		<StyledCard>
			<StyledCardContent>
				<CardTitle variant="h6">
					<FontAwesomeIcon icon={faDownload} />
					Application Updates
				</CardTitle>

				<CardDescription variant="body2">
					Check for and install updates to the Local Operator application.
				</CardDescription>

				<CheckForUpdatesButton />
			</StyledCardContent>
		</StyledCard>
	);
};
