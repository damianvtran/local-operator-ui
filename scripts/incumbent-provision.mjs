import { spawn as nodeSpawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { MOCK_KEYCHAIN_SWITCH } from "./chrome-keychain.mjs";
import { TELEMETRY_ENV, TELEMETRY_OFF_VALUE } from "./telemetry-off.mjs";

const HEALTH = "http://127.0.0.1:1111/health";
const POLL_MS = 250;
const PROBE_MS = 1_000;
const BACKEND_READY_MS = 120_000;
// v0.57.8 src/main/backend/backend-installer.ts:103–108 documents one to
// five minutes for setup alone. Backend startup gets the verifier's existing
// 120 s health budget on top, rather than competing with installation.
const INSTALL_READY_MS = 5 * 60_000 + BACKEND_READY_MS;
const clock = () => performance.now();
export const ended = (child) =>
	child.exitCode !== null || child.signalCode !== null;
const describeExit = (child) =>
	child.signalCode ? `signal ${child.signalCode}` : `exit ${child.exitCode}`;

export function candidateReadiness(inheritedSelection) {
	return {
		// Preserve the previous combined selection + health allowance, but make
		// health the only readiness evidence, even if a rebuild is needed.
		firstBootMs: 600_000 + BACKEND_READY_MS,
		secondBootMs: BACKEND_READY_MS,
		selectionCaveat: inheritedSelection
			? "selection marker inherited before candidate boot; not evidence of candidate publication or runtime reuse"
			: "no inherited selection marker; runtime reuse was not verified",
	};
}

// One registry per verifier, also usable with an injected signal emitter in
// tests. A cancellation starts reaping immediately, not after a pending probe.
export function ownChildren(signalTarget = process) {
	const controller = new AbortController();
	const children = new Map();
	const { signal } = controller;
	const releaseAll = () =>
		Promise.allSettled([...children.values()].map((release) => release()));
	function cancel(name, code) {
		controller.abort(
			Object.assign(new Error(`cancelled by ${name}`), { exitCode: code }),
		);
		void releaseAll();
	}
	const interrupt = () => cancel("SIGINT", 130);
	const terminate = () => cancel("SIGTERM", 143);
	signalTarget.on("SIGINT", interrupt);
	signalTarget.on("SIGTERM", terminate);
	return {
		signal,
		track(
			child,
			{ now = clock, sleep = delay, term = 60_000, kill = 5_000 } = {},
		) {
			let pending;
			let cancelledAt;
			const reap = async () => {
				let termSentAt;
				async function wait(ms) {
					const deadline = now() + ms;
					while (!ended(child)) {
						const t = now();
						if (signal.aborted) cancelledAt ??= t;
						// Actions can send SIGTERM with only 2.5 s left. Allow at
						// most 1 s each for TERM and KILL, even mid-grace.
						const end = signal.aborted
							? Math.min(deadline, cancelledAt + 1_000)
							: deadline;
						if (t >= end) break;
						await sleep(Math.min(POLL_MS, end - t));
					}
					return ended(child);
				}
				// ChildProcess.kill targets only this child. `child.killed` means
				// a signal was sent, not that the exact PID was reaped.
				if (child.pid && !ended(child)) {
					const sendingAt = now();
					if (child.kill("SIGTERM")) termSentAt = sendingAt;
					if (!(await wait(term)) && !ended(child)) {
						child.kill("SIGKILL");
						cancelledAt = undefined;
						if (!(await wait(kill)))
							throw new Error(
								`owned PID ${child.pid} did not exit after SIGKILL`,
							);
					}
				}
				children.delete(child);
				return { termSentAt };
			};
			// Share the exact same cleanup promise across cancel and finally.
			const release = () => {
				pending ??= Promise.resolve().then(reap);
				return pending;
			};
			children.set(child, release);
			return release;
		},
		release: (child) => children.get(child)?.(),
		async close() {
			const results = await releaseAll();
			signalTarget.off("SIGINT", interrupt);
			signalTarget.off("SIGTERM", terminate);
			return results;
		},
	};
}

/**
 * Turn the pristine VM profile into an installed incumbent profile without
 * modifying the signed bundle. A clean install exit is not readiness (R4):
 * only an HTTP OK observed during this boot can advance the update proof.
 *
 * A pre-R4 incumbent closes its only setup window before starting the backend.
 * Headless mode quits on that close, so it cannot provision a pristine profile.
 * Inactive mode shows a never-focused window on the disposable VM, where the
 * isolation constraint is no writes to /Applications, not no windows. The
 * macOS non-headless lifecycle keeps the app alive between setup and backend
 * start. An older app that ignores the switch runs normally and can still
 * provision; there is no window-mode capability gate for this boot.
 */
export async function provisionIncumbent({
	tag,
	paths,
	env,
	spawn = nodeSpawn,
	fetch = globalThis.fetch,
	now = clock,
	sleep = delay,
	// In a non-cancelled run, give SIGTERM the incumbent's documented
	// shutdown budget (115 s at v0.57.8) before escalating.
	timeouts = { readiness: INSTALL_READY_MS, term: 120_000, kill: 5_000 },
	owned,
	signalTarget,
}) {
	const result = (verdict, detail) => ({
		verdict,
		detail: `${tag}: ${detail}`,
	});

	const registry = owned ?? ownChildren(signalTarget);
	const { signal } = registry;
	async function probe(ms = PROBE_MS) {
		try {
			const response = await fetch(HEALTH, {
				signal: AbortSignal.any([signal, AbortSignal.timeout(ms)]),
				redirect: "error",
			});
			const observedAt = now();
			// Only headers decide readiness; do not wait on a streaming body.
			void response.body?.cancel().catch(() => {});
			return response.ok ? { observedAt } : "not-ready";
		} catch (error) {
			return error.cause?.code === "ECONNREFUSED" ? "closed" : "not-ready";
		} finally {
			signal.throwIfAborted();
		}
	}

	let child;
	let release;
	let spawnError;
	let healthAt;
	let failure;
	try {
		signal.throwIfAborted();
		// A listener already in the VM is not the incumbent's. Fail closed on
		// ambiguous probes as well; never kill a process found by port.
		if ((await probe()) !== "closed")
			return result(
				"FAIL",
				`health port already answering or not verifiably closed at ${HEALTH}; no health attributed to the incumbent`,
			);
		signal.throwIfAborted();
		// Give both child descriptors the same append-only log. Unlike two
		// pipes sharing one stream, closing either descriptor cannot cut off
		// the other's output; there is no pipe to keep the parent alive.
		const log = openSync(paths.log, "a");
		try {
			child = spawn(
				paths.executable,
				["--window-mode=inactive", MOCK_KEYCHAIN_SWITCH],
				{
					env: { ...env, [TELEMETRY_ENV]: TELEMETRY_OFF_VALUE },
					stdio: ["ignore", log, log],
				},
			);
			release = registry.track(child, {
				now,
				sleep,
				term: timeouts.term,
				kill: timeouts.kill,
			});
			child.on("error", (error) => {
				spawnError = error;
			});
		} finally {
			closeSync(log);
		}

		const deadline = now() + timeouts.readiness;
		while (!spawnError && !ended(child) && now() < deadline) {
			signal.throwIfAborted();
			const remaining = Math.max(1, Math.ceil(deadline - now()));
			const response = await probe(Math.min(PROBE_MS, remaining));
			if (spawnError || ended(child)) break;
			if (response.observedAt < deadline) {
				healthAt = response.observedAt;
				break;
			}
			const pause = Math.min(POLL_MS, deadline - now());
			if (pause > 0) await sleep(pause);
		}
		signal.throwIfAborted();
		if (spawnError)
			throw new Error(
				`could not spawn incumbent: ${spawnError.message}; no health observed`,
			);
		if (ended(child))
			throw new Error(
				`incumbent exited before readiness was confirmed (${describeExit(child)}); no health seen`,
			);
		if (healthAt === undefined)
			throw new Error(
				`readiness timed out after ${timeouts.readiness} ms; no health observed at ${HEALTH}`,
			);

		// No natural-exit grace: the OK must come from a live incumbent, and
		// we must successfully initiate its shutdown before it exits.
		const { termSentAt } = await release();
		signal.throwIfAborted();
		if (termSentAt === undefined || termSentAt < healthAt)
			throw new Error(
				`incumbent exited before readiness was confirmed (${describeExit(child)})`,
			);
		// A leftover backend could falsely satisfy the candidate's later probe.
		if ((await probe()) !== "closed")
			throw new Error(
				`HTTP OK observed, but ${HEALTH} was not verifiably closed after the incumbent ended (${describeExit(child)})`,
			);
	} catch (error) {
		failure = error.message;
	} finally {
		try {
			await release?.();
		} catch (error) {
			if (failure !== error.message)
				failure = [failure, error.message].filter(Boolean).join("; ");
		} finally {
			if (!owned) await registry.close();
		}
	}
	if (signal.aborted && !failure?.includes(signal.reason.message))
		failure = [signal.reason.message, failure].filter(Boolean).join("; ");
	return failure
		? result("FAIL", failure)
		: result(
				"PASS",
				`HTTP OK observed at ${HEALTH}; incumbent ended (${describeExit(child)})`,
			);
}
