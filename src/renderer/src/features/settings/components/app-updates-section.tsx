import { faDownload, faInfoCircle } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Grid, Tooltip, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import { useEffect, useState } from "react";
import type { FC } from "react";
// import { HealthApi } from "../../../api/local-operator/health-api";
// import type { HealthCheckResponse } from "../../../api/local-operator/types";
import { HealthApi, type HealthCheckResponse } from "@shared/api/local-operator";
import { apiConfig } from "../../../config"; // TODO: Migrate apiConfig to shared
import { AppUpdates } from "./app-updates";

const SectionTitle = styled(Typography)(({ theme }) => ({
	marginTop: theme.spacing(4),
	marginBottom: theme.spacing(2),
	fontWeight: 500,
	display: "flex",
	alignItems: "center",
	gap: 8,
}));

const SectionDescription = styled(Typography)(({ theme }) => ({
	marginBottom: theme.spacing(3),
	color: theme.palette.text.secondary,
}));

const InfoBox = styled(Box)(() => ({
	padding: 16,
	borderRadius: 8,
	backgroundColor: "background.default",
	height: "100%",
	marginBottom: 24,
}));

const InfoLabel = styled(Typography)(() => ({
	color: "text.secondary",
	marginBottom: 8,
}));

const InfoValue = styled(Typography)(() => ({
	fontWeight: 500,
}));

/**
 * App Updates Section component
 *
 * Displays application update controls and version information
 */
export const AppUpdatesSection: FC = () => {
	// State for app information
	const [appVersion, setAppVersion] = useState<string>("0.1.2-beta.6");
	const [serverVersion, setServerVersion] = useState<string>(
		"Unknown (update required)",
	);
	const [platformInfo, setPlatformInfo] = useState({
		platform: "unknown",
		arch: "unknown",
		nodeVersion: "unknown",
		electronVersion: "unknown",
		chromeVersion: "unknown",
	});

	// Fetch app version, server version, and platform info on component mount
	useEffect(() => {
		const fetchAppInfo = async () => {
			try {
				// Get app version
				const version = await window.api.systemInfo.getAppVersion();
				setAppVersion(version);

				// Get platform info
				const info = await window.api.systemInfo.getPlatformInfo();
				setPlatformInfo(info);
			} catch (error) {
				console.error("Error fetching app information:", error);
			}
		};

		const fetchServerVersion = async () => {
			try {
				// Get API server version from health check
				const healthResponse: HealthCheckResponse = await HealthApi.healthCheck(
					apiConfig.baseUrl,
				);
				const version = HealthApi.getServerVersion(healthResponse);
				setServerVersion(version);
			} catch (error) {
				console.error("Error fetching server version:", error);
				setServerVersion("Unknown (connection error)");
			}
		};

		fetchAppInfo();
		fetchServerVersion();
	}, []);

	return (
		<Box mt={6} mb={4}>
			<SectionTitle variant="h5">
				<FontAwesomeIcon icon={faDownload} />
				Application Updates
			</SectionTitle>
			<SectionDescription variant="body1">
				Check for updates and view information about your Local Operator
				installation
			</SectionDescription>
			{/* Version Information */}
			<Grid container spacing={2} sx={{ mb: 3 }}>
				<Grid item xs={12} sm={6} md={3}>
					<InfoBox>
						<InfoLabel variant="subtitle2">
							<Tooltip title="The version of the Local Operator user interface application">
								<FontAwesomeIcon
									icon={faInfoCircle}
									style={{ marginRight: 8 }}
								/>
							</Tooltip>
							Application Version
						</InfoLabel>
						<InfoValue variant="body1">{appVersion}</InfoValue>
					</InfoBox>
				</Grid>

				<Grid item xs={12} sm={6} md={3}>
					<InfoBox>
						<InfoLabel variant="subtitle2">
							<Tooltip title="The version of the Local Operator API server. This backend service handles all API requests and model interactions.">
								<FontAwesomeIcon
									icon={faInfoCircle}
									style={{ marginRight: 8 }}
								/>
							</Tooltip>
							Server Version
						</InfoLabel>
						<InfoValue variant="body1">{serverVersion}</InfoValue>
					</InfoBox>
				</Grid>

				<Grid item xs={12} sm={6} md={3}>
					<InfoBox>
						<InfoLabel variant="subtitle2">
							<Tooltip title="The operating system and architecture your application is running on. This affects compatibility and performance.">
								<FontAwesomeIcon
									icon={faInfoCircle}
									style={{ marginRight: 8 }}
								/>
							</Tooltip>
							Platform
						</InfoLabel>
						<InfoValue variant="body1">
							{platformInfo.platform} ({platformInfo.arch})
						</InfoValue>
					</InfoBox>
				</Grid>

				<Grid item xs={12} sm={6} md={3}>
					<InfoBox>
						<InfoLabel variant="subtitle2">
							<Tooltip title="The JavaScript runtime environment that powers the backend processes of the application. Different versions may affect performance and feature availability.">
								<FontAwesomeIcon
									icon={faInfoCircle}
									style={{ marginRight: 8 }}
								/>
							</Tooltip>
							Node.js
						</InfoLabel>
						<InfoValue variant="body1">{platformInfo.nodeVersion}</InfoValue>
					</InfoBox>
				</Grid>

				<Grid item xs={12} sm={6} md={3}>
					<InfoBox>
						<InfoLabel variant="subtitle2">
							<Tooltip title="The framework that enables this desktop application to run across different operating systems using web technologies. It combines Chromium and Node.js into a single runtime.">
								<FontAwesomeIcon
									icon={faInfoCircle}
									style={{ marginRight: 8 }}
								/>
							</Tooltip>
							Electron
						</InfoLabel>
						<InfoValue variant="body1">
							{platformInfo.electronVersion}
						</InfoValue>
					</InfoBox>
				</Grid>
			</Grid>

			{/* App Updates Component */}
			<AppUpdates />
		</Box>
	);
};
