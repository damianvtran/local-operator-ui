import { faCheck, faKey } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Grid, Typography, styled } from "@mui/material";
import { SectionTitle as CommonSectionTitle } from "@shared/components/common/section-title";
import type { FC, ReactNode } from "react";

// Styling for the section description
const SectionDescription = styled(Typography)(({ theme }) => ({
	marginBottom: theme.spacing(2.5),
	color: theme.palette.text.secondary,
	fontSize: "0.875rem",
	lineHeight: 1.5,
}));

// Shadcn-inspired empty state container
const EmptyStateContainer = styled(Box)(({ theme }) => ({
	padding: theme.spacing(4, 3),
	textAlign: "center",
	backgroundColor: theme.palette.action.hover,
	border: `1px dashed ${theme.palette.divider}`,
	borderRadius: theme.shape.borderRadius * 0.75,
	marginBottom: theme.spacing(3),
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
}));

// Styling for the icon within the empty state
const EmptyStateIcon = styled(Box)(({ theme }) => ({
	marginBottom: theme.spacing(1.5),
	color: theme.palette.text.disabled,
}));

type CredentialsSectionProps = {
	title: string;
	description: string;
	children: ReactNode;
	isEmpty?: boolean;
	emptyStateType?: "noCredentials" | "allConfigured";
	isFirstSection?: boolean;
};

/**
 * Component for displaying a section of credentials (e.g., Configured, Available).
 * Uses shadcn-inspired styling for title, description, and empty state.
 */
export const CredentialsSection: FC<CredentialsSectionProps> = ({
	title,
	description,
	children,
	isEmpty = false,
	emptyStateType = "noCredentials",
	isFirstSection = false,
}) => {
	return (
		<Box sx={{ mb: 4 }}>
			{" "}
			{/* Add margin bottom to separate sections */}
			<CommonSectionTitle
				title={title}
				variant="h6"
				sx={{
					mt: isFirstSection ? 0 : 3,
					mb: 1,
				}}
			/>
			<SectionDescription variant="body2">{description}</SectionDescription>
			{isEmpty ? (
				<EmptyState type={emptyStateType} />
			) : (
				<Grid container spacing={2}>
					{children}
				</Grid>
			)}
		</Box>
	);
};

// --- Empty State Component ---

type EmptyStateProps = {
	type: "noCredentials" | "allConfigured";
};

/**
 * Component for displaying an empty state message within a CredentialsSection.
 */
export const EmptyState: FC<EmptyStateProps> = ({ type }) => {
	const isNoCredentials = type === "noCredentials";

	return (
		<EmptyStateContainer>
			<EmptyStateIcon>
				<FontAwesomeIcon
					icon={isNoCredentials ? faKey : faCheck}
					size="lg" // Slightly smaller icon
				/>
			</EmptyStateIcon>
			<Typography
				variant="subtitle1" // Use subtitle1 for slightly smaller heading
				fontWeight={500} // Medium weight
				gutterBottom
				sx={{ mb: 0.5 }} // Reduced margin
			>
				{isNoCredentials
					? "No Credentials Configured"
					: "All Available Credentials Configured"}
			</Typography>
			<Typography
				variant="body2"
				color="text.secondary"
				sx={{ maxWidth: 400, margin: "0 auto" }} // Limit width for readability
			>
				{isNoCredentials
					? "You haven't set up any API credentials yet. Add credentials from the available options or add a custom one."
					: "You've configured all the common API credentials. You can still add custom credentials if needed."}
			</Typography>
		</EmptyStateContainer>
	);
};
