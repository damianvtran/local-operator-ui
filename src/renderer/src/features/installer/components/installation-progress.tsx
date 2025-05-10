import {
	Box,
	Button,
	Typography,
	useTheme,
	alpha, 
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
					Setting Up Your Environment
				</Typography>
			</Box>

			<Box sx={{ width: "100%" }}>
				<Typography
					variant="body1"
					color="text.secondary"
					sx={{ textAlign: "center", mb: 3, fontSize: "1rem" }}
				>
					We're preparing the magic behind the scenes! This one-time setup
					ensures you'll have the best experience with Local Operator.
				</Typography>
				{/* LinearProgress removed as per feedback */}
			</Box>

			<SpinnerContainer sx={{ my: 2 }}> {/* Added some margin for better spacing */}
				<Spinner />
			</SpinnerContainer>

			<Typography
				variant="body1" 
				sx={{ textAlign: "center", color: "text.secondary", fontSize: "1rem" }} 
			>
				Installing dependencies and configuring your environment...
			</Typography>
      <Typography
				variant="body1"
				sx={{ textAlign: "center", color: "text.secondary", fontSize: "0.875rem" }}
			>
				This will take a few minutes.
			</Typography>

			<Button
				variant="outlined" 
				color="error"
				onClick={handleCancel}
				sx={{
					alignSelf: "center",
					px: 3, 
					py: 1,
					borderRadius: theme.shape.borderRadius, 
					borderColor: theme.palette.error.main,
					"&:hover": {
						backgroundColor: alpha(theme.palette.error.main, 0.08), 
						borderColor: theme.palette.error.dark,
					},
				}}
			>
				Cancel Setup
			</Button>
		</Box>
	);
};
