/**
 * The version row at a narrow width, where the grid reflows and values wrap.
 *
 * WHY this file exists. The set next door is one 980x320 crop, sized to the
 * section: at the app's shipped 1380x800 the section sits on ~95% empty ground,
 * so the wide frame is the honest instrument for the row's own layout. What it
 * cannot show is what happens when the window is narrow, and that is where this
 * row's change is at its most exposed - the value now carries `version · address`
 * (about 25 characters) where it used to carry a bare number, and `InfoGrid` is
 * `repeat(auto-fit, minmax(160px, 1fr))`, so a narrow window is the only thing
 * that proves the grid reflows and shows which string wraps first.
 *
 * It is the same component, the same bridge stub and the same snapshots as the
 * wide set; only the viewport differs, which is why it is a second story file
 * rather than a second capture of the first (the rig's frame path is derived
 * from the story id, so one id is one viewport).
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useLayoutEffect } from "react";
import type { DaemonStatusSnapshot } from "../../../../../shared/backend-status";
import { AppUpdatesSection } from "./app-updates-section";

const snapshot = (
	overrides: Partial<DaemonStatusSnapshot>,
): DaemonStatusSnapshot => ({
	state: "attached",
	reconnecting: false,
	owned: false,
	url: "http://127.0.0.1:7341",
	instanceId: "i".repeat(43),
	pid: 4242,
	version: "0.54.47",
	prefix: "/Users/you/.local/share/uv/tools/local-operator",
	installKind: "uv-tool",
	desktopAvailable: true,
	failures: 0,
	capabilityStatus: null,
	detail:
		"Connected to the daemon on http://127.0.0.1:7341 (pid 4242, v0.54.47).",
	updatedAt: Date.now(),
	...overrides,
});

/**
 * The updater surface the section reaches on mount, at the bridge's own width.
 *
 * This is the narrow twin of the `app-updates-and-info` fixture and carries the
 * same set for the same reason: the preload's updater surface rather than the
 * methods today's call sites reach, or the next bridge method takes the surface
 * out at mount (review round 1, R1-1). See that file's note, and `scripts/
 * preload-updater-surface.test.mjs`, which asserts it on both.
 */
const updaterStub = () => ({
	checkForUpdates: async () => ({ updateInfo: {}, cancellationToken: null }),
	checkForBackendUpdates: async () => null,
	checkForAllUpdates: async () => ({}),
	getLastInstallAttempt: async () => null,
	updateBackend: async () => ({}),
	downloadUpdate: async () => ({}),
	quitAndInstall: async () => ({}),
	quitForUpdateInstall: async () => ({}),
	onUpdateAvailable: () => () => {},
	onUpdateNotAvailable: () => () => {},
	onUpdateDevMode: () => () => {},
	onUpdateNpxAvailable: () => () => {},
	onBackendUpdateAvailable: () => () => {},
	onBackendUpdateDevMode: () => () => {},
	onBackendUpdateNotAvailable: () => () => {},
	onBackendUpdateCompleted: () => () => {},
	onBackendUpdateError: () => () => {},
	onBackendUpdateManualRequired: () => () => {},
	onUpdateDownloaded: () => () => {},
	onUpdateError: () => () => {},
	onUpdateInstallBlocked: () => () => {},
	onUpdateInstallFailed: () => () => {},
	onUpdateProgress: () => () => {},
	onUpdateInstallInFlight: () => () => {},
	onBeforeQuitForUpdate: () => () => {},
});

const Bridge = ({
	status,
	children,
}: {
	status: DaemonStatusSnapshot;
	children: React.ReactNode;
}) => {
	const api = window.api as unknown as {
		backend?: unknown;
		updater?: unknown;
	};
	api.updater = api.updater ?? updaterStub();
	api.backend = {
		getStatus: async () => status,
		reconnect: async () => status,
		onStatusChange: () => () => {},
	};
	useLayoutEffect(() => {
		return () => {
			(window.api as unknown as { backend?: unknown }).backend = undefined;
		};
	}, []);
	return <>{children}</>;
};

const withBridge = (status: DaemonStatusSnapshot) => (Story: React.FC) => (
	<Bridge status={status}>
		<div className="p-4">
			<Story />
		</div>
	</Bridge>
);

const meta: Meta<typeof AppUpdatesSection> = {
	component: AppUpdatesSection,
	title: "Settings/App updates and info narrow",
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="min-h-screen bg-canvas">
				<Story />
			</div>
		),
	],
};

export default meta;
type Story = StoryObj<typeof AppUpdatesSection>;

/** The longest value this row renders: `version · address`. */
export const Attached: Story = {
	decorators: [withBridge(snapshot({}))],
};

/** The second-longest: the string that replaced `Unknown (update required)`. */
export const NoVersion: Story = {
	decorators: [
		withBridge(
			snapshot({
				version: null,
				detail:
					"Connected to the daemon on http://127.0.0.1:7341 (pid 4242, vunknown).",
			}),
		),
	],
};

/** `degraded`: the muted value and the label's suffix at the tightest track. */
export const Degraded: Story = {
	decorators: [
		withBridge(
			snapshot({
				state: "degraded",
				failures: 2,
				detail: "No answer from /health (probe 2 of 3).",
			}),
		),
	],
};
