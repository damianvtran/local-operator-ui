import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/**
 * Contract checks for the launcher watch.
 *
 * Why these cases: this app is launched by harnesses tens of times over on one
 * machine, and a run whose launcher has gone cannot be ended by anyone — the
 * window is never shown and macOS keeps a windowless app alive. Measured on
 * this repo, a QA round's 13 boots left 13 survivors (`ppid 1`) and an evidence
 * matrix left ~30 in the operator's Dock. The watch is the fix, so what it
 * decides has to be exact in both directions: too eager and it kills a run that
 * is still being driven, too patient and the instance is back.
 *
 * The state machine is stepped directly (`createLauncherWatch().poll()`), not
 * raced against a clock: the whole point of that seam is that "one missed poll"
 * and "two missed polls" are exact, countable states, and a test that slept
 * between them would be asserting on the scheduler. `startLauncherWatch` — the
 * timer wrapper the app runs — gets one real-clock test of its own.
 *
 * The module is bundled in memory from the shipped TypeScript, the same way
 * `window-mode.test.mjs` does, so these stay tests of the code that ships.
 */
const bundle = await build({
	stdin: {
		contents: 'export * from "./src/main/launcher-watch";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	LAUNCHER_MISSES_BEFORE_GONE,
	createLauncherWatch,
	isProcessAlive,
	startLauncherWatch,
} = await import(
	`data:text/javascript;base64,${Buffer.from(
		bundle.outputFiles[0].text,
	).toString("base64")}`
);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The lines of a source file that are not comments.
 *
 * These contract checks are about call sites, and the policy they pin is
 * documented in prose in every module it touches — `app.dock.hide()` named in a
 * comment is not a call, and a check that could not tell them apart would fail
 * on the very comments that explain why the rule exists.
 */
function codeLines(path) {
	return readFileSync(path, "utf8")
		.split("\n")
		.filter((line) => {
			const trimmed = line.trim();
			return !(
				trimmed.startsWith("//") ||
				trimmed.startsWith("/*") ||
				trimmed.startsWith("*") ||
				trimmed.endsWith("*/")
			);
		});
}

/**
 * A call site's code, flattened onto one line.
 *
 * A multi-line call is still one call: asserting per line is how a check passes
 * on `onLauncherGone:` while the handler it names was replaced — or misses a
 * wrapped argument list entirely. Collapsing whitespace keeps the assertion
 * about the arguments rather than about the formatter.
 */
function codeText(path) {
	return codeLines(path)
		.map((line) => line.trim())
		.join(" ")
		.replace(/\s+/g, " ");
}

/** A watch over a launcher whose answers the test sets directly. */
function watchHarness({ alive = true, parent = 4242, misses } = {}) {
	const state = { alive, parent, gone: [], polls: 0 };
	const watch = createLauncherWatch({
		launcherPid: 4242,
		isAlive: () => {
			state.polls += 1;
			return state.alive;
		},
		parentPid: () => state.parent,
		onLauncherGone: (gone) => state.gone.push(gone),
		...(misses === undefined ? {} : { missesBeforeGone: misses }),
	});
	return { state, watch };
}

test("a live launcher is left alone, however many times it is polled", () => {
	const { state, watch } = watchHarness();
	for (let i = 0; i < 20; i += 1) assert.equal(watch.poll(), false);
	assert.deepEqual(state.gone, []);
	assert.equal(state.polls, 20, "the probe is what is asked, once per poll");
});

test("one missed poll does not end a run that is still being driven", () => {
	// The flap case: a probe that reads `false` once — a launcher between fork
	// and exec, a transient error — must not quit the app under a driver that is
	// talking to it, with the threshold at its shipped default.
	const { state, watch } = watchHarness();
	state.alive = false;
	assert.equal(watch.poll(), false, "one miss is not enough");
	state.alive = true;
	assert.equal(watch.poll(), false, "and a recovered launcher resets it");
	assert.deepEqual(state.gone, []);
});

test("consecutive misses fire once, and say it in plain words", () => {
	const { state, watch } = watchHarness();
	state.alive = false;
	assert.equal(watch.poll(), false, `miss 1 of ${LAUNCHER_MISSES_BEFORE_GONE}`);
	assert.equal(watch.poll(), true, "the threshold fires");
	// The console line a person reads states the outcome; the mechanism rides
	// alongside for the backend log.
	assert.equal(state.gone.length, 1);
	assert.equal(
		state.gone[0].message,
		"the process that launched this run (pid 4242) has exited",
	);
	assert.match(state.gone[0].detail, /pid 4242 is gone/);
	assert.doesNotMatch(state.gone[0].message, /pid 1|reparent/);
	// Firing is terminal, and it is the CALL that fires that answers true: an
	// already-fired watch answers false, because nothing is firing now.
	for (let i = 0; i < 5; i += 1) assert.equal(watch.poll(), false);
	assert.equal(state.gone.length, 1);
});

test("being reparented is the same fact seen from the child's side", () => {
	// `process.ppid` no longer naming the launcher means the launcher is gone
	// even if the probe still answers (a pid can be reused); both count toward
	// the same threshold rather than needing a separate path.
	const { state, watch } = watchHarness({ parent: 1 });
	assert.equal(watch.poll(), false);
	assert.equal(watch.poll(), true);
	assert.equal(state.gone.length, 1);
	// The plain line is the same outcome; the detail names what was observed.
	assert.match(state.gone[0].message, /has exited/);
	assert.match(state.gone[0].detail, /reparented to pid 1/);
});

test("stop() is idempotent, and a stopped watch never fires", () => {
	const { state, watch } = watchHarness();
	watch.stop();
	watch.stop();
	state.alive = false;
	// `poll()` answers "has this watch fired" (round 2, N5), so a stopped one
	// answers false however the launcher is doing — it never asked again.
	assert.equal(watch.poll(), false);
	assert.deepEqual(state.gone, []);
});

test("the timer wrapper polls on its own, and stops when told", async () => {
	// The one real-clock case: `startLauncherWatch` is what the app runs, so its
	// interval has to actually drive `poll()`.
	const state = { alive: false, gone: [] };
	const watch = startLauncherWatch({
		launcherPid: 4242,
		intervalMs: 5,
		isAlive: () => state.alive,
		parentPid: () => 4242,
		onLauncherGone: (gone) => state.gone.push(gone),
	});
	await wait(80);
	assert.equal(state.gone.length, 1, "the launcher was gone from the start");
	watch.stop();
	state.gone.length = 0;
	state.alive = false;
	await wait(40);
	assert.deepEqual(state.gone, [], "stop() clears the interval");
});

test("the real probe answers for a live pid and a reaped one", async () => {
	assert.equal(isProcessAlive(process.pid), true);
	// A pid that never existed: the answer must be `false`, not an exception.
	assert.equal(isProcessAlive(0x7ffffff0), false);
	// And a pid that existed and is genuinely gone — the case a harness leaves
	// behind — is `false` too.
	const child = spawn(process.execPath, ["-e", "process.exit(0)"], {
		stdio: "ignore",
	});
	const exited = new Promise((resolve) => child.on("exit", resolve));
	const pid = child.pid;
	await exited;
	// The pid is only guaranteed reaped once the parent has waited on it, which
	// the `exit` event above means; the extra turn covers the reap.
	await wait(20);
	assert.equal(isProcessAlive(pid), false);
});

test("the Dock tile is hidden on the launch plan's word, in one place", () => {
	// `app.dock.hide()` is a main-process call, so it can be reached from any
	// module — and a second call site is how a mode becomes half-applied. It
	// lives in `index.ts`, guarded by the plan, and nowhere else.
	const mainDir = join(process.cwd(), "src", "main");
	const callers = readdirSync(mainDir)
		.filter((name) => name.endsWith(".ts"))
		.filter((name) =>
			codeLines(join(mainDir, name)).some((line) =>
				/app\.dock\.hide\(\)/.test(line),
			),
		);
	assert.deepEqual(callers, ["index.ts"]);

	const index = codeLines(join(mainDir, "index.ts"));
	const hideAt = index.findIndex((line) => /app\.dock\.hide\(\)/.test(line));
	assert.notEqual(hideAt, -1, "the hide is gone");
	const guardAt = index.findIndex((line) =>
		/if \(windowLaunch\.hideDock\)/.test(line),
	);
	assert.notEqual(guardAt, -1, "the guard is gone");
	assert.ok(
		guardAt < hideAt && hideAt - guardAt <= 3,
		`app.dock.hide() is no longer inside the windowLaunch.hideDock guard (guard ${guardAt}, hide ${hideAt})`,
	);
	// The icon is set in the other arm, where a tile exists to carry it.
	assert.ok(
		index.some((line) => /app\.dock\.setIcon\(image\)/.test(line)),
		"the dock icon is no longer set for the modes that keep a tile",
	);
});

test("the watch is wired to the real probe, the real parent and the plan", () => {
	/*
	 * Wiring, not just presence. Every one of these arguments is load-bearing
	 * and each has a failure mode that leaves the suite green: a wrong interval,
	 * a probe that always answers "alive", a parent reader that reads a constant
	 * instead of the live `ppid` (the reparent signal, and half the fix), or a
	 * `launcherPid` from somewhere other than the plan.
	 */
	const index = codeText(join(process.cwd(), "src", "main", "index.ts"));
	const wired = (what, pattern) =>
		assert.match(index, pattern, `the watch no longer wires ${what}`);

	wired(
		"its gate",
		/if \(launcher\.watch && launcher\.launcherPid !== null\) \{/,
	);
	wired("the plan's pid", /launcherPid: launcher\.launcherPid,/);
	wired("the exported interval", /intervalMs: LAUNCHER_POLL_INTERVAL_MS,/);
	wired("the real probe", /isAlive: isProcessAlive,/);
	wired("the live parent", /parentPid: \(\) => process\.ppid,/);
	wired(
		"the launch mode and the live pid",
		/mode: windowLaunch\.mode, launcherPid: process\.ppid,/,
	);
});

test("every way a headless run can end is bounded by the same deadline", () => {
	/*
	 * The defect reappeared on each end path separately — window close, launcher
	 * gone, signal — so pin all three to the one function that arms the bound,
	 * and pin that a signal is only handled in `headless` (a signal handler on
	 * the shipped app would change what Ctrl-C means for a person).
	 */
	const index = codeText(join(process.cwd(), "src", "main", "index.ts"));
	const wired = (what, pattern) =>
		assert.match(index, pattern, `the bounded exit lost ${what}`);

	wired(
		"the arming function",
		/function armHeadlessExitDeadline\(why: string\): void \{/,
	);
	wired("the graceful step", /armHeadlessExitDeadline\(why\); app\.quit\(\);/);
	// 1. launcher gone -> endHeadlessRun -> arm + quit
	wired(
		"the launcher path",
		/onLauncherGone: \(\{ message, detail \}\) => endHeadlessRun\(message, detail\),/,
	);
	// 2. a signal, headless only
	wired(
		"the signal loop",
		/for \(const signal of \["SIGTERM", "SIGINT"\] as const\) \{/,
	);
	// ...and it is inside the headless gate, not on a path the shipped app runs:
	// the signal handler is installed after the gate that names the mode, and a
	// bare handler outside it is asserted absent below.
	const loopAt = index.indexOf("for (const signal of");
	const gateAt = index.indexOf('if (windowLaunch.mode === "headless") {');
	assert.ok(
		gateAt !== -1 && loopAt > gateAt,
		"the SIGTERM/SIGINT handlers are no longer behind the headless gate",
	);
	wired(
		"the signal handler",
		/process\.on\(signal, \(\) => endHeadlessRun\(`received \$\{signal\}`\)\)/,
	);
	// 3. any quit, including a window close
	wired(
		"the quit backstop",
		/if \(windowLaunch\.mode === "headless"\) \{ launcherWatch\?\.stop\(\); armHeadlessExitDeadline\("the app is quitting"\); \}/,
	);
	// Prefixed like its siblings (round 2, D8): the prefix is what a rig greps.
	wired(
		"the window-close path",
		/\[window-mode\] all windows closed in a headless run; quitting/,
	);
	// And the signal path is not wired into the shipped app.
	assert.doesNotMatch(
		index,
		/process\.on\("SIGTERM", \(\) => endHeadlessRun/,
		"a bare SIGTERM handler outside the headless gate would change Ctrl-C for a person",
	);
});
