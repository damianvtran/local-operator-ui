import type { Meta, StoryObj } from "@storybook/react";
import { useEffect } from "react";
import type { DaemonStatusSnapshot } from "../../../../../shared/backend-status";
import { AppUpdatesSection } from "./app-updates-section";

/**
 * The server-version row, in every state discovery can put it in.
 *
 * WHY this exists. The row used to be photographed only in what Storybook can
 * produce by itself: `window.api.backend` is absent from the preview mock (a
 * Storybook host has no main process), so the section falls back to its own
 * `/health` fetch, fails, and prints "Unavailable" - one state of five, and not
 * the one the daemon-discovery change is about. The value now comes from main's
 * snapshot, so a reviewer has to be able to LOOK at what a claimed daemon, a
 * degraded one and a detached one each print, which is what this file renders.
 *
 * Each story stubs the bridge and restores the previous value on unmount, so
 * stories do not leak into one another.
 */

const snapshot = (
	overrides: Partial<DaemonStatusSnapshot>,
): DaemonStatusSnapshot => ({
	state: "attached",
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
 * The updater surface `AppUpdates` reaches on mount, plus the bridge.
 *
 * The Storybook preview mock has no `updater` object at all, so the section
 * throws in `CheckForUpdatesButton`'s first effect (`onUpdateError`) and React
 * unmounts it - which is why this surface has never had a frame. The stubs are
 * installed here, per story, rather than added to the shared preview mock: that
 * file is the whole evidence sweep's environment, and a change there would move
 * frames for every surface that renders an update control.
 */
const updaterStub = () => ({
	onUpdateError: () => () => {},
	onUpdateNotAvailable: () => () => {},
	onBackendUpdateNotAvailable: () => () => {},
	onBackendUpdateDevMode: () => () => {},
	onUpdateInstallFailed: () => () => {},
	onUpdateAvailable: () => () => {},
	onDownloadProgress: () => () => {},
	onUpdateDownloaded: () => () => {},
	getLastInstallAttempt: async () => null,
	checkForAllUpdates: async () => ({}),
	checkForBackendUpdates: async () => ({}),
	downloadUpdate: async () => ({}),
	quitAndInstall: async () => ({}),
	quitForInstall: async () => ({}),
	updateBackend: async () => ({}),
});

const Bridge = ({
	status,
	children,
}: {
	status: DaemonStatusSnapshot | null;
	children: React.ReactNode;
}) => {
	const api = window.api as unknown as {
		backend?: unknown;
		updater?: unknown;
	};
	/*
	 * Installed DURING render, not in an effect. React runs effects
	 * bottom-up - a child's mount effect fires before its parent's - so a
	 * decorator that stubbed the bridge in an effect was read too late by
	 * `CheckForUpdatesButton`, which is exactly how this story first failed with
	 * `undefined.onUpdateError`. The updater stub is left in place (the preview
	 * mock has no updater at all, so it only ever replaces `undefined`), while
	 * `backend` is restored on unmount so one story cannot hand the next a
	 * bridge it did not ask for.
	 */
	api.updater = api.updater ?? updaterStub();
	api.backend =
		status === null
			? undefined
			: {
					getStatus: async () => status,
					// No push in a still: the section's own pull is what fills the row.
					onStatusChange: () => () => {},
				};
	useEffect(() => {
		return () => {
			// Read from `window` in the cleanup rather than closing over the render's
			// handle, so the effect stays a genuine one-time mount/unmount pair.
			(window.api as unknown as { backend?: unknown }).backend = undefined;
		};
	}, []);
	return <>{children}</>;
};

const withBridge =
	(status: DaemonStatusSnapshot | null) => (Story: React.FC) => (
		<Bridge status={status}>
			<div className="p-8">
				<Story />
			</div>
		</Bridge>
	);

const meta: Meta<typeof AppUpdatesSection> = {
	component: AppUpdatesSection,
	title: "Settings/App updates and info",
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

/** No main process: the weaker `/health` fallback the row used to rely on. */
export const NoBridge: Story = {
	decorators: [withBridge(null)],
};

/** The daemon main is attached to, named with the install that serves it. */
export const AttachedToDiscoveredDaemon: Story = {
	decorators: [withBridge(snapshot({}))],
};

/** One or two missed probes: still a connection, so the version still shows. */
export const DegradedDaemon: Story = {
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

/** Detached: the row must say so rather than print a stale number. */
export const DetachedDaemon: Story = {
	decorators: [
		withBridge(
			snapshot({
				state: "detached",
				url: null,
				instanceId: null,
				pid: null,
				version: null,
				prefix: null,
				installKind: null,
				desktopAvailable: false,
				failures: 3,
				detail: "The daemon's process is gone.",
			}),
		),
	],
};

/** Before the first probe, and before main has answered: the loading frame. */
export const BeforeFirstProbe: Story = {
	decorators: [
		withBridge(
			snapshot({
				state: "connecting",
				url: null,
				instanceId: null,
				pid: null,
				version: null,
				prefix: null,
				installKind: null,
				desktopAvailable: false,
				detail: "Looking for a Local Operator daemon.",
			}),
		),
	],
};
