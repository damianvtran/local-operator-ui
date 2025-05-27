import { faPuzzlePiece } from "@fortawesome/free-solid-svg-icons";
import {
	Box,
	Button,
	CircularProgress,
	Paper,
	Stack,
	Tooltip,
	Typography,
	alpha,
	useTheme,
} from "@mui/material";
import { useOidcAuth } from "@shared/hooks/use-oidc-auth";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import {
	CalendarDays,
	CheckCircle2,
	HardDrive,
	Link as LinkIcon,
	Mail,
} from "lucide-react";
import type { FC } from "react";
import { SettingsSectionCard } from "./settings-section-card";

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
	isAuthenticated: boolean; // Added isAuthenticated prop
};

const IntegrationButton: FC<IntegrationButtonProps> = ({
	serviceName,
	icon,
	scopes,
	grantedScopes,
	onConnect,
	isLoading,
	isAuthenticated, // Destructure isAuthenticated
}) => {
	const theme = useTheme();
	const isConnected =
		grantedScopes && scopes.every((scope) => grantedScopes.includes(scope));

	const handleConnect = () => {
		if (!isConnected && isAuthenticated) {
			// Check isAuthenticated before connecting
			onConnect(scopes);
		}
	};

	const connectButton = (
		<Button
			variant={isConnected ? "contained" : "outlined"}
			color={isConnected ? "success" : "primary"}
			size="small"
			onClick={handleConnect}
			disabled={isLoading || isConnected || !isAuthenticated} // Disable if not authenticated
			startIcon={
				isLoading ? (
					<CircularProgress size={16} color="inherit" />
				) : isConnected ? (
					<CheckCircle2 size={16} />
				) : (
					<LinkIcon size={16} />
				)
			}
			sx={{
				minWidth: 110,
				textTransform: "none",
				fontSize: "0.8125rem",
				borderRadius: theme.shape.borderRadius * 0.75,
				padding: theme.spacing(0.75, 1.5),
				...(isConnected && {
					backgroundColor: theme.palette.success.main,
					color: theme.palette.success.contrastText,
					"&:hover": {
						backgroundColor: theme.palette.success.dark,
					},
				}),
				...(!isConnected && {
					borderColor: theme.palette.divider,
					color: theme.palette.text.primary,
					"&:hover": {
						backgroundColor: alpha(theme.palette.primary.main, 0.05),
						borderColor: theme.palette.primary.light,
					},
				}),
			}}
		>
			{isLoading ? "Connecting..." : isConnected ? "Connected" : "Connect"}
		</Button>
	);

	return (
		<Paper
			variant="outlined"
			sx={{
				p: theme.spacing(1.5, 2),
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				mb: theme.spacing(1.5),
				borderRadius: theme.shape.borderRadius * 0.75,
				backgroundColor: isConnected
					? alpha(theme.palette.success.main, 0.08)
					: theme.palette.background.paper,
				borderColor: isConnected
					? alpha(theme.palette.success.main, 0.4)
					: theme.palette.divider,
				transition:
					"border-color 0.2s ease-in-out, background-color 0.2s ease-in-out",
				"&:hover": {
					borderColor: isConnected
						? alpha(theme.palette.success.main, 0.6)
						: theme.palette.text.disabled,
				},
			}}
		>
			<Stack direction="row" alignItems="center" spacing={1.5}>
				{icon}
				<Typography variant="subtitle1" fontWeight="500" fontSize="0.9375rem">
					{serviceName}
				</Typography>
			</Stack>
			{!isAuthenticated && !isConnected ? (
				// @ts-ignore
				<Tooltip title="Login to Radient with a Google account to connect integrations">
					<span>
						{/* Span is needed for Tooltip when button is disabled */}
						{connectButton}
					</span>
				</Tooltip>
			) : (
				connectButton
			)}
		</Paper>
	);
};

export const GoogleIntegrationsSection: FC = () => {
	const {
		status: oidcStatus,
		requestAdditionalGoogleScopes,
		loading: oidcLoading,
	} = useOidcAuth();
	const { isAuthenticated: isRadientAuthenticated } = useRadientAuth(); // Get Radient auth status
	const theme = useTheme();

	const handleConnectService = async (scopesToRequest: string[]) => {
		if (isRadientAuthenticated) {
			// Ensure Radient authenticated before requesting Google scopes
			await requestAdditionalGoogleScopes(scopesToRequest);
		}
		// The useOidcAuth hook will handle status updates and re-renders
	};

	const iconProps = {
		size: 20,
		strokeWidth: 1.75,
	};

	return (
		<SettingsSectionCard
			title="Integrations"
			icon={faPuzzlePiece} // Use FontAwesome Puzzle icon
			description="Connect your Google services like Gmail, Calendar, and Drive to enhance Local Operator's capabilities."
			dataTourTag="settings-integrations-section"
		>
			<Box mt={theme.spacing(2)}>
				<IntegrationButton
					serviceName="Gmail"
					icon={<Mail {...iconProps} />}
					scopes={GMAIL_SCOPES}
					grantedScopes={oidcStatus.grantedScopes}
					onConnect={handleConnectService}
					isLoading={oidcLoading}
					isAuthenticated={
						isRadientAuthenticated && oidcStatus.provider === "google"
					} // Pass Radient auth status
				/>
				<IntegrationButton
					serviceName="Calendar"
					icon={<CalendarDays {...iconProps} />}
					scopes={CALENDAR_SCOPES}
					grantedScopes={oidcStatus.grantedScopes}
					onConnect={handleConnectService}
					isLoading={oidcLoading}
					isAuthenticated={
						isRadientAuthenticated && oidcStatus.provider === "google"
					} // Pass Radient auth status
				/>
				<IntegrationButton
					serviceName="Drive"
					icon={<HardDrive {...iconProps} />}
					scopes={DRIVE_SCOPES}
					grantedScopes={oidcStatus.grantedScopes}
					onConnect={handleConnectService}
					isLoading={oidcLoading}
					isAuthenticated={
						isRadientAuthenticated && oidcStatus.provider === "google"
					} // Pass Radient auth status
				/>
			</Box>
		</SettingsSectionCard>
	);
};
