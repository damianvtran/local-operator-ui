import { faGoogle } from "@fortawesome/free-brands-svg-icons";
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
import { SettingsSectionCard } from "./settings-section-card";
import { useOidcAuth } from "@shared/hooks/use-oidc-auth";
import type { FC } from "react";
import {
	Mail,
	CalendarDays,
	HardDrive,
	CheckCircle2,
	Link as LinkIcon, // Renamed to avoid conflict with HTML Link
} from "lucide-react";

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
				p: theme.spacing(1.5, 2), // Adjusted padding
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				mb: theme.spacing(1.5), // Adjusted margin
				borderRadius: theme.shape.borderRadius * 0.75, // Shadcn-like border radius
				backgroundColor: isConnected
					? alpha(theme.palette.success.main, 0.08) // Slightly adjusted alpha for subtlety
					: theme.palette.background.paper,
				borderColor: isConnected
					? alpha(theme.palette.success.main, 0.4) // Slightly adjusted alpha
					: theme.palette.divider,
				transition: "border-color 0.2s ease-in-out, background-color 0.2s ease-in-out",
				"&:hover": {
					borderColor: isConnected ? alpha(theme.palette.success.main, 0.6) : theme.palette.text.disabled,
				},
			}}
		>
			<Stack direction="row" alignItems="center" spacing={1.5}>
				{icon}
				<Typography variant="subtitle1" fontWeight="500" fontSize="0.9375rem"> {/* Adjusted Typography */}
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
						<CheckCircle2 size={16} />
					) : (
						<LinkIcon size={16} /> // Changed icon
					)
				}
				sx={{
					minWidth: 110, // Adjusted minWidth
					textTransform: "none",
					fontSize: "0.8125rem",
					borderRadius: theme.shape.borderRadius * 0.75, // Shadcn-like border radius
					padding: theme.spacing(0.75, 1.5), // Adjusted padding
					...(isConnected && {
						backgroundColor: theme.palette.success.main,
						color: theme.palette.success.contrastText,
						"&:hover": {
							backgroundColor: theme.palette.success.dark,
						},
					}),
					...(!isConnected && { // Styling for "Connect" button
						borderColor: theme.palette.divider,
						color: theme.palette.text.primary,
						"&:hover": {
							backgroundColor: alpha(theme.palette.primary.main, 0.05),
							borderColor: theme.palette.primary.light,
						},
					})
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
	const theme = useTheme(); // For spacing

	const handleConnectService = async (scopesToRequest: string[]) => {
		await requestAdditionalGoogleScopes(scopesToRequest);
		// The useOidcAuth hook will handle status updates and re-renders
	};

	// Icon props for Lucide icons
	const iconProps = {
		size: 20, // Consistent icon size
		strokeWidth: 1.75,
	};

	return (
		<SettingsSectionCard
			title="Integrations"
			icon={faGoogle} // Brand icon remains FontAwesome
			description="Connect your Google services like Gmail, Calendar, and Drive to enhance Local Operator's capabilities."
		>
			<Box mt={theme.spacing(2)}> {/* Adjusted margin top */}
				<IntegrationButton
					serviceName="Gmail"
					icon={<Mail {...iconProps} />}
					scopes={GMAIL_SCOPES}
					grantedScopes={oidcStatus.grantedScopes}
					onConnect={handleConnectService}
					isLoading={oidcLoading}
				/>
				<IntegrationButton
					serviceName="Calendar"
					icon={<CalendarDays {...iconProps} />}
					scopes={CALENDAR_SCOPES}
					grantedScopes={oidcStatus.grantedScopes}
					onConnect={handleConnectService}
					isLoading={oidcLoading}
				/>
				<IntegrationButton
					serviceName="Drive"
					icon={<HardDrive {...iconProps} />}
					scopes={DRIVE_SCOPES}
					grantedScopes={oidcStatus.grantedScopes}
					onConnect={handleConnectService}
					isLoading={oidcLoading}
				/>
			</Box>
		</SettingsSectionCard>
	);
};
