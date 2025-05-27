import { faDownload, faInfoCircle } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Tooltip } from "@mui/material"; // Keep Grid and Tooltip
// Remove styled from here if not used locally
import {
	HealthApi,
	type HealthCheckResponse,
} from "@shared/api/local-operator";
import { apiConfig } from "@shared/config";
import { useEffect, useState } from "react";
import type { FC } from "react";
import { AppUpdates } from "./app-updates"; // Keep this import
// Import the reusable components
import {
	InfoBox,
	InfoGrid,
	InfoLabel,
	InfoValue,
	SettingsSectionCard,
} from "./settings-section-card";

/**
 * Displays application update controls and version information using shadcn-inspired styling.
 */
export const AppUpdatesSection: FC = () => {
	// State for app information - Initial values can be placeholders or empty
	const [appVersion, setAppVersion] = useState<string>("Loading...");
	const [serverVersion, setServerVersion] = useState<string>("Loading...");
	const [platformInfo, setPlatformInfo] = useState({
		platform: "Loading...",
		arch: "...",
		nodeVersion: "Loading...",
		electronVersion: "Loading...",
		chromeVersion: "Loading...", // Keep chromeVersion if needed, otherwise remove
	});

	// Fetch app version, server version, and platform info
	useEffect(() => {
		let isMounted = true; // Flag to prevent state updates on unmounted component

		const fetchAppInfo = async () => {
			try {
				const [version, info] = await Promise.all([
					window.api.systemInfo.getAppVersion(),
					window.api.systemInfo.getPlatformInfo(),
				]);
				if (isMounted) {
					setAppVersion(version);
					setPlatformInfo(info);
				}
			} catch (err) {
				console.error("Error fetching app information:", err);
				if (isMounted) {
					// Optionally set error states
				}
			}
		};

		const fetchServerVersion = async () => {
			try {
				const healthResponse: HealthCheckResponse = await HealthApi.healthCheck(
					apiConfig.baseUrl,
				);
				const version = HealthApi.getServerVersion(healthResponse);
				if (isMounted) {
					setServerVersion(version);
				}
			} catch (err) {
				console.error("Error fetching server version:", err);
				if (isMounted) {
					setServerVersion("Unavailable"); // More concise error state
				}
			}
		};

		fetchAppInfo();
		fetchServerVersion();

		// Cleanup function to set isMounted to false when the component unmounts
		return () => {
			isMounted = false;
		};
	}, []); // Empty dependency array ensures this runs only once on mount

	// Helper to render an InfoBox with label, value, and tooltip
	const renderInfoItem = (
		label: string,
		value: string,
		tooltipTitle: string,
	) => (
		<InfoBox>
			<InfoLabel>
				{/* @ts-ignore - Keep ts-ignore for Tooltip as requested */}
				<Tooltip title={tooltipTitle} placement="top">
					<Box
						component="span"
						sx={{ display: "inline-flex", alignItems: "center" }}
					>
						<FontAwesomeIcon
							icon={faInfoCircle}
							size="xs"
							style={{ marginRight: 6 }} // Adjust spacing
						/>
						{label}
					</Box>
				</Tooltip>
			</InfoLabel>
			<InfoValue>{value}</InfoValue>
		</InfoBox>
	);

	return (
		<SettingsSectionCard
			title="Application Updates & Info"
			icon={faDownload}
			description="Check for updates and view information about your Local Operator installation."
			dataTourTag="settings-app-updates-section"
		>
			{/* Version Information Grid */}
			<InfoGrid sx={{ mb: 3 }}>
				{" "}
				{/* Use InfoGrid and add margin bottom */}
				{renderInfoItem(
					"Application Version",
					appVersion,
					"The version of the Local Operator user interface application.",
				)}
				{renderInfoItem(
					"Server Version",
					serverVersion,
					"The version of the Local Operator API server backend.",
				)}
				{renderInfoItem(
					"Platform",
					`${platformInfo.platform} (${platformInfo.arch})`,
					"The operating system and architecture your application is running on.",
				)}
				{renderInfoItem(
					"Node.js Version",
					platformInfo.nodeVersion,
					"The JavaScript runtime environment version.",
				)}
				{renderInfoItem(
					"Electron Version",
					platformInfo.electronVersion,
					"The framework version enabling this desktop application.",
				)}
				{/* Optionally add Chrome version if needed */}
				{/* {renderInfoItem("Chrome Version", platformInfo.chromeVersion, "The underlying Chromium browser engine version.")} */}
			</InfoGrid>

			{/* App Updates Component (assuming it contains the button) */}
			{/* Ensure AppUpdates is styled appropriately or wrap it if needed */}
			<AppUpdates />
		</SettingsSectionCard>
	);
};
