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
import { readFile, readdir } from "node:fs/promises";
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
 * kill a legitimate multi-GB suite on a bad minute. A budget that can flake a
 * correct run teaches people to turn it off, which is worse than no bound.
 */
export const _TOTAL_SHARE = 0.25;

/** Floor, MB. MEASURED, 2026-09-30, one real `pnpm test:desktop` over the 330-file
 * list at the governor's concurrency of 7, sampled every 2 s with this file's own
 * `sampleGroup`: peak `max(footprint, rss)` tree total **3,041 MB** (footprint
 * 2,850 MB, RSS 2,077 MB at that sample, 19 processes there; summed-RSS peak 2,077
 * MB across up to 32). The first revision argued 6 GB from the older ~1.2 GB
 * summed-RSS figure, which is a different quantity from what the trip compares,
 * and 6 GB is only 2x the real one. 8 GB is 2.7x it: a legitimately heavy new
 * file has room, a false kill (which teaches people to switch the bound off)
 * stays implausible, and the incident's 198 GB trips with orders of magnitude to
 * spare. (That run had 28 failures coinciding with ENOSPC on this host's disk, so
 * its peak is a floor on a healthy run's, not a ceiling; the margin is why.) */
export const _BUDGET_FLOOR_MB = 8192;

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

/** `pgrep -P` discovery used when the `ps` table cannot be read: levels of the
 * tree to walk, per-call timeout, and a cap on discovered pids. Short on purpose
 * — this path exists for the starved-host case, where a long probe is the thing
 * that would wedge the tick. */
export const _PGREP_DEPTH = 6;
export const _PGREP_TIMEOUT_MS = 2500;
export const _PGREP_MAX_PIDS = 256;

/** Budget for the single pre-kill re-read of the process table. Shorter than a
 * sampling probe: a kill must not wait on a starved host. If it cannot be read,
 * the by-pid kills are skipped (and reported) rather than made from a stale
 * snapshot. */
export const _RECHECK_TIMEOUT_MS = 4000;

/** Most pids handed to one `footprint` exec. Members beyond it (by RSS, largest
 * first are probed) keep their RSS charge. A suite tree is 5-28 processes; this
 * only bounds argv for a pathological one. */
export const _MAX_FOOTPRINT_PIDS = 128;

/** Exit status when the watchdog ends a run: 128 + SIGKILL, the shell's own
 * spelling of "killed", and non-zero for every caller. */
export const BREACH_EXIT_CODE = 137;

const MB = 1024 * 1024;
// `lstart` (process start time, fixed 5 tokens: "Tue Sep 30 21:56:12 2026") is the
// identity a pid is re-checked against before it is signalled by pid; it is
// optional so a row without it parses and is simply never signalled by pid.
const TABLE_LINE =
	/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)(?:\s+(\S+\s+\S+\s+\d+\s+[\d:]+\s+\d{4}))?\s*$/;
const FOOTPRINT_LINE =
	/\[(\d+)\]:\s+\d+-bit\s+Footprint:\s+([\d.]+)\s*(B|KB|MB|GB|bytes)?\b/;
const UNIT_BYTES = { B: 1, bytes: 1, KB: 1024, MB: MB, GB: 1024 * MB };
const WHITESPACE = /\s+/;
const VM_RSS_LINE = /^VmRSS:\s+(\d+)\s*kB/m;
const PID_NAME = /^\d+$/;
const PS_TABLE_ARGS = ["-axo", "pid=,ppid=,pgid=,rss=,lstart="];

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
 * cost is what the governor stood down for, and it is nil here — 8 GB is 2.7x the
 * suite's measured peak and the floor is the budget on a 16 GB runner
 * (max(8,192, 4,096), capped at 8,192).
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

/** PURE. `ps -axo pid=,ppid=,pgid=,rss=,lstart=` text -> rows (rss in BYTES). Lines that
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
			lstart: match[5] ?? null,
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
export function runProbe(
	command,
	args,
	timeoutMs = _PROBE_TIMEOUT_MS,
	okExitCodes = [],
) {
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
					// `okExitCodes` names exits that are an ANSWER, not a failure
					// (`pgrep` exits 1 for "no children"); without it an empty tree
					// would read as a failed probe.
					if (error && !stdout && !okExitCodes.includes(error.code)) {
						resolve(null);
						return;
					}
					resolve(String(stdout ?? ""));
				},
			);
		} catch {
			resolve(null);
		}
	});
}

/** Where Linux keeps its process table. A parameter everywhere it is used so a
 * test can point it at a fake tree and exercise the Linux arm on any host. */
export const DEFAULT_PROC_ROOT = "/proc";

/** `/proc/<pid>/stat` text -> `{ ppid, pgid, lstart }`, or `null` when it does not
 * parse. PURE. The command name (field 2) is parenthesised and may itself contain
 * spaces and `)`, so fields are counted from the LAST `)`: what follows is field 3
 * (state) onward, which puts ppid at index 1, pgrp at 2 and `starttime` (field 22,
 * clock ticks since boot) at 19. `starttime` is the identity stamp: it is the one
 * per-process value that never changes and never repeats for a recycled pid, and
 * it needs no fork and no locale/format parsing, unlike `ps -o lstart=`. It is
 * prefixed so it can never be confused with a `ps` start-time string. */
export function parseProcStat(text) {
	const close = String(text ?? "").lastIndexOf(")");
	if (close < 0) return null;
	const fields = text
		.slice(close + 1)
		.trim()
		.split(WHITESPACE);
	const ppid = Number.parseInt(fields[1], 10);
	const pgid = Number.parseInt(fields[2], 10);
	const start = fields[19];
	if (!Number.isInteger(ppid) || !Number.isInteger(pgid) || !start) return null;
	return { ppid, pgid, lstart: `proc:${start}` };
}

/** `/proc/<pid>/status` text -> resident bytes (`VmRSS`, kB), `0` for a kernel
 * thread that has none. PURE. */
export function parseProcStatusRss(text) {
	const match = VM_RSS_LINE.exec(String(text ?? ""));
	return match === null ? 0 : Number(match[1]) * 1024;
}

/** One pid's `{ pid, ppid, pgid, lstart }` from `/proc`, or `null` (gone, or not
 * ours to read). Never throws. */
async function readProcStat(pid, procRoot) {
	try {
		const parsed = parseProcStat(
			await readFile(`${procRoot}/${pid}/stat`, "utf8"),
		);
		return parsed === null ? null : { pid, rssBytes: 0, ...parsed };
	} catch {
		return null;
	}
}

async function readProcRss(pid, procRoot) {
	try {
		return parseProcStatusRss(
			await readFile(`${procRoot}/${pid}/status`, "utf8"),
		);
	} catch {
		return 0;
	}
}

/**
 * The Linux fallback for a `ps` table that cannot be read: the whole table rebuilt
 * from `/proc`, with NO subprocess at all. This is the arm that matters on the
 * hosted CI runner, where the first revision's macOS-only `pgrep` walk left a
 * starved or failing `ps` as total blindness (measured there: the runaway ran to
 * completion with the table read dead, and only the "NOT reliably bounded" line
 * said so). Reading `/proc` directly is cheaper than the `ps` it replaces and
 * cannot be starved by a fork failing under memory pressure — the exact condition
 * the watchdog exists for.
 *
 * Returns the leader's tree (group + `ppid` descendants, via `selectMembers`) with
 * RSS and the `starttime` identity already recorded for every member, which is
 * what lets `killTree` verify a descendant that left the group AFTER the group is
 * dead and it has been re-parented. `null` when `/proc` cannot be listed.
 */
async function walkProc(leaderPid, procRoot) {
	let names;
	try {
		names = await readdir(procRoot);
	} catch {
		return null;
	}
	const rows = (
		await Promise.all(
			names
				.filter((name) => PID_NAME.test(name))
				.map((name) => readProcStat(Number(name), procRoot)),
		)
	).filter((row) => row !== null);
	const members = selectMembers(rows, leaderPid);
	await Promise.all(
		members.map(async (member) => {
			member.rssBytes = await readProcRss(member.pid, procRoot);
		}),
	);
	return members;
}

/**
 * Descendants of the leader through `pgrep -P`, for when the `ps` table cannot be
 * read. Walks breadth-first to `_PGREP_DEPTH` levels, one short-timeout call per
 * level, and keeps whatever levels succeeded: a partial tree is still more of the
 * truth than the leader alone, and nothing here ever KILLS on its own — it only
 * widens what the footprint read can see. Members carry no pgid/rss/lstart (the
 * table is exactly what we do not have), so they are signalled by pid only after
 * `killTree`'s own fresh re-check.
 */
async function walkDescendants(leaderPid, run) {
	const members = [
		{ pid: leaderPid, ppid: 0, pgid: leaderPid, rssBytes: 0, lstart: null },
	];
	const seen = new Set([leaderPid]);
	let frontier = [leaderPid];
	for (
		let depth = 0;
		depth < _PGREP_DEPTH &&
		frontier.length > 0 &&
		members.length < _PGREP_MAX_PIDS;
		depth++
	) {
		const text = await run(
			"pgrep",
			["-P", frontier.join(",")],
			_PGREP_TIMEOUT_MS,
			[1],
		);
		if (text === null) break;
		frontier = [];
		for (const line of text.split("\n")) {
			const pid = Number.parseInt(line, 10);
			if (!Number.isInteger(pid) || seen.has(pid)) continue;
			seen.add(pid);
			frontier.push(pid);
			members.push({ pid, ppid: 0, pgid: null, rssBytes: 0, lstart: null });
		}
	}
	if (members.length > 1) {
		// IDENTITY AT WALK TIME (Q5). A walked member's start time has to be on
		// record BEFORE the group is killed: once it is, a `setsid` descendant is
		// re-parented to pid 1 and the "my parent is still in this tree" fallback can
		// never match it, so the breach would leave it running. One narrow
		// `ps -p` read - the same shape the pre-kill re-check uses, which has been
		// the one that survives where the full table does not - fills in
		// pgid/rss/lstart. If it fails the members keep `lstart: null` and are
		// skipped-and-counted at kill time rather than guessed at.
		const text = await run(
			"ps",
			[
				"-o",
				"pid=,ppid=,pgid=,rss=,lstart=",
				"-p",
				members
					.slice(1)
					.map((member) => member.pid)
					.join(","),
			],
			_PGREP_TIMEOUT_MS,
			[1],
		);
		if (text !== null) {
			const rows = new Map(
				parseProcessTable(text).map((row) => [row.pid, row]),
			);
			for (const member of members.slice(1)) {
				const row = rows.get(member.pid);
				if (row === undefined) continue;
				Object.assign(member, {
					ppid: row.ppid,
					pgid: row.pgid,
					rssBytes: row.rssBytes,
					lstart: row.lstart,
				});
			}
		}
	}
	return members;
}

/**
 * One reading of the group, or `null` when nothing could be read.
 *
 * The reading says how complete it is, because an incomplete one is NOT a bounded
 * run and must not reset the watchdog's blind counter (that was the first
 * revision's hole: with `ps` failing, only the ~17 MB `node --test` coordinator
 * was probed, the reading came back non-null, and the run — whose memory lives in
 * the test-file processes the coordinator forks — was reported as bounded while
 * being unwatched):
 *
 *   coverage "table"   `ps` rows gave the whole tree.
 *   coverage "walk"    `ps` failed and the descendants were found another way:
 *                      macOS `pgrep -P`; Linux `/proc` (fork-free), then `pgrep -P`
 *                      if `/proc` cannot be listed. Kills still come from real
 *                      readings only.
 *   coverage "leader"  nothing but the leader could be found.
 *   blind              true for "leader", and on macOS when no footprint came back
 *                      (RSS alone is the blind instrument there, see the module
 *                      header). On Linux RSS IS the instrument — there is no
 *                      compressor hiding pages from it and no footprint tool — so
 *                      a Linux reading is blind only at "leader" coverage. The
 *                      budget is still enforced on whatever WAS read.
 *
 * PLATFORMS. macOS and Linux have a fallback walk; any other platform has none
 * and a failed table read skips the tick. `run`, `platform` and `procRoot` are
 * injectable so the failure shapes (starved `ps`, vanished pid, no footprint tool)
 * and BOTH platforms' branches are tested against canned output and a fake
 * `/proc` instead of the host.
 */
export async function sampleGroup(
	leaderPid,
	{
		run = runProbe,
		platform = process.platform,
		procRoot = DEFAULT_PROC_ROOT,
	} = {},
) {
	const tableText = await run("ps", PS_TABLE_ARGS);
	let members =
		tableText === null
			? []
			: selectMembers(parseProcessTable(tableText), leaderPid);
	let coverage = "table";
	if (!members.some((member) => member.pid === leaderPid)) {
		// The membership read failed, was degenerate (no rows, or no leader in
		// them) or the leader is gone. The pid we spawned is ours, so it can still
		// be read without any table; elsewhere the tick is skipped.
		if (platform === "darwin") {
			members = await walkDescendants(leaderPid, run);
		} else if (platform === "linux") {
			members =
				(await walkProc(leaderPid, procRoot)) ??
				(await walkDescendants(leaderPid, run));
		} else {
			return null;
		}
		if (!members.some((member) => member.pid === leaderPid)) {
			// /proc listed but the leader is not in it (already gone): the leader
			// stub keeps the leader-only reading honest.
			members = [
				{ pid: leaderPid, ppid: 0, pgid: leaderPid, rssBytes: 0, lstart: null },
			];
		}
		coverage = members.length > 1 ? "walk" : "leader";
	} else if (platform === "linux") {
		// A table member that left the group gets the `/proc` identity stamp, so the
		// pre-kill re-check (which reads `/proc` on Linux) compares like with like.
		await Promise.all(
			members
				.filter((member) => member.pgid !== leaderPid)
				.map(async (member) => {
					member.lstart =
						(await readProcStat(member.pid, procRoot))?.lstart ?? null;
				}),
		);
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
	// Nothing at all read: no footprint and no member carrying an RSS.
	if (
		coverage !== "table" &&
		footprints.size === 0 &&
		!members.some((member) => member.rssBytes > 0)
	) {
		return null;
	}
	const blind =
		coverage === "leader" || (platform === "darwin" && footprints.size === 0);
	return { members, coverage, blind, ...totalMemory(members, footprints) };
}

/**
 * SIGKILL the test group, then every out-of-group descendant that is verifiably
 * still the process we sampled. Returns `{ signalled, skipped, errors }`; it
 * throws only for a pid that is not a plausible spawned leader, so a bug upstream
 * can never become `kill(-1)` / `kill(0)`.
 *
 * ORDER, and why. The GROUP goes first and unconditionally: at the 4.9 GB/s this
 * host was measured touching memory, waiting on a re-read before the kill that
 * stops the growth is the wrong trade, and the group send never needs a check (a
 * live group's id cannot be recycled). Only then are the by-pid kills prepared —
 * they exist for processes that left the group (Electron launched `detached`) and
 * they are the one place the "only signal what we spawned" invariant is
 * probabilistic: the sample they come from can be seconds old (probes are allowed
 * 8 s each, and `ps` has been measured at 13.6 s here), long enough for a pid to
 * be recycled to a stranger. So each is signalled only if a FRESH read shows the
 * same start time (`lstart`) the sample recorded for that pid: on macOS a narrow
 * `ps -p <pids>` (bounded by `_RECHECK_TIMEOUT_MS`); on Linux `/proc/<pid>/stat`
 * `starttime`, which forks nothing and so cannot fail under the pressure that
 * caused the kill. (Each platform's sample stamps members with its own kind, and
 * the Linux ones are `proc:`-prefixed so the two can never be compared.) A recycled pid has a different
 * one. Anything unverifiable — no recorded start time, or the re-read itself
 * failing — is skipped and COUNTED, so the loud line can say so, rather than
 * guessed at. A pid that is simply gone (it died with the group) is the common case
 * and is not counted.
 *
 * ERRORS. ESRCH (gone) and EPERM are not failures of the kill: macOS answers
 * `kill(-pgid)` with EPERM once a group holds only zombies, which is "nothing left
 * to signal". Each send is independent, so one refusal cannot skip the others;
 * anything else is collected into `errors` instead of escaping, because a thrown
 * kill inside the watchdog tick turned an exit-137 trip into an unhandled
 * rejection and exit 1.
 */
export async function killTree(
	leaderPid,
	members,
	{
		signal = "SIGKILL",
		kill = process.kill,
		run = runProbe,
		recheckTimeoutMs = _RECHECK_TIMEOUT_MS,
		platform = process.platform,
		procRoot = DEFAULT_PROC_ROOT,
	} = {},
) {
	if (
		!Number.isInteger(leaderPid) ||
		leaderPid <= 1 ||
		leaderPid === process.pid
	) {
		throw new Error(`refusing to signal group of pid ${leaderPid}`);
	}
	const errors = [];
	const send = (target) => {
		try {
			kill(target, signal);
			return true;
		} catch (error) {
			if (error?.code !== "ESRCH" && error?.code !== "EPERM")
				errors.push(error);
			return false;
		}
	};
	send(-leaderPid);

	const outOfGroup = members.filter(
		(member) =>
			member.pgid !== leaderPid && member.pid > 1 && member.pid !== process.pid,
	);
	if (outOfGroup.length === 0) return { signalled: 0, skipped: 0, errors };

	// The fresh identity read. Linux reads `/proc` (no fork, so it cannot be starved
	// or fail under the memory pressure that triggered the kill); elsewhere the
	// narrow `ps -p` read. Both yield rows with the same shape and the stamp kind
	// the sample recorded on that platform.
	let fresh = null;
	if (platform === "linux") {
		fresh = new Map();
		for (const member of outOfGroup) {
			const row = await readProcStat(member.pid, procRoot);
			if (row !== null) fresh.set(member.pid, row);
		}
	} else {
		const text = await run(
			"ps",
			[
				"-o",
				"pid=,ppid=,pgid=,rss=,lstart=",
				"-p",
				outOfGroup.map((member) => member.pid).join(","),
			],
			recheckTimeoutMs,
			[1],
		);
		if (text === null) {
			return { signalled: 0, skipped: outOfGroup.length, errors };
		}
		fresh = new Map(parseProcessTable(text).map((row) => [row.pid, row]));
	}
	const known = new Set([leaderPid, ...members.map((member) => member.pid)]);
	let signalled = 0;
	let skipped = 0;
	for (const member of outOfGroup) {
		const row = fresh.get(member.pid);
		if (row === undefined) continue; // gone with the group
		if (row.pgid === leaderPid) continue; // the group send already took it
		// Identity: the start time the sample recorded. A `pgrep` walk has none, so
		// there the fallback is that the pid's parent is still a process of THIS
		// tree - a recycled pid is a stranger with an unrelated parent.
		const sameProcess =
			member.lstart !== null && member.lstart !== undefined
				? row.lstart === member.lstart
				: known.has(row.ppid);
		if (!sameProcess) {
			skipped += 1;
			continue;
		}
		if (send(member.pid)) signalled += 1;
	}
	return { signalled, skipped, errors };
}

/**
 * The watchdog loop. `tick()` is exposed so tests drive it without timers.
 *
 * `sample`, `kill` and the timer functions are injected for the same reason.
 * `onTrip(reading)` fires once, BEFORE the kill starts (so the caller can mark the
 * coming child exit as a verdict); `kill(members)` may be async and its result
 * `{ signalled, skipped, errors }` is passed on; `onBreach(reading, outcome)`
 * fires once, AFTER the kill, and the loop stops. `onBlind(ticks)` fires once
 * after `_BLIND_TICKS_WARN` consecutive blind ticks.
 */
export function createMemoryWatchdog({
	leaderPid,
	budgetBytes,
	sample = () => sampleGroup(leaderPid),
	kill = (members) => killTree(leaderPid, members),
	onBreach,
	onTrip = () => {},
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
		// ENFORCE FIRST, then account for blindness: a partial reading that is
		// already over the budget is a real kill signal, and only a reading that
		// cannot be trusted to cover the tree counts toward the warning.
		if (reading !== null && reading.totalBytes >= budgetBytes) {
			stopped = true;
			onTrip(reading);
			let outcome = { signalled: 0, skipped: 0, errors: [] };
			try {
				outcome = (await kill(reading.members)) ?? outcome;
			} catch (error) {
				outcome.errors.push(error);
			}
			onBreach(reading, outcome);
			return "breach";
		}
		if (reading === null || reading.blind === true) {
			blind += 1;
			if (blind >= _BLIND_TICKS_WARN && !warned) {
				warned = true;
				onBlind(blind);
			}
			return "blind";
		}
		blind = 0;
		return "ok";
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
export function formatBreachLine({
	leaderPid,
	reading,
	budgetBytes,
	outcome = null,
}) {
	const fp =
		reading.footprintBytes > 0
			? `footprint ${human(reading.footprintBytes)}, rss ${human(reading.rssBytes)}`
			: `rss ${human(reading.rssBytes)}`;
	// Said only when something was NOT done, so the common line stays one clause
	// shorter and an unkilled straggler is never silent.
	const notes = [];
	if (outcome?.skipped > 0) {
		notes.push(
			`${outcome.skipped} out-of-group process(es) NOT signalled (identity could not be re-verified; check for strays)`,
		);
	}
	if (outcome?.errors?.length > 0) {
		notes.push(`kill errors: ${outcome.errors.map(String).join("; ")}`);
	}
	if (reading.coverage && reading.coverage !== "table") {
		notes.push(
			`process table was unreadable (${reading.coverage} coverage); the figure may undercount`,
		);
	}
	const note = notes.length > 0 ? `; ${notes.join("; ")}` : "";
	return `desktop tests: MEMORY LIMIT EXCEEDED — killed process group ${leaderPid} (${reading.members.length} processes): ${human(reading.totalBytes)} owned (${fp}) >= budget ${human(budgetBytes)}; raise it with ${MEMORY_BUDGET_OVERRIDE_ENV}=<MB> if the suite legitimately needs more${note}`;
}

// Kept for tests that want to assert the table shape without importing regexes.
export const _internal = { WHITESPACE };
