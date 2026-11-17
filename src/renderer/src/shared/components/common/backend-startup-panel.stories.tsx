/**
 * The start-up band for this app's own server: starting, and each failure
 * category main can name (PostHog D2).
 *
 * These states need a server that fails on a real machine in a specific way (a
 * held port, a quarantined executable, a reserved Windows port range), so they
 * are not reachable on demand in the live app; the snapshot here is the same
 * record main publishes (`src/shared/backend-startup.ts`), and the stderr text
 * is the platform's own wording for each failure.
 */
import type { Meta, StoryObj } from "@storybook/react";
import { expect, waitFor } from "@storybook/test";
import type {
	BackendStartup,
	BackendStartupCategory,
} from "../../../../../shared/backend-startup";
import type { DaemonStatusSnapshot } from "../../../../../shared/backend-status";
import { BackendStartupPanel } from "./backend-startup-panel";

const STDERR: Partial<Record<BackendStartupCategory, string>> = {
	port_in_use:
		'Traceback (most recent call last):\n  File "local_operator\\server\\app.py", line 412, in serve\nOSError: [WinError 10048] Only one usage of each socket address (protocol/network address/port) is normally permitted\n',
	port_forbidden:
		"PermissionError: [WinError 10013] An attempt was made to access a socket in a way forbidden by its access permissions\n",
	crashed:
		"Traceback (most recent call last):\n  File \"local_operator\\cli.py\", line 7, in <module>\nModuleNotFoundError: No module named 'pydantic_core._pydantic_core'\n",
};

const startup = (
	phase: BackendStartup["phase"],
	category: BackendStartupCategory | null,
	startedAgoMs = 9_000,
): BackendStartup => ({
	phase,
	startedAt: Date.now() - startedAgoMs,
	budgetMs: 30_000,
	attempt: 1,
	settledAt: phase === "starting" ? null : Date.now(),
	failure: category
		? {
				category,
				exitCode: category === "executable_blocked" ? 3221225506 : 1,
				signal: null,
				spawnErrorCode: null,
				stderrTail: STDERR[category] ?? "",
				message: "The server process ended before it answered.",
			}
		: null,
});

const snapshot = (value: BackendStartup): DaemonStatusSnapshot => ({
	state: value.phase === "starting" ? "connecting" : "detached",
	reconnecting: false,
	owned: true,
	url: null,
	instanceId: null,
	pid: null,
	version: null,
	prefix: null,
	installKind: null,
	desktopAvailable: false,
	pairing: { available: false, cause: "unpaired" },
	failures: 0,
	capabilityStatus: null,
	unanswered: 0,
	lastTransportAt: null,
	addressSubstitution: null,
	detail: value.failure?.message ?? "",
	updatedAt: Date.now(),
	startup: value,
});

const meta: Meta<typeof BackendStartupPanel> = {
	component: BackendStartupPanel,
	title: "Common/Backend start-up band",
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="min-h-[220px] bg-canvas text-ink">
				<Story />
			</div>
		),
	],
};
export default meta;
type Story = StoryObj<typeof BackendStartupPanel>;

const shows = (text: RegExp) => async () => {
	await waitFor(() =>
		expect(text.test(document.body.textContent ?? "")).toBe(true),
	);
};

export const Starting: Story = {
	args: { snapshot: snapshot(startup("starting", null)) },
	play: shows(/Starting the Local Operator server/),
};

export const FailedPortInUse: Story = {
	args: { snapshot: snapshot(startup("failed", "port_in_use")) },
	play: shows(/Another program is using the port/),
};

export const FailedPortReservedByWindows: Story = {
	args: { snapshot: snapshot(startup("failed", "port_forbidden")) },
	play: shows(/Windows has reserved the port/),
};

export const FailedBlockedByAntivirus: Story = {
	args: { snapshot: snapshot(startup("failed", "executable_blocked")) },
	play: shows(/security software blocked/),
};

export const FailedCrashed: Story = {
	args: { snapshot: snapshot(startup("failed", "crashed")) },
	play: shows(/hit an error while starting/),
};

export const FailedTimedOut: Story = {
	args: { snapshot: snapshot(startup("failed", "timed_out", 30_000)) },
	play: shows(/did not answer within 30 seconds/),
};
