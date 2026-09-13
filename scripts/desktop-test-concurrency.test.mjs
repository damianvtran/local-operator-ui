import assert from "node:assert/strict";
import { test } from "node:test";
import {
	_CPU_SHARE,
	_MAX_WORKERS,
	_MEMORY_RESERVE_CAP_MB,
	_MEMORY_RESERVE_FRACTION,
	_MB_PER_WORKER,
	_MIN_WORKERS,
	_AGENT_SHELL_ENV,
	OVERRIDE_ENV,
	availableMbFromVmStat,
	computeDesktopTestConcurrency,
	formatDesktopTestConcurrencyLine,
	nodeDefaultConcurrency,
	resolveDesktopTestConcurrency,
} from "./desktop-test-concurrency.mjs";

/*
 * The desktop test concurrency governor's arithmetic, pinned one input at a
 * time.
 *
 * Why assert this at all: the governor decides how wide `pnpm test:desktop`
 * runs, and every constant in it was chosen against a measurement. A change
 * that quietly moves the cap — a "corrected" `_MB_PER_WORKER`, a re-added
 * `Pages inactive` term, a clamp that stops clamping — leaves a suite that is
 * still green on this machine and turns a shared host into the swap storm the
 * governor exists to prevent. Nothing else in the repo would notice, because
 * the failure is only visible under load.
 *
 * Every decision case passes its inputs explicitly (`cpus`, `availableMb`,
 * `totalMb`, `nodeDefault`), so the assertions describe the policy and never
 * this machine. The two tests that touch the host say so.
 */

// 14-core / 36 GB, the host every constant in the governor was measured on.
// `availableMb` is a healthy unloaded figure; `nodeDefault` is what node's test
// runner picks without `--test-concurrency` (availableParallelism - 1).
const HOST = { cpus: 14, availableMb: 11800, totalMb: 36864, nodeDefault: 13 };

/** Run `body` with `env` applied, restoring the previous values afterwards.
 * Mutating the real environment is the only way to exercise the resolution
 * layer's `CI`/agent-shell composition, which lives there and not in the pure
 * function. */
function withEnv(env, body) {
	const saved = new Map(Object.keys(env).map((key) => [key, process.env[key]]));
	for (const [key, value] of Object.entries(env)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	try {
		return body();
	} finally {
		for (const [key, value] of saved) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

test("the CPU share binds on an unloaded developer machine", () => {
	const decision = computeDesktopTestConcurrency(HOST);
	// floor(14 * 0.5) = 7, and the memory budget is nowhere near binding at
	// 11.8 GB available, so the share is what produces the number.
	assert.equal(decision.arm, "cpu");
	assert.equal(decision.cpuCap, Math.floor(HOST.cpus * _CPU_SHARE));
	assert.equal(decision.concurrency, 7);
});

test("the memory arm binds below twice the reserve, and the floor catches the rest", () => {
	// 4 GB available: budget = min(2 GB, 4 GB - 3 GB) = 1 GB -> 5 workers. Below
	// twice the reserve the memory term takes over from the CPU share.
	const binding = computeDesktopTestConcurrency({ ...HOST, availableMb: 4096 });
	assert.equal(binding.arm, "memory");
	assert.equal(binding.memoryCap, 5);
	assert.equal(binding.concurrency, 5);
	assert.ok(binding.concurrency < 7, "the memory arm must bind below the CPU cap");

	// Above twice the reserve the term is invisible: min(share, available -
	// reserve) == share for all available >= 2 * reserve, so this suite is not
	// charged twice for the same memory. The double-charging form,
	// `(available - reserve) * share`, would allow 8 workers here instead of 16.
	const free = computeDesktopTestConcurrency({ ...HOST, availableMb: 6144 });
	assert.equal(free.arm, "cpu");
	assert.equal(free.memoryCap, 16);
	assert.equal(free.concurrency, 7);

	// 2 GB available: budget = max(0, min(1 GB, 2 GB - 3 GB)) = 0, so the budget
	// allows no worker at all and the floor is the only thing keeping the suite
	// parallel.
	const starved = computeDesktopTestConcurrency({ ...HOST, availableMb: 2048 });
	assert.equal(starved.arm, "min");
	assert.equal(starved.memoryCap, 0);
	assert.equal(starved.concurrency, _MIN_WORKERS);
});

test("the CI arm returns node's default untouched", () => {
	const decision = computeDesktopTestConcurrency({ ...HOST, onCi: true });
	assert.equal(decision.arm, "ci");
	assert.equal(decision.concurrency, HOST.nodeDefault);
	// Not clamped into the 2..8 bounds and not lowered by the memory arm: a
	// hosted runner is dedicated, and taking parallelism away from it is a
	// regression paid on every run.
	const narrow = computeDesktopTestConcurrency({ ...HOST, onCi: true, availableMb: 512 });
	assert.equal(narrow.concurrency, HOST.nodeDefault);
});

test("CI and the harness marker together take the developer path", () => {
	// The distinction is load-bearing and lives in the resolution layer: our own
	// bash tool exports `CI=1` on every agent-run command, so `CI` alone would
	// take the CI arm on a shared laptop and skip the governor exactly where it
	// is needed.
	//
	// The override is cleared in both cases because the SUBJECT here is the
	// `CI`/agent-shell composition. Leaving it ambient made this test pass in a
	// clean shell and fail under `LOCAL_OPERATOR_UI_TEST_CONCURRENCY=12` — the
	// override legitimately outranks the CI arm, so the test has to pin it away
	// rather than inherit whatever the caller exported.
	const onRealCi = withEnv({ CI: "1", [_AGENT_SHELL_ENV]: undefined, [OVERRIDE_ENV]: undefined }, () =>
		resolveDesktopTestConcurrency(),
	);
	assert.equal(onRealCi.arm, "ci");

	const onAgentLaptop = withEnv(
		{ CI: "1", [_AGENT_SHELL_ENV]: "1", [OVERRIDE_ENV]: undefined },
		() => resolveDesktopTestConcurrency(),
	);
	assert.notEqual(onAgentLaptop.arm, "ci");
	assert.ok(
		onAgentLaptop.arm === "cpu" || onAgentLaptop.arm === "memory" || onAgentLaptop.arm === "min",
		`unexpected arm on an agent-run laptop: ${onAgentLaptop.arm}`,
	);
	// And the cap is genuinely lower than node's own answer there, which is the
	// whole point of not standing down.
	assert.ok(
		onAgentLaptop.concurrency <= nodeDefaultConcurrency(onAgentLaptop.cpus),
		"the governor must not raise a developer machine's parallelism",
	);
});

test("an override is honoured unclamped, above and below the bounds", () => {
	const high = computeDesktopTestConcurrency({ ...HOST, override: "12" });
	assert.equal(high.arm, "override");
	assert.equal(high.concurrency, 12); // above _MAX_WORKERS, deliberately

	const low = computeDesktopTestConcurrency({ ...HOST, override: "1", availableMb: 512 });
	assert.equal(low.concurrency, 1); // below _MIN_WORKERS, deliberately

	// The override also wins over the CI arm, so it stays a usable escape hatch
	// on a runner.
	const onCi = computeDesktopTestConcurrency({ ...HOST, onCi: true, override: "3" });
	assert.equal(onCi.concurrency, 3);
});

test("an unusable override degrades to the governed path instead of throwing", () => {
	for (const override of ["", "   ", "abc", "0", "-2", "4abc", null, undefined]) {
		const decision = computeDesktopTestConcurrency({ ...HOST, override });
		assert.equal(decision.arm, "cpu", `override ${JSON.stringify(override)}`);
		assert.equal(decision.concurrency, 7, `override ${JSON.stringify(override)}`);
	}
});

test("an unmeasurable memory probe degrades to the CPU-only cap", () => {
	for (const availableMb of [null, undefined, Number.NaN]) {
		const decision = computeDesktopTestConcurrency({ ...HOST, availableMb });
		assert.equal(decision.arm, "cpu");
		assert.equal(decision.concurrency, 7);
		assert.equal(decision.memoryCap, null);
	}
	// An unmeasurable core count is the same class of failure and must not
	// propagate NaN through the min().
	const noCpus = computeDesktopTestConcurrency({ ...HOST, cpus: null });
	assert.ok(Number.isInteger(noCpus.concurrency));
	assert.equal(noCpus.concurrency, _MIN_WORKERS);
});

test("the clamp holds at both ends", () => {
	// nodeDefault is passed wide here so the never-raise guard cannot be what
	// produces the answer: this case is about the max clamp alone.
	const big = computeDesktopTestConcurrency({
		cpus: 64,
		availableMb: 32768,
		totalMb: 65536,
		nodeDefault: 63,
	});
	assert.equal(big.arm, "max");
	assert.equal(big.concurrency, _MAX_WORKERS);
});

test("the governor never raises parallelism, even when the floor would", () => {
	// A 2-core machine: the CPU share gives 1 and node's own default is 1, so
	// the 2-worker floor would be a RAISE. A governor that may not lower a
	// machine must not raise one either.
	const laptop = computeDesktopTestConcurrency({
		cpus: 2,
		availableMb: 4096,
		totalMb: 8192,
		nodeDefault: nodeDefaultConcurrency(2),
	});
	assert.equal(laptop.arm, "node-default");
	assert.equal(laptop.concurrency, 1);
});

test("a shrinking fleet backs the cap off instead of each run halving the rest", () => {
	const caps = [36864, 12288, 6144, 4096, 2048].map(
		(availableMb) => computeDesktopTestConcurrency({ ...HOST, availableMb }).concurrency,
	);
	assert.deepEqual(caps, [7, 7, 7, 5, 2]);
	for (let i = 1; i < caps.length; i += 1) {
		assert.ok(caps[i] <= caps[i - 1], `cap rose from ${caps[i - 1]} to ${caps[i]}`);
	}
});

test("the reserve is held OUT of the budget, not subtracted from it first", () => {
	// At 6 GB available on a 36 GB host the two shapes differ (16 vs 8 workers),
	// which is the ~2.6-worker double charge the `min` form avoids.
	const availableMb = 6144;
	const reserveMb = Math.min(_MEMORY_RESERVE_CAP_MB, Math.floor(36864 / _MEMORY_RESERVE_FRACTION));
	const decision = computeDesktopTestConcurrency({ ...HOST, availableMb });
	assert.equal(decision.memoryCap, Math.floor(Math.min(availableMb * 0.5, availableMb - reserveMb) / _MB_PER_WORKER));
	assert.notEqual(
		decision.memoryCap,
		Math.floor(((availableMb - reserveMb) * 0.5) / _MB_PER_WORKER),
	);
});

test("the vm_stat parser counts free + speculative + file-backed and nothing else", () => {
	// A captured-shaped sample in which `Pages inactive` is enormous and the
	// machine is in fact nearly out of memory. Counting inactive as available
	// reported 8 GB of headroom on a box with 452 MB free, so it must not count
	// here; the 16K page size must also come from the header rather than from an
	// assumed 4096, which would under-report by 4x.
	const sample = [
		"Mach Virtual Memory Statistics: (page size of 16384 bytes)",
		"Pages free:                               27500.",
		"Pages active:                           1530000.",
		"Pages inactive:                          520000.",
		"Pages speculative:                         1400.",
		"Pages throttled:                              0.",
		"Pages wired down:                        168000.",
		"Pages purgeable:                            900.",
		"File-backed pages:                       400000.",
		"Swapins:                                 900000.",
		"Swapouts:                                900000.",
	].join("\n");
	// (27500 + 1400 + 400000) * 16 KiB, truncated like every other MB figure
	// here (`int(...)`, as in the conftest this mirrors).
	assert.equal(
		availableMbFromVmStat(sample),
		Math.trunc(((27500 + 1400 + 400000) * 16384) / (1024 * 1024)),
	);
});

test("the vm_stat parser returns null rather than a wrong number", () => {
	assert.equal(availableMbFromVmStat("no header here"), null);
	assert.equal(
		availableMbFromVmStat(
			"Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 100.",
		),
		null,
		// A missing "File-backed pages" is NOT a failure: it is absent on some
		// macOS versions, so it degrades to the free-page estimate.
	);
	assert.equal(
		availableMbFromVmStat(
			[
				"Mach Virtual Memory Statistics: (page size of 4096 bytes)",
				"Pages free:                                1024.",
				"Pages speculative:                          512.",
			].join("\n"),
		),
		// 4K pages this time: the size comes from the header, not from a constant.
		((1024 + 512) * 4096) / (1024 * 1024),
	);
});

test("node's default concurrency is availableParallelism - 1, floored at 1", () => {
	assert.equal(nodeDefaultConcurrency(14), 13);
	assert.equal(nodeDefaultConcurrency(2), 1);
	assert.equal(nodeDefaultConcurrency(1), 1);
	assert.equal(nodeDefaultConcurrency(0), 1);
});

test("the evidence line names the arm that actually bound", () => {
	const line = (decision) => formatDesktopTestConcurrencyLine(decision, 23);
	assert.match(
		line(computeDesktopTestConcurrency(HOST)),
		/^desktop tests: 23 files, concurrency 7 \(cpu share 0\.5 of 14 cores; 11\.5 GB available\)$/,
	);
	assert.match(
		line(computeDesktopTestConcurrency({ ...HOST, availableMb: 4096 })),
		/concurrency 5 \(memory budget 1\.0 GB of 4\.0 GB available at 192 MB per worker; cpu share would allow 7\)$/,
	);
	assert.match(
		line(computeDesktopTestConcurrency({ ...HOST, override: "12" })),
		/concurrency 12 \(explicit LOCAL_OPERATOR_UI_TEST_CONCURRENCY; governor bypassed\)$/,
	);
	assert.match(
		line(computeDesktopTestConcurrency({ ...HOST, onCi: true })),
		/concurrency 13 \(CI runner: governor stands down, node default for 14 cores\)$/,
	);
	// A probe failure must read as one rather than as a plausible number.
	assert.match(
		line(computeDesktopTestConcurrency({ ...HOST, availableMb: null })),
		/memory not measurable/,
	);
	// A CI stand-down with no measurable node default must not print a number it
	// does not have (the runner passes no cap in that case).
	assert.match(
		line(computeDesktopTestConcurrency({ ...HOST, onCi: true, nodeDefault: null })),
		/^desktop tests: 23 files, no concurrency cap \(CI runner: governor stands down/,
	);
});

test("resolution on this host never throws and stays plausible", () => {
	// Shape-only assertions: this is one of the two tests that reads the real
	// machine, so it has to pass on a laptop, a 2-vCPU container and a hosted
	// runner alike.
	const decision = resolveDesktopTestConcurrency();
	assert.ok(Number.isInteger(decision.concurrency), "concurrency must be an integer");
	assert.ok(decision.concurrency >= 1, "concurrency must be at least 1");
	assert.ok(decision.concurrency <= 1024, "concurrency must be plausible");
	assert.doesNotThrow(() => formatDesktopTestConcurrencyLine(decision, 23));
});
