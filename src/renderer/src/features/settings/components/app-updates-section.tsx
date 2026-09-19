import {
	HealthApi,
	type HealthCheckResponse,
} from "@shared/api/local-operator";
import { Tooltip } from "@shared/components/ui";
import { apiConfig } from "@shared/config";
import { Download, Info } from "lucide-react";
import type { FC } from "react";
import { useEffect, useState } from "react";
import type { DaemonStatusSnapshot } from "../../../../../shared/backend-status";
import { AppUpdates } from "./app-updates";
import { InfoGrid, InfoItem, SettingsSection } from "./settings-section";

/**
 * What the "Server version" row prints, and what it says about it.
 *
 * Three fields rather than one string, because one string could not carry the
 * two things the row has to answer: WHICH daemon this number describes (the
 * address of the daemon main is attached to, since a machine can have several),
 * and what main actually observed (its `detail`, verbatim, as the value's
 * tooltip). `degraded` also has to be visible in the row itself - two of three
 * probes have failed, and the number alone looked identical to a healthy
 * connection.
 */
type ServerVersionReading = {
	value: string;
	detail: string | null;
	degraded: boolean;
};

/**
 * `host:port` for a daemon URL, for the value's attribution.
 *
 * The address rather than the install kind, because it is what a user can check
 * against `lop serve` (or `lsof`) to confirm the row describes the daemon their
 * TUI is using. Null when there is no daemon to name.
 */
const daemonAddress = (url: string | null): string | null => {
	if (!url) return null;
	try {
		return new URL(url).host;
	} catch {
		return null;
	}
};

/**
 * Update controls plus the version numbers a bug report needs.
 *
 * Each label carries a tooltip because "Server version" and "Application
 * version" are indistinguishable to someone reading a support request back to
 * us — the tooltip is what tells them which number to quote.
 */
export const AppUpdatesSection: FC = () => {
	/*
	 * Null while unknown rather than the string "Loading...", because this value is
	 * handed to the update card and printed as the version that IS running (design
	 * D1): a sentence that named the placeholder would be the same class of untrue
	 * statement the hand-off removes, and the row below supplies the placeholder at
	 * the one place it is a display concern.
	 */
	const [appVersion, setAppVersion] = useState<string | null>(null);
	const [serverVersion, setServerVersion] = useState<ServerVersionReading>({
		value: "Loading...",
		detail: null,
		degraded: false,
	});
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
		const showDaemonVersion = (snapshot: DaemonStatusSnapshot) => {
			if (!isMounted) return;
			const address = daemonAddress(snapshot.url);
			/*
			 * The value per state, and never a stale number:
			 *
			 * - `connecting` is the pre-first-probe state, and the only one that says
			 *   "Loading...";
			 * - `detached` is "we have no daemon" - not "the server is offline",
			 *   which is the sentence this change removes, and not "Unavailable",
			 *   which is reserved for the no-bridge branch below where this host
			 *   cannot ask anyone;
			 * - `wedged` is a daemon that exists and that this app deliberately did
			 *   not attach to, so it is neither a version nor an absence;
			 * - a live connection shows the version, attributed to the daemon serving
			 *   it, and "Version unknown" when that daemon reports no version at all.
			 *   The old string here was "Unknown (update required)", which asserted a
			 *   remedy nothing had established (a serve record may simply omit the
			 *   version); recommending an update is the update control's job, not this
			 *   row's.
			 */
			if (snapshot.state === "connecting") {
				setServerVersion({
					value: "Loading...",
					detail: null,
					degraded: false,
				});
				return;
			}
			if (snapshot.state === "detached") {
				setServerVersion({
					value: "Not connected",
					detail: snapshot.detail || null,
					degraded: false,
				});
				return;
			}
			if (snapshot.state === "wedged") {
				setServerVersion({
					value: "Not attached",
					detail: snapshot.detail || null,
					degraded: false,
				});
				return;
			}
			const version = snapshot.version || "Version unknown";
			setServerVersion({
				value: address ? `${version} \u00b7 ${address}` : version,
				detail: snapshot.detail || null,
				degraded: snapshot.state === "degraded",
			});
		};
		// Settings can stay open while discovery finishes or the selected daemon
		// exits. A mount-only read would keep showing a version that is no longer serving.
		let statusPushed = false;
		const unsubscribe = window.api?.backend?.onStatusChange((snapshot) => {
			statusPushed = true;
			showDaemonVersion(snapshot);
		});

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
				/*
				 * The version of the daemon that is actually serving, read from MAIN.
				 *
				 * This used to be a `/health` fetch made here, from the packaged app's
				 * `file://` document - which is the divergence the version row was
				 * reporting in the first place (the app's bundled venv answered while the
				 * operator's `lop` served). Main reads the daemon it identity-matched,
				 * sends no Origin, and holds the bearer, so the number here describes the
				 * daemon the app is actually talking to.
				 */
				const bridge = window.api?.backend;
				if (bridge) {
					const snapshot = await bridge.getStatus();
					// A newer push wins if the initial IPC pull arrives afterwards.
					if (!statusPushed) showDaemonVersion(snapshot);
					return;
				}
				// No desktop bridge (Storybook, browser dev server): the direct probe,
				// which is the weaker answer this row used to rely on everywhere.
				const healthResponse: HealthCheckResponse = await HealthApi.healthCheck(
					apiConfig.baseUrl,
				);
				const version = HealthApi.getServerVersion(healthResponse);
				if (isMounted) {
					setServerVersion({
						value: version,
						detail: null,
						degraded: false,
					});
				}
			} catch (err) {
				console.error("Error fetching server version:", err);
				if (isMounted) {
					setServerVersion({
						value: "Unavailable",
						detail: null,
						degraded: false,
					});
				}
			}
		};

		fetchAppInfo();
		fetchServerVersion();

		return () => {
			isMounted = false;
			unsubscribe?.();
		};
	}, []);

	// The tooltip wraps the label rather than a lone icon so the whole label is
	// the target; `InfoItem` already lays its label row out as a flex row, and
	// the trigger needs a single ref-forwarding element, hence the span.
	const renderInfoItem = (
		label: string,
		value: string,
		tooltipText: string,
		options: {
			valueTooltip?: string | null;
			valueClassName?: string;
			/**
			 * Marks the value as the rig's hover target.
			 *
			 * `:hover` is browser state, so no story can force it: the evidence rig
			 * moves a real pointer at a SELECTOR instead (`{ hover }` in
			 * `scripts/capture-evidence.mjs`). A wrapper class would be a selector that
			 * silently stops matching the next time this row gains a span, and a rig whose
			 * selector matched nothing throws; this is the hook that keeps the frame
			 * honest instead of lucky.
			 */
			valueHoverTarget?: boolean;
			/**
			 * A short state word for the row, rendered on its own line under the value.
			 *
			 * Only where the row's own state has something to say that the number
			 * cannot: a `degraded` connection keeps the number (the claim is that it
			 * does not blank), and this is what makes the state visible in a still
			 * without reflowing the label.
			 */
			statusNote?: string;
		} = {},
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
			valueClassName={options.valueClassName}
			value={
				<>
					{options.valueTooltip ? (
						<Tooltip content={options.valueTooltip}>
							<span
								data-backend-version={options.valueHoverTarget ? "" : undefined}
								className="cursor-help"
							>
								{value}
							</span>
						</Tooltip>
					) : (
						value
					)}
					{/*
					 * The state word, on its OWN line under the number.
					 *
					 * Not a suffix on the value and not a suffix on the label: both wrap
					 * in the column this grid gives them (`minmax(160px, 1fr)`), and the
					 * first attempt at this put "Server version" on one line and
					 * "(reconnecting)" on the next, which pushed the number below its
					 * siblings' baseline - visible in the frame the reviewer of round 1
					 * asked for. A third line leaves the label, the number and every other
					 * row's alignment alone, which is what makes the reading comparable.
					 */}
					{options.statusNote ? (
						<span className="mt-0.5 block text-meta text-ink-dim">
							{options.statusNote}
						</span>
					) : null}
				</>
			}
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
						appVersion ?? "Loading...",
						"The version of the Local Operator user interface application.",
					)}
					{renderInfoItem(
						"Server version",
						serverVersion.value,
						"The version of the Local Operator API server backend, and the address of the daemon it was read from.",
						{
							valueTooltip: serverVersion.detail,
							valueHoverTarget: true,
							// "Not answering" rather than "reconnecting": main's own
							// vocabulary reserves the second word for a DETACHED connection
							// inside its reconnection window (the snapshot field of the same
							// name), and the banner renders that state with it. A row that is
							// still attached must not borrow the word that the banner uses to
							// mean something else.
							statusNote: serverVersion.degraded ? "Not answering" : undefined,
							valueClassName: serverVersion.degraded
								? "text-ink-muted"
								: undefined,
						},
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

				<AppUpdates appVersion={appVersion} />
			</div>
		</SettingsSection>
	);
};
