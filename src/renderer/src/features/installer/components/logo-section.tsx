import logo from "@assets/clear-icon-with-text.png";
import { Box, Typography, useTheme } from "@mui/material";
import type React from "react";
import { LogoContainer } from "./installer-styled";

/**
 * LogoSection component
 *
 * Displays the Local Operator logo and title
 */
export const LogoSection: React.FC = () => {
	const theme = useTheme();

	return (
		<>
			<LogoContainer>
				<Box
					component="img"
					src={logo}
					alt="Local Operator Logo"
					sx={{
						width: "auto",
						height: 120,
						objectFit: "contain",
						display: "block",
					}}
					onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
						// Fallback if the path is incorrect
						e.currentTarget.src = "../assets/icon.png";
					}}
				/>
			</LogoContainer>
			<Typography
				variant="h3"
				sx={{
					textAlign: "center",
					mb: 2,
					fontWeight: 700,
					color: theme.palette.text.primary,
				}}
			>
				Local Operator
			</Typography>
			<Typography
				variant="h6"
				sx={{
					textAlign: "center",
					mb: 4,
					color: theme.palette.text.secondary,
					maxWidth: "500px",
					fontWeight: 400,
				}}
			>
				Personal AI Assistants that Turn Ideas into Action
			</Typography>
		</>
	);
};
