/**
 * The connectivity banner, in every state the daemon connection can leave it in.
 *
 * WHY this file exists. This banner is the app-wide surface that used to render
 * "The server is offline" - the sentence the operator's report is about - and
 * until now it had no frame anywhere in the tree: the sweep photographed
 * Settings' version row, and the neighbouring rigs only asserted the banner's
 * ABSENCE. So the one surface whose trigger condition this work rewrote could
 * not be looked at, and a reviewer could not tell whether "offline" still
 * described a daemon that was up.
 *
 * The states are not reachable on demand in the live app (they need a real
 * daemon to exit, three probes to fail against a live one, or a manager
 * configured not to spawn), so the story stubs `window.api.backend` with the
 * snapshot MAIN publishes for each - the real component, rendering the real
 * copy from `shared/backend-status.ts`, over a realistic page ground.
 *
 * `attached` is a frame OF the banner's absence, which is the claim: a missing
 * probe is not an outage, so the state that is still connected must show
 * nothing at all.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { expect, waitFor } from "@storybook/test";
import { useLayoutEffect } from "react";
import type { DaemonStatusSnapshot } from "../../../../../shared/backend-status";
import { ConnectivityBanner } from "./connectivity-banner";

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
	unanswered: 0,
	lastTransportAt: null,
	detail:
		"Connected to the daemon on http://127.0.0.1:7341 (pid 4242, v0.54.47).",
	updatedAt: Date.now(),
	...overrides,
});

/**
 * The page ground the fixed banner covers, so the frame is the surface a user
 * actually sees rather than a bare rectangle on the story ground.
 *
 * It is a realistic conversation list rather than two lines of prose, and it has
 * to be: the rig treats a story root with fewer than eight elements as not yet
 * drawn, and a frame whose subject is the banner's ABSENCE (attached, degraded)
 * is otherwise indistinguishable from a story that never mounted.
 */
const PageGround = () => (
	<div className="flex h-full flex-col gap-3 p-6 pt-24">
		<h1 className="font-medium text-body text-ink">Conversations</h1>
		<p className="max-w-xl text-body-sm text-ink-muted">
			Nothing is in flight. The banner above the page is the whole of what this
			surface has to say about the server.
		</p>
		<ul className="flex max-w-xl flex-col gap-2">
			{[
				"Deploy the staging cluster",
				"Review the paging change",
				"Triage the support queue",
			].map((row) => (
				<li
					key={row}
					className="flex items-center justify-between rounded-md border border-hairline bg-surface px-3 py-2"
				>
					<span className="text-body-sm text-ink">{row}</span>
					<span className="text-meta text-ink-dim">idle</span>
				</li>
			))}
		</ul>
	</div>
);

/**
 * Stub MAIN's side of the bridge for one story.
 *
 * Installed during render rather than in an effect, because the banner's first
 * query is issued on mount (the row stories learned the same lesson).
 */
const Bridge = ({
	status,
	children,
}: {
	status: DaemonStatusSnapshot | null;
	children: React.ReactNode;
}) => {
	const api = window.api as unknown as { backend?: unknown };
	api.backend =
		status === null
			? undefined
			: {
					getStatus: async () => status,
					// Retry asks main to try; a still cannot show the attempt, and a stub
					// that changed the snapshot would photograph the stub.
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

const withBridge =
	(status: DaemonStatusSnapshot | null) => (Story: React.FC) => (
		<Bridge status={status}>
			<div className="min-h-screen bg-canvas text-ink">
				<Story />
				<PageGround />
			</div>
		</Bridge>
	);

/** Waits for the banner's rendered sentence, so the frame cannot be a race. */
const waitForCopy = (text: string | RegExp) => async () => {
	await waitFor(() => {
		const body = document.body.textContent ?? "";
		expect(
			typeof text === "string" ? body.includes(text) : text.test(body),
		).toBe(true);
	});
};

const meta: Meta<typeof ConnectivityBanner> = {
	component: ConnectivityBanner,
	title: "Common/Connectivity banner",
	parameters: { layout: "fullscreen" },
	// The banner's own 3 s refetch loop is disabled: the stub answers the same
	// snapshot forever, so polling adds nothing but a race with the frame.
	args: { autoCheck: false },
};

export default meta;
type Story = StoryObj<typeof ConnectivityBanner>;

/**
 * No desktop bridge at all: the weaker answer a browser host gets.
 *
 * Measured, and asserted as measured (design round 2, D12): this state renders
 * NO BANNER. `useConnectivityStatus` reads `serverHealth?.online ?? true`, and an
 * absent bridge leaves the health query with no answer, so the fallback is
 * "online" and `hasConnectivityIssue` is false.
 *
 * The play used to wait for "Not connected to a Local Operator server." - the
 * sentence the contract carries for exactly this state (`serverBannerCopy(null)`)
 * and which no surface can reach while the gate above reads an absent bridge as
 * online - so the play failed and the pair captured as the no-banner ground,
 * byte-identical to `attached`. Asserting the absence is what the state actually
 * supports today; whether a browser-hosted app should announce the absent bridge
 * is a product question for the design round.
 */
export const NoBridge: Story = {
	decorators: [withBridge(null)],
	play: async () => {
		await waitFor(() => {
			expect(document.body.textContent ?? "").not.toContain(
				"reconnects to it on its own",
			);
			expect(document.body.textContent ?? "").not.toContain(
				"The Local Operator server stopped",
			);
		});
	},
};

/** Attached: no banner. The empty frame IS the claim. */
export const Attached: Story = {
	decorators: [withBridge(snapshot({}))],
	play: async () => {
		await waitFor(() => {
			expect(document.body.textContent).not.toContain(
				"Not connected to a Local Operator server",
			);
			expect(document.body.textContent).not.toContain(
				"The Local Operator server stopped",
			);
		});
	},
};

/** Degraded: one or two missed probes on a connection that is still there. */
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
	play: async () => {
		await waitFor(() => {
			expect(document.body.textContent).not.toContain(
				"Not connected to a Local Operator server",
			);
		});
	},
};

/**
 * Three identity-failing probes while a process is still listening: this app
 * lost its attachment, and something else answers at the address.
 */
export const IdentityFailed: Story = {
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
				detail:
					"Another process is answering at http://127.0.0.1:1111 (answered with a different instance id)",
			}),
		),
	],
	play: waitForCopy("Not connected to a Local Operator server."),
};

/**
 * Discovery found a daemon and could not attach to it, with the manager
 * configured not to spawn one - the path whose own sentence is "A local daemon
 * may still be running, but could not be attached".
 */
export const NoSpawn: Story = {
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
				detail:
					"A local daemon may still be running, but could not be attached. Waiting without starting a duplicate.",
			}),
		),
	],
	play: waitForCopy("could not be attached"),
};

/**
 * A daemon that refused this app's credential for its desktop plane: recorded
 * BESIDE the state (401/403), never as a liveness answer.
 */
export const Unclaimed: Story = {
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
				failures: 0,
				capabilityStatus: 403,
				detail:
					"A daemon is running at http://127.0.0.1:1111, but it refused this app's credential for its desktop plane. The daemon is running.",
			}),
		),
	],
	play: waitForCopy("refused this app's credential"),
};

/** Past the 90 s reconnection window: the honest escalation. */
export const Stopped: Story = {
	decorators: [
		withBridge(
			snapshot({
				state: "detached",
				reconnecting: false,
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
	play: waitForCopy("The Local Operator server stopped."),
};

/**
 * A daemon is running on this machine and this app did not attach to it.
 *
 * Two producers reach this state and this story carries the first: a record
 * whose process is alive while its published heartbeat stopped. The second -
 * a daemon answering the configured address that this app holds no credential
 * for - is `Unattachable` below.
 *
 * The assertion is on the TITLE and the detail separately, and that split is
 * the point: the title states the connection fact, which is true of every path
 * into the state, while the detail states which path was taken. The title used
 * to assert the heartbeat, which is false of the other producer - a daemon
 * whose key this app may not read is running perfectly well.
 */
export const Wedged: Story = {
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
				failures: 0,
				detail:
					"A Local Operator daemon is running (pid 4242), but it stopped publishing its heartbeat, so this app did not attach to it. Waiting without starting a second one.",
			}),
		),
	],
	play: waitForCopy(
		/A Local Operator server is running on this machine and this app is not attached to it\./,
	),
};

/**
 * The other producer: a Local Operator daemon is serving the address this app is
 * configured for, and this app holds no credential for it (no serve record it
 * can read describes that address).
 *
 * This is the copy the operator's report asks for: it names the address, the pid
 * when the daemon published one, and the path into the state, and it says what
 * was NOT done about it. The daemon is serving throughout - nothing here may
 * render as "offline".
 */
export const Unattachable: Story = {
	decorators: [
		withBridge(
			snapshot({
				state: "wedged",
				url: "http://127.0.0.1:1111",
				instanceId: null,
				pid: 42411,
				version: "0.55.6",
				prefix: null,
				installKind: "uv-tool",
				desktopAvailable: false,
				failures: 0,
				detail:
					"This app was not given the key to that server, so it did not start a second one. It keeps probing for a server it can open.",
			}),
		),
	],
	play: waitForCopy(/It keeps probing for a server it can open/),
};
