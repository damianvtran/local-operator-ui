#!/usr/bin/env node
/**
 * The memory bound `pnpm test:desktop` runs under: a watchdog over the whole
 * process group of the `node --test` child, and the arithmetic that sizes it.
 *
 * WHY THIS EXISTS. On 2026-09-30 a `node --test` run (parent: `timeout 900 …`)
 * grew to a ~198 GB owned footprint while `ps` RSS read ~1.4 GB. Swap pegged at
 * 22.9/24.5 GB, about twelve agent sessions died within minutes, and an operator
 * killed the tree by hand. Nothing automated bit: `timeout` bounds wall clock,
 * not memory; node's test children inherit no heap cap; and `desktop-test-
 * concurrency.mjs` caps the NUMBER of workers, not what one of them may hold.
 * This runner is the one choke point every `pnpm test:desktop` already goes
 * through, so the bound lives here rather than in each caller's shell.
 *
 * WHAT IS MEASURED, AND WHY RSS ALONE IS THE WRONG SIGNAL. macOS keeps a
 * process's dirty pages in the compressor or swap under pressure. `ps` RSS counts
 * only what is resident right now; `ri_phys_footprint` (what Activity Monitor,
 * `top` and `/usr/bin/footprint` report) counts the owned dirty set at LOGICAL
 * size. Measured on this host with node holding 4,096 MB of Buffers: RSS read
 * 37 MB-2,498 MB across samples while the footprint read 4,113 MB on every one.
 * A guard keyed on RSS is therefore structurally blind to exactly the incident
 * class, which is the failure this file exists to close. So each member is
 * charged `max(footprint, rss)`: footprint where the platform can provide it
 * (macOS), RSS as the always-available floor (and the only arm on Linux, where
 * RSS has no compressor to hide behind).
 *
 * THE PROBE. Measured on the 14-core / 36 GB host, 2026-09-30, load 14-70:
 *
 *   /usr/bin/footprint --noCategories -f bytes -p … (one exec, N pids)
 *     1 pid 0.31 s wall / 0.03 s cpu;  5 pids 0.31 / 0.13;  12 pids 0.37 / 0.32;
 *     25 pids 0.55 / 0.53
 *   ps -axo pid=,ppid=,pgid=,rss=       0.30-0.41 s wall / 0.06 s cpu
 *
 * and, from the resource-guards lane's evidence, the same `ps` read took up to
 * 13.6 s (mean 3.5 s) on this fleet at its worst. Two consequences drive the
 * shape below:
 *
 *  - CADENCE is 2 s between the END of one tick and the start of the next. A
 *    suite tree is 5-28 processes, so a tick costs ~0.4-0.6 s of cpu, i.e.
 *    roughly 10-15% of ONE core of a 14-core host while the suite runs — and
 *    never overlaps itself (the next tick is armed only when this one settles),
 *    so a slow probe makes the watchdog sparser, not heavier. Touching memory
 *    measured 4.9 GB/s on this host, so the worst case between samples is a
 *    ~10 GB overshoot of the budget; the incident grew over minutes. A faster
 *    cadence would spend more cpu than the suite's own headroom for a risk the
 *    budget's margin already absorbs.
 *  - THE WATCHDOG MUST NEVER BE WHAT WEDGES A RUN. Both probes are ASYNC with a
 *    hard timeout (8 s, SIGKILL) so the runner's event loop — signal forwarding,
 *    child-exit handling — is never blocked behind a starved `ps`. A probe that
 *    fails or times out SKIPS THE TICK: unknown never kills, because killing on
 *    "could not read" would turn a busy host into a flaky suite. Only a
 *    SUCCESSFUL reading at or over the budget kills. After `_BLIND_TICKS_WARN`
 *    consecutive skipped ticks (~10+ s) one stderr line says the run is
 *    currently unbounded, so a blind watchdog is visible rather than silent.
 *    When only the membership read fails, the leader's own footprint is still
 *    probed (the pid we spawned is ours; no table needed) before the tick is
 *    skipped.
 *
 * WHAT IS THE GROUP. The child is spawned `detached`, so it leads its own process
 * group and every descendant that does not call setsid shares it. Descendants
 * that DO leave the group (a rig launching Electron `detached: true`) are found
 * by walking `ppid` from the leader in the same table read, and are counted and
 * killed too. Orphans already re-parented to launchd are out of reach and are
 * not claimed.
 *
 * KILL. The whole group gets SIGKILL (never a bare pid, never the runner's own
 * group) plus each out-of-group descendant by pid. SIGKILL rather than SIGTERM
 * because a process that has already reached the budget is, by the numbers this
 * file was built on, swapping the host; a graceful shutdown that allocates more
 * is the wrong trade. One loud line names the leader, the measured footprint and
 * the budget, and the runner exits 137 (128 + SIGKILL): non-zero so no caller
 * reads a killed suite as green.
 *
 * WHY NO `--max-old-space-size`. Evaluated and NOT added. Measured on node
 * 26.5.0 here: a child run with `--max-old-space-size=128` still held 1,536 MB
 * of Buffers (`heapUsed` 3 MB, `external` 1,612 MB) and exited 0 — the flag
 * bounds the V8 JS heap only, and Buffers/ArrayBuffers live outside it. The JS
 * heap's own default limit is already ~4,192 MB on this host (it scales with
 * system memory), so a flag would only matter in a band the watchdog already
 * covers. It cannot catch the class that matters and adds a second knob that
 * can constrain legitimately heavy files, so the watchdog is the one net.
 */

import { execFile } from "node:child_process";
import { totalmem } from "node:os";

/** `off` disables the watchdog (announced loudly); a positive whole number of MB
 * replaces the derived budget. Mirrors `LOCAL_OPERATOR_UI_TEST_CONCURRENCY`:
 * honoured unclamped, because an override that is silently re-clamped is a
 * hatch that does not open. */
export const MEMORY_BUDGET_OVERRIDE_ENV =
	"LOCAL_OPERATOR_UI_TEST_MEMORY_BUDGET_MB";

/**
 * Fraction of PHYSICAL RAM the suite tree may own before it is killed.
 *
 * Total, not available — deliberately unlike the concurrency governor, which
 * sizes a politeness share out of what is free. A kill threshold derived from
 * available memory moves with whatever the fleet is doing: on this host
 * "available" swings 4-6 GB minute to minute, so a budget of half of it would
 * kill a legitimate 1.2 GB suite on a bad minute. A budget that can flake a
 * correct run teaches people to turn it off, which is worse than no bound.
 */
export const _TOTAL_SHARE = 0.25;

/** Floor, MB. The current suite peaks around 1.2 GB across its tree (see
 * `desktop-test-concurrency.mjs`); 6 GB is five times that, so a legitimately
 * heavy new file has room and a runaway — the incident's was 198 GB — trips with
 * orders of magnitude to spare. */
export const _BUDGET_FLOOR_MB = 6144;

/** Ceiling as a fraction of physical RAM, so a small host's floor cannot exceed
 * what the machine can actually give (the floor alone would be 75% of an 8 GB
 * box). */
export const _BUDGET_CEILING_SHARE = 0.5;

/** Milliseconds between the end of one tick and the start of the next. See the
 * THE PROBE section for the cost this was chosen against. */
export const _TICK_INTERVAL_MS = 2000;

/** Per-probe timeout. Above the 5 s the per-command guard uses because the
 * measured worst `ps` read here was 13.6 s; a probe that still has not answered
 * is killed and the tick skipped. */
export const _PROBE_TIMEOUT_MS = 8000;

/** Consecutive skipped ticks before the one "blind" warning. */
export const _BLIND_TICKS_WARN = 5;

/** Most pids handed to one `footprint` exec. Members beyond it (by RSS, largest
 * first are probed) keep their RSS charge. A suite tree is 5-28 processes; this
 * only bounds argv for a pathological one. */
export const _MAX_FOOTPRINT_PIDS = 128;

/** Exit status when the watchdog ends a run: 128 + SIGKILL, the shell's own
 * spelling of "killed", and non-zero for every caller. */
export const BREACH_EXIT_CODE = 137;

const MB = 1024 * 1024;
const TABLE_LINE = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/;
const FOOTPRINT_LINE =
	/\[(\d+)\]:\s+\d+-bit\s+Footprint:\s+([\d.]+)\s*(B|KB|MB|GB|bytes)?\b/;
const UNIT_BYTES = { B: 1, bytes: 1, KB: 1024, MB: MB, GB: 1024 * MB };
const WHITESPACE = /\s+/;

/** `NNN MB` / `N.N GB`, for the one line a human reads. */
function human(bytes) {
	const mb = bytes / MB;
	return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/**
 * PURE. The budget in MB, from the inputs behind it.
 *
 * Returns `{ budgetMb, arm, totalMb }`. `arm` is `override`, `off`, `derived` or
 * `fallback` (physical RAM unmeasurable: the floor, since an unknown host must
 * still be bounded). There is deliberately NO CI arm: the watchdog stays active
 * on CI at the same budget. A hosted runner is dedicated, so a runaway there
 * costs the job's 35-minute timeout plus an OOM-killer death with no message;
 * the watchdog turns it into a named failure in seconds. The false-positive
 * cost is what the governor stood down for, and it is nil here — 6 GB is five
 * times the suite's measured peak and the floor is the budget on a 16 GB runner
 * (max(6,144, 4,096) capped at 8,192).
 */
export function computeMemoryBudget({ totalMb = null, override = null }) {
	const text =
		override === null || override === undefined ? "" : String(override).trim();
	if (text.toLowerCase() === "off") {
		return { budgetMb: null, arm: "off", totalMb };
	}
	if (text !== "") {
		const value = Number.parseInt(text, 10);
		// `parseInt` reads "4abc" as 4; both that and 0 are typos, not budgets.
		if (Number.isInteger(value) && value >= 1 && String(value) === text) {
			return { budgetMb: value, arm: "override", totalMb };
		}
		console.warn(
			`${MEMORY_BUDGET_OVERRIDE_ENV} is not a positive whole number of MB or "off": ${text}. Ignoring it.`,
		);
	}
	if (!(Number.isFinite(totalMb) && totalMb > 0)) {
		return { budgetMb: _BUDGET_FLOOR_MB, arm: "fallback", totalMb: null };
	}
	const derived = Math.max(
		_BUDGET_FLOOR_MB,
		Math.floor(totalMb * _TOTAL_SHARE),
	);
	const ceiling = Math.floor(totalMb * _BUDGET_CEILING_SHARE);
	return { budgetMb: Math.min(derived, ceiling), arm: "derived", totalMb };
}

/** Measure this machine and decide. Never throws: a budget that cannot be
 * computed must not stop a suite from starting. */
export function resolveMemoryBudget() {
	try {
		const bytes = totalmem();
		return computeMemoryBudget({
			totalMb:
				Number.isFinite(bytes) && bytes > 0 ? Math.trunc(bytes / MB) : null,
			override: process.env[MEMORY_BUDGET_OVERRIDE_ENV] ?? null,
		});
	} catch {
		return { budgetMb: _BUDGET_FLOOR_MB, arm: "fallback", totalMb: null };
	}
}

/** The evidence line printed once at start, so a reviewer reads what bound the
 * run instead of trusting it. */
export function formatMemoryBudgetLine(decision) {
	if (decision.arm === "off") {
		return `desktop tests: WARNING — memory watchdog OFF (${MEMORY_BUDGET_OVERRIDE_ENV}=off); a runaway test process will NOT be killed`;
	}
	const why =
		decision.arm === "override"
			? `explicit ${MEMORY_BUDGET_OVERRIDE_ENV}`
			: decision.arm === "fallback"
				? "physical memory not measurable; floor"
				: `max(${_BUDGET_FLOOR_MB} MB floor, ${_TOTAL_SHARE * 100}% of ${decision.totalMb} MB RAM), capped at ${_BUDGET_CEILING_SHARE * 100}%`;
	return `desktop tests: memory bound ${human(decision.budgetMb * MB)} for the test process group (${why}); sampled every ${_TICK_INTERVAL_MS / 1000}s on max(footprint, rss)`;
}

/** PURE. `ps -axo pid=,ppid=,pgid=,rss=` text -> rows (rss in BYTES). Lines that
 * do not parse are dropped: a half-read table must not invent a member. */
export function parseProcessTable(text) {
	const rows = [];
	for (const line of String(text ?? "").split("\n")) {
		const match = TABLE_LINE.exec(line);
		if (match === null) continue;
		rows.push({
			pid: Number(match[1]),
			ppid: Number(match[2]),
			pgid: Number(match[3]),
			rssBytes: Number(match[4]) * 1024,
		});
	}
	return rows;
}

/**
 * PURE. The leader's group plus every descendant reached through `ppid`.
 *
 * Both arms are needed: the group alone misses a descendant that called setsid
 * (an Electron launched `detached`), and the ppid walk alone misses a member
 * whose parent already exited but which stayed in the group.
 */
export function selectMembers(rows, leaderPid) {
	const members = new Map();
	for (const row of rows) {
		if (row.pgid === leaderPid || row.pid === leaderPid)
			members.set(row.pid, row);
	}
	const children = new Map();
	for (const row of rows) {
		if (!children.has(row.ppid)) children.set(row.ppid, []);
		children.get(row.ppid).push(row);
	}
	const queue = [leaderPid];
	while (queue.length > 0) {
		const parent = queue.pop();
		for (const row of children.get(parent) ?? []) {
			if (members.has(row.pid) && row.pid !== leaderPid) {
				// Already counted through the group arm; still walk below it.
				queue.push(row.pid);
				continue;
			}
			if (row.pid === leaderPid) continue;
			members.set(row.pid, row);
			queue.push(row.pid);
		}
	}
	return [...members.values()];
}

/** PURE. `footprint --noCategories -f bytes` text -> Map(pid -> bytes). A pid
 * that vanished prints an error line and no header, so it is simply absent. */
export function parseFootprintBytes(text) {
	const out = new Map();
	for (const line of String(text ?? "").split("\n")) {
		const match = FOOTPRINT_LINE.exec(line);
		if (match === null) continue;
		const factor = UNIT_BYTES[match[3] ?? "B"] ?? 1;
		out.set(Number(match[1]), Math.round(Number(match[2]) * factor));
	}
	return out;
}

/**
 * PURE. Charge every member `max(footprint, rss)` and sum.
 *
 * A member with no footprint reading (vanished between the two probes, or past
 * `_MAX_FOOTPRINT_PIDS`, or a platform with no footprint) keeps its RSS — the
 * lower bound — rather than dropping out of the sum.
 */
export function totalMemory(members, footprints) {
	let total = 0;
	let footprintTotal = 0;
	let rssTotal = 0;
	for (const member of members) {
		const fp = footprints.get(member.pid) ?? 0;
		total += Math.max(fp, member.rssBytes);
		footprintTotal += fp;
		rssTotal += member.rssBytes;
	}
	return {
		totalBytes: total,
		footprintBytes: footprintTotal,
		rssBytes: rssTotal,
	};
}

/** Run a command to completion with a hard timeout; resolve its stdout, or
 * `null` on any failure. Never rejects, never blocks the event loop. */
export function runProbe(command, args, timeoutMs = _PROBE_TIMEOUT_MS) {
	return new Promise((resolve) => {
		try {
			execFile(
				command,
				args,
				{
					encoding: "utf8",
					timeout: timeoutMs,
					killSignal: "SIGKILL",
					maxBuffer: 8 * MB,
				},
				(error, stdout) => {
					// `footprint` exits non-zero when ANY listed pid has vanished
					// but still prints the rest; keep whatever it produced.
					resolve(error && !stdout ? null : String(stdout ?? ""));
				},
			);
		} catch {
			resolve(null);
		}
	});
}

/**
 * One reading of the group, or `null` when nothing could be read.
 *
 * `run` and `platform` are injectable so the failure shapes (starved `ps`,
 * vanished pid, no footprint tool) are tested against canned output instead of
 * the host.
 */
export async function sampleGroup(
	leaderPid,
	{ run = runProbe, platform = process.platform } = {},
) {
	const tableText = await run("ps", ["-axo", "pid=,ppid=,pgid=,rss="]);
	let members =
		tableText === null
			? []
			: selectMembers(parseProcessTable(tableText), leaderPid);
	if (members.length === 0) {
		// The membership read failed or did not contain the leader. The pid we
		// spawned is ours, so on a platform with a footprint tool it can still be
		// read without any table; elsewhere the tick is skipped.
		if (platform !== "darwin") return null;
		members = [{ pid: leaderPid, ppid: 0, pgid: leaderPid, rssBytes: 0 }];
	}
	let footprints = new Map();
	if (platform === "darwin") {
		const probed = [...members]
			.sort((a, b) => b.rssBytes - a.rssBytes)
			.slice(0, _MAX_FOOTPRINT_PIDS);
		const text = await run("/usr/bin/footprint", [
			"--noCategories",
			"-f",
			"bytes",
			...probed.flatMap((member) => ["-p", String(member.pid)]),
		]);
		if (text !== null) footprints = parseFootprintBytes(text);
	}
	// A footprint-less reading of a table-less tick has nothing at all to judge.
	if (tableText === null && footprints.size === 0) return null;
	return { members, ...totalMemory(members, footprints) };
}

/**
 * SIGKILL the group and any out-of-group descendants. ESRCH (already gone) is
 * the expected race and is not an error. Refuses pids that are not a plausible
 * spawned leader so a bug upstream can never become `kill(-1)` / `kill(0)`.
 */
export function killGroup(
	leaderPid,
	members,
	{ signal = "SIGKILL", kill = process.kill } = {},
) {
	if (
		!Number.isInteger(leaderPid) ||
		leaderPid <= 1 ||
		leaderPid === process.pid
	) {
		throw new Error(`refusing to signal group of pid ${leaderPid}`);
	}
	const send = (target) => {
		try {
			kill(target, signal);
		} catch (error) {
			if (error?.code !== "ESRCH") throw error;
		}
	};
	send(-leaderPid);
	for (const member of members) {
		if (
			member.pgid !== leaderPid &&
			member.pid > 1 &&
			member.pid !== process.pid
		) {
			send(member.pid);
		}
	}
}

/**
 * The watchdog loop. `tick()` is exposed so tests drive it without timers.
 *
 * `sample`, `kill` and the timer functions are injected for the same reason.
 * `onBreach(reading)` is called once, AFTER the kill, and the loop stops.
 */
export function createMemoryWatchdog({
	leaderPid,
	budgetBytes,
	sample = () => sampleGroup(leaderPid),
	kill = (members) => killGroup(leaderPid, members),
	onBreach,
	onBlind = () => {},
	intervalMs = _TICK_INTERVAL_MS,
	setTimer = setTimeout,
	clearTimer = clearTimeout,
}) {
	let timer = null;
	let stopped = false;
	let blind = 0;
	let warned = false;

	async function tick() {
		if (stopped) return "stopped";
		let reading = null;
		try {
			reading = await sample();
		} catch {
			reading = null;
		}
		if (stopped) return "stopped";
		if (reading === null) {
			blind += 1;
			if (blind >= _BLIND_TICKS_WARN && !warned) {
				warned = true;
				onBlind(blind);
			}
			return "blind";
		}
		blind = 0;
		if (reading.totalBytes < budgetBytes) return "ok";
		stopped = true;
		try {
			kill(reading.members);
		} finally {
			onBreach(reading);
		}
		return "breach";
	}

	function schedule() {
		if (stopped) return;
		timer = setTimer(async () => {
			const status = await tick();
			if (status !== "breach" && status !== "stopped") schedule();
		}, intervalMs);
		timer?.unref?.();
	}

	return {
		tick,
		start: schedule,
		stop() {
			stopped = true;
			if (timer !== null) clearTimer(timer);
		},
	};
}

/** The ONE loud line printed on a breach. Names the leader, the measured
 * figure and the budget, because that is what the person who owned the run needs
 * to decide whether their test leaks or the budget is wrong. */
export function formatBreachLine({ leaderPid, reading, budgetBytes }) {
	const fp =
		reading.footprintBytes > 0
			? `footprint ${human(reading.footprintBytes)}, rss ${human(reading.rssBytes)}`
			: `rss ${human(reading.rssBytes)}`;
	return `desktop tests: MEMORY LIMIT EXCEEDED — killed process group ${leaderPid} (${reading.members.length} processes): ${human(reading.totalBytes)} owned (${fp}) >= budget ${human(budgetBytes)}; raise it with ${MEMORY_BUDGET_OVERRIDE_ENV}=<MB> if the suite legitimately needs more`;
}

// Kept for tests that want to assert the table shape without importing regexes.
export const _internal = { WHITESPACE };
