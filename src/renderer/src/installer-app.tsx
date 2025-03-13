import { Box, Button, Card, LinearProgress, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import type React from "react";

/**
 * Container for the installer app
 * Centers content vertically and horizontally
 */
const AppContainer = styled(Box)(() => ({
	display: "flex",
	height: "100vh",
	overflow: "hidden",
	justifyContent: "center",
	alignItems: "center",
	backgroundColor: "#0A0A0A",
	padding: "32px",
}));

/**
 * Styled card component for the installer content
 */
const StyledCard = styled(Card)(() => ({
	width: "100%",
	maxWidth: "520px",
	padding: "24px",
	display: "flex",
	flexDirection: "column",
	gap: "24px",
}));

/**
 * Container for the spinner
 */
const SpinnerContainer = styled(Box)(() => ({
	display: "flex",
	justifyContent: "center",
	margin: "24px 0",
}));

/**
 * Animated spinner component
 */
const Spinner = styled(Box)(({ theme }) => ({
	width: "40px",
	height: "40px",
	border: `3px solid ${theme.palette.primary.main}20`,
	borderRadius: "50%",
	borderTopColor: theme.palette.primary.main,
	animation: "spin 1s ease-in-out infinite",
	"@keyframes spin": {
		to: { transform: "rotate(360deg)" },
	},
}));

/**
 * InstallerApp component
 *
 * Displays the installation progress UI with a spinner, progress bar, and cancel button
 */
export const InstallerApp: React.FC = () => {
	/**
	 * Handle cancel button click
	 * Sends a message to the main process to cancel the installation
	 */
	const handleCancel = () => {
		// Use IPC to communicate with main process
		window.api.ipcRenderer.send("cancel-installation");
	};

	return (
		<AppContainer>
			<StyledCard>
				<Box sx={{ textAlign: "center" }}>
					<Typography variant="gradientTitle">
						🚀 Setting Up Your Environment
					</Typography>
				</Box>

				<Box sx={{ width: "100%" }}>
					<Typography
						variant="body2"
						color="text.secondary"
						sx={{ textAlign: "center", mb: 2 }}
					>
						We're preparing the magic behind the scenes! This one-time setup
						ensures you'll have the best experience with Local Operator.
					</Typography>

					<LinearProgress
						sx={{
							height: 6,
							borderRadius: 1,
							backgroundColor: "rgba(255, 255, 255, 0.1)",
							"& .MuiLinearProgress-bar": {
								borderRadius: 1,
							},
						}}
					/>
				</Box>

				<SpinnerContainer>
					<Spinner />
				</SpinnerContainer>

				<Button
					variant="contained"
					color="error"
					onClick={handleCancel}
					sx={{ alignSelf: "center" }}
				>
					Cancel Setup
				</Button>
			</StyledCard>
		</AppContainer>
	);
};
