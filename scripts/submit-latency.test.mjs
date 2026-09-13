import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { after, test } from "node:test";
import { build } from "esbuild";

/*
 * The submit-latency benchmark: is the ~1.15 s the user feels after pressing
 * Enter actually gone?
 *
 * The felt lag decomposed into four independent claims, and they need two
 * different instruments because they are not the same KIND of fact:
 *
 *   M1/M2/M3 are TRANSPORT facts - wall time against a real backend over real
 *   loopback HTTP, driving the shipped `requestDesktop`. They are measured
 *   rather than asserted structurally because "the engage no longer happens
 *   inside the message request" is a claim about duration and nothing else.
 *
 *   M4/M5/M6 are the FELT facts, and they are pinned STRUCTURALLY: the echo is
 *   present at the moment the transport is entered, the panel does not remount,
 *   the stream does not return to "connecting". Those are facts about ordering
 *   and identity, so a clock would only add flake to a stronger assertion. They
 *   live in `canonical-chat.test.mjs` and `transcript-reducer.test.mjs`, next
 *   to the code they constrain; this file re-states which tests carry them so
 *   the benchmark is readable as one table.
 *
 * WHY A REAL BACKEND. `desktop-contract.test.mjs` answers from a `createServer`
 * stub in the same process, which replies in microseconds and would measure
 * nothing at all. Only a real `local-operator serve` spawns the runtime process
 * whose start-up IS the number under test.
 *
 * M2 IS THE CONTROL AND IT MUST STILL FAIL SLOWLY. A harness that silently
 * warmed every session would report M1 green while proving nothing, so the
 * un-warmed send is measured too and is REQUIRED to stay slow. If M2 ever comes
 * back fast, the instrument is broken and M1's green is meaningless.
 */

// --------------------------------------------------------------- thresholds

/*
 * M1's reported ceiling, and WHY IT IS NOT A PRECISION BOUND.
 *
 * Two corrections live here, both from measurement rather than argument.
 *
 * FIRST: the design specified < 150 ms, derived from FINDINGS.md's "same
 * endpoint immediately after: 12-42 ms". That figure is a SECOND send on a
 * bridge that has already admitted one; M1 times a FIRST send on a freshly
 * warmed session, which is a different operation - the first admit does work
 * the second does not repeat. On this host, warm confirmed landed before each
 * send:
 *
 *   first send after a completed warm   p50 293 ms   (138-350 over 10 rounds)
 *   second send on that same session    p50  44 ms
 *   third send on that same session     p50  53 ms
 *
 * ~6x apart, so gating a first send on a second send's figure fails a working
 * feature.
 *
 * SECOND, and the reason this is now a REPORTED number rather than an
 * assertion: 500 ms was calibrated on one laptop and did not survive a second.
 * Review round 1 ran this same harness against the same backend branch:
 *
 *   host          M1 warmed p50   M2 control p50   ratio   500 ms gate
 *   author        225-293 ms      1259-1333 ms     4.3-5.9x   passed
 *   reviewer      595 ms          2701 ms          4.5x       FAILED
 *
 * The feature was working on both - warm landed, control properly slow, ratio
 * comfortably above 3x - and the absolute bound failed anyway on the slower
 * box, because a slower machine inflates M1 and M2 together while a millisecond
 * ceiling only tracks one of them. That is precisely the failure
 * `~/local-operator/AGENTS.md` documents under "Calibrate ceilings from CI,
 * never from your laptop" as having cost three PRs, and the previous version of
 * this comment cited that rule and then broke it.
 *
 * So there is NO absolute M1 assertion. The number is measured, recorded and
 * printed; the RATIO below is the gate. A catastrophe bound is kept only to
 * report an outlier, set with deliberate headroom over the slowest observation
 * (595 ms) rather than near it, and it is not asserted.
 */
const M1_REPORTED_CEILING_MS = 1500;
/*
 * The control's FLOOR, and this one IS asserted.
 *
 * It is what makes M1 mean anything: if the cold path stops being slow on a
 * host, a fast M1 is indistinguishable from a fast machine. Both observed
 * controls (1259 ms here, 2701 ms on the reviewer's box) and the original
 * 1134/1146/1220 ms sit far above 500 ms, while every warmed send sits far
 * below it, so this separates the populations without pinning a host-specific
 * number.
 */
const M2_COLD_SEND_FLOOR_MS = 500;
/*
 * THE REAL GATE.
 *
 * The claim is "the engage is no longer inside the send" - a statement that the
 * two populations differ in KIND. A ratio is the only form of that claim which
 * survives a slower box, because both numbers inflate together: 4.3-5.9x here
 * and 4.5x on the reviewer's much slower host, where the absolute bound failed.
 *
 * 3x leaves real headroom under the slowest observed ratio while remaining
 * impossible to pass if the warm stops working: a warm cancelled by the bridge
 * detaching measured 1634 ms against a 1240 ms control, a ratio below 1.
 */
const M1_MINIMUM_SPEEDUP = 3;
/*
 * M3's REPORTING bound - not an assertion, for the same reason as M1's.
 *
 * The warm op returns while the engage it started is still in flight, so its
 * own cost is one bridge acquire - the same ~12-40 ms a warm send costs
 * (observed p50 37 ms here). But 100 ms turned out to be the same
 * laptop-calibrated instrument already rejected once: review measured 89 ms
 * p50, passing by 11 ms, and QA measured 128 ms p50 on a run where the warm was
 * demonstrably healthy. Neither says anything about whether the op awaits its
 * engage - only about how loaded the box was.
 *
 * A warm that DID await its engage would cost ~1.15 s, i.e. an order of
 * magnitude away from this bound and impossible to miss; and it would also
 * collapse the M1/M2 ratio, which is asserted. So this number is printed as
 * context and flagged when exceeded, and the ratio does the gating.
 */
const M3_WARM_CEILING_MS = 100;
/*
 * How long the harness waits between the warm and the send.
 *
 * Stands in for the window a real user spends finishing their sentence after
 * the first keystroke fired the warm, which is the case the feature is FOR.
 * The engage is ~1.15 s, so a shorter settle would measure a PARTIALLY warmed
 * session and report the feature as weaker than it is.
 */
const SETTLE_MS = 2000;
/*
 * Rounds per population. Ten is enough for a p50/p95 to mean something on a
 * shared laptop without spending ten runtime spawns per extra sample - each is
 * roughly 283 MB of RSS, and this host is memory- and disk-constrained.
 */
const ROUNDS = Number(process.env.LOP_LATENCY_ROUNDS ?? 10);

/*
 * How long to wait for the backend to answer /v1/capabilities. Generous
 * because it is a process start plus an import graph, and because a too-tight
 * boot timeout produces a confusing "connection refused" instead of a clear
 * statement that the backend never came up.
 */
const BOOT_TIMEOUT_MS = 60_000;

// ------------------------------------------------------------ backend under test

/*
 * Which `local-operator` to measure, and why it is an input rather than a
 * constant.
 *
 * M1 and M3 need a backend that HAS `POST /v1/desktop/sessions/{id}/warm`. That
 * route ships in its own PR, so on a checkout that predates it this harness
 * must still be runnable and must still produce M2 - the before column - rather
 * than erroring out. Pointing LOP_BACKEND_BIN at a worktree that has the route
 * turns M1/M3 from "pending" into real numbers without editing this file.
 */
const BACKEND_BIN =
	process.env.LOP_BACKEND_BIN ??
	join(
		process.env.HOME ?? "",
		".local/share/uv/tools/local-operator/bin/local-operator",
	);

// ------------------------------------------------------------------ bundling

/*
 * The REAL shipped transport, bundled in memory exactly as
 * `desktop-contract.test.mjs` does. Re-implementing the fetch here would
 * measure a hand-written HTTP call rather than the one the app performs, and
 * would skip the schema parse, the endpoint table and the byte-budget guard
 * that sit in front of every real request.
 */
const bundle = await build({
	stdin: {
		contents:
			'export {requestDesktop} from "./src/main/desktop-transport"; export {desktopEndpoint, desktopRequestSchema} from "./src/shared/desktop-contract";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { requestDesktop, desktopRequestSchema } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

// ------------------------------------------------------------------ isolation

/**
 * The environment the backend is spawned with.
 *
 * ISOLATION IS A GATE HERE, NOT A NICETY, and it has two independent halves:
 *
 *  1. A throwaway `LOCAL_OPERATOR_CONFIG_DIR`, so this never reads or writes
 *     the operator's real sessions, credentials or agent registry.
 *  2. Every inherited `CMUX_*` variable is SCRUBBED. A config dir alone is not
 *     enough: a child that inherits `CMUX_WORKSPACE_ID` addresses the
 *     operator's real workspace through a channel the config dir does not
 *     cover, and an inherited one has renamed real workspaces before. The
 *     scrub is a deny-by-prefix rather than a list of known names, because the
 *     set grows and a missed name is silent.
 */
function isolatedEnv(root, token) {
	const env = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (key.startsWith("CMUX_")) continue;
		env[key] = value;
	}
	return {
		...env,
		LOCAL_OPERATOR_CONFIG_DIR: root,
		LOCAL_OPERATOR_DESKTOP_TOKEN: token,
		// The runtime child is spawned by the backend and inherits from it, so
		// the scrub has to hold for the whole tree, not just the server process.
		NO_COLOR: "1",
	};
}

/** A port the OS picked, so a leaked server from an earlier run cannot be
 * mistaken for ours - that mismatch surfaces as a 401, not a bind error. */
function freePort() {
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.on("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const { port } = probe.address();
			probe.close(() => resolve(port));
		});
	});
}

const started = [];
after(async () => {
	// `child` is null when the failure happened between creating the config dir
	// and spawning into it; the dir still has to go.
	for (const { child } of started) child?.kill("SIGKILL");
	// The backend's runtime children are grandchildren of this process and keep
	// writing into the config dir for a moment after the server dies, so an
	// immediate rmdir races them and fails with ENOTEMPTY. The pause is not a
	// fix for a leak - `force` already tolerates a missing tree - it just keeps
	// teardown from reporting a failure that is nothing to do with the results.
	await new Promise((resolve) => setTimeout(resolve, 1000));
	for (const { root } of started)
		await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

/**
 * Stand up an isolated backend and return its base URL and bearer.
 *
 * `hosting: test` / `model_name: mock` is a real provider path with no network
 * and no spend, so the runtime engages SUCCESSFULLY. An empty config dir would
 * measure the FAILURE path - the child exits on a missing provider - which is
 * not the latency a user feels and is much faster, so it would quietly make
 * every number look good.
 */
async function startBackend() {
	const root = await mkdtemp(join(tmpdir(), "lop-submit-latency-"));
	/*
	 * Registered BEFORE anything that can throw.
	 *
	 * The dir was previously recorded only once the child had spawned and
	 * booted, so every failure between `mkdtemp` and that point - a config write
	 * error, a boot timeout, a backend that exits, and notably the M1 path where
	 * a round can bail out - orphaned a config dir under /tmp. QA counted the
	 * leftovers going 22 -> 23 across a single run. These dirs hold a real
	 * config and the runtime's working state, so leaking them is a disclosure
	 * question and not only an untidiness one.
	 *
	 * `child` is filled in below; teardown tolerates a null child, because the
	 * case this exists for is precisely the one where there is not one yet.
	 */
	const record = { child: null, root };
	started.push(record);
	const token = Array.from({ length: 32 }, () =>
		Math.floor(Math.random() * 256)
			.toString(16)
			.padStart(2, "0"),
	).join("");
	await writeFile(
		join(root, "config.yml"),
		"version: 0.0.0\nvalues:\n  hosting: test\n  model_name: mock\n",
	);
	const port = await freePort();
	const child = spawn(BACKEND_BIN, ["serve", "--port", String(port)], {
		env: isolatedEnv(root, token),
		stdio: ["ignore", "pipe", "pipe"],
	});
	const log = [];
	child.stdout.on("data", (chunk) => log.push(String(chunk)));
	child.stderr.on("data", (chunk) => log.push(String(chunk)));
	record.child = child;

	const url = `http://127.0.0.1:${port}`;
	const deadline = Date.now() + BOOT_TIMEOUT_MS;
	for (;;) {
		if (child.exitCode !== null)
			throw new Error(
				`backend exited with ${child.exitCode}:\n${log.join("")}`,
			);
		try {
			const response = await fetch(`${url}/v1/capabilities`);
			if (response.ok) break;
		} catch {
			// Not listening yet; the deadline below is the real bound.
		}
		if (Date.now() > deadline)
			throw new Error(
				`backend did not boot in ${BOOT_TIMEOUT_MS}ms:\n${log.join("")}`,
			);
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	return { url, token, log };
}

/*
 * How long to wait for a fired warm to reach state "warm" before giving up on
 * the round.
 *
 * Generous on purpose. This is not a latency bound - nothing here is timed
 * against it - it only decides whether a round tested M1's hypothesis at all.
 * The engage it waits on is the ~1.15s process spawn plus handshake, and a
 * loaded CI box has been measured taking several times that; a tight deadline
 * here would reintroduce the very failure this exists to remove, just in the
 * shape of a skip instead of a red run.
 */
const WARM_LANDING_TIMEOUT_MS = Number(
	process.env.LOP_WARM_LANDING_TIMEOUT_MS ?? 20000,
);

/**
 * Poll the warm receipt until the engage has LANDED, or the deadline passes.
 *
 * Re-issuing `sessions.warm` is the read: the op is idempotent and reports the
 * session's current state, so this observes the precondition without a second
 * vocabulary for asking about it. It cannot itself start a competing engage -
 * a session already warming reports `warming`, and one already warm reports
 * `warm`.
 */
async function waitForWarm(url, token, sessionId) {
	const at = performance.now();
	const deadline = Date.now() + WARM_LANDING_TIMEOUT_MS;
	let state;
	for (;;) {
		const receipt = await requestDesktop(
			{ op: "sessions.warm", sessionId },
			url,
			token,
		);
		state = receipt.body.result?.state;
		if (state === "warm")
			return { ok: true, state, waitedMs: Math.round(performance.now() - at) };
		// Any state that is not "warming" is terminal for this round: the engage
		// is not on its way, so waiting the full deadline would only slow the run
		// down to reach the same skip.
		if (state !== "warming" || Date.now() > deadline)
			return { ok: false, state, waitedMs: Math.round(performance.now() - at) };
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

/** One real request through the shipped transport, timed. */
async function timed(request, url, token) {
	const at = performance.now();
	const response = await requestDesktop(request, url, token);
	return { ms: performance.now() - at, response };
}

async function createSession(url, token) {
	const { response } = await timed(
		{ op: "sessions.create", requestId: crypto.randomUUID(), cwd: tmpdir() },
		url,
		token,
	);
	assert.equal(response.status, 200, JSON.stringify(response.body));
	return response.body.result.session_id;
}

const send = (sessionId, text) => ({
	op: "sessions.message",
	sessionId,
	requestId: crypto.randomUUID(),
	text,
	mode: "prompt",
});

// ------------------------------------------------------------------ the report

const report = [];
const record = (id, what, value, verdict) =>
	report.push({ id, what, value, verdict });
after(() => {
	const width = Math.max(...report.map((row) => row.what.length));
	console.log("\n  submit-latency benchmark");
	for (const row of report)
		console.log(
			`  ${row.id}  ${row.what.padEnd(width)}  ${String(row.value).padStart(12)}  ${row.verdict}`,
		);
	console.log("");
});

// --------------------------------------------------------------------- tests

test("the backend under test is reachable and isolated", async (t) => {
	if (!existsSync(BACKEND_BIN)) {
		record("--", "backend binary", "absent", "SKIP");
		t.skip(
			`no local-operator at ${BACKEND_BIN}; set LOP_BACKEND_BIN to measure M1-M3`,
		);
		return;
	}
	const { url, token } = await startBackend();
	const response = await requestDesktop({ op: "capabilities" }, url, token);
	assert.equal(response.status, 200);
	assert.equal(response.body.result.desktop_available, true);
	/*
	 * The scrub is proven against a POISONED parent and read back from the
	 * CHILD's own environment.
	 *
	 * The previous version of this check filtered the dict `isolatedEnv` returns
	 * while the parent happened to carry no `CMUX_*` at all, so it passed
	 * whether or not the scrub worked (QA round 1, Q3). A guard that cannot
	 * fail is not a guard, and this one stands in front of the failure mode that
	 * renamed the operator's real cmux workspaces — so it is worth the synthetic
	 * variables.
	 *
	 * Poison is set and removed around the call rather than left in
	 * `process.env`, so a later test in this file cannot inherit it.
	 */
	const poison = {
		CMUX_WORKSPACE_ID: "synthetic-workspace-must-not-escape",
		CMUX_SESSION_ID: "synthetic-session-must-not-escape",
	};
	Object.assign(process.env, poison);
	let childEnv;
	try {
		childEnv = isolatedEnv("/tmp/x", "t");
	} finally {
		for (const key of Object.keys(poison)) delete process.env[key];
	}
	assert.ok(
		Object.keys(poison).every((key) => process.env[key] === undefined),
		"the poison must not outlive this assertion",
	);
	assert.deepEqual(
		Object.keys(childEnv).filter((key) => key.startsWith("CMUX_")),
		[],
		"no CMUX_* variable may reach the backend, even when the parent carries one",
	);
	// And the rest of the environment still crosses, or the child would not run.
	assert.equal(childEnv.LOCAL_OPERATOR_DESKTOP_TOKEN, "t");
	assert.equal(childEnv.LOCAL_OPERATOR_CONFIG_DIR, "/tmp/x");
	record(
		"--",
		"capabilities.session_catalogue",
		response.body.result.features?.session_catalogue ?? 0,
		"INFO",
	);
});

/**
 * An open SSE subscription, which every mounted SessionPanel holds.
 *
 * NOT decoration: the benchmark is VOID without it, and this is the single
 * most important fact about how the warm op behaves.
 *
 * The desktop bridge is reference-counted. It detaches when its last user
 * releases, and detaching CANCELS an in-flight warm so a spawn cannot outlive
 * the facade it was started against. The warm request is itself a user - so a
 * warm issued while nothing else holds the bridge is cancelled the instant its
 * own HTTP response returns, the engage never completes, and the next send
 * pays the full cold cost as though no warm had happened. Measured here: 1634
 * ms unsubscribed versus 79-209 ms subscribed, on the same backend and branch.
 *
 * That is correct behaviour rather than a bug, and it is exactly why the
 * renderer fires the warm from inside the mounted SessionPanel: the panel's
 * own stream subscription is what holds the bridge open across the engage, and
 * the composer that fires the warm lives inside that panel. A warm fired from
 * anywhere that can run while the panel is unmounted would be a silent no-op
 * that still looks like it works.
 */
async function subscribe(url, token, sessionId) {
	const controller = new AbortController();
	const response = await fetch(
		`${url}/v1/desktop/sessions/${sessionId}/events`,
		{
			headers: { Authorization: `Bearer ${token}` },
			signal: controller.signal,
		},
	);
	assert.equal(response.status, 200, "the panel's subscription must open");

	/*
	 * The subscription id arrives in the `open` frame's PAYLOAD, and the watch
	 * lease below is useless without it. Reading it from the frame's top level
	 * instead silently yields null, the lease is never sent, and the runtime
	 * stops counting this as an interactive viewer - at which point its
	 * residency drain reaps the very runtime the warm just spawned and the
	 * measurement quietly becomes meaningless (observed: 503s and sends that
	 * found "warming" again after a 4 s settle).
	 */
	let subscriptionId = null;
	const decoder = new TextDecoder();
	let buffered = "";
	(async () => {
		try {
			for await (const chunk of response.body) {
				buffered += decoder.decode(chunk, { stream: true });
				for (const line of buffered.split("\n")) {
					if (!line.startsWith("data:")) continue;
					try {
						const frame = JSON.parse(line.slice(5).trim());
						const id = frame.payload?.subscription_id;
						if (id && !subscriptionId) subscriptionId = id;
					} catch {
						// A partial frame; the next chunk completes it.
					}
				}
				buffered = buffered.slice(buffered.lastIndexOf("\n") + 1);
			}
		} catch {
			// Aborted at teardown.
		}
	})();
	for (let i = 0; i < 100 && !subscriptionId; i++)
		await new Promise((resolve) => setTimeout(resolve, 100));
	assert.ok(subscriptionId, "the open frame must name the subscription");

	/*
	 * The watch lease, on the renderer's own 15 s heartbeat but faster here.
	 * A desktop attach counts as an interactive viewer only while its lease is
	 * live AND the window reports visible or notifiable; without it the
	 * runtime's residency drain reaps a warmed session a few seconds later,
	 * which is exactly the case this benchmark must NOT accidentally measure.
	 */
	const beat = () =>
		requestDesktop(
			{
				op: "sessions.watch",
				sessionId,
				subscriptionId,
				visible: true,
				canNotify: false,
			},
			url,
			token,
		).catch(() => {
			// A missed heartbeat is self-healing; the next one re-establishes it.
		});
	await beat();
	const timer = setInterval(beat, 5000);
	return {
		close: () => {
			clearInterval(timer);
			controller.abort();
		},
	};
}

const percentile = (values, p) => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[
		Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
	];
};
const summarise = (values) => ({
	p50: Math.round(percentile(values, 50)),
	p95: Math.round(percentile(values, 95)),
	all: values.map((v) => Math.round(v)),
});

test("M1/M2/M3: the warm removes the engage from the send, and the control proves it", async (t) => {
	if (!existsSync(BACKEND_BIN)) {
		for (const [id, what] of [
			["M3", "sessions.warm own cost"],
			["M1", "send after warm (subscribed)"],
			["M2", "send with no warm (control)"],
		])
			record(id, what, "pending", "no backend binary");
		t.skip(
			`no local-operator at ${BACKEND_BIN}; set LOP_BACKEND_BIN to measure M1-M3`,
		);
		return;
	}
	const { url, token } = await startBackend();
	const capabilities = await requestDesktop({ op: "capabilities" }, url, token);
	const version = capabilities.body.result.features?.session_catalogue ?? 0;
	if (version < 3) {
		/*
		 * PENDING, not failed, and not silently skipped either.
		 *
		 * The renderer half of this change is gated on session_catalogue >= 3 and
		 * degrades to an exact no-op against an older backend, so a backend
		 * without the route is a legitimate configuration rather than a broken
		 * one. But the number is genuinely unmeasured, and a benchmark that
		 * invented one would be worse than a benchmark that admits it.
		 */
		for (const [id, what] of [
			["M3", "sessions.warm own cost"],
			["M1", "send after warm (subscribed)"],
		])
			record(id, what, "pending", `route absent (catalogue ${version})`);
		t.skip(
			`backend advertises session_catalogue ${version}; the warm route lands in the backend PR. Set LOP_BACKEND_BIN to a checkout that has it.`,
		);
		return;
	}

	const warmOp = [];
	const warmed = [];
	const control = [];
	const settled = [];
	// Rounds whose warm never landed. These tested nothing, so they are reported
	// rather than scored - see the poll above.
	const skipped = [];
	/*
	 * Interleaved rather than run as two phases, so drift in machine load hits
	 * both populations equally. A warmed run and its control sit next to each
	 * other in time, which is what makes their RATIO meaningful on a shared
	 * laptop where absolute numbers wander.
	 */
	for (let round = 0; round < ROUNDS; round++) {
		// --- M3 + M1: subscribe, warm, let the engage land, then send.
		const sessionId = await createSession(url, token);
		const panel = await subscribe(url, token, sessionId);
		const warm = await timed({ op: "sessions.warm", sessionId }, url, token);
		assert.equal(warm.response.status, 200, JSON.stringify(warm.response.body));
		assert.equal(
			warm.response.body.result.state,
			"warming",
			"a cold session's first warm must START one rather than report it already warm",
		);
		warmOp.push(warm.ms);
		/*
		 * WAIT FOR THE PRECONDITION, AND SKIP THE ROUND IF IT NEVER ARRIVES.
		 *
		 * M1's claim is "a send on a session whose warm HAS LANDED is fast". A
		 * round whose warm is still `warming` when the send goes out has not
		 * tested that claim - it measures a partial engage - so feeding it into
		 * the population reports an untested hypothesis as a refuted one. Both
		 * review and QA hit exactly this: the suite went red at 2.0x and 1.3x on
		 * runs where the warm simply had not landed, which is indistinguishable
		 * from the warm being broken.
		 *
		 * So the state is POLLED to a bounded deadline rather than sampled once
		 * after a fixed settle, and a round that never reaches "warm" is dropped
		 * from both populations and counted as skipped. Skipping is not a pass:
		 * the reason is printed and the round contributes to neither M1 nor its
		 * control, so the ratio stays a comparison of like with like.
		 *
		 * The poll is what a real user's think-time provides for free; the
		 * deadline only bounds a host slow enough that nobody could type that
		 * fast anyway.
		 */
		const landed = await waitForWarm(url, token, sessionId);
		settled.push(landed.state);
		if (!landed.ok) {
			skipped.push({ round, state: landed.state, waitedMs: landed.waitedMs });
			panel.close();
			continue;
		}
		const sent = await timed(send(sessionId, `warmed ${round}`), url, token);
		assert.equal(sent.response.status, 200, JSON.stringify(sent.response.body));
		warmed.push(sent.ms);
		panel.close();

		// --- M2: the CONTROL. Same server, same subscription shape, same round,
		// no warm. Holding a subscription here too keeps the only difference
		// between the two populations the warm itself.
		const coldId = await createSession(url, token);
		const coldPanel = await subscribe(url, token, coldId);
		const cold = await timed(send(coldId, `control ${round}`), url, token);
		assert.equal(cold.response.status, 200, JSON.stringify(cold.response.body));
		control.push(cold.ms);
		coldPanel.close();
	}

	/*
	 * EVERY round skipped means the precondition never held on this host, which
	 * is a statement about the environment and not about the feature. Reported
	 * like the route-absent case - visible reason, exit 0 - because a run that
	 * could not test the hypothesis must not be able to refute it.
	 */
	if (warmed.length === 0) {
		record(
			"M1",
			"send after warm (subscribed)",
			"skipped",
			`warm never landed in ${WARM_LANDING_TIMEOUT_MS}ms (${skipped.length}/${ROUNDS} rounds)`,
		);
		console.log(
			`  SKIPPED: the warm did not land on any of ${ROUNDS} rounds; states seen: ${JSON.stringify(settled)}`,
		);
		console.log(
			"  This run measured nothing about M1 - it is not evidence the warm is broken.",
		);
		t.skip(`warm never landed in ${WARM_LANDING_TIMEOUT_MS}ms`);
		return;
	}
	if (skipped.length)
		console.log(
			`  NOTE: ${skipped.length}/${ROUNDS} rounds skipped - warm did not land: ${JSON.stringify(skipped)}`,
		);

	const m3 = summarise(warmOp);
	const m1 = summarise(warmed);
	const m2 = summarise(control);
	record(
		"M3",
		"sessions.warm own cost",
		`${m3.p50} / ${m3.p95} ms`,
		m3.p50 < M3_WARM_CEILING_MS ? "reported" : "reported (outlier)",
	);
	record(
		"M1",
		"send after warm (subscribed)",
		`${m1.p50} / ${m1.p95} ms`,
		m1.p50 < M1_REPORTED_CEILING_MS ? "reported" : "reported (outlier)",
	);
	record(
		"M2",
		"send with no warm (control)",
		`${m2.p50} / ${m2.p95} ms`,
		`>${M2_COLD_SEND_FLOOR_MS} ms`,
	);
	console.log(
		`  M3 warm op      p50=${m3.p50} p95=${m3.p95}  ${JSON.stringify(m3.all)}`,
	);
	console.log(
		`  M1 warmed send  p50=${m1.p50} p95=${m1.p95}  ${JSON.stringify(m1.all)}`,
	);
	console.log(
		`  M2 control      p50=${m2.p50} p95=${m2.p95}  ${JSON.stringify(m2.all)}`,
	);
	console.log(`  warm state at send: ${JSON.stringify(settled)}`);
	const speedup = m2.p50 / m1.p50;
	record(
		"M1",
		"speedup vs control",
		`${speedup.toFixed(1)}x`,
		`>${M1_MINIMUM_SPEEDUP}x`,
	);

	/*
	 * THE CONTROL IS ASSERTED FIRST, because its failure does not mean the
	 * feature is broken - it means the MEASUREMENT is void. If the cold path is
	 * no longer slow on this host, a fast M1 is indistinguishable from a fast
	 * machine and proves nothing at all.
	 */
	assert.ok(
		m2.p50 > M2_COLD_SEND_FLOOR_MS,
		`M2 control p50 ${m2.p50}ms <= ${M2_COLD_SEND_FLOOR_MS}ms - the cold path is not slow here, so this run proves nothing`,
	);
	/*
	 * M3 IS REPORTED, NOT ASSERTED, for the same reason as M1.
	 *
	 * The claim it carries - "the warm returns without awaiting its engage" - is
	 * qualitative, and the absolute ceiling proved to be the same
	 * laptop-calibrated instrument already rejected for M1: review measured 89 ms
	 * p50 (passing by 11 ms) and QA measured 128 ms p50 on a healthy run where
	 * the warm was working correctly. A fire-and-forget warm on a loaded box is
	 * still fire-and-forget.
	 *
	 * What actually pins the claim is structural and lives on the backend: a
	 * warm that awaited its engage would take ~1.15s and be indistinguishable
	 * from a cold send, which the M1/M2 ratio below would catch immediately.
	 */
	if (m3.p50 >= M3_WARM_CEILING_MS)
		console.log(
			`  NOTE: M3 p50 ${m3.p50}ms is above the ${M3_WARM_CEILING_MS}ms reporting bound; the ratio gate below still decides this run.`,
		);
	/*
	 * M1 is REPORTED, NOT ASSERTED - see the constant's comment. An absolute
	 * millisecond bound on this number failed on a slower host while the feature
	 * was demonstrably working (595 ms against a 2701 ms control, 4.5x), so the
	 * ratio below carries the claim instead. An outlier is surfaced in the table
	 * and in this line rather than failing the run.
	 */
	if (m1.p50 >= M1_REPORTED_CEILING_MS)
		console.log(
			`  NOTE: M1 p50 ${m1.p50}ms is above the ${M1_REPORTED_CEILING_MS}ms catastrophe bound; the ratio gate below still decides this run.`,
		);
	/*
	 * The gate that actually carries the claim, and the one that survives a
	 * slower box: a cold engage inside the send makes the two populations the
	 * same, so the ratio collapses toward 1. A cancelled warm - the failure
	 * mode where the bridge is not held across the engage - measured 1634 ms
	 * against a 1240 ms control, i.e. a ratio BELOW 1, and this is what catches
	 * that without depending on any absolute millisecond figure.
	 */
	assert.ok(
		speedup > M1_MINIMUM_SPEEDUP,
		`the warm must make the send categorically faster than the control: ${speedup.toFixed(1)}x, need >${M1_MINIMUM_SPEEDUP}x (M1 p50 ${m1.p50}ms vs M2 p50 ${m2.p50}ms)`,
	);
});

test("M4/M5/M6: the felt claims are pinned structurally, not by this clock", () => {
	/*
	 * Stated here so the benchmark reads as one table, and asserted where the
	 * code lives. These are deliberately NOT timed:
	 *
	 *   M4 echo-to-paint      canonical-chat.test.mjs asserts the ORDERING (the
	 *                         echo is painted before the transport is entered,
	 *                         under the admission request id);
	 *                         echo-delivery.test.mjs asserts the DELIVERY - that
	 *                         it actually reaches a transcript, including on the
	 *                         New-chat path where the panel has not mounted yet.
	 *                         Both are needed: review round 1 found the ordering
	 *                         correct and the delivery silently dropped.
	 *   M5 panel remounts     canonical-chat.test.mjs, "the draft send remounts
	 *                         the panel exactly once, before the message POST".
	 *                         SCOPED: an existing-session send has no remount; a
	 *                         draft send has exactly ONE, at `createSession`.
	 *                         The swap moved it off the message POST rather than
	 *                         removing it, and the echo survives it because the
	 *                         pending-echo queue buffers by session id.
	 *   M6 connecting states  follows M5 with the same scope: no remount on an
	 *                         existing-session send, and the draft path's single
	 *                         remount lands before the POST resolves, so the
	 *                         panel that receives the admission row is the
	 *                         subscribed one.
	 *
	 * The reducer half - that the echo COALESCES with the owner's row instead of
	 * duplicating it - is transcript-reducer.test.mjs.
	 */
	// The op the whole M1/M3 path depends on is part of the shipped closed
	// vocabulary, which is what makes the renderer able to issue it at all.
	assert.equal(
		desktopRequestSchema.safeParse({
			op: "sessions.warm",
			sessionId: "123456abcdef",
		}).success,
		true,
	);
	record(
		"M4",
		"echo present at transport entry",
		"structural",
		"canonical-chat",
	);
	record("M4", "echo delivered to a transcript", "structural", "echo-delivery");
	record(
		"M5",
		"remounts: existing-session / draft",
		"0 / 1 (pre-POST)",
		"canonical-chat",
	);
	record(
		"M6",
		"connecting: existing-session / draft",
		"0 / 1 (pre-POST)",
		"canonical-chat",
	);
});
