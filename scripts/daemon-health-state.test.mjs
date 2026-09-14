/**
 * Regression guards for the daemon connection state machine: what "down" is
 * allowed to mean.
 *
 * The failures this encodes are the ones users reported as "the UI says my
 * server is down when it is not":
 *
 *   - one missed probe restarted the backend (now: three consecutive
 *     identity-failing probes, and nothing at all before that);
 *   - a gated route's 401/403/503 was read as "server down" (now: a capability
 *     result, recorded BESIDE the state, never moving it);
 *   - a daemon announcing a new installed build looked dead (now: attached and
 *     named, because an announcement is not a handover);
 *   - a daemon whose pid is gone kept the app "attached" for a whole tick (now:
 *     detached immediately, because that is evidence rather than a timeout).
 *
 * Pure logic, driven directly: the shipped TypeScript is bundled in memory and
 * the clock is injected, so no interval is ever waited out.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/main/backend/daemon-status"; export { isServerReachable } from "./src/shared/backend-status";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	DaemonStateMachine,
	DEGRADED_AFTER_FAILURES,
	DETACHED_AFTER_MS,
	REATTACH_BACKOFF_MS,
	REATTACH_BACKOFF_CEILING_MS,
	isServerReachable,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const identity = {
	url: "http://127.0.0.1:7341",
	instanceId: "instance-1",
	pid: 4321,
	version: "0.54.46",
	prefix: "/Users/x/.local/share/uv/tools/local-operator",
	installKind: "uv-tool",
};

function attached(owned = false, clock = () => 0) {
	const machine = new DaemonStateMachine(clock);
	machine.attach(identity, { owned });
	return machine;
}

test("a new machine starts connecting, with no daemon and nothing to compare", () => {
	const machine = new DaemonStateMachine();
	assert.equal(machine.getState(), "connecting");
	assert.equal(machine.expectedInstanceId(), null);
	assert.equal(machine.getUrl(), null);
	assert.equal(machine.mayManageDaemon(), false);
});

test("an attached daemon publishes its identity, and only an owned one is manageable", () => {
	const external = attached(false);
	assert.equal(external.getState(), "attached");
	assert.equal(external.expectedInstanceId(), "instance-1");
	const snapshot = external.snapshot();
	assert.equal(snapshot.url, identity.url);
	assert.equal(snapshot.pid, identity.pid);
	assert.equal(snapshot.version, "0.54.46");
	assert.equal(snapshot.installKind, "uv-tool");
	assert.equal(snapshot.owned, false);
	assert.equal(external.mayManageDaemon(), false, "an external daemon is not ours to stop");
	assert.equal(attached(true).mayManageDaemon(), true);
});

test("ONE missed probe is degraded, never a restart, and three are detached", () => {
	const machine = attached();
	for (let i = 1; i <= DEGRADED_AFTER_FAILURES - 1; i++) {
		assert.equal(machine.observe({ kind: "failed", detail: "no answer" }), "degraded");
		assert.equal(machine.snapshot().failures, i);
	}
	assert.equal(isServerReachable(machine.getState()), true, "degraded is still a connection");
	assert.equal(machine.observe({ kind: "failed", detail: "no answer" }), "detached");
	assert.equal(isServerReachable(machine.getState()), false);
});

test("a success resets the failure count and returns to attached", () => {
	const machine = attached();
	machine.observe({ kind: "failed", detail: "no answer" });
	machine.observe({ kind: "failed", detail: "no answer" });
	assert.equal(machine.snapshot().failures, 2);
	assert.equal(machine.observe({ kind: "identified" }), "attached");
	assert.equal(machine.snapshot().failures, 0);
});

test("a daemon whose pid is gone is detached immediately, without waiting for a probe", () => {
	const machine = attached();
	assert.equal(machine.observe({ kind: "pid-dead" }), "detached");
	assert.equal(machine.snapshot().failures, DEGRADED_AFTER_FAILURES);
	assert.match(machine.snapshot().detail, /process is gone/);
});

test("a CAPABILITY refusal never moves the state or counts as a failure", () => {
	const machine = attached();
	for (const status of [401, 403, 503]) {
		assert.equal(machine.observe({ kind: "capability", status, detail: `gated ${status}` }), "attached");
		assert.equal(machine.snapshot().failures, 0, "a gated route is not a missed probe");
		assert.equal(machine.snapshot().capabilityStatus, status);
		assert.equal(isServerReachable(machine.getState()), true);
		assert.match(machine.snapshot().detail, /The daemon is running\./);
	}
	// ... and a second probe still attached means the state was never touched.
	assert.equal(machine.observe({ kind: "identified" }), "attached");
	assert.equal(machine.snapshot().capabilityStatus, null);
});

test("an announced build change leaves the connection attached and untouched", () => {
	const machine = attached();
	// The backend announces that the INSTALLED build moved; it keeps serving
	// until a verified idle-boundary handoff exists. Anything but `attached`
	// here detaches the event stream and abandons whatever turn is in flight.
	assert.equal(
		machine.observe({ kind: "build-announced", detail: "new installed build v0.54.46 -> v0.55.0" }),
		"attached",
	);
	assert.equal(isServerReachable(machine.getState()), true, "an announcement is not an outage");
	assert.equal(machine.snapshot().capabilityStatus, null, "no route refused us: not a capability result either");
	assert.equal(machine.snapshot().failures, 0);
	assert.match(machine.snapshot().detail, /new installed build/);
	assert.equal(machine.observe({ kind: "identified" }), "attached");
});

test("a stale heartbeat with a live daemon is degraded, not detached", () => {
	const machine = attached();
	assert.equal(machine.observe({ kind: "heartbeat-stale", detail: "heartbeat 60s old" }), "degraded");
	assert.equal(machine.snapshot().failures, 0, "a stuck daemon is not a failing probe");
	assert.equal(isServerReachable(machine.getState()), true);
});

test("re-discovery finding nothing detaches, and the backoff doubles to a ceiling", () => {
	const machine = attached();
	assert.equal(machine.observe({ kind: "no-candidate", detail: "no daemon to attach to" }), "detached");
	assert.equal(machine.nextBackoff(), REATTACH_BACKOFF_MS);
	assert.equal(machine.nextBackoff(), REATTACH_BACKOFF_MS * 2);
	assert.equal(machine.nextBackoff(), REATTACH_BACKOFF_MS * 4);
	const capped = machine.nextBackoff();
	assert.equal(machine.nextBackoff(), Math.min(capped * 2, REATTACH_BACKOFF_CEILING_MS));
	assert.equal(machine.nextBackoff(), REATTACH_BACKOFF_CEILING_MS, "the ceiling holds");
});

test("a detach becomes reportable as 'stopped' only after the escalation window", () => {
	let now = 1_000_000;
	const machine = new DaemonStateMachine(() => now);
	machine.attach(identity, { owned: false });
	machine.observe({ kind: "no-candidate", detail: "gone" });
	assert.equal(machine.isReportablyGone(), false, "reconnecting, not stopped");
	now += DETACHED_AFTER_MS - 1;
	assert.equal(machine.isReportablyGone(), false);
	now += 1;
	assert.equal(machine.isReportablyGone(), true);
});

test("a replacement this app started is an owned attachment, and reachable", () => {
	const machine = attached(false);
	machine.markReplaced({ ...identity, url: "http://127.0.0.1:55001", pid: 999 });
	assert.equal(machine.getState(), "replaced");
	assert.equal(machine.mayManageDaemon(), true);
	assert.equal(machine.getUrl(), "http://127.0.0.1:55001");
	assert.equal(isServerReachable("replaced"), true);
	// The first successful probe folds `replaced` back into `attached`.
	assert.equal(machine.observe({ kind: "identified" }), "attached");
});

test("desktop availability is reported beside the state, not through it", () => {
	const machine = attached();
	machine.setDesktopAvailable(false);
	assert.equal(machine.snapshot().desktopAvailable, false);
	assert.equal(machine.getState(), "attached");
	machine.observe({ kind: "identified" });
	assert.equal(machine.snapshot().desktopAvailable, false, "a probe does not invent a capability");
});
