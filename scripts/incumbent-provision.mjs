import { spawn as nodeSpawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { posix } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { MOCK_KEYCHAIN_SWITCH } from "./chrome-keychain.mjs";
import { TELEMETRY_ENV, TELEMETRY_OFF_VALUE } from "./telemetry-off.mjs";

const HEALTH = "http://127.0.0.1:1111/health";
const POLL_MS = 250;
const PROBE_MS = 1_000;
const ended = (child) => child.exitCode !== null || child.signalCode !== null;
const describeExit = (child) =>
	child.signalCode ? `signal ${child.signalCode}` : `exit ${child.exitCode}`;

/**
 * Read the original signed entry point, not the checkout or a version cutoff.
 * Electron can ignore an unrecognized switch; trying it to discover support
 * could boot an older app in normal window mode. These are the bundled main
 * process's flag and launch diagnostics, not evidence that a backend started.
 */
export function headlessRefusal(asar, extractFile) {
	try {
		const { main } = JSON.parse(extractFile(asar, "package.json").toString());
		const mainPath = main.startsWith("./") ? main.slice(2) : main;
		let entry = extractFile(asar, mainPath);
		// Published desktop builds use electron-vite's JS shim to require the
		// adjacent V8 bytecode. The unprotected ASCII literals live in that
		// payload, not in the shim; read it but never execute it for capability.
		if (
			entry.includes("bytecode-loader.cjs") &&
			entry.includes(`require("./${posix.basename(mainPath)}c")`)
		)
			entry = extractFile(asar, `${mainPath}c`);
		if (
			![
				"--window-mode",
				"LOCAL_OPERATOR_UI_WINDOW_MODE",
				"[window-mode]",
			].every((marker) => entry.includes(marker))
		)
			return "signed main entry lacks --window-mode support";
		return null;
	} catch (error) {
		return `could not establish --window-mode support from the signed app: ${error.message}`;
	}
}

/**
 * Turn the pristine VM profile into an installed incumbent profile without
 * modifying the signed bundle. A clean install exit is not readiness (R4):
 * only an HTTP OK observed during this boot can advance the update proof.
 */
export async function provisionIncumbent({
	tag,
	paths,
	env,
	checkHeadless,
	spawn = nodeSpawn,
	fetch = globalThis.fetch,
	now = () => performance.now(),
	sleep = delay,
	// Give SIGTERM the incumbent's own documented shutdown budget (115 s
	// at v0.57.8) before escalating; exit is the grace before asking it to quit.
	timeouts = { readiness: 180_000, exit: 5_000, term: 120_000, kill: 5_000 },
}) {
	const result = (verdict, detail) => ({
		verdict,
		detail: `${tag}: ${detail}`,
	});
	const refusal = checkHeadless();
	if (refusal) return result("BLOCKED", refusal);

	async function probe(ms = PROBE_MS) {
		try {
			const response = await fetch(HEALTH, {
				signal: AbortSignal.timeout(ms),
				redirect: "error",
			});
			const ok = response.ok;
			// Only headers decide readiness; do not leave streaming bodies open.
			await response.body?.cancel();
			return ok ? "ok" : "not-ready";
		} catch (error) {
			return error.cause?.code === "ECONNREFUSED" ? "closed" : "not-ready";
		}
	}

	// An answer from a listener already in the VM is not the incumbent's. Fail
	// closed on ambiguous probes as well; never kill a process found by port.
	if ((await probe()) !== "closed")
		return result(
			"FAIL",
			`health port already answering or not verifiably closed at ${HEALTH}; no health attributed to the incumbent`,
		);

	let child;
	let spawnError;
	let failure;
	let healthy = false;
	async function waitForExit(ms) {
		const deadline = now() + ms;
		while (!ended(child) && now() < deadline)
			await sleep(Math.min(POLL_MS, deadline - now()));
		return ended(child);
	}

	try {
		// Give both child descriptors the same append-only log. Unlike two
		// pipes sharing one stream, closing either descriptor cannot cut off
		// the other's output; there is no pipe to keep the parent alive.
		const log = openSync(paths.log, "a");
		try {
			child = spawn(
				paths.executable,
				["--window-mode=headless", MOCK_KEYCHAIN_SWITCH],
				{
					env: { ...env, [TELEMETRY_ENV]: TELEMETRY_OFF_VALUE },
					stdio: ["ignore", log, log],
				},
			);
			child.on("error", (error) => {
				spawnError = error;
			});
		} finally {
			closeSync(log);
		}

		const deadline = now() + timeouts.readiness;
		while (!spawnError && !ended(child) && now() < deadline) {
			const remaining = Math.max(1, Math.ceil(deadline - now()));
			healthy = (await probe(Math.min(PROBE_MS, remaining))) === "ok";
			if (healthy) break;
			const pause = Math.min(POLL_MS, deadline - now());
			if (!spawnError && !ended(child) && pause > 0) await sleep(pause);
		}
		if (healthy) await waitForExit(timeouts.exit);
		else if (spawnError)
			failure = `could not spawn incumbent: ${spawnError.message}; no health observed`;
		else if (ended(child))
			failure = `incumbent ended (${describeExit(child)}); no health observed`;
		else
			failure = `readiness timed out after ${timeouts.readiness} ms; no health observed at ${HEALTH}`;
	} catch (error) {
		failure = `${error.message}; ${healthy ? "health was observed" : "no health observed"}`;
	} finally {
		if (child?.pid && !ended(child)) {
			// ChildProcess.kill targets this exact PID. `killed` only says a
			// signal was sent; exitCode/signalCode say the child was reaped.
			child.kill("SIGTERM");
			if (!(await waitForExit(timeouts.term))) {
				child.kill("SIGKILL");
				if (!(await waitForExit(timeouts.kill)))
					failure = `${failure ? `${failure}; ` : ""}owned PID ${child.pid} did not exit after SIGKILL (${healthy ? "health was observed" : "no health observed"})`;
			}
		}
	}

	if (failure) return result("FAIL", failure);
	// A leftover backend could falsely satisfy the candidate's later probe.
	if ((await probe()) !== "closed")
		return result(
			"FAIL",
			`HTTP OK observed, but ${HEALTH} was not verifiably closed after the incumbent ended (${describeExit(child)})`,
		);
	return result(
		"PASS",
		`HTTP OK observed at ${HEALTH}; incumbent ended (${describeExit(child)})`,
	);
}
