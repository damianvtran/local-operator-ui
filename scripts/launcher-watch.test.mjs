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
const { LAUNCHER_MISSES_BEFORE_GONE, isProcessAlive, startLauncherWatch } =
	await import(
		`data:text/javascript;base64,${Buffer.from(
			bundle.outputFiles[0].text,
		).toString("base64")}`
	);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The lines of a source file that are not comments.
 *
 * These two contract checks are about call sites, and the policy they pin is
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

/** A watch over a launcher whose answer the test controls, at 5 ms intervals. */
function watchHarness({ alive = true, parent = 4242, misses } = {}) {
	const state = { alive, parent, gone: [] };
	const watch = startLauncherWatch({
		launcherPid: 4242,
		intervalMs: 5,
		isAlive: () => state.alive,
		parentPid: () => state.parent,
		onLauncherGone: (detail) => state.gone.push(detail),
		...(misses === undefined ? {} : { missesBeforeGone: misses }),
	});
	return { state, watch };
}

test("a live launcher is left alone, however long the run goes on", async () => {
	const { state, watch } = watchHarness();
	await wait(60);
	watch.stop();
	assert.deepEqual(state.gone, []);
});

test("a launcher that goes is noticed, named, and reported exactly once", async () => {
	const { state, watch } = watchHarness();
	state.alive = false;
	await wait(
		(LAUNCHER_MISSES_BEFORE_GONE + 2) * 5 +
			/* the polls have to happen before the assertions do */ 30,
	);
	watch.stop();
	assert.equal(state.gone.length, 1);
	assert.match(state.gone[0], /pid 4242 is gone/);
});

test("one missed poll does not end a run that is still being driven", async () => {
	// The flap case: a probe that reads `false` once — a launcher between fork
	// and exec, a transient error — must not quit the app under a driver that
	// is still talking to it.
	const { state, watch } = watchHarness();
	state.alive = false;
	await wait(8);
	state.alive = true;
	await wait(60);
	watch.stop();
	assert.deepEqual(state.gone, []);
});

test("being reparented is the same fact seen from the child's side", async () => {
	// `process.ppid` no longer naming the launcher means the launcher is gone
	// even if the probe still answers (a pid can be reused); both count toward
	// the same threshold rather than needing a separate path.
	const { state, watch } = watchHarness();
	state.parent = 1;
	await wait(
		(LAUNCHER_MISSES_BEFORE_GONE + 2) * 5 +
			/* the polls have to happen before the assertions do */ 30,
	);
	watch.stop();
	assert.equal(state.gone.length, 1);
	assert.match(state.gone[0], /reparented to pid 1/);
});

test("stop() is the caller's way out, and is idempotent", async () => {
	const { state, watch } = watchHarness();
	watch.stop();
	watch.stop();
	state.alive = false;
	await wait(60);
	assert.deepEqual(state.gone, []);
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
	// lives in `index.ts`, guarded by the plan, and nowhere else. Comments are
	// stripped first: this policy is documented in prose in three modules, and
	// naming a call is not making one.
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

test("the watch is started once, in index.ts, only for a launcher-bound run", () => {
	const mainDir = join(process.cwd(), "src", "main");
	const callers = readdirSync(mainDir)
		.filter((name) => name.endsWith(".ts"))
		.filter((name) =>
			codeLines(join(mainDir, name)).some((line) =>
				/startLauncherWatch\(\{/.test(line),
			),
		);
	assert.deepEqual(callers, ["index.ts"]);
	const index = codeLines(join(mainDir, "index.ts"));
	assert.ok(
		index.some((line) =>
			/if \(launcher\.watch && launcher\.launcherPid !== null\)/.test(line),
		),
		"the watch is no longer gated on the plan",
	);
	// A headless run also ends when its window does: nothing else can close it.
	assert.ok(
		index.some((line) =>
			/if \(windowLaunch\.mode === "headless"\) \{/.test(line),
		),
		"the headless window-all-closed branch is gone",
	);
	assert.ok(
		index.some((line) =>
			/All windows closed in a headless run, quitting/.test(line),
		),
		"the headless window-all-closed branch no longer quits",
	);
});
