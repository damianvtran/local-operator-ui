/**
 * @file radient-account-section.tsx
 * @description
 * Settings section for managing Radient account.
 * Shows sign-in buttons if not authenticated, or account information and sign-out button if authenticated.
 */

import { faSignOut, faUser } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Box,
	Button,
	Card,
	CardContent,
	Chip,
	Divider,
	Grid,
	Typography,
	alpha,
	styled,
} from "@mui/material";
import { RadientAuthButtons } from "@renderer/components/auth";
import { useRadientAuth } from "@renderer/hooks";
import { useFeatureFlags } from "@renderer/providers/feature-flags";
import type { FC } from "react";

const StyledCard = styled(Card)(() => ({
	marginBottom: 32,
	backgroundColor: "background.paper",
	borderRadius: 8,
	boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
}));

const StyledCardContent = styled(CardContent)(({ theme }) => ({
	[theme.breakpoints.down("sm")]: {
		padding: 16,
	},
	[theme.breakpoints.up("sm")]: {
		padding: 24,
	},
}));

const CardTitle = styled(Typography)(() => ({
	marginBottom: 16,
	display: "flex",
	alignItems: "center",
	gap: 8,
}));

const CardDescription = styled(Typography)(() => ({
	marginBottom: 24,
	color: "text.secondary",
}));

const InfoContainer = styled(Box)(({ theme }) => ({
	padding: theme.spacing(3),
	borderRadius: 8,
	backgroundColor: alpha(theme.palette.primary.main, 0.05),
	marginBottom: theme.spacing(3),
}));

const InfoRow = styled(Box)(({ theme }) => ({
	display: "flex",
	marginBottom: theme.spacing(2),
	"&:last-child": {
		marginBottom: 0,
	},
}));

const InfoLabel = styled(Typography)(({ theme }) => ({
	fontWeight: 500,
	width: 120,
	flexShrink: 0,
	color: theme.palette.text.secondary,
}));

const InfoValue = styled(Typography)(() => ({
	fontWeight: 400,
	flexGrow: 1,
}));

const StatusChip = styled(Chip)(({ theme }) => ({
	marginLeft: theme.spacing(1),
}));

const SignOutButton = styled(Button)(({ theme }) => ({
	marginTop: theme.spacing(3),
	backgroundColor: alpha(theme.palette.error.main, 0.1),
	color: theme.palette.error.main,
	"&:hover": {
		backgroundColor: alpha(theme.palette.error.main, 0.2),
	},
}));

/**
 * RadientAccountSection component
 *
 * Settings section for managing Radient account.
 * Shows sign-in buttons if not authenticated, or account information and sign-out button if authenticated.
 */
export const RadientAccountSection: FC = () => {
	const { isEnabled } = useFeatureFlags();
	const isRadientPassEnabled = isEnabled("radient-pass-onboarding");
	const { isAuthenticated, user, isLoading, error, signOut } = useRadientAuth();

	// If the feature flag is disabled, don't show this section
	if (!isRadientPassEnabled) {
		return null;
	}

	const handleSignOut = async () => {
		await signOut();
		// The page will be refreshed by the user-profile-sidebar component
	};

	return (
		<StyledCard>
			<StyledCardContent>
				<CardTitle variant="h6">
					<FontAwesomeIcon icon={faUser} />
					Radient Account
				</CardTitle>

				<CardDescription variant="body2">
					Manage your Radient account for accessing additional features like web
					search, image generation, and more.
				</CardDescription>

				{isLoading ? (
					<Typography>Loading account information...</Typography>
				) : error ? (
					<Typography color="error">Error: {error}</Typography>
				) : isAuthenticated && user.radientUser ? (
					<>
						<InfoContainer>
							<InfoRow>
								<InfoLabel variant="body2">Status:</InfoLabel>
								<InfoValue variant="body2">
									Connected
									<StatusChip
										label={user.radientUser.account.status}
										color="success"
										size="small"
									/>
								</InfoValue>
							</InfoRow>
							<InfoRow>
								<InfoLabel variant="body2">Name:</InfoLabel>
								<InfoValue variant="body2">
									{user.radientUser.account.name || "Not provided"}
								</InfoValue>
							</InfoRow>
							<InfoRow>
								<InfoLabel variant="body2">Email:</InfoLabel>
								<InfoValue variant="body2">
									{user.radientUser.account.email}
								</InfoValue>
							</InfoRow>
							<InfoRow>
								<InfoLabel variant="body2">Account ID:</InfoLabel>
								<InfoValue variant="body2">
									{user.radientUser.account.id}
								</InfoValue>
							</InfoRow>
							<InfoRow>
								<InfoLabel variant="body2">Provider:</InfoLabel>
								<InfoValue variant="body2" sx={{ textTransform: "capitalize" }}>
									{user.radientUser.identity.provider}
								</InfoValue>
							</InfoRow>
							<InfoRow>
								<InfoLabel variant="body2">Created:</InfoLabel>
								<InfoValue variant="body2">
									{new Date(
										user.radientUser.account.created_at,
									).toLocaleString()}
								</InfoValue>
							</InfoRow>
						</InfoContainer>

						<Divider sx={{ my: 3 }} />

						<Grid container spacing={2}>
							<Grid item xs={12}>
								<Typography variant="body2" color="text.secondary" gutterBottom>
									Need to sign out or switch accounts?
								</Typography>
								<SignOutButton
									variant="outlined"
									startIcon={<FontAwesomeIcon icon={faSignOut} />}
									onClick={handleSignOut}
								>
									Sign Out from Radient
								</SignOutButton>
							</Grid>
						</Grid>
					</>
				) : (
					<Box sx={{ mt: 2 }}>
						<Typography variant="body2" color="text.secondary" gutterBottom>
							You are not currently signed in to Radient. Sign in to access
							additional features.
						</Typography>
						<Box sx={{ mt: 3 }}>
							<RadientAuthButtons
								titleText="Sign in to your Radient account"
								descriptionText="Choose your preferred sign-in method to access Radient services."
							/>
						</Box>
					</Box>
				)}
			</StyledCardContent>
		</StyledCard>
	);
};
