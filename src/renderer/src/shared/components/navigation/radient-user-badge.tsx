/**
 * @file radient-user-badge.tsx
 * @description
 * A component that displays a badge with the user's Radient authentication status.
 * This is a simple example of how to use the useRadientAuth hook.
 */

import { Box, Chip, Tooltip, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import { useRadientAuth } from "@shared/hooks/use-radient-auth"; // TODO: Advise on this type of import/export
import type { FC } from "react";

/**
 * Props for the RadientUserBadge component
 */
type RadientUserBadgeProps = {
	/**
	 * Whether to show detailed user information
	 */
	showDetails?: boolean;
};

const BadgeContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	gap: theme.spacing(1),
	padding: theme.spacing(1),
}));

const UserInfoContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	flexDirection: "column",
	gap: theme.spacing(0.5),
}));

/**
 * RadientUserBadge component
 *
 * Displays a badge with the user's Radient authentication status.
 * If authenticated, shows the user's name and email.
 * If not authenticated, shows a message indicating that the user is not authenticated.
 */
export const RadientUserBadge: FC<RadientUserBadgeProps> = ({
	showDetails = false,
}) => {
	const { isAuthenticated, isLoading, user, error } = useRadientAuth();

	// Only show loading if we're loading and not authenticated yet
	if (isLoading && !isAuthenticated) {
		return (
			<BadgeContainer>
				<Chip label="Loading..." color="default" size="small" />
			</BadgeContainer>
		);
	}

	// Show error only if there's an error and we're not authenticated
	if (error && !isAuthenticated) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		return (
			<Tooltip title={errorMessage} arrow>
				<BadgeContainer>
					<Chip label="Auth Error" color="error" size="small" />
				</BadgeContainer>
			</Tooltip>
		);
	}

	// Show not authenticated state
	if (!isAuthenticated) {
		return (
			<BadgeContainer>
				<Chip label="Not Authenticated" color="default" size="small" />
			</BadgeContainer>
		);
	}

	return (
		<BadgeContainer>
			<Chip label="Radient Authenticated" color="success" size="small" />

			{showDetails && user && (
				<UserInfoContainer>
					<Typography variant="subtitle2">{user.name}</Typography>
					<Typography variant="caption" color="text.secondary">
						{user.email}
					</Typography>
					{user.radientUser && (
						<Typography variant="caption" color="text.secondary">
							Account ID: {user.radientUser.account.id}
						</Typography>
					)}
				</UserInfoContainer>
			)}
		</BadgeContainer>
	);
};
