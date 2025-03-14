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
					mb: 4,
					fontWeight: 600,
					background: `linear-gradient(90deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
					WebkitBackgroundClip: "text",
					WebkitTextFillColor: "transparent",
				}}
			>
				Local Operator
			</Typography>
			<Typography
				variant="h6"
				sx={{
					textAlign: "center",
					mb: 6,
					color: "rgba(255, 255, 255, 0.7)",
					maxWidth: "600px",
				}}
			>
				Your Personal Assistant that Gets Things Done with Python
			</Typography>
		</>
	);
};
