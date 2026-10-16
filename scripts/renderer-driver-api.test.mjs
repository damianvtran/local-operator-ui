#!/usr/bin/env node
/**
 * The renderer driver's IMPORT and CALLER contract: importing it does nothing a
 * caller can be surprised by, the CLI it has always been still runs `main()`,
 * and the exported surface is a launch context a caller can actually use.
 *
 * WHY THIS FILE EXISTS. The Q1 acceptance caller must import
 * `scripts/renderer-driver.mjs` and drive its existing machinery (the CDP
 * client, the scene verbs, frame capture, the boot lifecycle) instead of
 * copying any of it — `scripts/relaunch-during-quit-proof.mjs` carries a
 * hand-copied `CdpClient` for exactly the want of this. Before the change this
 * suite pins, importing the driver EXECUTED a whole CLI run: `CdpClient` was
 * not exported and the footer called `main()` unconditionally.
 *
 * WHAT IS PINNED, AND WHY EACH HALF IS NEEDED.
 *   - the facade is exactly six frozen facts (no accretion by accident);
 *   - an import has no DRIVER side effects: no `main()` output, no scratch
 *     tree, no process signal/exit handlers (the reapers are installed from
 *     `main()`), no dev-driver environment keys. The ONE process-level effect
 *     is the vendored native image dependency setting `VIPSHOME` at load, and
 *     it is asserted EXACTLY rather than described away;
 *   - a caller's own async SIGTERM cleanup survives the import (behavioural:
 *     two children, control and imported, both must write their marker and
 *     exit 0 — before the fix the import's own handler exited 143 first);
 *   - `prepareDriverContext` binds the caller's backend URL into the scratch
 *     `.env` and refuses a blank binding; `launchApp` refuses without any
 *     binding with a clear message instead of an ENOENT; a PER-CALL `apiUrl`
 *     goes through the same non-empty-string contract before it is assigned,
 *     and a rejected call preserves the prior binding;
 *   - a DIRECT run still reaches the CLI: run against a synthetic app tree
 *     (its own `out/` absent, then present-but-stale), it still REFUSES before
 *     spawning anything — deterministic, and independent of this repository's
 *     own build state.
 *
 * WHAT THIS DOES NOT DO. It never boots the app, opens a CDP connection or
 * touches the network; the only processes are the throwaway children it
 * spawns, and each is reaped by its own exit.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

/** The shipped directory, resolved to the module loader's own (physical) URL. */
const SCRIPTS = dirname(
	fileURLToPath(new URL("./renderer-driver.mjs", import.meta.url)),
);
const REPO = dirname(SCRIPTS);
const DRIVER = join(SCRIPTS, "renderer-driver.mjs");

/** The frozen facade's exact surface, sorted. */
const FACADE_KEYS = [
	"CdpClient",
	"capture",
	"launchApp",
	"prepareDriverContext",
	"reapLiveBoots",
	"verb",
	// Added deliberately when the CI asks producer became a caller: it spawned the
	// app and attached straight away, and a port nothing was listening on turned
	// `fetch` into a bare `TypeError: fetch failed`. This wait is the step every
	// in-repo caller already took before its own attach, so it is part of the
	// caller contract rather than an internal detail.
	// Exported together, for the same caller: a scene must wait for the endpoint,
	// then for the page to paint, then for the bridge to register its verbs -
	// before it sends one. Listed in the sort order the assertion reads them in.
	"waitForBridge",
	"waitForDevtools",
	"waitForPage",
];

/** The two pre-spawn refusals a synthetic tree can reach (`assertBuildIsCurrent`). */
const REFUSAL_ABSENT =
	/refusing to run: `out\/` holds no built renderer assets/;
const REFUSAL_STALE =
	/refusing to run: the built renderer is \d+s OLDER than the newest source file/;
const FAIL_LINE = /\[FAIL\] the run threw/;

/** The driver's own opt-ins, stripped so nothing here can arm a boot. */
const SCRUBBED_PREFIX = /^(CMUX_|LOP_|LOCAL_OPERATOR_UI_DEV_DRIVER)/;

/** `assertBuildIsCurrent`'s content marker; a bundle carrying it passes that arm. */
const BUILD_MARKER = "data-session-control-pair";

/**
 * The ONE process-level effect an import has: loading sharp's vendored libvips
 * sets `VIPSHOME` to the bundled path. It is the native dependency's fact, not
 * this module's code, and it is asserted exactly so the claim cannot drift.
 */
const IMPORT_SIDE_EFFECT = ["VIPSHOME"];

/** The child environment: no CMUX_/LOP_ prefixes (house rule) and no opt-ins. */
function childEnv(extra = {}) {
	const env = { ...process.env };
	for (const key of Object.keys(env)) {
		if (SCRUBBED_PREFIX.test(key)) delete env[key];
	}
	// The runner's OWN import of the driver (the facade test) has already set
	// VIPSHOME in THIS process, and children inherit it — which would mask the
	// very addition the inertness test asserts. Strip it so the child sees the
	// import's own effect (`undefined` rather than `delete`, the driver's own
	// spelling for an env key a child must not receive).
	env.VIPSHOME = undefined;
	return Object.assign(env, extra);
}

/** Run a one-off ESM program in a child; returns the spawnSync result. */
function runChild(program, { cwd = REPO } = {}) {
	return spawnSync(process.execPath, ["--input-type=module", "-e", program], {
		cwd,
		encoding: "utf8",
		env: childEnv(),
		timeout: 60_000,
	});
}

/**
 * A synthetic app tree, for the CLI refusal: its own `package.json` (so the
 * import-time Electron resolution has a base), a `node_modules` link to this
 * repo's (so Electron resolves), and — when `present` — an `out/` bundle that
 * carries the marker but is older than a fresh `src/` file, which is the stale
 * arm. The repo's own build state is never consulted.
 */
function makeSyntheticApp({ present }) {
	const dir = mkdtempSync(join(tmpdir(), "lop-driver-api-"));
	writeFileSync(
		join(dir, "package.json"),
		`${JSON.stringify({ name: "synthetic-app", version: "0.0.0" }, null, 2)}\n`,
	);
	symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"), "dir");
	if (present) {
		mkdirSync(join(dir, "out", "renderer", "assets"), { recursive: true });
		const bundle = join(dir, "out", "renderer", "assets", "bundle.js");
		writeFileSync(
			bundle,
			`/* synthetic bundle */ const marker = ${JSON.stringify(BUILD_MARKER)};\n`,
		);
		const old = new Date("2001-01-01T00:00:00Z");
		utimesSync(bundle, old, old);
		mkdirSync(join(dir, "src"), { recursive: true });
		writeFileSync(join(dir, "src", "main.ts"), "export const fixture = 1;\n");
	}
	return dir;
}

test("the export surface is exactly the frozen facade", async () => {
	const mod = await import("./renderer-driver.mjs");
	assert.deepEqual(
		Object.keys(mod).sort(),
		["prepareDriverContext", "rendererDriverApi"],
		"two exports, so the surface cannot accrete by accident",
	);
	const api = mod.rendererDriverApi;
	assert.ok(Object.isFrozen(api), "the facade must be frozen");
	assert.deepEqual(Object.keys(api).sort(), FACADE_KEYS);
	for (const key of FACADE_KEYS) {
		assert.equal(typeof api[key], "function", `${key} must be a function`);
	}
});

test("attach to a port nothing is listening on RETRIES, and names the port when it gives up", async () => {
	/*
	 * The defect CI caught: a caller attached straight after `launchApp`, the
	 * debugging port was not listening yet, `fetch` REJECTED, and the reject
	 * escaped the retry loop as a bare `TypeError: fetch failed` - a message that
	 * names neither the port nor the fact that the app was still starting. The
	 * loop's own contract is "retry until the target exists", so an unanswered
	 * port is one more not-yet.
	 *
	 * Driven over a port that is provably closed (bound, then released) rather
	 * than a patched `fetch`: the behaviour under test is what the kernel does
	 * with a connection nobody accepts, and a stub would assert the stub.
	 */
	const mod = await import("./renderer-driver.mjs");
	const { CdpClient } = mod.rendererDriverApi;
	const { createServer } = await import("node:net");
	const probe = createServer();
	await new Promise((open) => probe.listen(0, "127.0.0.1", open));
	const closedPort = probe.address().port;
	await new Promise((close) => probe.close(close));

	const started = Date.now();
	await assert.rejects(
		() => CdpClient.attach(closedPort, "out/renderer/index.html", 900),
		(error) => {
			assert.equal(error.name, "Error");
			assert.doesNotMatch(
				String(error.message),
				/TypeError|fetch failed/,
				"a not-yet-listening port is a wait, not a transport failure",
			);
			assert.match(
				error.message,
				new RegExp(
					`no renderer target for out/renderer/index.html on port ${closedPort} after \\d+ms`,
				),
			);
			return true;
		},
	);
	assert.ok(
		Date.now() - started >= 900,
		"the loop must actually have retried for its whole timeout",
	);
});

test("importing the driver runs nothing: no main, no scratch, no handlers, no driver env", () => {
	const program = [
		"const counts = () => ({",
		'\tSIGINT: process.listenerCount("SIGINT"),',
		'\tSIGTERM: process.listenerCount("SIGTERM"),',
		'\texit: process.listenerCount("exit"),',
		"});",
		"const before = new Set(Object.keys(process.env));",
		"const listenersBefore = counts();",
		`const mod = await import(${JSON.stringify(DRIVER)});`,
		"const after = new Set(Object.keys(process.env));",
		"console.log(JSON.stringify({",
		"\tfacade: Boolean(mod.rendererDriverApi),",
		"\tpid: process.pid,",
		"\tadded: [...after].filter((k) => !before.has(k)),",
		"\tremoved: [...before].filter((k) => !after.has(k)),",
		"\tlistenersBefore,",
		"\tlistenersAfter: counts(),",
		'\tdevDriverEnv: Object.keys(process.env).filter((k) => k.startsWith("LOCAL_OPERATOR_UI_DEV_DRIVER")),',
		"}));",
	].join("\n");
	const run = runChild(program);
	assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
	const lines = run.stdout.trim().split("\n");
	assert.equal(
		lines.length,
		1,
		`an import must print nothing but its own report:\n${run.stdout}`,
	);
	const report = JSON.parse(lines[0]);
	assert.equal(report.facade, true);
	assert.deepEqual(
		report.added,
		IMPORT_SIDE_EFFECT,
		"the only env mutation is the vendored libvips VIPSHOME; anything else is a regression",
	);
	assert.deepEqual(report.removed, []);
	assert.deepEqual(
		report.listenersAfter,
		report.listenersBefore,
		"an import must register no signal/exit handlers",
	);
	assert.deepEqual(report.devDriverEnv, []);
	assert.equal(
		existsSync(join(tmpdir(), `lo-renderer-driver-${report.pid}`)),
		false,
		"an import must not materialise the scratch tree",
	);
});

test("a caller's async SIGTERM cleanup survives importing the driver", async () => {
	/** One child: registers its OWN SIGTERM handler whose cleanup defers a tick. */
	const runCase = (withImport) =>
		new Promise((resolveCase, rejectCase) => {
			const dir = mkdtempSync(join(tmpdir(), "lop-driver-sigterm-"));
			const marker = join(dir, "cleanup-ran");
			const program = [
				'import { writeFileSync } from "node:fs";',
				withImport ? `await import(${JSON.stringify(DRIVER)});` : "",
				'process.on("SIGTERM", () => {',
				`\tsetTimeout(() => { writeFileSync(${JSON.stringify(marker)}, "cleanup"); process.exit(0); }, 50);`,
				"});",
				'console.log("READY");',
				"setInterval(() => {}, 1000);",
			].join("\n");
			const child = spawn(
				process.execPath,
				["--input-type=module", "-e", program],
				{ cwd: REPO, env: childEnv(), stdio: ["ignore", "pipe", "pipe"] },
			);
			let out = "";
			child.stdout.on("data", (chunk) => {
				out += chunk.toString();
				if (out.includes("READY")) child.kill("SIGTERM");
			});
			const timer = setTimeout(() => {
				child.kill("SIGKILL");
				rejectCase(new Error(`child did not exit; stdout=${out}`));
			}, 15_000);
			child.on("exit", (code) => {
				clearTimeout(timer);
				resolveCase({ code, marker, dir });
			});
		});

	const control = await runCase(false);
	const imported = await runCase(true);
	try {
		assert.equal(control.code, 0, "control child must exit cleanly");
		assert.ok(existsSync(control.marker), "control cleanup must run");
		assert.equal(
			imported.code,
			0,
			"an import must not exit(143) over the caller's cleanup",
		);
		assert.ok(
			existsSync(imported.marker),
			"imported caller's cleanup must run",
		);
	} finally {
		rmSync(control.dir, { recursive: true, force: true });
		rmSync(imported.dir, { recursive: true, force: true });
	}
});

test("prepareDriverContext binds the backend into the scratch .env; blank apiUrl refuses", () => {
	const success = runChild(
		[
			'import { readFileSync } from "node:fs";',
			'import { join } from "node:path";',
			`const { prepareDriverContext } = await import(${JSON.stringify(DRIVER)});`,
			'const ctx = prepareDriverContext({ apiUrl: "http://127.0.0.1:9" });',
			'console.log(JSON.stringify({ ctx, env: readFileSync(join(ctx.appCwd, ".env"), "utf8") }));',
		].join("\n"),
	);
	assert.equal(success.status, 0, `${success.stdout}\n${success.stderr}`);
	const { ctx, env } = JSON.parse(success.stdout.trim().split("\n").pop());
	try {
		assert.ok(existsSync(ctx.scratch), "the scratch tree must exist");
		assert.ok(
			env.includes("VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:9"),
			`the caller's URL must be the app's binding; got:\n${env}`,
		);
	} finally {
		rmSync(ctx.scratch, { recursive: true, force: true });
	}

	const refusal = runChild(
		[
			`const { prepareDriverContext } = await import(${JSON.stringify(DRIVER)});`,
			"try {",
			'\tprepareDriverContext({ apiUrl: "  " });',
			'\tconsole.log("NO-REFUSAL");',
			"} catch (error) {",
			"\tconsole.log(error.message);",
			"}",
		].join("\n"),
	);
	assert.equal(refusal.status, 0, `${refusal.stdout}\n${refusal.stderr}`);
	assert.match(refusal.stdout, /needs the caller's backend binding/);
});

test("launchApp refuses without a backend binding — a clear message, not an ENOENT", () => {
	const run = runChild(
		[
			`const { rendererDriverApi } = await import(${JSON.stringify(DRIVER)});`,
			"try {",
			"\tawait rendererDriverApi.launchApp({});",
			'\tconsole.log("NO-REFUSAL");',
			"} catch (error) {",
			"\tconsole.log(error.message);",
			"}",
		].join("\n"),
	);
	assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
	assert.match(run.stdout, /launchApp has no backend binding/);
	assert.doesNotMatch(run.stdout, /ENOENT/);
});

test("per-call apiUrl is validated before assignment; a rejected call preserves the prior binding", () => {
	const program = [
		'import { createRequire } from "node:module";',
		'import { readFileSync } from "node:fs";',
		'import { join } from "node:path";',
		"const require = createRequire(import.meta.url);",
		'const cp = require("node:child_process");',
		'const { EventEmitter } = require("node:events");',
		"// Node built-in spawn interception, BEFORE the driver is imported: the",
		"// driver's static named import resolves against the same core-module",
		"// exports object, so no real process is ever started here.",
		"const spawned = [];",
		"const children = [];",
		"cp.spawn = (bin, args, opts) => {",
		"\tspawned.push({ bin, argv0: args[0], cwd: opts.cwd });",
		"\tconst child = new EventEmitter();",
		"\tchild.pid = 4242;",
		"\tchild.stdout = new EventEmitter();",
		"\tchild.stderr = new EventEmitter();",
		"\tchild.kill = () => true;",
		"\tchild.exitCode = null;",
		"\tchild.signalCode = null;",
		"\tchildren.push(child);",
		"\treturn child;",
		"};",
		`const { rendererDriverApi } = await import(${JSON.stringify(DRIVER)});`,
		"const { prepareDriverContext, launchApp } = rendererDriverApi;",
		'const ctx = prepareDriverContext({ apiUrl: "http://127.0.0.1:9" });',
		"const refusals = [];",
		'for (const bad of ["", "  ", 7, null]) {',
		"\ttry {",
		'\t\tawait launchApp({ apiUrl: bad, logName: "bad.log", tag: "bad" });',
		'\t\trefusals.push({ bad: String(bad), outcome: "NO-REFUSAL" });',
		"\t} catch (error) {",
		"\t\trefusals.push({ bad: String(bad), outcome: error.message });",
		"\t}",
		"}",
		"// The rejected calls must not have touched the binding: an omitted",
		"// apiUrl still launches against the prepared URL (fake spawn).",
		'const kept = await launchApp({ logName: "kept.log", tag: "kept" });',
		'const overridden = await launchApp({ apiUrl: "http://127.0.0.1:8", logName: "over.log", tag: "over" });',
		"// Let launchApp's exit listeners clear their flush intervals so this",
		"// process can end on its own.",
		'for (const child of children) child.emit("exit", 0);',
		"console.log(",
		"\tJSON.stringify({",
		"\t\tscratch: ctx.scratch,",
		"\t\trefusals,",
		"\t\tkeptApi: kept.apiUrl,",
		"\t\toverriddenApi: overridden.apiUrl,",
		'\t\tenvAfterOverride: readFileSync(join(ctx.appCwd, ".env"), "utf8"),',
		"\t\tspawned,",
		"\t}),",
		");",
	].join("\n");
	const run = runChild(program);
	assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
	const report = JSON.parse(run.stdout.trim().split("\n").pop());
	try {
		assert.equal(report.refusals.length, 4);
		for (const refusal of report.refusals) {
			assert.match(refusal.outcome, /non-empty string/, `bad=${refusal.bad}`);
		}
		assert.equal(
			report.keptApi,
			"http://127.0.0.1:9",
			"the prior binding must survive the rejected calls",
		);
		assert.equal(report.overriddenApi, "http://127.0.0.1:8");
		assert.ok(
			report.envAfterOverride.includes(
				"VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8",
			),
			"a valid per-call URL must be the app's actual binding",
		);
		assert.equal(
			report.spawned.length,
			2,
			"two positive launches, both intercepted",
		);
		for (const entry of report.spawned) {
			assert.ok(
				String(entry.bin).toLowerCase().includes("electron"),
				entry.bin,
			);
		}
	} finally {
		rmSync(report.scratch, { recursive: true, force: true });
	}
});

test("a direct CLI run still reaches main(): the pre-spawn refusal, absent and present out", () => {
	for (const present of [false, true]) {
		const dir = makeSyntheticApp({ present });
		try {
			const run = spawnSync(process.execPath, [DRIVER, "--scene", "states"], {
				cwd: dir,
				encoding: "utf8",
				env: childEnv(),
				timeout: 60_000,
			});
			assert.notEqual(run.status, 0, "a synthetic tree must refuse, not pass");
			assert.match(run.stdout, FAIL_LINE, run.stdout);
			assert.match(
				run.stdout,
				present ? REFUSAL_STALE : REFUSAL_ABSENT,
				run.stdout,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});
