import { Paper, Typography, styled } from "@mui/material";
import type { FC } from "react";

/**
 * Props for the ErrorView component
 */
type ErrorViewProps = {
	message: string;
};

const ErrorContainer = styled(Paper)({
	display: "flex",
	flexDirection: "column",
	height: "100%",
	flexGrow: 1,
	borderRadius: 0,
	justifyContent: "center",
	alignItems: "center",
});

/**
 * ErrorView Component
 *
 * Displays an error message when there's an issue loading content
 */
export const ErrorView: FC<ErrorViewProps> = ({ message }) => {
	return (
		<ErrorContainer elevation={0}>
			<Typography variant="h6" color="error">
				Error loading messages
			</Typography>
			<Typography variant="body2" color="text.secondary">
				{message || "An unknown error occurred"}
			</Typography>
		</ErrorContainer>
	);
};
