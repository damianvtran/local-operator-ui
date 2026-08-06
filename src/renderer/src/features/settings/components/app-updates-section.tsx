import {
	HealthApi,
	type HealthCheckResponse,
} from "@shared/api/local-operator";
import { Tooltip } from "@shared/components/ui";
import { apiConfig } from "@shared/config";
import { Download, Info } from "lucide-react";
import type { FC } from "react";
import { useEffect, useState } from "react";
import { AppUpdates } from "./app-updates";
import { InfoGrid, InfoItem, SettingsSection } from "./settings-section";

/**
 * Update controls plus the version numbers a bug report needs.
 *
 * Each label carries a tooltip because "Server version" and "Application
 * version" are indistinguishable to someone reading a support request back to
 * us — the tooltip is what tells them which number to quote.
 */
export const AppUpdatesSection: FC = () => {
	const [appVersion, setAppVersion] = useState<string>("Loading...");
	const [serverVersion, setServerVersion] = useState<string>("Loading...");
	const [platformInfo, setPlatformInfo] = useState({
		platform: "Loading...",
		arch: "...",
		nodeVersion: "Loading...",
		electronVersion: "Loading...",
		chromeVersion: "Loading...",
	});

	useEffect(() => {
		// Both fetches outlive a fast navigation away from settings; the flag
		// stops them setting state on an unmounted component.
		let isMounted = true;

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
					setServerVersion("Unavailable");
				}
			}
		};

		fetchAppInfo();
		fetchServerVersion();

		return () => {
			isMounted = false;
		};
	}, []);

	// The tooltip wraps the label rather than a lone icon so the whole label is
	// the target; `InfoItem` already lays its label row out as a flex row, and
	// the trigger needs a single ref-forwarding element, hence the span.
	const renderInfoItem = (
		label: string,
		value: string,
		tooltipText: string,
	) => (
		<InfoItem
			label={
				<Tooltip content={tooltipText}>
					<span className="inline-flex cursor-help items-center gap-1.5">
						<Info size={12} className="shrink-0" />
						{label}
					</span>
				</Tooltip>
			}
			value={value}
		/>
	);

	return (
		<SettingsSection
			title="Application updates and info"
			icon={Download}
			description="Check for updates and view information about your Local Operator installation."
			dataTourTag="settings-app-updates-section"
		>
			<div className="flex flex-col gap-6">
				<InfoGrid>
					{renderInfoItem(
						"Application version",
						appVersion,
						"The version of the Local Operator user interface application.",
					)}
					{renderInfoItem(
						"Server version",
						serverVersion,
						"The version of the Local Operator API server backend.",
					)}
					{renderInfoItem(
						"Platform",
						`${platformInfo.platform} (${platformInfo.arch})`,
						"The operating system and architecture your application is running on.",
					)}
					{renderInfoItem(
						"Node.js version",
						platformInfo.nodeVersion,
						"The JavaScript runtime environment version.",
					)}
					{renderInfoItem(
						"Electron version",
						platformInfo.electronVersion,
						"The framework version enabling this desktop application.",
					)}
				</InfoGrid>

				<AppUpdates />
			</div>
		</SettingsSection>
	);
};
