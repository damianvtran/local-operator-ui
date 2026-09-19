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
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/main/backend/daemon-status"; export { isServerReachable, serverBannerCopy, pairingHasRemedy, relayNeedsRebuild } from "./src/shared/backend-status";',
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
	TRANSPORT_EVIDENCE_MS,
	UNANSWERED_BEFORE_DETACHED,
	REATTACH_BACKOFF_MS,
	REATTACH_BACKOFF_CEILING_MS,
	isServerReachable,
	pairingHasRemedy,
	relayNeedsRebuild,
	serverBannerCopy,
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
	assert.equal(
		external.mayManageDaemon(),
		false,
		"an external daemon is not ours to stop",
	);
	assert.equal(attached(true).mayManageDaemon(), true);
});

test("ONE missed probe is degraded, never a restart, and three are detached", () => {
	const machine = attached();
	for (let i = 1; i <= DEGRADED_AFTER_FAILURES - 1; i++) {
		assert.equal(
			machine.observe({ kind: "failed", detail: "no answer" }),
			"degraded",
		);
		assert.equal(machine.snapshot().failures, i);
	}
	assert.equal(
		isServerReachable(machine.getState()),
		true,
		"degraded is still a connection",
	);
	assert.equal(
		machine.observe({ kind: "failed", detail: "no answer" }),
		"detached",
	);
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
		assert.equal(
			machine.observe({
				kind: "capability",
				status,
				detail: `gated ${status}`,
			}),
			"attached",
		);
		assert.equal(
			machine.snapshot().failures,
			0,
			"a gated route is not a missed probe",
		);
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
		machine.observe({
			kind: "build-announced",
			detail: "new installed build v0.54.46 -> v0.55.0",
		}),
		"attached",
	);
	assert.equal(
		isServerReachable(machine.getState()),
		true,
		"an announcement is not an outage",
	);
	assert.equal(
		machine.snapshot().capabilityStatus,
		null,
		"no route refused us: not a capability result either",
	);
	assert.equal(machine.snapshot().failures, 0);
	assert.match(machine.snapshot().detail, /new installed build/);
	assert.equal(machine.observe({ kind: "identified" }), "attached");
});

test("a stale heartbeat with a live daemon is reported as WEDGED, not as detached", () => {
	/*
	 * The machine with NO attachment - which is the only state discovery's wedged
	 * records can be observed from: they are records it refused to attach to.
	 */
	const machine = new DaemonStateMachine();
	assert.equal(
		machine.observe({
			kind: "heartbeat-stale",
			detail:
				"a Local Operator daemon is running (pid 4242), but it stopped publishing its heartbeat",
		}),
		"wedged",
	);
	assert.equal(
		machine.snapshot().failures,
		0,
		"a stuck daemon is not a failing probe",
	);
	/*
	 * Not usable (there is no attachment to query through) and not offline (there
	 * is a process). A surface that renders those two alike is the reported "it
	 * says my server is down when it is running" again, one rung down.
	 */
	assert.equal(isServerReachable(machine.getState()), false);
	assert.equal(machine.snapshot().reconnecting, false);
	assert.match(
		serverBannerCopy(machine.snapshot()).title,
		/is running on this machine and this app is not attached/,
	);
	/*
	 * The path is in the DETAIL, and the title may not claim one.
	 *
	 * The title used to assert the heartbeat, which is true of this producer and
	 * false of the other one that reaches `wedged` - a daemon answering the
	 * configured address whose key this app may not use is running perfectly well.
	 * A title that names a cause the state does not have is the same class of
	 * mistake as calling a serving daemon offline, one rung down.
	 */
	assert.match(
		serverBannerCopy(machine.snapshot()).detail,
		/stopped publishing its heartbeat/,
	);
	assert.doesNotMatch(serverBannerCopy(machine.snapshot()).title, /heartbeat/);
});

test("a quiet record never demotes a connection this app is using", () => {
	const machine = attached();
	machine.observe({
		kind: "heartbeat-stale",
		detail: "some other record went quiet",
	});
	assert.equal(
		machine.getState(),
		"attached",
		"the record that went quiet is not the daemon we are talking to",
	);
});

test("a detached connection is 'reconnecting' until the escalation window passes", () => {
	let now = 1_000_000;
	const machine = new DaemonStateMachine(() => now);
	machine.attach(identity, { owned: false });
	machine.observe({ kind: "no-candidate", detail: "gone" });
	assert.equal(machine.snapshot().reconnecting, true);
	/*
	 * The two sentences a lost daemon gets, and why the snapshot has to carry the
	 * difference: a still cannot show a timer, so a renderer given only `detached`
	 * said "the server is offline" at t=0 - while a daemon that is still running is
	 * expected back and main keeps re-discovering for it.
	 */
	assert.match(
		serverBannerCopy(machine.snapshot()).title,
		/If one is still running, the app reconnects to it on its own/,
	);
	now += DETACHED_AFTER_MS;
	assert.equal(machine.snapshot().reconnecting, false);
	assert.match(
		serverBannerCopy(machine.snapshot()).title,
		/The Local Operator server stopped/,
	);
});

test("only the unattached states get banner copy: a missed probe is not an outage", () => {
	assert.equal(
		serverBannerCopy({ state: "attached", reconnecting: false, detail: "x" }),
		null,
	);
	assert.equal(
		serverBannerCopy({ state: "degraded", reconnecting: false, detail: "x" }),
		null,
	);
	assert.equal(
		serverBannerCopy({ state: "replaced", reconnecting: false, detail: "x" }),
		null,
	);
	assert.equal(
		serverBannerCopy({ state: "connecting", reconnecting: false, detail: "x" }),
		null,
	);
	/*
	 * A host with no desktop bridge gets the weaker answer and no snapshot at
	 * all: "not connected" is the whole of what it can honestly say.
	 */
	assert.equal(
		serverBannerCopy(null)?.title,
		"Not connected to a Local Operator server.",
	);
});

test("re-discovery finding nothing detaches, and the backoff doubles to a ceiling", () => {
	const machine = attached();
	assert.equal(
		machine.observe({ kind: "no-candidate", detail: "no daemon to attach to" }),
		"detached",
	);
	assert.equal(machine.nextBackoff(), REATTACH_BACKOFF_MS);
	assert.equal(machine.nextBackoff(), REATTACH_BACKOFF_MS * 2);
	assert.equal(machine.nextBackoff(), REATTACH_BACKOFF_MS * 4);
	const capped = machine.nextBackoff();
	assert.equal(
		machine.nextBackoff(),
		Math.min(capped * 2, REATTACH_BACKOFF_CEILING_MS),
	);
	assert.equal(
		machine.nextBackoff(),
		REATTACH_BACKOFF_CEILING_MS,
		"the ceiling holds",
	);
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
	machine.markReplaced({
		...identity,
		url: "http://127.0.0.1:55001",
		pid: 999,
	});
	assert.equal(machine.getState(), "replaced");
	assert.equal(machine.mayManageDaemon(), true);
	assert.equal(machine.getUrl(), "http://127.0.0.1:55001");
	assert.equal(isServerReachable("replaced"), true);
	// The first successful probe folds `replaced` back into `attached`.
	assert.equal(machine.observe({ kind: "identified" }), "attached");
});

test("desktop availability is reported beside the state, not through it", () => {
	const machine = attached();
	machine.setPairing({ available: false, cause: "credential-refused" });
	assert.equal(machine.snapshot().desktopAvailable, false);
	assert.equal(machine.getState(), "attached");
	machine.observe({ kind: "identified" });
	assert.equal(
		machine.snapshot().desktopAvailable,
		false,
		"a probe does not invent a capability",
	);
});

/*
 * The pairing record itself, which is what the renderer words its sentences from:
 *
 *  - the derived boolean and the record are ONE fact, so a producer cannot leave
 *    them disagreeing;
 *  - a FAILURE sets it, not only a success. The value it replaces was written
 *    `true` at three sites and `false` at none, and `attach()` did not reset it,
 *    so after a `lop` build swap the app went on reporting a pairing a successor
 *    had already destroyed (design § 1.4);
 *  - `attach()` RESETS it, so a cause cannot outlive the pairing it described and
 *    keep a banner up over a working app (design § 10.3).
 */
test("the pairing record is written on failure too, and cleared by an attach", () => {
	const machine = attached();
	assert.deepEqual(
		machine.snapshot().pairing,
		{ available: true, cause: null },
		"attaching to a daemon this app proved it may drive is a pairing",
	);

	machine.setPairing({ available: false, cause: "successor" });
	assert.deepEqual(machine.snapshot().pairing, {
		available: false,
		cause: "successor",
	});
	assert.equal(
		machine.snapshot().desktopAvailable,
		false,
		"the boolean is the record's projection, not a second value",
	);
	assert.equal(machine.getState(), "attached");

	machine.attach(
		{
			url: "http://127.0.0.1:55002",
			instanceId: "b".repeat(43),
			pid: 4243,
			version: "0.55.6",
			prefix: "/tmp/prefix",
			installKind: "uv-tool",
		},
		{ owned: false },
	);
	assert.deepEqual(
		machine.snapshot().pairing,
		{ available: true, cause: null },
		"a fresh attach clears the cause, so a stale one cannot keep a banner up",
	);
	assert.equal(machine.snapshot().desktopAvailable, true);
});

/*
 * The operator's report, 2026-09-15: a banner said the backend was unavailable
 * on port 1111 while the backend was serving fine on that port, the TUI attached
 * to it without trouble, and `GET /health`, `GET /v1/credentials` and
 * `GET /v1/desktop/sessions?limit=500` all answered 200 in the same minutes.
 *
 * The mechanism was this machine's own rule read too strongly: a probe that
 * MISSES is not a probe that was REFUSED, and three misses at a 2 s budget is
 * what a daemon in the middle of one long agent turn produces while it serves
 * everything else. The cases below pin the three rules that remove it.
 */

test("a probe with no answer is not evidence of absence: three misses stay usable", () => {
	const machine = attached();
	for (let i = 1; i < UNANSWERED_BEFORE_DETACHED; i++) {
		assert.equal(
			machine.observe({
				kind: "unanswered",
				cause: "timeout",
				detail: "http://127.0.0.1:1111 did not answer (timeout)",
			}),
			"degraded",
		);
		assert.equal(
			isServerReachable(machine.getState()),
			true,
			`${i} unanswered probes is a busy daemon, not a gone one`,
		);
		assert.equal(machine.snapshot().unanswered, i);
	}
	assert.equal(
		machine.observe({
			kind: "unanswered",
			cause: "timeout",
			detail: "http://127.0.0.1:1111 did not answer (timeout)",
		}),
		"detached",
		"a minute and a half of continuous silence IS evidence",
	);
	assert.match(machine.snapshot().detail, /did not answer/);
});

test("a refused socket is evidence, and still detaches on the ordinary count", () => {
	const machine = attached();
	for (let i = 1; i < DEGRADED_AFTER_FAILURES; i++) {
		assert.equal(
			machine.observe({
				kind: "failed",
				detail: "http://127.0.0.1:1111 refused the connection",
			}),
			"degraded",
		);
	}
	assert.equal(
		machine.observe({
			kind: "failed",
			detail: "http://127.0.0.1:1111 refused the connection",
		}),
		"detached",
	);
});

test("a daemon that answered a request is never reported as offline", () => {
	const machine = attached();
	// A long turn: every probe expires, while the app keeps reading sessions.
	for (let i = 0; i < UNANSWERED_BEFORE_DETACHED * 3; i++) {
		machine.recordTransportSuccess();
		machine.observe({
			kind: "unanswered",
			cause: "timeout",
			detail: "http://127.0.0.1:1111 did not answer (timeout)",
		});
		assert.equal(
			isServerReachable(machine.getState()),
			true,
			"the transport is the one carrying the user's data",
		);
		assert.equal(machine.getState(), "attached");
	}
	// The detail still says what the probe saw - the point is that the STATE
	// does not repeat the probe's mistake.
	assert.match(machine.snapshot().detail, /budget is what expired/);
});

test("the same misses detach once the transport has been silent as long as they have", () => {
	let now = 1_000_000;
	const machine = new DaemonStateMachine(() => now);
	machine.attach(identity, { owned: false });
	machine.recordTransportSuccess();
	for (let i = 1; i < UNANSWERED_BEFORE_DETACHED; i++) {
		now += TRANSPORT_EVIDENCE_MS + 1;
		assert.equal(
			machine.observe({
				kind: "unanswered",
				cause: "timeout",
				detail: "no answer",
			}),
			"degraded",
		);
	}
	now += TRANSPORT_EVIDENCE_MS + 1;
	assert.equal(
		machine.observe({
			kind: "unanswered",
			cause: "timeout",
			detail: "no answer",
		}),
		"detached",
		"stale transport evidence does not excuse a silent daemon forever",
	);
});

test("a corroborated absence bypasses the transport gate: a gone pid is a gone pid", () => {
	const machine = attached();
	machine.recordTransportSuccess();
	assert.equal(machine.observe({ kind: "pid-dead" }), "detached");
});

test("an answer after the misses puts the connection back, and says so once", () => {
	const machine = attached();
	machine.observe({
		kind: "unanswered",
		cause: "timeout",
		detail: "no answer",
	});
	assert.equal(machine.getState(), "degraded");
	assert.equal(
		machine.recordTransportSuccess(),
		true,
		"the state moved, so the caller pushes exactly one snapshot",
	);
	assert.equal(machine.getState(), "attached");
	assert.equal(machine.snapshot().unanswered, 0);
	assert.equal(
		machine.recordTransportSuccess(),
		false,
		"and a later answer has nothing new to say",
	);
});

test("a daemon this app may not drive is WEDGED with its own path named, not detached", () => {
	const machine = new DaemonStateMachine();
	machine.observe({
		kind: "unattachable",
		detail:
			"This app was not given the key to that server, so it did not start a second one. It keeps probing for a server it can open.",
	});
	assert.equal(machine.getState(), "wedged");
	assert.equal(
		isServerReachable(machine.getState()),
		false,
		"this app is not attached, and must not pretend a read would work",
	);
	const copy = serverBannerCopy(machine.snapshot());
	assert.match(
		copy.title,
		/is running on this machine and this app is not attached/,
	);
	assert.match(
		copy.detail,
		/keeps probing for a server it can open/,
		"the detail says what the app does about it",
	);
	assert.doesNotMatch(
		copy.title,
		/heartbeat/,
		"the title may not claim a cause that belongs to one path only",
	);
});

test("an unattachable daemon never displaces a live attachment", () => {
	const machine = attached();
	machine.observe({ kind: "unattachable", detail: "another daemon elsewhere" });
	assert.equal(
		machine.getState(),
		"attached",
		"a daemon answering a port this app is not using says nothing about the one it is",
	);
});

/**
 * An answered contradiction outranks the traffic that used to excuse it.
 *
 * The exit test for the 2026-09-18 report. A `lop` build swap replaced the
 * daemon under the running app: the successor answered `/health` with a
 * different `instance_id` (the identity contradiction below) and refused every
 * desktop call with `503` because its plane was shut until the app claimed it.
 * Each of those refusals - and the capability op the renderer re-asks every
 * 15 s while the plane is shut, which the plane serves without admitting anyone -
 * was stamped as a successful request, which cleared `failures` and put the state
 * back to `attached` naming a pid that was gone. The count never survived to
 * three, so the app never detached, never re-discovered and never re-claimed:
 * the operator read "This app is not paired with the running Local Operator
 * server" for 28 minutes, and restarting the app was what re-paired it.
 */
test("a refusal is liveness evidence, never a pairing: it may not clear the identity-failure count", () => {
	const machine = attached();
	for (let i = 1; i < DEGRADED_AFTER_FAILURES; i++) {
		// the refused desktop call and the public capability poll, in the order the
		// app makes them: answered, and about nothing this app's pairing can be read from
		machine.recordTransportAnswer();
		assert.equal(
			machine.observe({
				kind: "contradicted",
				detail: "Another process is answering at http://127.0.0.1:1111",
			}),
			"degraded",
			`an answered contradiction is still counted (${i} of ${DEGRADED_AFTER_FAILURES})`,
		);
	}
	machine.recordTransportAnswer();
	assert.equal(
		machine.observe({
			kind: "contradicted",
			detail: "Another process is answering at http://127.0.0.1:1111",
		}),
		"detached",
		"and the third one detaches through the app's own answered refusals, which is what reaches re-discovery and a fresh claim",
	);
});

test("a contradiction is not excused by the transport gate the way a silent probe is", () => {
	const machine = attached();
	// the gate's own case, unchanged: a probe with NO answer is outranked by traffic
	machine.recordTransportAnswer();
	assert.equal(
		machine.observe({
			kind: "failed",
			detail: "http://127.0.0.1:1111 refused the connection",
		}),
		"degraded",
		"a socket that refused is not evidence about the attachment while the app is being answered",
	);
	// and the case the gate must not swallow: an ANSWERED contradiction
	machine.recordTransportAnswer();
	assert.equal(
		machine.observe({
			kind: "contradicted",
			detail: "Another process is answering at http://127.0.0.1:1111",
		}),
		"degraded",
	);
	machine.recordTransportAnswer();
	assert.equal(
		machine.observe({
			kind: "contradicted",
			detail: "Another process is answering at http://127.0.0.1:1111",
		}),
		"detached",
		"a contradiction is evidence about THIS app's pairing, so other answered traffic may not excuse it",
	);
});

test("an ADMITTED request still clears the count, which is what a pairing is", () => {
	const machine = attached();
	machine.observe({ kind: "contradicted", detail: "another process" });
	machine.observe({ kind: "contradicted", detail: "another process" });
	assert.equal(machine.getState(), "degraded");
	assert.equal(
		machine.recordTransportSuccess(),
		true,
		"the plane admitted a request, so the attachment is proven and the state moves back",
	);
	assert.equal(machine.getState(), "attached");
	assert.equal(
		machine.observe({ kind: "contradicted", detail: "another process" }),
		"degraded",
		"and the count really was cleared: one contradiction is again the FIRST of three, not the third",
	);
});

/*
 * The two bands answer ONE question the same way, and the record is what answers
 * it (design round 1, D2; UX round 1, U3).
 *
 * The compatibility band withholds its control for exactly the causes where
 * re-pairing cannot help; the connectivity band sits a line above it on the same
 * screen and offered its Retry regardless, so the screen carried the verb the
 * band below had already declared inert. These cases pin the shared rule and the
 * promise that goes with it.
 */
test("the connectivity band offers its Retry only where a re-pairing act exists", () => {
	const detached = (cause, owned = false) => ({
		state: "detached",
		reconnecting: true,
		detail: "The daemon did not answer.",
		pairing: { available: false, cause },
		owned,
	});

	assert.equal(pairingHasRemedy("governed-elsewhere"), false);
	assert.equal(pairingHasRemedy("pre-handshake"), false);
	for (const cause of ["successor", "credential-refused", "unpaired", null])
		assert.equal(
			pairingHasRemedy(cause),
			true,
			`${cause} is the app's to repair`,
		);

	const governed = serverBannerCopy(detached("governed-elsewhere"));
	assert.equal(
		governed.retry,
		false,
		"another principal's plane will not be re-claimed by trying again",
	);
	assert.doesNotMatch(
		governed.title,
		/reconnects to it on its own/,
		"and the band does not promise a reconnection it cannot make",
	);
	const successor = serverBannerCopy(detached("successor"));
	assert.equal(successor.retry, true);
	assert.match(successor.title, /reconnects to it on its own/);
	/*
	 * A snapshot from a build that predates the pairing record answers
	 * permissively: a surface may not withhold a control on the strength of a
	 * field it never read.
	 */
	const legacy = serverBannerCopy({
		state: "detached",
		reconnecting: true,
		detail: null,
	});
	assert.equal(legacy.retry, true);

	/*
	 * AND THE LATE ARM, which the cases above did not reach: every one of them
	 * built `reconnecting: true`, so this arm's control was pinned by nothing and
	 * passed before the round-2 change (review round 3). `reconnecting: false` is
	 * what main publishes past its 90 s boundary, and it is exactly where UX round
	 * 2 measured a Retry that asks `/health` and `/v1/capabilities` only.
	 */
	const late = (cause) =>
		serverBannerCopy({
			state: "detached",
			reconnecting: false,
			detail: "A local daemon may still be running, but could not be attached.",
			pairing: { available: false, cause },
			owned: false,
		});
	for (const cause of ["governed-elsewhere", "pre-handshake"]) {
		const copy = late(cause);
		assert.equal(copy.retry, false, `${cause}: the late arm must withhold the Retry`);
		/*
		 * And it may not assert a stop it cannot know: main's own detail beside it
		 * says a daemon may still be running, which for these two causes is the
		 * truth - the process is fine and this app may not attach (UX round 3, U10).
		 */
		assert.doesNotMatch(copy.title, /stopped/i, `${cause}: no stop is established`);
	}
	const lateRepairable = late("successor");
	assert.equal(lateRepairable.retry, true);
	assert.match(lateRepairable.title, /stopped/i);
});

/*
 * A RELAY IS BOUND TO A CREDENTIAL, NOT ONLY TO AN ADDRESS.
 *
 * The defect this pins was measured, not imagined: after a build swap the app
 * re-paired with the successor on the same port, and the sidebar went on saying
 * "Not connected to the backend - showing the last known state." because the
 * feed relay had been rebuilt on the URL rule alone and kept the retired claim
 * key, so every attempt was refused and no state transition could ever clear the
 * line (QA round 1 Q-2, design round 1 D3).
 */
test("a relay is rebuilt when the CREDENTIAL changes under a stable address", () => {
	const url = "http://127.0.0.1:46140";
	assert.equal(
		relayNeedsRebuild({ url, token: "key-a" }, { url, token: "key-a" }),
		false,
		"an unchanged pair keeps the relay, and its socket",
	);
	assert.equal(
		relayNeedsRebuild({ url, token: "key-a" }, { url, token: "key-b" }),
		true,
		"a re-pair on the same port must rebuild: the old bearer is refused forever",
	);
	assert.equal(
		relayNeedsRebuild(
			{ url, token: "key-a" },
			{ url: "http://127.0.0.1:46141", token: "key-a" },
		),
		true,
		"and so must a moved address",
	);
	assert.equal(
		relayNeedsRebuild({ url, token: null }, { url, token: "key-a" }),
		true,
		"a relay built before the credential existed is not reusable once it does",
	);
});

/*
 * THE CALL SITE, PINNED BESIDE THE RULE.
 *
 * `relayNeedsRebuild` can be perfect and unused: a revert of the one line that
 * consults it is what the round-1 defect WAS, and the rule's own cases cannot see
 * that revert (review round 2). `backend-service.ts` cannot be bundled into this
 * harness - it pulls in Electron and the whole main process - so the call site is
 * asserted as source, and the behaviour is asserted by the cases above. A revert
 * has to survive both.
 */
test("the feed relay's rebuild consults the rule, for the credential as well as the address", () => {
	const source = readFileSync("src/main/backend/backend-service.ts", "utf8");
	const feed = source.slice(
		source.indexOf("getDesktopFeedRelay()"),
		source.indexOf("getDesktopFeedRelay()") + 2_500,
	);
	assert.match(
		feed,
		/relayNeedsRebuild\(/,
		"the feed relay must answer the rebuild question with the shared rule",
	);
	assert.match(
		feed,
		/feedRelayToken = this\.desktopToken/,
		"and it must record the credential it rebuilt with, or the rule cannot fire twice",
	);
	assert.doesNotMatch(
		feed,
		/feedRelayUrl !== this\.backendUrl/,
		"the URL-only test is the defect: the credential is the half a re-pair changes",
	);
});
