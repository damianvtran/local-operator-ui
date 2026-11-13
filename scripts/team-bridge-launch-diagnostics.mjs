/**
 * KEEP WHAT A FAILED BENCH LAUNCH LEFT BEHIND, before the scratch reap destroys it.
 *
 * WHY THIS EXISTS (QA round 2, finding Q2-1 on ui#1889). The instant-load timing
 * run died in `waitForTarget` after its 90 s budget with "no application target yet
 * (0 page targets)", and the bench then removed its scratch directory - the app's
 * stdout/stderr, its log directory and the Electron profile all went with it. With
 * nothing left, "slow under machine load" could not be told apart from "the app
 * crashed" or "the app refused to start", and the next attempt would have been a
 * blind retry. This module copies the evidence OUT of the scratch first, and names
 * which of those three cases is knowable from it.
 *
 * CONSTRAINTS.
 * - It never changes the bench's timing: the 90 s budget stays where it is (no new
 *   timeout without a measured distribution). The only waits here are the two
 *   bounded probes of the CDP endpoint AT FAILURE TIME, after the budget expired.
 * - No secrets. The child's environment is never written: the command line is the
 *   argv only, and the environment is recorded as key NAMES the bench set, never
 *   values. The scratch `config/` tree (daemon discovery records, claim material)
 *   is NOT copied - only log directories and crash reports.
 * - It must never turn a launch failure into a different failure: every step is
 *   best-effort and the caller rethrows the ORIGINAL error afterwards.
 * - The process-group teardown is not this module's: the caller still runs its
 *   own reap, unchanged, after this returns.
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * Where diagnostics go when `--diagnostics` is not passed: beside the `--json`
 * report (the place a person already looks for this run's output), else directly
 * under the scratch ROOT - never inside the per-run scratch subdirectory, which the
 * bench reaps.
 * Run-unique by timestamp and pid so a retry never overwrites the last failure.
 */
export function diagnosticsDir({ explicit, jsonOut, scratchRoot, now, pid }) {
	if (explicit) return resolve(explicit);
	const name = `launch-diagnostics-${now}-${pid}`;
	return jsonOut
		? join(dirname(resolve(jsonOut)), name)
		: join(resolve(scratchRoot), name);
}

/** One bounded GET of the DevTools endpoint; `null` body when it did not answer. */
async function probe(port, path) {
	if (!port) return { ok: false, error: "no CDP port was allocated" };
	try {
		const response = await fetch(`http://127.0.0.1:${port}${path}`, {
			signal: AbortSignal.timeout(3_000),
		});
		return { ok: true, status: response.status, body: await response.text() };
	} catch (error) {
		return { ok: false, error: String(error?.cause?.code ?? error) };
	}
}

/**
 * What is KNOWABLE about the failure, in the order that decides it: a child that
 * exited is a crash or refusal whatever the endpoint said; a running child whose
 * endpoint answers with no app page is "up but the renderer never loaded" (slow or
 * stuck); a running child whose endpoint never answers is "Electron never got as far
 * as DevTools".
 */
export function classify({ exit, list }) {
	// A failure before the spawn (no build, stub could not listen) has no child to
	// describe; calling it "still running" would send the reader after a process.
	if (!exit)
		return {
			kind: "never-launched",
			text: "the app was never spawned (failed before launch)",
		};
	if (exit && (exit.code !== null || exit.signal !== null))
		return {
			kind: "child-exited",
			text: `child exited (code=${exit.code} signal=${exit.signal})`,
		};
	if (list?.ok) {
		let pages = null;
		try {
			pages = JSON.parse(list.body).filter(
				(target) => target.type === "page",
			).length;
		} catch {
			// an answer that is not the target list is still an answer
		}
		return {
			kind: "running-no-target",
			text: `child still running, endpoint answered with ${pages ?? "unparseable"} page targets`,
		};
	}
	return {
		kind: "endpoint-silent",
		text: `child still running, CDP endpoint never answered (${list?.error ?? "not probed"})`,
	};
}

/**
 * Copy the failure's evidence into `dir` and return `{ dir, classification, line }`.
 *
 * `app` is the bench's launch record: `{ child, userData, stdout(), stderr(),
 * argv, envKeys }`. `scratch` is the per-run directory the caller will reap next.
 */
export async function preserveLaunchDiagnostics({
	dir,
	app,
	scratch,
	port,
	error,
	startedAt,
	phase,
}) {
	mkdirSync(dir, { recursive: true });
	const write = (name, text) => {
		try {
			writeFileSync(join(dir, name), text ?? "");
		} catch {
			// best-effort: the next file may still land
		}
	};
	const child = app?.child ?? null;
	const exit = child
		? { pid: child.pid, code: child.exitCode, signal: child.signalCode }
		: null;
	const [list, version] = await Promise.all([
		probe(port, "/json/list"),
		probe(port, "/json/version"),
	]);
	const classification = classify({ exit, list });
	const uptime = spawnSync("uptime", { encoding: "utf8" });

	write("stdout.log", app?.stdout?.() ?? "");
	write("stderr.log", app?.stderr?.() ?? "");
	write(
		"cdp-json-list.txt",
		list.ok ? list.body : `NO ANSWER: ${list.error}\n`,
	);
	write(
		"cdp-json-version.txt",
		version.ok ? version.body : `NO ANSWER: ${version.error}\n`,
	);

	/*
	 * Log directories and crash reports only. `config/` is deliberately absent: it
	 * holds the daemon discovery record and claim material, which are credentials
	 * for the stub this run spoke to.
	 */
	const copied = [];
	const candidates = [
		["logs", scratch && join(scratch, "logs")],
		["profile-logs", app?.userData && join(app.userData, "logs")],
		["crashpad", app?.userData && join(app.userData, "Crashpad")],
	];
	for (const [name, source] of candidates) {
		if (!source || !existsSync(source)) continue;
		try {
			cpSync(source, join(dir, name), { recursive: true });
			copied.push(name);
		} catch (copyError) {
			copied.push(`${name} (copy failed: ${String(copyError)})`);
		}
	}

	const summary = {
		phase,
		error: String(error?.message ?? error),
		classification,
		exit,
		elapsedMs: startedAt ? Date.now() - startedAt : null,
		uptime: (uptime.stdout ?? "").trim() || null,
		loadavg: loadavg(),
		cdpPort: port ?? null,
		// argv only; the environment is NAMES, never values (it can carry tokens).
		command: app?.argv ?? null,
		envKeysSet: app?.envKeys ?? null,
		copied,
		at: new Date().toISOString(),
	};
	write("summary.json", `${JSON.stringify(summary, null, 2)}\n`);

	const line = `team-bridge-bench: launch failed during ${phase} - ${classification.text}; diagnostics kept at ${dir}`;
	return { dir, classification, line, summary };
}
