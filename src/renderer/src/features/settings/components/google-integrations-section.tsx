import { faGoogle } from "@fortawesome/free-brands-svg-icons";
import {
	faCalendarDays,
	faCheckCircle,
	faCircleExclamation,
	faEnvelope,
	faHardDrive,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Box,
	Button,
	CircularProgress,
	Paper,
	Stack,
	Typography,
	alpha,
	useTheme,
} from "@mui/material";
import { SettingsSectionCard } from "./settings-section-card"; // Corrected import path
import { useOidcAuth } from "@shared/hooks/use-oidc-auth";
import type { FC } from "react";

// Define the scopes for each Google service
const GMAIL_SCOPES = [
	"https://www.googleapis.com/auth/gmail.readonly",
	"https://www.googleapis.com/auth/gmail.compose",
];
const CALENDAR_SCOPES = [
	"https://www.googleapis.com/auth/calendar.readonly",
	"https://www.googleapis.com/auth/calendar",
];
const DRIVE_SCOPES = [
	"https://www.googleapis.com/auth/drive.readonly",
	"https://www.googleapis.com/auth/drive",
];

type IntegrationButtonProps = {
	serviceName: string;
	icon: JSX.Element;
	scopes: string[];
	grantedScopes: string[] | undefined;
	onConnect: (scopes: string[]) => void;
	isLoading: boolean;
};

const IntegrationButton: FC<IntegrationButtonProps> = ({
	serviceName,
	icon,
	scopes,
	grantedScopes,
	onConnect,
	isLoading,
}) => {
	const theme = useTheme();
	const isConnected =
		grantedScopes && scopes.every((scope) => grantedScopes.includes(scope));

	const handleConnect = () => {
		if (!isConnected) {
			onConnect(scopes);
		}
	};

	return (
		<Paper
			variant="outlined"
			sx={{
				p: 2,
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				mb: 1.5,
				backgroundColor: isConnected
					? alpha(theme.palette.success.main, 0.05)
					: theme.palette.background.paper,
				borderColor: isConnected
					? alpha(theme.palette.success.main, 0.3)
					: theme.palette.divider,
			}}
		>
			<Stack direction="row" alignItems="center" spacing={1.5}>
				{icon}
				<Typography variant="body1" fontWeight="500">
					{serviceName}
				</Typography>
			</Stack>
			<Button
				variant={isConnected ? "contained" : "outlined"}
				color={isConnected ? "success" : "primary"}
				size="small"
				onClick={handleConnect}
				disabled={isLoading || isConnected}
				startIcon={
					isLoading ? (
						<CircularProgress size={16} color="inherit" />
					) : isConnected ? (
						<FontAwesomeIcon icon={faCheckCircle} />
					) : (
						<FontAwesomeIcon icon={faCircleExclamation} />
					)
				}
				sx={{
					minWidth: 120,
					textTransform: "none",
					fontSize: "0.8125rem",
					...(isConnected && {
						backgroundColor: theme.palette.success.main,
						color: theme.palette.success.contrastText,
						"&:hover": {
							backgroundColor: theme.palette.success.dark,
						},
					}),
				}}
			>
				{isLoading
					? "Connecting..."
					: isConnected
						? "Connected"
						: "Connect"}
			</Button>
		</Paper>
	);
};

export const GoogleIntegrationsSection: FC = () => {
	const { status: oidcStatus, requestAdditionalGoogleScopes, loading: oidcLoading, } = useOidcAuth();

	const handleConnectService = async (scopesToRequest: string[]) => {
		await requestAdditionalGoogleScopes(scopesToRequest);
		// The useOidcAuth hook will handle status updates and re-renders
	};

	return (
		<SettingsSectionCard
			title="Google Integrations"
			icon={faGoogle}
			description="Connect your Google services like Gmail, Calendar, and Drive to enhance Local Operator's capabilities."
		>
			<Box mt={1}>
				<IntegrationButton
					serviceName="Gmail"
					icon={<FontAwesomeIcon icon={faEnvelope} fixedWidth />}
					scopes={GMAIL_SCOPES}
					grantedScopes={oidcStatus.grantedScopes}
					onConnect={handleConnectService}
					isLoading={oidcLoading}
				/>
				<IntegrationButton
					serviceName="Calendar"
					icon={<FontAwesomeIcon icon={faCalendarDays} fixedWidth />}
					scopes={CALENDAR_SCOPES}
					grantedScopes={oidcStatus.grantedScopes}
					onConnect={handleConnectService}
					isLoading={oidcLoading}
				/>
				<IntegrationButton
					serviceName="Drive"
					icon={<FontAwesomeIcon icon={faHardDrive} fixedWidth />}
					scopes={DRIVE_SCOPES}
					grantedScopes={oidcStatus.grantedScopes}
					onConnect={handleConnectService}
					isLoading={oidcLoading}
				/>
			</Box>
		</SettingsSectionCard>
	);
};
