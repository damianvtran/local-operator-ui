import { faCheck, faKey } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Grid, Typography, styled } from "@mui/material";
import type { FC, ReactNode } from "react";

const SectionTitle = styled(Typography)(({ theme }) => ({
	marginTop: theme.spacing(4),
	marginBottom: theme.spacing(2),
	fontWeight: 500,
}));

const SectionDescription = styled(Typography)(({ theme }) => ({
	marginBottom: theme.spacing(3),
	color: theme.palette.text.secondary,
}));

const EmptyStateContainer = styled(Box)(({ theme }) => ({
	padding: theme.spacing(4),
	textAlign: "center",
	backgroundColor: "rgba(0, 0, 0, 0.01)",
	borderRadius: 8,
	marginBottom: theme.spacing(4),
}));

const EmptyStateIcon = styled(Box)(() => ({
	marginBottom: 16,
	opacity: 0.5,
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
 * Component for displaying a section of credentials
 * Includes title, description, and content
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
		<>
			<SectionTitle variant="h6" sx={{ mt: isFirstSection ? 1 : 4 }}>
				{title}
			</SectionTitle>
			<SectionDescription variant="body2">{description}</SectionDescription>

			{isEmpty ? (
				<EmptyState type={emptyStateType} />
			) : (
				<Grid container spacing={3}>
					{children}
				</Grid>
			)}
		</>
	);
};

type EmptyStateProps = {
	type: "noCredentials" | "allConfigured";
};

/**
 * Component for displaying an empty state message
 */
export const EmptyState: FC<EmptyStateProps> = ({ type }) => {
	const isNoCredentials = type === "noCredentials";

	return (
		<EmptyStateContainer>
			<EmptyStateIcon>
				<FontAwesomeIcon icon={isNoCredentials ? faKey : faCheck} size="2x" />
			</EmptyStateIcon>
			<Typography variant="h6" gutterBottom>
				{isNoCredentials
					? "No Credentials Configured"
					: "All Available Credentials Configured"}
			</Typography>
			<Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
				{isNoCredentials
					? "You haven't set up any API credentials yet. Add credentials from the available options below."
					: "You've configured all the common API credentials. You can still add custom credentials if needed."}
			</Typography>
		</EmptyStateContainer>
	);
};
