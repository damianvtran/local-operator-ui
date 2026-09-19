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
 *
 * The value is `version · host:port` because a machine can be serving several
 * daemons and a bare number cannot say which one it came from - the residual of
 * the reported defect on a host where three were running. `replaced` and the
 * null-version state are here because both are reachable and neither was
 * photographed before: a snapshot with no `version` in it is what the row used
 * to render as "Unknown (update required)", an instruction to update a backend
 * whose record simply omitted the field.
 */

const snapshot = (
	overrides: Partial<DaemonStatusSnapshot>,
): DaemonStatusSnapshot => {
	const merged: Omit<DaemonStatusSnapshot, "pairing"> = {
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
		unanswered: 0,
		lastTransportAt: null,
		detail:
			"Connected to the daemon on http://127.0.0.1:7341 (pid 4242, v0.54.47).",
		updatedAt: Date.now(),
		...overrides,
	};
	/*
	 * `pairing` is DERIVED from the merged `desktopAvailable` unless a story names
	 * it, so a fixture that flips the boolean cannot leave the two disagreeing -
	 * the defect the record replaces, in miniature (design § 1.4).
	 */
	return {
		...merged,
		pairing:
			overrides.pairing ??
			(merged.desktopAvailable
				? { available: true, cause: null }
				: { available: false, cause: "unpaired" }),
	};
};

/**
 * The updater surface `AppUpdates` reaches on mount, plus the bridge.
 *
 * The Storybook preview mock has no `updater` object at all, so the section
 * throws in `CheckForUpdatesButton`'s first effect (`onUpdateError`) and React
 * unmounts it - which is why this surface has never had a frame. The stubs are
 * installed here, per story, rather than added to the shared preview mock: that
 * file is the whole evidence sweep's environment, and a change there would move
 * frames for every surface that renders an update control.
 *
 * The set is the PRELOAD's own updater surface, not the handful of methods this
 * section happens to call today. A fixture that stubs only what today's call sites
 * reach is one bridge method away from throwing inside a mount effect, and that
 * failure is silent from CI's side: nothing re-drives a story, so the next capture
 * is the first thing to see it (review round 1, R1-1). `scripts/
 * preload-updater-surface.test.mjs` asserts that set on every fixture in the tree,
 * so the next method cannot be missed the same way.
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
	onBackendUpdateProgress: () => () => {},
	onBackendUpdateError: () => () => {},
	onBackendUpdateManualRequired: () => () => {},
	onUpdateDownloaded: () => () => {},
	onUpdateError: () => () => {},
	onUpdateInstallBlocked: () => () => {},
	onUpdateInstallFailed: () => () => {},
	onUpdateProgress: () => () => {},
	onUpdateInstallInFlight: () => () => {},
	onBeforeQuitForUpdate: () => () => {},
	onUpdateInstallProgress: () => () => {},
	onUpdateInstallSucceeded: () => () => {},
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

/** The daemon main is attached to, named with the address serving it. */
export const AttachedToDiscoveredDaemon: Story = {
	decorators: [withBridge(snapshot({}))],
};

/**
 * The daemon THIS APP started, which no frame covered before.
 *
 * The first review round's MAJOR finding: the ordinary fixed-port spawn never
 * registered the child with the state machine, so a backend the app had started
 * seconds ago rendered as `owned: false` with no version - the row printed
 * "Unknown (update required)" for it. The row cannot show `owned` itself; what
 * it shows is a version and an address where there used to be an instruction to
 * update, and `scripts/daemon-discovery-evidence.mjs` is what proves a real
 * spawn reaches this snapshot.
 */
export const OwnedDaemon: Story = {
	decorators: [
		withBridge(
			snapshot({
				owned: true,
				detail:
					"Connected to the daemon on http://127.0.0.1:1111 (pid 61643, v0.54.47).",
			}),
		),
	],
};

/** A successor for a daemon this app owned: reachable, and its version shows. */
export const ReplacedDaemon: Story = {
	decorators: [
		withBridge(
			snapshot({
				state: "replaced",
				owned: true,
				url: "http://127.0.0.1:55001",
				pid: 999,
				detail:
					"Started a replacement daemon on http://127.0.0.1:55001 (pid 999).",
			}),
		),
	],
};

/** A daemon that exists but is not attachable: not a version, not an absence. */
export const WedgedDaemon: Story = {
	decorators: [
		withBridge(
			snapshot({
				state: "wedged",
				url: null,
				instanceId: null,
				pid: 4242,
				version: null,
				prefix: null,
				installKind: null,
				desktopAvailable: false,
				detail:
					"A Local Operator daemon is running (pid 4242), but it stopped publishing its heartbeat, so this app did not attach to it. Waiting without starting a second one.",
			}),
		),
	],
};

/**
 * A live connection whose daemon reports no version: the string that used to
 * assert an unestablished remedy.
 */
export const AttachedWithoutVersion: Story = {
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
				reconnecting: true,
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

/**
 * The same frame with the pointer on the value.
 *
 * The story adds nothing to the snapshot: what it exists for is the hover
 * GROUND, which no story can force (`:hover` is browser state). The rig moves a
 * real pointer at `[data-backend-version]` for this id, which is how the frame
 * that shows the value's tooltip - where the daemon's own detail sentence lives -
 * gets taken at all.
 */
export const ValueHover: Story = {
	decorators: [withBridge(snapshot({}))],
};
