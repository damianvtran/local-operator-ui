import { faDownload, faInfoCircle } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Grid, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import { useEffect, useState } from "react";
import type { FC } from "react";
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
	const [platformInfo, setPlatformInfo] = useState({
		platform: "unknown",
		arch: "unknown",
		nodeVersion: "unknown",
		electronVersion: "unknown",
		chromeVersion: "unknown",
	});

	// Fetch app version and platform info on component mount
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

		fetchAppInfo();
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
							<FontAwesomeIcon icon={faInfoCircle} style={{ marginRight: 8 }} />
							Version
						</InfoLabel>
						<InfoValue variant="body1">{appVersion}</InfoValue>
					</InfoBox>
				</Grid>

				<Grid item xs={12} sm={6} md={3}>
					<InfoBox>
						<InfoLabel variant="subtitle2">
							<FontAwesomeIcon icon={faInfoCircle} style={{ marginRight: 8 }} />
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
							<FontAwesomeIcon icon={faInfoCircle} style={{ marginRight: 8 }} />
							Node.js
						</InfoLabel>
						<InfoValue variant="body1">{platformInfo.nodeVersion}</InfoValue>
					</InfoBox>
				</Grid>

				<Grid item xs={12} sm={6} md={3}>
					<InfoBox>
						<InfoLabel variant="subtitle2">
							<FontAwesomeIcon icon={faInfoCircle} style={{ marginRight: 8 }} />
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
