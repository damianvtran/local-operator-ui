/**
 * @file radient-account-section.tsx
 * @description
 * Settings section for managing Radient account.
 * Shows sign-in buttons if not authenticated, or account information and sign-out button if authenticated.
 */

import { faSignOut } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Box,
	Button,
	Chip,
	CircularProgress,
	Divider,
	Typography,
	alpha,
	styled,
} from "@mui/material";
import { RadientAuthButtons } from "@shared/components/auth";
import { useRadientAuth } from "@shared/hooks";
import { type FC, useCallback, useMemo } from "react";

// Shadcn-inspired container for info rows
const InfoContainer = styled(Box)(({ theme }) => ({
	padding: theme.spacing(2),
	borderRadius: theme.shape.borderRadius * 0.75,
	backgroundColor: theme.palette.action.hover,
	border: `1px solid ${theme.palette.divider}`,
	marginBottom: theme.spacing(3),
}));

// Styling for each row within the info container
const InfoRow = styled(Box)(({ theme }) => ({
	display: "flex",
	flexDirection: "row",
	alignItems: "flex-start",
	marginBottom: theme.spacing(1.5),
	"&:last-child": {
		marginBottom: 0,
	},
	[theme.breakpoints.down("sm")]: {
		flexDirection: "column",
		alignItems: "stretch",
		marginBottom: theme.spacing(2),
	},
}));

// Styling for the label part of an info row
const InfoLabel = styled(Typography)(({ theme }) => ({
	fontWeight: 500,
	width: 100,
	flexShrink: 0,
	color: theme.palette.text.secondary,
	fontSize: "0.8125rem",
	lineHeight: 1.6,
	marginRight: theme.spacing(2),
	[theme.breakpoints.down("sm")]: {
		width: "auto",
		marginBottom: theme.spacing(0.5),
		marginRight: 0,
	},
}));

// Styling for the value part of an info row
const InfoValue = styled(Typography)(({ theme }) => ({
	fontWeight: 400,
	flexGrow: 1,
	fontSize: "0.8125rem",
	lineHeight: 1.6,
	wordBreak: "break-word",
	color: theme.palette.text.primary,
}));

// Styling for the status chip (e.g., "Connected")
const StatusChip = styled(Chip)(({ theme }) => ({
	marginLeft: theme.spacing(1),
	height: 20,
	fontSize: "0.75rem",
	borderRadius: theme.shape.borderRadius,
	"& .MuiChip-label": {
		paddingLeft: theme.spacing(1),
		paddingRight: theme.spacing(1),
	},
	"&.MuiChip-colorSuccess": {
		backgroundColor: alpha(theme.palette.success.main, 0.15),
		color: theme.palette.success.dark,
	},
}));

// Shadcn-inspired destructive button style for Sign Out
const SignOutButton = styled(Button)(({ theme }) => ({
	borderColor: theme.palette.divider,
	color: theme.palette.error.main,
	textTransform: "none",
	fontSize: "0.8125rem",
	padding: theme.spacing(0.75, 2),
	borderRadius: theme.shape.borderRadius * 0.75,
	"&:hover": {
		backgroundColor: alpha(theme.palette.error.main, 0.05),
		borderColor: alpha(theme.palette.error.main, 0.5),
	},
}));

// Loading container
const LoadingContainer = styled(Box)({
	display: "flex",
	justifyContent: "center",
	alignItems: "center",
	minHeight: 150,
});

/**
 * Settings section for managing Radient account connection and details.
 * Uses shadcn-inspired styling via SettingsSectionCard and styled components.
 */
export const RadientAccountSection: FC = () => {
	const { isAuthenticated, user, isLoading, error, signOut } = useRadientAuth();

	// Memoize the sign-out handler
	const handleSignOut = useCallback(async () => {
		try {
			await signOut();
		} catch (err) {
			console.error("Error signing out:", err);
			// Consider adding user feedback
		}
	}, [signOut]);

	// Memoize the account information section
	const accountInfoSection = useMemo(() => {
		if (!isAuthenticated || !user.radientUser) return null;

		const { account, identity } = user.radientUser;

		return (
			<>
				<InfoContainer>
					<InfoRow>
						<InfoLabel>Status:</InfoLabel>
						<Box sx={{ flexGrow: 1, display: "flex", alignItems: "center" }}>
							<InfoValue>Connected</InfoValue>
							<StatusChip
								label={account.status}
								color="success"
								size="small"
								className="MuiChip-colorSuccess" // Ensure class is applied for styling
							/>
						</Box>
					</InfoRow>
					<InfoRow>
						<InfoLabel>Name:</InfoLabel>
						<InfoValue>{account.name || "Not provided"}</InfoValue>
					</InfoRow>
					<InfoRow>
						<InfoLabel>Email:</InfoLabel>
						<InfoValue>{account.email}</InfoValue>
					</InfoRow>
					<InfoRow>
						<InfoLabel>Account ID:</InfoLabel>
						<InfoValue>{account.id}</InfoValue>
					</InfoRow>
					<InfoRow>
						<InfoLabel>Tenant ID:</InfoLabel>
						<InfoValue>{account.tenant_id}</InfoValue>
					</InfoRow>
					<InfoRow>
						<InfoLabel>Provider:</InfoLabel>
						<InfoValue sx={{ textTransform: "capitalize" }}>
							{identity.provider}
						</InfoValue>
					</InfoRow>
					<InfoRow>
						<InfoLabel>Created:</InfoLabel>
						<InfoValue>
							{new Date(account.created_at).toLocaleString()}
						</InfoValue>
					</InfoRow>
				</InfoContainer>

				<Divider sx={{ my: 3 }} />

				<Box>
					<Typography variant="body2" color="text.secondary" mb={1.5}>
						Need to sign out or switch accounts?
					</Typography>
					<SignOutButton
						variant="outlined"
						startIcon={<FontAwesomeIcon icon={faSignOut} size="sm" />}
						onClick={handleSignOut}
					>
						Sign Out from Radient
					</SignOutButton>
				</Box>
			</>
		);
	}, [isAuthenticated, user.radientUser, handleSignOut]);

	// Memoize the sign-in section
	const signInSection = useMemo(() => {
		if (isAuthenticated) return null;

		return (
			<Box sx={{ mt: 1 }}>
				{" "}
				{/* Reduced margin top */}
				<Typography variant="body2" color="text.secondary" mb={2.5}>
					You are not currently signed in to Radient. Sign in to access your
					account details or sign up to get free credits and unified access to
					models, tools, and more with Radient Pass.
				</Typography>
				<RadientAuthButtons
					titleText=""
					descriptionText=""
					onSignInSuccess={() => {
						// Optional: Add logic after successful sign-in if needed
					}}
				/>
			</Box>
		);
	}, [isAuthenticated]);

	return (
		<Box>
			{" "}
			{/* Wrap content in a Box instead of a Card */}
			{isLoading ? (
				<LoadingContainer>
					<CircularProgress />
				</LoadingContainer>
			) : error ? (
				<Typography color="error" variant="body2">
					Error loading account information:{" "}
					{error instanceof Error ? error.message : String(error)}
				</Typography>
			) : (
				// Render either the account info or the sign-in prompt
				accountInfoSection || signInSection
			)}
		</Box>
	);
};
