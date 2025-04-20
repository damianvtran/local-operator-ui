import {
	Box,
	Button,
	LinearProgress,
	Typography,
	useTheme,
} from "@mui/material";
import type React from "react";
import { Spinner, SpinnerContainer } from "./installer-styled";

/**
 * InstallationProgress component
 *
 * Displays the installation progress UI with a spinner, progress bar, and cancel button
 */
export const InstallationProgress: React.FC = () => {
	const theme = useTheme();

	/**
	 * Handle cancel button click
	 * Sends a message to the main process to cancel the installation
	 */
	const handleCancel = () => {
		// Use IPC to communicate with main process
		window.api.ipcRenderer.send("cancel-installation");
	};

	return (
		<Box
			sx={{
				display: "flex",
				flexDirection: "column",
				gap: 4,
				width: "100%",
				maxWidth: "520px",
			}}
		>
			<Box sx={{ textAlign: "center" }}>
				<Typography variant="gradientTitle">
					🚀 Setting Up Your Environment
				</Typography>
			</Box>

			<Box sx={{ width: "100%" }}>
				<Typography
					variant="body1"
					color="text.secondary"
					sx={{ textAlign: "center", mb: 3 }}
				>
					We're preparing the magic behind the scenes! This one-time setup
					ensures you'll have the best experience with Local Operator.
				</Typography>

				<LinearProgress
					sx={{
						height: 8,
						borderRadius: 2,
						backgroundColor: "rgba(255, 255, 255, 0.1)",
						"& .MuiLinearProgress-bar": {
							borderRadius: 2,
							background: `linear-gradient(90deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
						},
					}}
				/>
			</Box>

			<SpinnerContainer>
				<Spinner />
			</SpinnerContainer>

			<Typography
				variant="body2"
				sx={{ textAlign: "center", color: "text.secondary", mb: 2 }}
			>
				Installing dependencies and configuring your environment...
			</Typography>

			<Button
				variant="contained"
				color="error"
				onClick={handleCancel}
				sx={{
					alignSelf: "center",
					px: 4,
					py: 1,
					borderRadius: 2,
					boxShadow: "0 4px 12px rgba(211, 47, 47, 0.2)",
				}}
			>
				Cancel Setup
			</Button>
		</Box>
	);
};
