#!/usr/bin/env node
/**
 * Resolves how wide `pnpm test:desktop` is allowed to run on this machine.
 *
 * `test:desktop` runs `node --test` over every `scripts/*.test.mjs` file, and
 * with no `--test-concurrency` node picks `availableParallelism() - 1`
 * concurrent FILE workers — 13 on the 14-core host this was measured on. That
 * is the right default for one checkout on an idle machine and the wrong one
 * here, because this repo is worked through many concurrent git worktrees and
 * several agent sessions run the suite at the same time. A handful of files in
 * this suite are not pure JavaScript either: they spawn real subprocesses
 * (`codesign`, `hdiutil`, a 17 s watchdog tree), so 13 workers is not 13
 * processes.
 *
 * MEASURED, on the 14-core / 36 GB host, `pnpm test:desktop`, two interleaved
 * rounds per setting, sampling the whole process tree (`ps -Ao pid,ppid,rss`)
 * rather than the runner process alone:
 *
 *   --test-concurrency   peak tree RSS      peak procs   wall
 *   default (13)         1117 / 1124 MB     25 / 27      92.8 / 92.0 s
 *   6                    708 MB             13           93.9 s
 *   4                    515 / 569 MB       9 / 10       98.6 / 97.0 s
 *   2                    392 MB             5            168.1 s (+81%)
 *
 * So capping in the 4-7 range roughly halves the peak and cuts concurrent
 * processes by ~2.6x for ~5% wall; 2 is where the curve turns and the run takes
 * 81% longer, which is why `_MIN_WORKERS` is a floor and not a target. The
 * lever exists for the machine, not for the suite: the suite is not slower in
 * any way that matters at 4-7, and a box in a swap storm is slower for
 * everything on it.
 *
 * This mirrors the xdist cap in local-operator's root `conftest.py`, which
 * solves the identical problem for pytest, and deliberately carries over its
 * two hard-won measurement choices (see `availableMemoryMb` below). The shape
 * of the decision is the same: a CPU share and a memory budget, whichever is
 * smaller, clamped to a sane range, with an unclamped operator override and a
 * CI escape.
 *
 * The decision is a pure function of its inputs so the tests can pin every one
 * of them and stay machine-independent; `resolveDesktopTestConcurrency` is the
 * thin layer that measures the real machine.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { availableParallelism, totalmem } from "node:os";

/**
 * Operator override, honoured UNCLAMPED (see `computeDesktopTestConcurrency`).
 *
 * A human who types a worker count has a reason — a dedicated machine, or
 * bisecting a concurrency-sensitive failure at 1 — and second-guessing it would
 * make the escape hatch useless. Setting it also bypasses the CI arm, which is
 * the point: it is the one input that always wins.
 */
export const OVERRIDE_ENV = "LOCAL_OPERATOR_UI_TEST_CONCURRENCY";

/*
 * The CPU share applies on a developer machine and is skipped on CI. It is
 * deliberately NOT applied to a hosted runner: that machine is dedicated and
 * single-purpose, so the contention the share protects against does not exist,
 * and halving its parallelism makes every PR slower for no gain.
 *
 * That is where this governor diverges from the conftest it mirrors, and the
 * difference is intentional. conftest keeps the memory budget (and the 2-8
 * clamp) live on CI. Here the CI arm stands the governor down entirely and
 * returns node's own default. Both are non-regressive, but standing down is the
 * strictly safer of the two: it cannot lower a dedicated runner's parallelism
 * at all, so it cannot introduce a CI regression by arithmetic nobody watches,
 * and the failure it would guard against on a runner (OOM on a 2-vCPU box) is
 * not a failure this suite has ever shown there. The cost is that a hosted
 * runner gets no memory protection from this file; the benefit is that this
 * file cannot make CI slower. On CI the suite is a small fraction of the job's
 * wall time anyway — the checkout and install dominate — so the CPU share buys
 * nothing there even when it does apply.
 */

/** Fraction of cores to claim on a developer machine. Leaving half idle is what
 * keeps a second worktree's suite from turning into a swap storm; the A/B above
 * shows we lose nothing measurable by doing so. */
export const _CPU_SHARE = 0.5;

/** Fraction of available memory the suite may claim. The rest is left for the
 * editor, the agent sessions and the OS page cache that are the reason this
 * machine is contended in the first place. */
export const _MEMORY_SHARE = 0.5;

/**
 * Divisor for the memory budget, in MB per worker.
 *
 * A deliberately CONSERVATIVE ENVELOPE, not the measured per-worker figure - do
 * not "correct" it downward. The table above gives a marginal cost of roughly
 * 60-70 MB per extra worker (1117 -> 708 -> 515 -> 392 MB across 13/6/4/2), but
 * that is the runner's own accounting and it misses what the workers spawn:
 * several files here fork real subprocesses (`codesign`, `hdiutil`, a 17 s
 * watchdog process tree) whose footprint never appears in the runner's RSS. 192
 * is ~3x the marginal figure, which is the same posture conftest takes with its
 * 600 MB against measured worker RSS. The asymmetry justifies it:
 * under-provisioning costs a little wall time, over-provisioning costs the
 * whole machine a swap storm.
 */
export const _MB_PER_WORKER = 192;

/**
 * Memory held back from the budget entirely, in MB, computed per host.
 *
 * WHY: `_MEMORY_SHARE` claims a fraction of what REMAINS, so N sibling suites
 * each halve the remainder — 1 suite leaves 50% free, 3 leave 12.5%, 6 leave
 * 1.6%. Every suite is individually polite and the fleet still walks into swap.
 * Holding an absolute floor out of the budget first is what stops the walk
 * being purely geometric.
 *
 * SHAPE — `min(share, available - reserve)`, NOT `(available - reserve) *
 * share`. Subtracting first then halving charges two independent politeness
 * terms to the same memory, costing ~2.6 workers even when this suite is the
 * ONLY one running. The `min` form expresses "leave the reserve free" without
 * that penalty.
 *
 * THE CONSEQUENCE, which is the single most useful thing to know before tuning
 * these constants: `min(a * 0.5, a - reserve) == a * 0.5` for all `a >= 2 *
 * reserve`. So this term BINDS ONLY BELOW ~2x itself (6,144 MB here) and is
 * invisible above that — on a 36 GB box under normal load the CPU arm is what
 * you will see bind, not this one. It is a floor under a single suite's
 * appetite when memory is genuinely short, NOT a fleet-total lever.
 */
export const _MEMORY_RESERVE_CAP_MB = 3072;

/** Scales the reserve per host: a flat 3 GB would reserve three quarters of a
 * 4 GB container. `total / 8` gives 512 MB on a 4 GB runner and 4.5 GB on this
 * 36 GB laptop, where the 3072 cap then binds. */
export const _MEMORY_RESERVE_FRACTION = 8;

/** Hard bounds. Below 2 the suite stops being parallel at all, and the A/B
 * above shows why 2 is a floor rather than a target: it is the one setting
 * that cost real wall time (+81%). Above 8 buys nothing measurable and is
 * precisely the concurrency that produced the peak this change exists to cut. */
export const _MIN_WORKERS = 2;
export const _MAX_WORKERS = 8;

/** Safe answer for any path that cannot measure the machine. Small enough to be
 * harmless on a laptop already under load, large enough to keep the suite
 * parallel. */
export const _FALLBACK_WORKERS = 4;

/**
 * Environment marker set by local-operator's own bash tool
 * (`local_operator/tools/builtin.py`, `NON_INTERACTIVE_ENV`) on every
 * agent-run command.
 *
 * Its presence means `CI` is NOT trustworthy as a "dedicated runner" signal:
 * the harness sets `CI=1` to make CLIs non-interactive, on a shared laptop that
 * may be running several agent sessions and their suites at once. Without this
 * denial every agent-run suite on this box would take the CI arm and skip the
 * governor exactly where it is needed.
 *
 * Deliberately a denylist, not an allowlist of provider variables
 * (`GITHUB_ACTIONS` and friends): the set of CI providers is open, and
 * narrowing the check to the ones we remembered would silently drop every
 * provider not on the list into the developer share. The set of harnesses
 * lying about `CI` on this machine is closed and ours.
 */
export const _AGENT_SHELL_ENV = "LOCAL_OPERATOR_AGENT_SHELL";

/** Parse the override environment value into a worker count, or `null` when it
 * is absent or unusable. A typo degrades to the governed path with a warning
 * rather than to a hard failure: a test suite that will not start because
 * someone fat-fingered an environment variable is a worse failure than a
 * suboptimal worker count. */
function parseOverride(override) {
	if (override === null || override === undefined) return null;
	const text = String(override).trim();
	if (text === "") return null;
	const value = Number.parseInt(text, 10);
	// `parseInt` happily reads "4abc" as 4 and "0" as 0; both are typos here.
	// A zero-worker run is also nonsense to node's runner, which would throw —
	// i.e. the escape hatch would fail in a way that looks like the governor
	// broke.
	if (!Number.isInteger(value) || value < 1 || String(value) !== text) {
		console.warn(
			`${OVERRIDE_ENV} is not a positive whole number: ${text}. Ignoring it.`,
		);
		return null;
	}
	return value;
}

/**
 * PURE. The whole concurrency policy, as a function of its inputs.
 *
 * Returns `{ concurrency, arm, cpus, availableMb, totalMb, onCi, cpuCap,
 * memoryCap, budgetMb }`. It returns the ARM as well as the number because the
 * runner has to print which term bound, and recomputing that in the runner
 * would be a second implementation of the same rule — free to silently
 * disagree with the number printed next to it. The inputs are echoed back so
 * the evidence line cannot misreport them: they travel with the number.
 *
 * Inputs, all explicit so the tests never depend on the host:
 *
 *   cpus          `os.availableParallelism()`
 *   availableMb   memory the suite may take without pushing the host into
 *                 swap, or `null` when it could not be measured
 *   totalMb       physical RAM, or `null`; only used to SCALE the reserve
 *   onCi          `CI` set AND the harness marker absent (see `_AGENT_SHELL_ENV`)
 *   override      the raw override value, or `null`
 *   nodeDefault   the worker count node itself would have used, so the CI arm
 *                 can mean "change nothing" and the dev path can refuse to
 *                 raise parallelism above it
 *
 * Never throws: a machine we cannot measure must still run its tests.
 */
export function computeDesktopTestConcurrency({
	cpus,
	availableMb = null,
	totalMb = null,
	onCi = false,
	override = null,
	nodeDefault = null,
}) {
	try {
		const unclamped = parseOverride(override);
		if (unclamped !== null) {
			// See `OVERRIDE_ENV`: honoured unclamped, so this arm returns before
			// any of the bounds below are consulted.
			return {
				concurrency: unclamped,
				arm: "override",
				cpus,
				availableMb,
				totalMb,
				nodeDefault: Number.isFinite(nodeDefault) ? nodeDefault : null,
				onCi,
				cpuCap: null,
				memoryCap: null,
				budgetMb: null,
			};
		}

		if (onCi) {
			// "Change nothing on a hosted runner": hand back node's own choice
			// rather than a number this file invented. See the block comment
			// above `_CPU_SHARE` for why this repo stands down where conftest
			// keeps its memory budget live.
			return {
				concurrency: nodeDefault,
				arm: "ci",
				cpus,
				availableMb,
				totalMb,
				nodeDefault: Number.isFinite(nodeDefault) ? nodeDefault : null,
				onCi,
				cpuCap: null,
				memoryCap: null,
				budgetMb: null,
			};
		}

		// An unmeasurable core count is the same class of failure as an
		// unmeasurable memory probe, so it takes the same fallback rather than
		// propagating NaN through the min().
		const cpuCount = Number.isFinite(cpus) && cpus > 0 ? cpus : _FALLBACK_WORKERS;
		const cpuCap = Math.max(1, Math.floor(cpuCount * _CPU_SHARE));

		// No memory measurement degrades to the CPU-only cap rather than to a
		// guess: `Infinity` cannot bind, which is exactly the pre-existing
		// behaviour.
		let memoryCap = Number.POSITIVE_INFINITY;
		let budgetMb = null;
		if (Number.isFinite(availableMb)) {
			budgetMb = availableMb * _MEMORY_SHARE;
			if (Number.isFinite(totalMb)) {
				// The reserve is held out of the budget; see the shape comment on
				// `_MEMORY_RESERVE_CAP_MB`. `max(0, ...)` keeps the intermediate
				// readable when free memory is below the reserve — it is NOT what
				// guarantees a usable worker count, the clamp below does that.
				const reserveMb = Math.min(
					_MEMORY_RESERVE_CAP_MB,
					Math.floor(totalMb / _MEMORY_RESERVE_FRACTION),
				);
				budgetMb = Math.max(0, Math.min(budgetMb, availableMb - reserveMb));
			}
			memoryCap = Math.floor(budgetMb / _MB_PER_WORKER);
		}

		const rawCap = Math.min(cpuCap, memoryCap);
		let arm = cpuCap <= memoryCap ? "cpu" : "memory";
		if (rawCap < _MIN_WORKERS) arm = "min";
		else if (rawCap > _MAX_WORKERS) arm = "max";

		let concurrency = Math.max(_MIN_WORKERS, Math.min(_MAX_WORKERS, rawCap));

		// NEVER RAISE. The bounds above can only lower a dev machine's worker
		// count in practice, but the `_MIN_WORKERS` floor is a raise on a host
		// node itself would have run narrower (a 2-core machine has a node
		// default of 1). A governor that may not lower a machine must not raise
		// one either, or it is not a governor — so the floor yields to node's
		// own answer when that answer is smaller.
		if (Number.isFinite(nodeDefault) && nodeDefault >= 1 && concurrency > nodeDefault) {
			concurrency = nodeDefault;
			arm = "node-default";
		}

		return {
			concurrency,
			arm,
			cpus,
			availableMb,
			totalMb,
			nodeDefault: Number.isFinite(nodeDefault) ? nodeDefault : null,
			onCi,
			cpuCap,
			memoryCap: Number.isFinite(memoryCap) ? memoryCap : null,
			budgetMb,
		};
	} catch {
		// See the docstring. Reached only by an input shape nobody documented.
		return {
			concurrency: _FALLBACK_WORKERS,
			arm: "fallback",
			cpus: null,
			availableMb: null,
			totalMb: null,
			nodeDefault: null,
			onCi,
			cpuCap: null,
			memoryCap: null,
			budgetMb: null,
		};
	}
}

/**
 * PURE. Memory the suite can take without pushing the machine into swap, from
 * the text of `vm_stat`, in MB — or `null` when the output cannot be read.
 *
 * Split out from the probe so the two choices in it can be tested against a
 * captured `vm_stat`, because both were made against a measured failure of the
 * obvious alternative and a future reader would otherwise re-introduce one:
 *
 *   - **Not `Pages inactive`.** Counting it as available reported 8,137 MB of
 *     headroom on this host at the exact moment it had 452 MB genuinely free
 *     and 6.1 GB of 7.2 GB of swap consumed, so the term never bound under the
 *     pressure it exists to detect. On macOS `inactive` is not Linux's
 *     `MemAvailable`: much of it is dirty and compressor-backed, reclaimable
 *     only by paging, which is the cost being avoided. `File-backed pages` is
 *     the subset vm_stat itself identifies as clean and cheaply reclaimable, so
 *     it needs no invented discount fraction.
 *   - **Not consumed swap as a pressure term.** `vm.swapusage`'s `used` looks
 *     like the natural way to notice a machine that is paging, but that counter
 *     is CUMULATIVE — macOS never decrements it — so it reads "this host swapped
 *     at some point since boot", not "this host is swapping now". A term that
 *     only ratchets down is worse than no term: it silently makes the cap
 *     independent of actual conditions. Every page count used here is
 *     instantaneous and recovers on its own.
 *
 * The page size is read from the header, never assumed: this host uses 16K
 * pages, so a hardcoded 4096 would under-report by 4x. The compressor is
 * deliberately NOT subtracted: the pages it occupies are already excluded from
 * both free and file-backed, so subtracting would double-count.
 */
export function availableMbFromVmStat(text) {
	const header = /page size of (\d+) bytes/.exec(text);
	if (header === null) return null;
	const pageSize = Number.parseInt(header[1], 10);
	if (!Number.isFinite(pageSize) || pageSize <= 0) return null;

	const counts = {};
	for (const label of ["Pages free", "Pages speculative"]) {
		const match = new RegExp(`^${label}:\\s+(\\d+)\\.`, "m").exec(text);
		if (match === null) return null;
		counts[label] = Number.parseInt(match[1], 10);
	}
	// "File-backed pages" is absent on some macOS versions; treat a miss as 0
	// rather than as a probe failure, which degrades to the free-page estimate
	// instead of discarding a usable measurement.
	const fileBacked = /^File-backed pages:\s+(\d+)\./m.exec(text);
	counts["File-backed pages"] = fileBacked === null ? 0 : Number.parseInt(fileBacked[1], 10);

	const perMb = pageSize / (1024 * 1024);
	return Math.max(0, Math.trunc(Object.values(counts).reduce((a, b) => a + b, 0) * perMb));
}

/** Probe the host for available memory in MB, or `null` when it cannot be
 * measured (the caller then degrades to the CPU-only cap). Never throws: a
 * probe must not break a test run. */
function availableMemoryMb() {
	try {
		if (process.platform === "darwin") {
			const out = execFileSync("vm_stat", {
				encoding: "utf8",
				timeout: 5000,
				stdio: ["ignore", "pipe", "ignore"],
			});
			return availableMbFromVmStat(out);
		}
		if (process.platform === "linux") {
			// MemAvailable is the kernel's own estimate of what can be handed out
			// without swapping — strictly better than MemFree, which ignores
			// reclaimable page cache and would badly understate a warm container.
			for (const line of readFileSync("/proc/meminfo", "utf8").split("\n")) {
				if (line.startsWith("MemAvailable:")) {
					return Math.trunc(Number.parseInt(line.split(/\s+/)[1], 10) / 1024);
				}
			}
		}
	} catch {
		return null;
	}
	return null;
}

/** Physical RAM in MB, or `null`. Only used to scale the reserve, so an
 * unmeasurable host degrades to no reserve rather than to a guess. */
function totalMemoryMb() {
	try {
		const bytes = totalmem();
		return Number.isFinite(bytes) && bytes > 0 ? Math.trunc(bytes / (1024 * 1024)) : null;
	} catch {
		return null;
	}
}

/** The worker count node's test runner would use with no `--test-concurrency`:
 * `availableParallelism() - 1`. Named rather than inlined because two arms
 * depend on it — the CI arm returns it unchanged, and the dev path refuses to
 * climb above it. */
export function nodeDefaultConcurrency(cpus = availableParallelism()) {
	const count = Number.isFinite(cpus) && cpus > 1 ? cpus : 1;
	return Math.max(1, count - 1);
}

/**
 * Measure this machine and decide. Returns the decision plus the inputs behind
 * it, which is what the runner prints as its evidence line.
 *
 * Never throws. A suite that cannot start because the worker-count heuristic
 * threw would be a far worse failure than a suboptimal worker count.
 */
export function resolveDesktopTestConcurrency() {
	try {
		const cpus = availableParallelism();
		// `CI` is set by GitHub Actions and essentially every other provider, so
		// it stays the signal — except for the one liar we control. See
		// `_AGENT_SHELL_ENV`.
		const onCi = Boolean(process.env.CI) && !process.env[_AGENT_SHELL_ENV];
		return computeDesktopTestConcurrency({
			cpus,
			availableMb: availableMemoryMb(),
			totalMb: totalMemoryMb(),
			onCi,
			override: process.env[OVERRIDE_ENV] ?? null,
			nodeDefault: nodeDefaultConcurrency(cpus),
		});
	} catch {
		return {
			concurrency: _FALLBACK_WORKERS,
			arm: "fallback",
			cpus: null,
			availableMb: null,
			totalMb: null,
			nodeDefault: null,
			onCi: false,
			cpuCap: null,
			memoryCap: null,
			budgetMb: null,
		};
	}
}

/** GB, one decimal, for the human-readable evidence line. */
function gb(mb) {
	return `${(mb / 1024).toFixed(1)} GB`;
}

/**
 * The ONE line `pnpm test:desktop` prints before it runs, naming the resolved
 * cap, the term that bound, and the inputs behind it.
 *
 * This line is the evidence a reviewer or QA reads, so it has to be honest and
 * specific: every arm below states the term that actually produced the number,
 * and the bypass arms say so rather than borrowing the governed wording.
 */
export function formatDesktopTestConcurrencyLine(decision, fileCount) {
	const prefix = `desktop tests: ${fileCount} files, concurrency ${decision.concurrency}`;
	const { arm } = decision;
	// A probe failure reads as a probe failure rather than as a plausible
	// figure, so the line can never quietly imply a measurement that did not
	// happen.
	const available = Number.isFinite(decision.availableMb)
		? `${gb(decision.availableMb)} available`
		: "memory not measurable";
	if (!Number.isFinite(decision.concurrency)) {
		// Only reachable if the CI arm was asked to stand down without being told
		// node's own default: the runner then passes no cap at all rather than
		// inventing one, and says so here instead of printing `concurrency null`.
		return `desktop tests: ${fileCount} files, no concurrency cap (CI runner: governor stands down, node's default not measurable)`;
	}
	if (arm === "override") {
		return `${prefix} (explicit ${OVERRIDE_ENV}; governor bypassed)`;
	}
	if (arm === "ci") {
		return `${prefix} (CI runner: governor stands down, node default for ${decision.cpus} cores)`;
	}
	if (arm === "fallback") {
		return `${prefix} (could not measure this machine; safe fallback)`;
	}
	if (arm === "node-default") {
		return `${prefix} (node's own default; the governor never raises parallelism)`;
	}
	if (arm === "min") {
		return `${prefix} (min floor ${_MIN_WORKERS}; ${available})`;
	}
	if (arm === "max") {
		return `${prefix} (max clamp ${_MAX_WORKERS}; cpu share of ${decision.cpus} cores allows more)`;
	}
	if (arm === "memory") {
		return `${prefix} (memory budget ${gb(decision.budgetMb)} of ${available} at ${_MB_PER_WORKER} MB per worker; cpu share would allow ${decision.cpuCap})`;
	}
	return `${prefix} (cpu share ${_CPU_SHARE} of ${decision.cpus} cores; ${available})`;
}
