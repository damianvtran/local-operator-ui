import { Box, Button, LinearProgress, Typography } from "@mui/material";
import type React from "react";
import { SpinnerContainer, Spinner, StyledCard } from "./installer-styled";

/**
 * InstallerContent component
 *
 * Displays the installation progress UI with a spinner, progress bar, and cancel button
 */
export const InstallerContent: React.FC = () => {
	/**
	 * Handle cancel button click
	 * Sends a message to the main process to cancel the installation
	 */
	const handleCancel = () => {
		// Use IPC to communicate with main process
		window.api.ipcRenderer.send("cancel-installation");
	};

	return (
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
	);
};
