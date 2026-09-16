import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { after, test } from "node:test";
import { build } from "esbuild";
import { pythonChildEnv } from "./python-child-env.mjs";

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
 * The name every throwaway config dir this harness creates is prefixed with.
 *
 * ONE definition, read by `mkdtemp` AND by the start-of-run sweep that reaps a
 * previous run's residue. Two copies of this string would let the sweep quietly
 * stop matching what the harness creates - and the failure would look exactly
 * like "there was nothing stale to sweep", which is also what a working sweep
 * prints.
 */
const CONFIG_DIR_PREFIX = "lop-submit-latency-";

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
 * WHY THE ENVIRONMENT FIELD SPECIFICALLY, AND NOT JUST "THE LINE". `ps eww`
 * prints argv and the environment CONCATENATED, with no delimiter between them,
 * so a hit on the raw line cannot say whether the process was STARTED with this
 * config dir or merely MENTIONS the path in its command line - and a decoy that
 * names the path in argv is exactly what review measured the naive rule
 * matching. So a candidate pid is re-read WITHOUT `e`, which yields argv alone,
 * and that prefix is subtracted from the `eww` line. What is left is the
 * environment region, which is the half a process cannot forge, and the token
 * test runs on that.
 *
 * The residual over-match is the argv prefix failing to match - the process
 * changed shape between the two reads - and it is handled by falling back to the
 * whole line. That is the conservative direction: it can only ever match a
 * process that already carries `LOCAL_OPERATOR_CONFIG_DIR=<this run's unique
 * mkdtemp path>` in its command line, which nothing but this harness produces.
 *
 * COST, WHICH IS WHY THIS IS TWO READS AND NOT ONE PER PID. The obvious shape -
 * list the pids, then `ps eww -p <pid>` each - forks once per process on the
 * box. Measured here at 842 pids: 0.24 s for one whole-table `ps eww -A`,
 * against the ~10.6 s idle / 22-26 s loaded per call that per-pid loop cost,
 * across ~3 calls per root. Teardown that costs more than the benchmark it
 * cleans up after is a defect in its own right (review R5-3 / QA Q14).
 *
 * WHAT THIS CANNOT SEE. macOS prints no environment at all for SIP-protected
 * system binaries, so a holder started from a system path would be invisible
 * here (measured: `/bin/sleep` shows none, the venv interpreter shows its own).
 * It does not arise for what we reap - the backend and its runtimes are always
 * the venv or uv-tool interpreter this harness was pointed at - but it is why
 * the start-of-run sweep exists as well: a root nobody can be proved to hold is
 * removed on the next run regardless.
 *
 * POSIX-only by nature, like the leak.
 *
 * "COULD NOT READ THE TABLE" IS NOT "NOBODY HOLDS IT" - the distinction this
 * used to collapse, and the reason the return type is `null`-able (R6-1). The
 * two consumers ask opposite questions of the same answer:
 *
 *   - TEARDOWN of our own tree asks "is anyone still holding this?". A failed
 *     read there only means our own tree may survive to the next run, so
 *     degrading to "nothing found" was harmless and kept teardown from ever
 *     failing a run.
 *   - The SWEEP asks "may I delete this?", where "nothing found" IS the
 *     deletion decision. Failing open there removes a tree whose live holder
 *     this process could not see, and the log line could not even tell the two
 *     apart: a failed census printed exactly what a genuine stale sweep prints.
 *     The conservative direction for a destructive decision is "cannot prove it
 *     is unheld, so leave it", which is what a `null` now means to every caller.
 */
// Hoisted so the collector does not rebuild them once per process on the box.
const PID_AND_COMMAND = /^\s*(\d+)\s(.*)$/;
const WHITESPACE_RUN = /\s+/;

/*
 * Report the FIRST refusal of each KIND, once per process, with `ps`'s reason.
 *
 * That reason used to be discarded (`stdio[2] = "ignore"`, no stderr in the
 * result), and the cost was concrete rather than theoretical: `ps eww -ax` is a
 * procps ERROR on Linux - "must set personality to get -x option", exit 1, empty
 * stdout - so this census answered `null` ("could not ask") for every root, and
 * the sweep could therefore never authorise a removal on the only platform whose
 * CI runs the suite. The log said `1 whose census could not be read`, which is
 * exactly what a transient failure prints, so nothing named the cause; finding it
 * took running the file in a Linux container.
 *
 * ONE LINE PER KIND, AND KEYED BY THE REASON RATHER THAN A SINGLE FLAG (review
 * R1). A single latch loses the line to the FIRST refusal, and the first refusal
 * is normally the benign one: `ps -p <pid>` on a pid that exited between the two
 * reads exits 1 with nothing on stderr, which happens mid-loop on a busy box. A
 * system-wide invocation error would then be the second, and silent - which is
 * the failure this reporting exists to prevent. The cap is the other half: at
 * most four distinct reasons, so a pathological `ps` cannot turn diagnostics into
 * the flood they would otherwise become.
 */
const censusRefusalsReported = new Set();
function reportCensusRefusal(args, why, stderr) {
	const reason = (stderr ?? "").split("\n").find((line) => line.trim()) ?? "";
	const kind = `${why}|${reason.trim()}`;
	if (censusRefusalsReported.has(kind) || censusRefusalsReported.size >= 4)
		return;
	censusRefusalsReported.add(kind);
	console.log(
		`  census: ps ${args.join(" ")} refused (${why})${reason ? `: ${reason.trim().slice(0, 200)}` : ""}`,
	);
}

function pidsHoldingConfigDir(root) {
	const marker = `LOCAL_OPERATOR_CONFIG_DIR=${root}`;
	/*
	 * `null` means "could not ask", which every caller must read as UNKNOWN.
	 *
	 * `spawnSync` rather than `execFileSync` for exactly this: `execFileSync`
	 * throws on any non-zero status AND on a failed spawn, so the caller cannot
	 * tell "ps refused the question" from "ps answered and there was no matching
	 * process" - the two cases have opposite meanings here.
	 *
	 * The `error` arm is not hypothetical. `ps eww -A` prints well over the 1 MB
	 * default buffer on a loaded box: measured at this machine's load, the
	 * default buffer produced `ENOBUFS` with a TRUNCATED table in `stdout`, which
	 * is the worst possible answer - a partial census that reads as a complete
	 * one and can only ever conclude "nobody holds it". It is reported as unknown
	 * instead, so a truncated read can never authorise a removal.
	 */
	const ps = (args) => {
		const result = spawnSync("ps", args, {
			encoding: "utf8",
			// The `eww` table of a loaded box is a few hundred KB; the default
			// 1 MB pipe buffer would truncate it and turn a real census into a
			// partial one without any error.
			maxBuffer: 64 << 20,
			// stderr is CAPTURED, not ignored: a refusal has to be able to name
			// itself (see reportCensusRefusal) - the reason is the only thing that
			// distinguishes "this box is busy" from "this invocation is wrong".
			stdio: ["ignore", "pipe", "pipe"],
		});
		/*
		 * ONE rule for both reads: `ps` either answers with text, or this census
		 * could not read the table. Every other outcome - a spawn failure
		 * (`error`), a refusal (`status !== 0`), or an empty answer - is the
		 * same "could not ask" to a caller deciding whether it may delete.
		 *
		 * It costs the rare mid-loop race the benefit of the doubt: a process
		 * that exited between the two reads is now "unknown" rather than "not a
		 * holder", so its root is left for a later run instead of being removed
		 * in the same pass. That is the direction to pay it in - the root is
		 * swept once the process is genuinely gone, and a removal is the one
		 * outcome with no undo.
		 */
		if (result.error) {
			reportCensusRefusal(
				args,
				`spawn failed: ${result.error.code ?? result.error}`,
				"",
			);
			return null;
		}
		if (result.status !== 0) {
			reportCensusRefusal(args, `exit ${result.status}`, result.stderr);
			return null;
		}
		return typeof result.stdout === "string" && result.stdout
			? result.stdout
			: null;
	};

	/*
	 * `-A`, NOT `-ax` - and the difference cost this file every sweep on Linux.
	 *
	 * Both spellings mean "every process" in BSD `ps`, which is why `-ax` reads
	 * as the portable one, and it is not: GNU procps REFUSES `-x` unless a
	 * personality is set, exiting 1 with an empty stdout and
	 * "error: must set personality to get -x option" on stderr (measured on the
	 * Ubuntu runner AND in a node:22 container: `rc=1, bytes=0`). Under the rule
	 * above that is "could not ask", so on Linux this census returned `null` for
	 * EVERY root: the sweep could never authorise a removal, and R6-1's positive
	 * control - an aged, unheld root the sweep MUST reap - could never pass. It
	 * was green on macOS, which is how a file that had only ever been run on a
	 * laptop shipped red to the only platform that runs it.
	 *
	 * `-A` selects the same set on both, and the environment comes with it:
	 * `rc=0` with the environment present on macOS (one 762-815 KB snapshot,
	 * depending on what the box is running) and on procps 4.0.2 (669 bytes in a
	 * fresh container). The set is *the same set* rather than merely a working
	 * one: on macOS the pid list from `-A` and from `-ax` compared equal, so the
	 * holder rule above is neither widened nor narrowed by the change.
	 *
	 * `-e` is NOT a substitute, and which `-e` you get depends on the MODE - which
	 * is decided by the shape of the first argument rather than by any flag
	 * (review R6): measured on BSD `ps` here, `ps eww -eo pid=,command=` - a
	 * hyphen-less first argument, i.e. compatibility mode, where `e` means "show
	 * the environment" - selected only the current terminal's processes (2 lines,
	 * 1 environment), while `ps -e -o pid=,command=` - normal mode, where the man
	 * page gives `-e` as an alias for `-A` - selected 813. `-A` means "every
	 * process" in both modes and on both platforms, which is the whole reason to
	 * spell it this way.
	 */
	const table = ps(["eww", "-A", "-o", "pid=,command="]);
	if (table === null) return null;

	const held = [];
	for (const line of table.split("\n")) {
		const match = line.match(PID_AND_COMMAND);
		if (!match) continue;
		const [, pid, full] = match;
		// Cheapest possible reject first: almost nothing on the box mentions this
		// path at all, so the string scan and the second read below run on a
		// handful of lines.
		if (!full.includes(marker)) continue;
		// `command=` is the last field on the line, so both edges are padding: the
		// newline, and (on some ps builds) leading width padding. Trimming both
		// keeps the prefix subtraction below exact rather than falling through to
		// the whole-line fallback for every process on the box.
		const perPid = ps(["-p", pid, "-o", "command="]);
		// One unreadable row poisons the answer for the whole root, deliberately:
		// the callers act on "nobody holds this", and a partial census is not
		// evidence for that.
		if (perPid === null) return null;
		const argv = perPid.trim();
		const envRegion = full.startsWith(argv) ? full.slice(argv.length) : full;
		// Exact token match: a prefix of this path (another run's dir) must not
		// count as ours.
		if (envRegion.split(WHITESPACE_RUN).includes(marker))
			held.push(Number(pid));
	}
	return held;
}

/**
 * True only when the census ANSWERED and found nobody.
 *
 * The one place the `null` distinction is turned into a verdict, so every
 * caller that treats emptiness as permission is reading the same rule.
 */
function censusSaysUnheld(root) {
	const pids = pidsHoldingConfigDir(root);
	return pids !== null && pids.length === 0;
}

/**
 * Tear a backend down by signalling its SUPERVISOR.
 *
 * There is no process group for this function to signal, and that is
deliberate rather than an oversight. The supervisor has to share THIS test
process's group so that its stdin pipe closes when we die (see `startBackend`),
so `process.kill(-pid)` here would address our own group rather than the
backend's. The group kill happens one level down instead: the supervisor's reap
thread `killpg`s the BACKEND's session, which the backend is given in its own
right on purpose, and that is where the server and anything still in its group
live. So this is the half of teardown that works without reading anyone's
environment; `reapConfigDir` covers the runtimes that leave even that group via
`start_new_session=True`.
 *
 * `process.kill(-child.pid, signal)` used to sit here. It was an ESRCH no-op
 (the supervisor is not a group leader by construction) whose comment read as
 load-bearing, so it was removed rather than left to look like a second line
 of defence. The census sweep is what confirms the result either way.
 */
function killGroup(child, signal) {
	if (!child?.pid) return;
	try {
		child.kill(signal);
	} catch {
		/* already dead */
	}
}

/** Signal every process still carrying `root`, and report how many were hit. */
function reapConfigDir(root, signal) {
	// An unreadable census identifies nobody to signal. Signalling is best-effort
	// here and the callers' post-conditions decide the outcome, so guess nobody
	// rather than guess at pids: same rule as the sweep's, opposite cost.
	const pids = pidsHoldingConfigDir(root) ?? [];
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
/**
 * How long the polite SIGTERM gets before the sweep escalates, and the total
 * budget for getting the holders dead. Both are WALL-CLOCK, not iteration
 * counts: `attempt >= 4` used to be the same thing only while a census was
 * nearly free. Once each iteration paid a multi-second per-pid scan it became
 * ~45 s of wall clock, which is what turned a cancelled run's exit into the
 * 133-189 s review timed (R5-3). Wall-clock deadlines keep the behaviour fixed
 * as the census gets faster or slower.
 */
const SWEEP_ESCALATE_MS = 500;
const SWEEP_REAP_BUDGET_MS = 10_000;
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
	/*
	 * Read once, and fail CLOSED. A census that could not read the table proves
	 * nothing, and this is the destructive consumer: "cannot prove it is unheld"
	 * leaves the tree for a later run instead of removing one that a holder it
	 * could not see can re-create (R6-1, which is precisely the round-5 leak's
	 * precondition). Bailing here rather than after the reap loop is the same
	 * decision made sooner and for free: with no census there is nobody this
	 * process can identify to signal, so the loop could only spin out its
	 * deadline and then reach the same answer.
	 */
	const census = pidsHoldingConfigDir(root);
	if (census === null) return false;
	if (!existsSync(root) && census.length === 0) return true;
	reapConfigDir(root, "SIGTERM");
	// Escalate on a wall-clock deadline; see SWEEP_ESCALATE_MS.
	const escalateAt = Date.now() + SWEEP_ESCALATE_MS;
	const deadline = Date.now() + SWEEP_REAP_BUDGET_MS;
	let escalated = false;
	while (Date.now() < deadline) {
		if (censusSaysUnheld(root)) break;
		if (!escalated && Date.now() >= escalateAt) {
			// A runtime in its own session will not die from our process group
			// going away, so the polite signal is only ever given a moment.
			reapConfigDir(root, "SIGKILL");
			escalated = true;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	for (let attempt = 0; attempt < SWEEP_ATTEMPTS; attempt++) {
		await rm(root, { recursive: true, force: true, maxRetries: 5 });
		await new Promise((resolve) => setTimeout(resolve, SWEEP_SETTLE_MS));
		// Gone AND nothing left that could re-create it. Checking both is what
		// makes this a real post-condition rather than a snapshot. `censusSaysUnheld`
		// and not an emptiness test: an unreadable census must make this post-condition
		// FAIL, not pass.
		if (!existsSync(root) && censusSaysUnheld(root)) return true;
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
	for (const { root } of started) {
		/*
		 * Only a root still ON DISK is "left behind". `sweepRoot` also answers
		 * false when the census could not read the table (R6-1's fail-closed
		 * rule), so a root that is already gone plus an unreadable census used to
		 * print a tree that was never left behind (QA round 7, Q2). The verdict
		 * stays fail-closed; only the sentence is narrowed to trees this run can
		 * still point at.
		 */
		if (!(await sweepRoot(root)) && existsSync(root)) stubborn.push(root);
	}
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
 * A tree younger than this is never judged stale, however unheld it looks.
 *
 * This exists to close one specific window, not to be a general grace period:
 * between `mkdtemp` and the spawn of its backend, a LIVE concurrent run has its
 * root on disk and no process whose environment names it. That window is
 * milliseconds, so a 60 s floor makes it unreachable - and a tree under live
 * use is touched every time the run writes into it anyway, so the age test can
 * never be the only thing sparing something that is actually in use.
 */
const STALE_ROOT_MIN_AGE_MS = 60_000;

/**
 * Reap the residue a previous run could not, before this one starts.
 *
 * WHY THIS EXISTS IN ADDITION TO THE SUPERVISOR AND ITS GUARDIAN. Everything
 * inside a run now cleans up after itself, but a run can die in ways that leave
 * no code of ours executing at all - a SIGKILL that takes the supervisor and
 * its guardian together, an OOM kill, a box that loses power - and those are
 * exactly the cases where a complete config tree (config, transcripts, the
 * runtime's caches) is left under the temp dir for good. That is
 * disclosure-shaped, not merely untidy, so every run starts by looking for a
 * predecessor's trees and removing the ones nothing can be proved to hold.
 *
 * THE SAFETY PROPERTY, WHICH IS THE WHOLE POINT. Peers run THIS FILE
 * concurrently on this machine - 11 at once was measured during round 5 - and
 * two independent conditions must BOTH hold before a tree is touched:
 *
 *   1. NO LIVE HOLDER. `LOCAL_OPERATOR_CONFIG_DIR=<root>` must appear in no
 *      running process's environment. This is the same census the teardown
 *      uses, so "held" is proved the same way in both places. There is no
 *      prefix match, no name match and no process-tree walk anywhere in here:
 *      the only selector is an exact token in one specific root's environment.
 *   2. NOT RECENTLY TOUCHED. The tree's mtime must be older than
 *      STALE_ROOT_MIN_AGE_MS, which is what covers the one window where a live
 *      concurrent run has no holder yet.
 *
 * Anything outside `tmpdir()` is out of scope by construction: the candidate
 * list is a `readdir` of the temp dir filtered on CONFIG_DIR_PREFIX. The
 * operator's own `~/.local-operator` is not under it and nothing here can reach
 * it, whatever the processes on this box are doing.
 */
function sweepStaleRoots() {
	let names;
	try {
		names = readdirSync(tmpdir()).filter((name) =>
			name.startsWith(CONFIG_DIR_PREFIX),
		);
	} catch {
		// No readable temp dir. Nothing to reap, and certainly not a reason to
		// fail a run that has not started yet.
		return;
	}
	const now = Date.now();
	const removed = [];
	let held = 0;
	let unreadable = 0;
	let recent = 0;
	for (const name of names) {
		const root = join(tmpdir(), name);
		let age;
		try {
			age = now - statSync(root).mtimeMs;
		} catch {
			continue; // Vanished between the listing and the stat.
		}
		if (age < STALE_ROOT_MIN_AGE_MS) {
			recent += 1;
			continue;
		}
		const pids = pidsHoldingConfigDir(root);
		if (pids === null) {
			// Not "held" and not "removed": the census could not read the table, so
			// this root is not provably unheld and not this sweep's to delete. Counted
			// separately because the log has to be able to tell that apart from a
			// genuine stale sweep - it could not before (R6-1).
			unreadable += 1;
		} else if (pids.length > 0) {
			held += 1;
		} else {
			try {
				rmSync(root, { recursive: true, force: true, maxRetries: 5 });
				removed.push(name);
			} catch {
				// Left for a later run: a sweep that cannot remove something must
				// never be the thing that fails the run about to start.
			}
		}
	}
	if (removed.length || held || unreadable)
		console.log(
			`  stale config trees: removed ${removed.length}${removed.length ? ` (${removed.join(", ")})` : ""}, left ${held} held by a live process, ${unreadable} whose census could not be read, ${recent} too recent to judge`,
		);
}

// Runs at import, before any test - and therefore before this run creates any
// tree of its own, so it can only ever see a predecessor's.
sweepStaleRoots();

/**
 * R6-1: the sweep deletes only on a census that ANSWERED.
 *
 * Driven through the real `sweepStaleRoots` and the real `pidsHoldingConfigDir`
 * with a `ps` this process cannot get an answer out of, because the defect it
 * pins is a read failure being read as a fact: `held == 0` was reached from
 * "the table could not be read" exactly as from "nobody holds this", and the
 * log line could not tell them apart either.
 *
 * The positive control is the load-bearing half. Without it, a sweep that
 * silently stopped matching anything - a renamed prefix, a `readdir` that found
 * none - would pass the first assertion for the wrong reason, which is the same
 * class of vacuous green the finding is about.
 */
test("R6-1: an unreadable census cannot authorise a removal", async (t) => {
	const stale = await mkdtemp(join(tmpdir(), CONFIG_DIR_PREFIX));
	// Aged well past the floor, so the ONLY thing that can spare it is the census.
	const old = new Date(Date.now() - STALE_ROOT_MIN_AGE_MS * 10);
	await utimes(stale, old, old);

	const shim = await mkdtemp(join(tmpdir(), "lo-census-shim-"));
	const realPath = process.env.PATH;
	await writeFile(join(shim, "ps"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
	t.after(async () => {
		process.env.PATH = realPath;
		await rm(shim, { recursive: true, force: true });
		await rm(stale, { recursive: true, force: true });
	});

	process.env.PATH = `${shim}:${realPath}`;
	assert.equal(
		censusSaysUnheld(stale),
		false,
		"a failure to read the table is not a census that found nobody",
	);
	sweepStaleRoots();
	assert.ok(
		existsSync(stale),
		"the sweep removed a root whose holders it could not read",
	);

	// Positive control: the same root, the same sweep, a `ps` that answers.
	process.env.PATH = realPath;
	sweepStaleRoots();
	assert.equal(
		existsSync(stale),
		false,
		"the sweep no longer reaps a stale unheld root at all",
	);
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
	const root = await mkdtemp(join(tmpdir(), CONFIG_DIR_PREFIX));
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
import os, shutil, signal, subprocess, sys, threading, time

# The backend gets its OWN session, so the server and anything still in its
# group are reachable as one unit from here.
#
# The root to remove from the death path at the bottom of this file. Read from
# the environment we were given rather than passed as an argument, because it is
# the same value the backend is started with - one source, so the two cannot
# drift apart.
root = os.environ.get("LOCAL_OPERATOR_CONFIG_DIR", "")

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


def holders_of(root):
    # The SAME rule the harness's own census uses: a pid holds this root iff
    # the token LOCAL_OPERATOR_CONFIG_DIR=<root> is an exact
    # whitespace-delimited token in its ENVIRONMENT. 'ps eww' prints argv and
    # the environment concatenated, so argv is read separately and subtracted -
    # a process that merely names the path on its command line is not a holder
    # and must not be signalled. Ourselves excluded: this guardian inherited the
    # root in its own environment and would otherwise signal itself before it
    # had finished.
    marker = "LOCAL_OPERATOR_CONFIG_DIR=" + root

    def ps(args):
        try:
            return subprocess.run(["ps"] + args, capture_output=True, text=True).stdout
        except Exception:
            return ""

    # -A, not -ax: the same rule the JS census above states, spelled so it works
    # on both ps flavours. procps refuses -x without a personality, and a refusal
    # here is silent (ps() returns an empty string), which read as "no holders" -
    # so on Linux this census could not see a holder even when one held the root.
    argv = {}
    for line in ps(["-A", "-o", "pid=,command="]).split("\\n"):
        parts = line.split(None, 1)
        if len(parts) == 2 and parts[0].isdigit():
            argv[parts[0]] = parts[1]
    found = []
    for line in ps(["eww", "-A", "-o", "pid=,command="]).split("\\n"):
        parts = line.split(None, 1)
        if len(parts) != 2 or not parts[0].isdigit() or marker not in parts[1]:
            continue
        pid, full = parts
        solo = argv.get(pid)
        if solo is None or int(pid) == os.getpid():
            continue
        region = full[len(solo):] if full.startswith(solo) else full
        if marker in region.split():
            found.append(int(pid))
    return found


def guardian():
    # THE CASE NEITHER OTHER TRIGGER COVERS: this supervisor being SIGKILLed
    # while the file that spawned it is still alive. No handler runs, no EOF is
    # produced, and the parent-poll thread below dies with us - so the backend
    # is reparented and keeps serving. Measured: one surviving server per
    # cancelled run.
    #
    # The guardian is forked into its OWN session, so it outlives this
    # supervisor by construction, and it polls for the supervisor's
    # disappearance rather than relying on being signalled.
    #
    # LIVENESS BY REPARENTING, NOT BY os.kill(sup, 0). kill(pid, 0) succeeds on
    # a ZOMBIE - a supervisor that is dead but not yet reaped still answers it -
    # so that check stayed blind for as long as the zombie lasted (measured: the
    # backend and this guardian still alive 30 s after the supervisor died, with
    # the backend still serving). getppid() changes the instant the parent dies,
    # because the kernel reparents us during exit() and before any reaping, so
    # the 0.5 s poll is a real bound rather than an aspiration.
    #
    # IT ALSO REMOVES THE CONFIG TREE, which is the one artefact nothing else
    # can reach: on a SIGKILLed or timeout-killed run the file process never
    # runs its cleanup, so there is no in-file sweep left to do it. It removes
    # exactly the root this run was given - never a prefix, never a pattern,
    # never anything it was not handed in its own environment.
    #
    # WHY IT REAPS AND RETRIES RATHER THAN REMOVING ONCE. The group kill above
    # reaches the SERVER, and that is all it reaches: the session runtimes are
    # deliberately in their own sessions (start_new_session=True) so that a
    # group kill here cannot take them out, and they die a few seconds later,
    # when the server they belong to is gone. Measured on this host: a runtime
    # kept writing for ~6 s after the kill, re-created the tree a single rmtree
    # had already removed, and left an empty directory standing with nothing
    # holding it. So the tree is only gone once nothing that can write to it is
    # alive, which means killing what still holds it and confirming the result
    # - the same reap-then-remove-then-verify shape the harness's own sweep
    # uses, and the same holder rule.
    sup = os.getpid()
    if os.fork() != 0:
        return
    os.setsid()
    start_ppid = os.getppid()
    while True:
        time.sleep(0.5)
        if os.getppid() != start_ppid:
            try:
                os.killpg(os.getpgid(child.pid), signal.SIGKILL)
            except Exception:
                pass
            if root:
                deadline = time.time() + 30
                while time.time() < deadline:
                    for pid in holders_of(root):
                        try:
                            os.kill(pid, signal.SIGKILL)
                        except Exception:
                            pass
                    shutil.rmtree(root, ignore_errors=True)
                    time.sleep(0.25)
                    if not holders_of(root) and not os.path.exists(root):
                        break
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
			// The supervisor is a real interpreter, so its python variables are
			// stated rather than inherited (scripts/python-child-env.mjs) - an ambient
			// `PYTHONPYCACHEPREFIX` pointing inside an installed `.app` is how a
			// harness wrote a bytecode cache into one. The cache does NOT go under
			// `root`: that is this run's config directory, which the backend reads for
			// its serve records, so a harness has no business adding to it.
			env: pythonChildEnv({ base: isolatedEnv(root, token) }),
			// stdin is a PIPE and deliberately left open: it is the liveness
			// channel the supervisor waits on.
			stdio: ["pipe", "pipe", "pipe"],
			/*
			 * Deliberately NOT `detached`, and that is load-bearing rather than
			 * incidental: a detached child's stdin pipe was observed staying open
			 * after this process exited, so the supervisor's read never returned and
			 * the backend survived anyway. Verified both ways in isolation before
			 * settling here.
			 *
			 * So the supervisor shares THIS process's group, which is why nothing
			 * here can group-kill it (`process.kill(-pid)` would address our own
			 * group) and why `killGroup` signals the supervisor directly instead.
			 * The supervisor gives the BACKEND its own session, so a real `killpg`
			 * still reaches the server and anything it started, one level down.
			 *
			 * The group is what makes the sweep reliable rather than best-effort:
			 * the runtimes are `start_new_session=True` and leave even that group,
			 * which is exactly why the environment census exists as well. The two
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
	/*
	 * EVERYTHING THAT CAN THROW BEFORE THIS FUNCTION HANDS BACK A HANDLE RUNS
	 * INSIDE THIS `try`.
	 *
	 * The caller's `try/finally` covers the region AFTER `subscribe` returns; it
	 * cannot cover a throw from inside, because at that point there is no handle
	 * to close yet - and the socket is already open by the time the `open`-frame
	 * assert can fail, so the file hangs instead of failing (measured by review:
	 * no summary within 400 s). This is the residual half of RM4-1.
	 */
	try {
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
	} catch (error) {
		// No handle exists for the caller to close, so this is the only place the
		// socket can be released. Without it a failed subscribe takes the whole
		// run down with it rather than reporting the failure.
		controller.abort();
		throw error;
	}
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
