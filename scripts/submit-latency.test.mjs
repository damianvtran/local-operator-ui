import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
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
 * 3x leaves real headroom under the slowest observed ratio while staying far
 * above a run where the warm contributes nothing.
 *
 * WHAT THIS GATE DOES NOT CATCH, since an earlier version of this comment
 * claimed otherwise: a warm that never lands at all does not produce a low
 * ratio here, because those rounds never reach the send and are dropped from
 * both populations. That case is caught by the UNVERIFIED rule below - zero
 * landed rounds on a backend that HAS the route is a failure, not a pass - and
 * a decoy backend that reports `warming` forever is what proves it. The ratio
 * covers the other shape: a warm that lands but does not help.
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

/**
 * Every live pid whose ENVIRONMENT names this throwaway config dir.
 *
 * WHY THE ENVIRONMENT AND NOT THE PROCESS TREE. The backend spawns its session
 * runtimes with `start_new_session=True` (`session/runtime/launch.py:361`), so
 * each one leads its OWN session and process group and is reparented away from
 * the server. Killing `serve` therefore does not kill them, `pgrep -P` does not
 * find them, and they rename their argv to `Local Operator [session] id=...`,
 * so there is no command string tying them to this run either. What they DO
 * carry, unforgeably, is the `LOCAL_OPERATOR_CONFIG_DIR` they were started
 * with - which is unique per run because it is an mkdtemp path.
 *
 * That is the whole mechanism behind the leak both review and QA measured: the
 * `rm` succeeded, and a surviving runtime that nobody had killed re-created its
 * tree underneath, which is why the inode CHANGED across the removal and why a
 * single immediate existence check saw nothing wrong.
 *
 * POSIX-only by nature, like the leak. `ps eww` is the portable way to read
 * another process's environment here; a failure to read one is treated as "not
 * ours" rather than aborting the sweep, because teardown must never be the
 * thing that fails a run.
 */
function pidsHoldingConfigDir(root) {
	const marker = `LOCAL_OPERATOR_CONFIG_DIR=${root}`;
	let listing;
	try {
		listing = execFileSync("ps", ["-eo", "pid="], { encoding: "utf8" });
	} catch {
		return [];
	}
	const held = [];
	for (const line of listing.split("\n")) {
		const pid = line.trim();
		if (!pid) continue;
		try {
			// `eww` prints the environment; an exact token match avoids a prefix
			// of this path (another run's dir) counting as ours.
			const env = execFileSync("ps", ["eww", "-p", pid], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			});
			if (env.split(/\s+/).includes(marker)) held.push(Number(pid));
		} catch {
			// Exited between the listing and the read, or not readable. Either way
			// it is not something we can or need to kill.
		}
	}
	return held;
}

/**
 * Signal a backend's whole process GROUP, not just its leader.
 *
 * The supervisor is killed first; its reap thread then `killpg`s the backend's
 * own session, which is where the server and anything still in its group live.
 * This is the half of teardown that works without reading anyone's environment;
 * `reapConfigDir` covers the runtimes that deliberately leave that group via
 * `start_new_session=True`.
 */
function killGroup(child, signal) {
	if (!child?.pid) return;
	// Killing the SUPERVISOR closes its end of nothing, so kill it directly and
	// let its own reap thread take the backend's group down with it; the census
	// sweep is what confirms the result either way.
	try {
		child.kill(signal);
	} catch {
		/* already dead */
	}
	try {
		process.kill(-child.pid, signal);
	} catch {
		// Not a group leader (the supervisor shares our group by design), or
		// already gone. The census below is what decides whether anything
		// survived.
	}
}

/** Signal every process still carrying `root`, and report how many were hit. */
function reapConfigDir(root, signal) {
	const pids = pidsHoldingConfigDir(root);
	for (const pid of pids) {
		try {
			process.kill(pid, signal);
		} catch {
			// Already gone; the census below is what decides success.
		}
	}
	return pids.length;
}

const SWEEP_SETTLE_MS = 250;
const SWEEP_ATTEMPTS = 20;

/**
 * Remove one run's tree, and do not claim success until it STAYS removed.
 *
 * Ordering is the point: reap first, confirm the census is empty, and only then
 * unlink. Removing while a runtime is alive is what produced a leftover that
 * looked like a failed `rm` but was actually a successful one followed by a
 * re-creation.
 *
 * The retry LOOP replaces the single immediate check, which is what let this
 * survive two rounds: a tree re-created 300 ms after the check passed was
 * reported as clean.
 */
async function sweepRoot(root) {
	if (!existsSync(root) && pidsHoldingConfigDir(root).length === 0) return true;
	reapConfigDir(root, "SIGTERM");
	for (let attempt = 0; attempt < SWEEP_ATTEMPTS; attempt++) {
		const remaining = pidsHoldingConfigDir(root);
		if (remaining.length === 0) break;
		// Escalate once the polite signal has had a fair chance; a runtime in its
		// own session will not die from our process group going away.
		if (attempt >= 4) reapConfigDir(root, "SIGKILL");
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	for (let attempt = 0; attempt < SWEEP_ATTEMPTS; attempt++) {
		await rm(root, { recursive: true, force: true, maxRetries: 5 });
		await new Promise((resolve) => setTimeout(resolve, SWEEP_SETTLE_MS));
		// Gone AND nothing left that could re-create it. Checking both is what
		// makes this a real post-condition rather than a snapshot.
		if (!existsSync(root) && pidsHoldingConfigDir(root).length === 0)
			return true;
	}
	return false;
}

/**
 * Teardown that survives cancellation, and runs at most once.
 *
 * `after()` alone was not enough: QA cancelled a run mid-flight and found two
 * complete config trees AND two live `serve` processes, because node never runs
 * `after` hooks when the process is signalled. Ctrl-C and a CI timeout are
 * ordinary ways for this benchmark to end - it takes minutes - so the cleanup
 * has to be reachable from a signal handler too.
 *
 * Idempotent by latch, because it is now reachable from four places (the normal
 * `after`, SIGINT, SIGTERM, `exit`) and a second pass must not double-kill a
 * pid that has since been reused by an unrelated process.
 */
let cleanedUp = false;
async function cleanup() {
	if (cleanedUp) return;
	cleanedUp = true;
	for (const { child } of started) killGroup(child, "SIGKILL");
	const stubborn = [];
	for (const { root } of started)
		if (!(await sweepRoot(root))) stubborn.push(root);
	if (stubborn.length)
		console.log(
			`  WARNING: ${stubborn.length} config dir(s) could not be removed and are being left behind: ${stubborn.join(", ")}`,
		);
}

/**
 * The synchronous last resort, for paths where nothing may await.
 *
 * `process.on("exit")` cannot run async work, so this is deliberately a
 * best-effort SIGKILL plus a blocking unlink: worse than `cleanup()`, and still
 * far better than the orphaned trees and live servers a cancelled run left
 * before. It runs only if the async path never got there.
 */
function cleanupSync() {
	if (cleanedUp) return;
	cleanedUp = true;
	for (const { child, root } of started) {
		killGroup(child, "SIGKILL");
		reapConfigDir(root, "SIGKILL");
		try {
			rmSync(root, { recursive: true, force: true, maxRetries: 5 });
		} catch {
			/* best effort: the process is on its way out */
		}
	}
}

after(cleanup);
process.on("exit", cleanupSync);
for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		cleanupSync();
		// Re-raise with the default handler so the exit status still says
		// "cancelled" rather than "finished successfully".
		process.exit(signal === "SIGINT" ? 130 : 143);
	});
}

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
	/*
	 * The backend runs under a SUPERVISOR that dies with this process, and the
	 * supervisor is what makes cancellation safe.
	 *
	 * `node --test` runs this file in a CHILD of the test runner, and that child
	 * is killed outright when the runner is cancelled - verified directly: with
	 * `after`, `process.on("exit")` and a `SIGINT` handler all installed, NONE
	 * of them ran when the runner received SIGINT. So no in-file teardown can be
	 * relied on here, which is why QA's cancelled run left two live `serve`
	 * processes and two complete config trees.
	 *
	 * What the OS does guarantee is that our stdio pipes close when we die. The
	 * supervisor holds its stdin open, kills the backend's process group the
	 * moment that pipe ends, and exits - so the backend cannot outlive its
	 * spawner no matter how the spawner dies. `python` is used rather than a
	 * shell because the group kill must be a real `killpg`.
	 *
	 * The in-file handlers below are still installed: they are the fast, tidy
	 * path for a normal finish or a direct Ctrl-C. This is the backstop for the
	 * case where none of them get to run.
	 */
	const supervisor = `
import os, signal, subprocess, sys, threading, time
# The backend gets its OWN session, so the server and anything still in its
# group are reachable as one unit from here.
child = subprocess.Popen(sys.argv[1:], start_new_session=True)

def kill_child(*_):
    try:
        os.killpg(os.getpgid(child.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        pass
    # Hard exit: the main thread is blocked in child.wait() and must not get a
    # chance to outlive the kill.
    os._exit(0)

# BOTH triggers are needed, and each covers a case the other misses:
#  - the signals fire when the test runner tears this file's process down,
#    which is what actually happens on Ctrl-C (verified: the file process is
#    orphaned rather than killed, so its stdin pipe stays OPEN and EOF alone
#    never arrives);
#  - the pipe EOF fires when the spawner dies without signalling us, e.g. a
#    SIGKILL, where no handler of ours can run at all.
for _sig in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
    signal.signal(_sig, kill_child)

def reap():
    try:
        sys.stdin.buffer.read()
    except Exception:
        pass
    kill_child()


def guardian():
    # THE CASE NEITHER OTHER TRIGGER COVERS: this supervisor being SIGKILLed.
    # No handler runs, no EOF is produced, and the parent-poll below dies with
    # the thread - so the backend is reparented to init and keeps serving.
    # Measured: one surviving server per cancelled run, which is exactly what
    # QA found.
    #
    # The guardian is forked into its OWN session, so it outlives this
    # supervisor by construction, and it polls for the supervisor's
    # disappearance rather than relying on being signalled. It holds no
    # resources; if it is ever itself killed, the census sweep in the harness
    # is still the backstop.
    sup = os.getpid()
    if os.fork() != 0:
        return
    os.setsid()
    while True:
        time.sleep(0.5)
        try:
            os.kill(sup, 0)
        except OSError:
            try:
                os.killpg(os.getpgid(child.pid), signal.SIGKILL)
            except Exception:
                pass
            os._exit(0)


def watch_parent():
    # THE BACKSTOP FOR SIGKILL, which no handler can catch and which leaves no
    # EOF behind either: if this supervisor is killed outright, the backend is
    # reparented to init and keeps serving. Polling our own parent is the only
    # signal that survives that, so a supervisor orphaned by any means takes the
    # backend down within a second. Measured leak without this: one live
    # serve process per cancelled run.
    start_ppid = os.getppid()
    while True:
        time.sleep(0.5)
        if os.getppid() != start_ppid:
            kill_child()


guardian()
threading.Thread(target=reap, daemon=True).start()
threading.Thread(target=watch_parent, daemon=True).start()
sys.exit(child.wait())
`;
	const child = spawn(
		"python3",
		["-c", supervisor, BACKEND_BIN, "serve", "--port", String(port)],
		{
			env: isolatedEnv(root, token),
			// stdin is a PIPE and deliberately left open: it is the liveness
			// channel the supervisor waits on.
			//
			// NOT `detached`, and that is load-bearing rather than incidental: a
			// detached child's stdin pipe was observed staying open after this
			// process exited, so the supervisor's read never returned and the
			// backend survived anyway. Verified both ways in isolation before
			// settling here. The supervisor gives the BACKEND its own session, so
			// group-killing still works from the supervisor's side.
			stdio: ["pipe", "pipe", "pipe"],
			/*
			 * Its OWN process group, so teardown can signal the backend and anything
			 * it started as one unit via `process.kill(-pid)`.
			 *
			 * Needed because `node --test` runs this file in a CHILD of the test
			 * runner: a Ctrl-C or a CI timeout kills the runner, this file's
			 * handlers may never run, and the backend - which does not watch its
			 * parent - was simply inherited by init and kept serving. QA cancelled a
			 * run and found two live `serve` processes and two complete config trees;
			 * reproduced here before fixing.
			 *
			 * The group is what makes the sweep reliable rather than best-effort: the
			 * runtimes are `start_new_session=True` and leave this group, which is
			 * exactly why the environment census below exists as well. The two
			 * mechanisms cover different escapes and are both needed.
			 */
		},
	);
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
const WARM_LANDING_TIMEOUT_MS = (() => {
	const raw = process.env.LOP_WARM_LANDING_TIMEOUT_MS;
	if (raw === undefined) return 20000;
	const parsed = Number(raw);
	/*
	 * Validated rather than coerced, because every bad value fails in the
	 * direction that LOOKS fine. `Number("")` is 0 and `Number("abc")` is NaN;
	 * both make the deadline expire on the first check, so every round skips
	 * and - before the UNVERIFIED rule above - the run exited 0 having measured
	 * nothing. A typo in an env var must not be able to turn the gate off.
	 */
	if (!Number.isFinite(parsed) || parsed <= 0)
		throw new Error(
			`LOP_WARM_LANDING_TIMEOUT_MS must be a positive number of milliseconds, got ${JSON.stringify(raw)}`,
		);
	return parsed;
})();

/**
 * Poll until the engage has LANDED, reading a NON-ENGAGING observable.
 *
 * THE POLL MUST NOT BE ABLE TO WARM THE SESSION IT IS MEASURING. The previous
 * version re-issued `sessions.warm` as its read, which made the harness repair
 * the very thing under test: a broken warm that left the session cold was
 * silently fixed by the poll, and review's decoy mutant - which scored 1.2x
 * when the warm was sabotaged - came back at 5.5x and PASSED. A gate that
 * performs the behaviour it is checking cannot fail.
 *
 * `sessions.get` is the shipped snapshot read the UI already makes. Its
 * `payload.cold` is `self.remote is None or self.remote.is_cold` - a pure read
 * of bridge state - and the route never calls `_ensure_bound`, so it cannot
 * spawn a runtime. Verified against a real backend: five consecutive
 * `sessions.get` calls on a cold session reported `cold = true` every time with
 * the runtime process count unchanged, while a session with a subscription held
 * flipped `cold: true -> false` in the same second its warm receipt went
 * `warming -> warm`. So this observes the landing without causing it, and
 * without inventing a product field for the harness's benefit.
 */
async function waitForWarm(url, token, sessionId) {
	const at = performance.now();
	const deadline = Date.now() + WARM_LANDING_TIMEOUT_MS;
	for (;;) {
		const snapshot = await requestDesktop(
			{ op: "sessions.get", sessionId },
			url,
			token,
		);
		// A snapshot that will not answer is not evidence the warm failed, so it
		// is reported as its own state rather than folded into "cold".
		if (snapshot.status !== 200)
			return {
				ok: false,
				state: `snapshot ${snapshot.status}`,
				waitedMs: Math.round(performance.now() - at),
			};
		const cold = snapshot.body.result?.payload?.cold;
		if (cold === false)
			return {
				ok: true,
				state: "warm",
				waitedMs: Math.round(performance.now() - at),
			};
		if (Date.now() > deadline)
			return {
				ok: false,
				state: "cold",
				waitedMs: Math.round(performance.now() - at),
			};
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
		/*
		 * try/finally, because `subscribe` leaves TWO live handles: an open SSE
		 * socket and a 5s heartbeat interval keeping the watch lease alive. An
		 * assertion thrown anywhere in this region used to skip `panel.close()`,
		 * and the interval then held the event loop open forever - the file never
		 * exited, so the failure that caused it was never printed (review
		 * reproduced `timeout 300` -> exit 124 with no diagnostics). A benchmark
		 * that hangs instead of failing is worse than one that fails.
		 */
		try {
			const warm = await timed({ op: "sessions.warm", sessionId }, url, token);
			assert.equal(
				warm.response.status,
				200,
				JSON.stringify(warm.response.body),
			);
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
				continue;
			}
			const sent = await timed(send(sessionId, `warmed ${round}`), url, token);
			assert.equal(
				sent.response.status,
				200,
				JSON.stringify(sent.response.body),
			);
			warmed.push(sent.ms);
		} finally {
			panel.close();
		}

		// --- M2: the CONTROL. Same server, same subscription shape, same round,
		// no warm. Holding a subscription here too keeps the only difference
		// between the two populations the warm itself.
		const coldId = await createSession(url, token);
		const coldPanel = await subscribe(url, token, coldId);
		// Same reason as the warmed panel above: this one holds a heartbeat too.
		try {
			const cold = await timed(send(coldId, `control ${round}`), url, token);
			assert.equal(
				cold.response.status,
				200,
				JSON.stringify(cold.response.body),
			);
			control.push(cold.ms);
		} finally {
			coldPanel.close();
		}
	}

	/*
	 * ZERO LANDED ROUNDS ON A BACKEND THAT HAS THE ROUTE IS A FAILURE, NOT A
	 * SKIP.
	 *
	 * The distinction is what the run can conclude, and it is not the same
	 * question in the two cases:
	 *
	 *   route ABSENT  - a compatibility state. The renderer gates on
	 *                   session_catalogue >= 3 and no-ops cleanly, so there is
	 *                   nothing to measure and nothing is wrong. Handled above:
	 *                   skip, exit 0.
	 *   route PRESENT - the feature is supposed to work here. If nothing landed
	 *                   within the deadline, either the warm is broken or this
	 *                   host cannot run it; both mean the gate has NO evidence,
	 *                   and exiting 0 would let a green run stand in for a
	 *                   feature that never engaged. That was the hole: the
	 *                   harness claimed the ratio catches a cancelled warm while
	 *                   a cancelled warm produced zero landed rounds and passed.
	 *
	 * So this fails, loudly and with the reason attached. A slow box does not
	 * land here by accident - WARM_LANDING_TIMEOUT_MS is generous and per round,
	 * so reaching this means every round exhausted it.
	 */
	if (warmed.length === 0) {
		record(
			"M1",
			"send after warm (subscribed)",
			"UNVERIFIED",
			`warm never landed in ${WARM_LANDING_TIMEOUT_MS}ms (${skipped.length}/${ROUNDS} rounds)`,
		);
		console.log(
			`  UNVERIFIED: the warm did not land on any of ${ROUNDS} rounds; states seen: ${JSON.stringify(settled)}`,
		);
		console.log(
			"  This run measured NOTHING about the feature: no round satisfied M1's precondition,",
		);
		console.log(
			"  so neither the speedup nor its absence has been demonstrated here.",
		);
		assert.fail(
			`UNVERIFIED: the warm route is present (session_catalogue ${version}) but no round reached a warm runtime within ${WARM_LANDING_TIMEOUT_MS}ms. This run measured nothing about the feature - it is not a pass.`,
		);
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
	 * The gate that carries the claim for rounds that DID land, and the one that
	 * survives a slower box: a cold engage still inside the send makes the two
	 * populations the same kind of thing, so the ratio collapses toward 1
	 * without depending on any absolute millisecond figure.
	 *
	 * A warm that never lands is not this assertion's job - those rounds are
	 * skipped and the UNVERIFIED rule above fails the run instead.
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
