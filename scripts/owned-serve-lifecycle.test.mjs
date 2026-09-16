import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { EventEmitter, once } from "node:events";
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import vm from "node:vm";
import { build, transform } from "esbuild";
import { pythonChildEnv } from "./python-child-env.mjs";

// No GUI, user rc files, inherited cmux attachment, or real backend is involved.
// Only fixture ChildProcess handles may be signalled; detached fixtures shut
// themselves down over their own HTTP endpoint instead of PID rediscovery.
const home = mkdtempSync(join(tmpdir(), "owned-serve-"));
/*
 * The environment every spawn in this file is handed, built through the shared
 * helper so the python variables are STATED rather than inherited
 * (scripts/python-child-env.mjs): the ambient `PYTHONPYCACHEPREFIX` of an agent
 * shell has pointed inside the operator's installed app, which is how a harness
 * wrote 19 `.pyc` into it. The `CMUX_*` and `LOCAL_OPERATOR_*` scrubs stay - an
 * inherited `CMUX_WORKSPACE_ID` once let a headless test rename the operator's
 * real cmux workspaces - and `PYTHONHOME` no longer needs naming here, because
 * the helper drops every `PYTHON*` variable this file did not set itself.
 */
const baseEnv = Object.fromEntries(
	Object.entries(process.env).filter(
		([key]) => !key.startsWith("CMUX_") && !key.startsWith("LOCAL_OPERATOR_"),
	),
);
const env = pythonChildEnv({
	base: baseEnv,
	extra: {
		HOME: home,
		XDG_CONFIG_HOME: home,
		/* The fixture package this suite proves is importable - the one `PYTHON*`
		 * variable a caller is entitled to set, and the reason the helper drops the
		 * rest rather than refusing the input. */
		PYTHONPATH: home,
		PATH: `${home}/bin:${baseEnv.PATH}`,
	},
});
const python = spawnSync(
	"python3",
	["-c", "import sys; print(sys.executable)"],
	{ env, encoding: "utf8" },
).stdout.trim();
assert.ok(python.startsWith("/"));
mkdirSync(join(home, "bin"));
mkdirSync(join(home, "local_operator"));
writeFileSync(join(home, "local_operator", "__init__.py"), "");
writeFileSync(
	join(home, "bin", "local-operator"),
	`#!${python}\nfrom local_operator.cli import main\nmain()\n`,
);
chmodSync(join(home, "bin", "local-operator"), 0o700);
writeFileSync(
	join(home, "local_operator", "cli.py"),
	`
import http.server, json, os, signal, subprocess, sys, threading, time

def main():
    assert sys.argv[1] == 'serve', sys.argv
    port = int(sys.argv[sys.argv.index('--port') + 1])
    mode = os.environ.get('FIXTURE_MODE', '')
    if mode == 'early': sys.exit(7)
    if mode == 'ignore': signal.signal(signal.SIGTERM, signal.SIG_IGN)
    if mode == 'unready':
        while True: time.sleep(1)
    durable = os.environ.get('DURABLE_PORT')
    if durable:
        child_env = dict(os.environ)
        del child_env['DURABLE_PORT']
        subprocess.Popen([sys.executable, '-c', 'from local_operator.cli import main; main()', 'serve', '--port', durable], env=child_env, start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200); self.end_headers()
            self.wfile.write(json.dumps({'pid': os.getpid(), 'name': 'local-operator serve python', 'mode': mode}).encode())
            if self.path == '/quit': threading.Thread(target=self.server.shutdown).start()
        def log_message(self, *args): pass
    http.server.HTTPServer(('127.0.0.1', port), Handler).serve_forever()
`,
);
/** The entry every fixture bundle builds: the manager and the launch plan under
 * test, with `electron`, `logger` and `config` replaced by stubs. */
const FIXTURE_ENTRY =
	'export * from "./src/main/backend/backend-service"; export * from "./src/main/backend/owned-serve-launch";';

/**
 * The one substitution set the whole file shares.
 *
 * `dialogStub` is the only part tests vary: most of the suite needs the error
 * box to merely not raise, while the failure-path tests read what it was shown.
 * A stub is deliberate here rather than a rendered dialog - this suite proves
 * process ownership, and no test in it claims the visual surface.
 */
const isolatedMain = (dialogStub = "()=>{}") => ({
	name: "isolated-main",
	setup(b) {
		b.onResolve({ filter: /^electron$/ }, () => ({
			path: "electron",
			namespace: "fixture",
		}));
		b.onResolve({ filter: /^\.\/(logger|config)$/ }, (a) =>
			a.importer.endsWith("backend-service.ts")
				? { path: a.path, namespace: "fixture" }
				: undefined,
		);
		b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
			loader: "js",
			contents:
				a.path === "electron"
					? `export const app={getPath:()=>${JSON.stringify(home)}}; export const dialog={showErrorBox:${dialogStub}};`
					: a.path === "./logger"
						? 'export const logger={info(){},warn(){},error(){}}; export const LogFileType={BACKEND:"backend"};'
						: 'export const backendConfig={VITE_DISABLE_BACKEND_MANAGER:"false",VITE_LOCAL_OPERATOR_API_URL:"http://127.0.0.1:1111"};',
		}));
	},
});

/** Build the fixture entry with the given plugins and evaluate it in-process. */
async function buildFixture(plugins) {
	const built = await build({
		stdin: { contents: FIXTURE_ENTRY, resolveDir: process.cwd() },
		bundle: true,
		format: "cjs",
		platform: "node",
		write: false,
		plugins,
	});
	const module = { exports: {} };
	new Function("require", "module", "exports", built.outputFiles[0].text)(
		createRequire(import.meta.url),
		module,
		module.exports,
	);
	return module.exports;
}

const bundle = await buildFixture([isolatedMain()]);
const {
	BackendServiceManager,
	ownedServeLaunch,
	consoleInterpreter,
	windowsInterpreterCandidates,
	windowsPathInterpreterCandidates,
	CONSOLE_RESOLUTION_WORST_MS,
	INTERPRETER_RESOLUTION_WORST_MS,
	OWNED_STOP_WORST_MS,
	READINESS_POLL_INTERVAL_MS,
} = bundle;
BackendServiceManager.prototype.loadShellEnvironment = async () => {};
const managers = [];
const children = [];
const detachedPorts = [];
async function freePort() {
	const s = createServer();
	s.listen(0, "127.0.0.1");
	await once(s, "listening");
	const port = s.address().port;
	await new Promise((r) => s.close(r));
	return port;
}
async function response(port) {
	const r = await fetch(`http://127.0.0.1:${port}/health`, {
		signal: AbortSignal.timeout(1000),
	});
	assert.equal(r.status, 200);
	return r.json();
}
async function ready(port) {
	for (let i = 0; i < 100; i++) {
		try {
			return await response(port);
		} catch {
			await new Promise((r) => setTimeout(r, 20));
		}
	}
	throw Error(`fixture ${port} not ready`);
}
async function manager(mode = "") {
	const m = new BackendServiceManager();
	managers.push(m);
	m.shellEnv = { ...env, FIXTURE_MODE: mode };
	m.isDisabled = false;
	m.port = await freePort();
	m.backendUrl = `http://127.0.0.1:${m.port}`;
	m.checkExistingBackend = async () => false;
	// Keep the real PATH resolver, console interpreter verification, spawn, health
	// HTTP requests, and exit listeners. Only suppress unrelated discovery probes.
	m.checkLocalOperatorExists = async () => true;
	return m;
}
/**
 * A backend this app does NOT own - the fixture that has to survive an exit.
 *
 * Its command line deliberately carries the text the pre-fix cleanup swept on.
 * `pkill -f "local-operator serve"` matched a process's whole command line, so
 * a fixture only discriminates against that regression if its real command line
 * contains the string: the reviewer reinstated the exact pre-fix sweep and this
 * suite stayed green, because no fixture's argv carried it (review round 1, F4).
 * The marker therefore rides in an argument, which is what `ps` and `pkill -f`
 * read, and the assertion below pins the premise instead of trusting it.
 */
async function sentinel() {
	const port = await freePort();
	const plan = await ownedServeLaunch([python], port, env);
	// The marker rides in an ARGUMENT rather than argv[0]: a macOS framework
	// python rewrites its own argv[0] to the resolved interpreter path, so an
	// `exec -a` spelling is not what the process table ends up showing. `ps` and
	// `pkill -f` read the joined argument list, and this is that list.
	const child = spawn(plan.command, [...plan.args, "local-operator serve"], {
		env: plan.env,
		stdio: "ignore",
	});
	children.push(child);
	await ready(port);
	const cmdline = execFileSync(
		"ps",
		["-o", "command=", "-p", String(child.pid)],
		{ encoding: "utf8", env },
	).trim();
	assert.match(
		cmdline,
		/local-operator serve/,
		"the survivor fixture must look like a name sweep's target",
	);
	console.log(`sentinel pid=${child.pid} argv=${cmdline}`);
	return { port, child };
}
after(async () => {
	for (const m of managers) {
		try {
			await m.stop(false);
		} catch {
			m.emergencyStopOwned();
		}
	}
	for (const port of detachedPorts) {
		try {
			await fetch(`http://127.0.0.1:${port}/quit`);
		} catch {}
	}
	for (const child of children)
		if (child.exitCode === null && child.signalCode === null) {
			const exit = once(child, "exit");
			child.kill("SIGKILL");
			await exit;
		}
	rmSync(home, { recursive: true, force: true });
});

test("real owned servers: direct exec PID, external sentinel and durable runtime survive", async () => {
	const a = await manager();
	const b = await manager();
	const external = await sentinel();
	const durable = await freePort();
	detachedPorts.push(durable);
	a.shellEnv.DURABLE_PORT = String(durable);
	assert.equal(await a.start(), true);
	assert.equal(await b.start(), true);
	const aChild = a.process;
	const bChild = b.process;
	assert.equal((await response(a.port)).pid, aChild.pid);
	assert.equal((await response(b.port)).pid, bChild.pid);
	const durableIdentity = await ready(durable);
	const exit = once(aChild, "exit");
	await a.stop(false);
	const result = await exit;
	assert.equal(result[1], "SIGTERM");
	assert.equal((await response(b.port)).pid, bChild.pid);
	assert.equal((await response(external.port)).pid, external.child.pid);
	assert.equal((await response(durable)).pid, durableIdentity.pid);
	console.log(
		`HTTP 200 owned=${aChild.pid}, second=${bChild.pid}, sentinel=${external.child.pid}, durable=${durableIdentity.pid}; owned exit=${JSON.stringify(result)}; survivors HTTP 200`,
	);
	await b.stop(false);
});

test("ignored graceful signal escalates only captured serve; normal/restart grace defaults", async () => {
	const m = await manager("ignore");
	assert.deepEqual(m.shutdownTimeoutMs, {
		restart: 10000,
		normal: 5000,
		force: 3000,
	});
	m.shutdownTimeoutMs = { normal: 40, restart: 60, force: 1000 };
	assert.equal(await m.start(), true);
	const child = m.process;
	const exit = once(child, "exit");
	await m.stop(false);
	assert.equal((await exit)[1], "SIGKILL");
	console.log(
		"ignored SIGTERM -> captured SIGKILL -> observed exit; no descendant selection",
	);
});

test("failed startup is stopped even before readiness; stopped start cannot spawn later", async () => {
	const m = await manager("unready");
	const starting = m.start();
	while (!m.process) await new Promise((r) => setTimeout(r, 10));
	const child = m.process;
	const exit = once(child, "exit");
	await m.stop(true);
	assert.equal(await starting, false);
	assert.equal((await exit)[1], "SIGTERM");
	assert.equal(m.process, null);
	const pending = await manager();
	let resolve;
	pending.checkExistingBackend = () =>
		new Promise((r) => {
			resolve = r;
		});
	const start = pending.start();
	const stop = pending.stop(false);
	resolve(false);
	await stop;
	assert.equal(await start, false);
	assert.equal(pending.process, null);
});

test("startup timeout and early exit clean actual children without claiming running", async () => {
	const early = await manager("early");
	assert.equal(await early.start(), false);
	assert.equal(early.process, null);
	const m = await manager("unready");
	// Keep real requests and children, but accelerate only the readiness polling
	// sleep in this module; signal grace is separately exercised above.
	const original = globalThis.setTimeout;
	globalThis.setTimeout = (fn, ms, ...args) =>
		original(fn, ms === 1000 ? 5 : ms, ...args);
	try {
		assert.equal(await m.start(), false);
		assert.equal(m.process, null);
	} finally {
		globalThis.setTimeout = original;
	}
});

test("concurrent restarts share cleanup and replacement; final quit wins", async () => {
	const m = await manager();
	assert.equal(await m.start(), true);
	const old = m.process;
	const first = m.restart();
	const second = m.restart();
	assert.equal(first, second);
	assert.equal(await first, true);
	assert.notEqual(m.process, old);
	assert.notEqual(old.signalCode, null);
	assert.equal((await response(m.port)).pid, m.process.pid);
	const restart = m.restart();
	await m.stop(false);
	assert.equal(await restart, false);
	assert.equal(m.process, null);
});

function fakeChild(pid = 99123) {
	const c = new EventEmitter();
	Object.assign(c, {
		pid,
		exitCode: null,
		signalCode: null,
		signals: [],
		kill(s) {
			this.signals.push(s);
			return true;
		},
	});
	return c;
}
test("stale exit/timer and reused PID never clear or signal replacement", async () => {
	const m = await manager();
	m.shutdownTimeoutMs = { normal: 15, restart: 15, force: 15 };
	const a = fakeChild();
	const ga = m.captureServe(a);
	// The predecessor is signalled but its exit is NOT delivered yet, so the
	// replacement is captured while the predecessor's death is still
	// unconfirmed. That is the ordering the late-exit guard exists for: the
	// reviewer deleted the guard and this suite stayed green, because emitting
	// the predecessor's exit first made the second call a no-op behind `exited`
	// and the line the title names was never reached (review round 1, F2).
	const stopping = m.stopGeneration(ga, true);
	assert.deepEqual(a.signals, ["SIGTERM"]);
	const b = fakeChild(a.pid);
	const gb = m.captureServe(b);
	assert.equal(m.process, b);
	a.exitCode = 0;
	a.emit("exit", 0, null);
	assert.equal(
		m.process,
		b,
		"a retired generation's late exit is not authority",
	);
	assert.equal(
		m.ownedServe,
		gb,
		"manager ownership still names the replacement",
	);
	await stopping;
	await new Promise((r) => setTimeout(r, 40));
	assert.equal(m.process, b);
	assert.deepEqual(a.signals, ["SIGTERM"]);
	assert.deepEqual(b.signals, []);
	b.exitCode = 0;
	b.emit("exit", 0, null);
	m.emergencyStopOwned();
	assert.deepEqual(b.signals, []);
});

test("a handle the OS already reaped is never signalled, however its number is reused", async () => {
	const m = await manager();
	m.shutdownTimeoutMs = { normal: 10, restart: 10, force: 10 };
	const c = fakeChild();
	const gc = m.captureServe(c);
	// `exitCode` set with no `exit` event is what a handle looks like once the OS
	// has reaped the process: the number may already name something else and Node
	// still accepts a `kill()` on it. `canSignal` is the only thing between that
	// handle and a signal to a stranger - the reviewer reduced it to
	// `return true` and the suite stayed green (review round 1, F2), so this pins
	// it behaviourally rather than in a comment.
	c.exitCode = 0;
	await assert.rejects(
		m.stopGeneration(gc, true),
		/unconfirmed/,
		"a reaped handle cannot confirm an exit",
	);
	assert.deepEqual(
		c.signals,
		[],
		"a reaped handle is not a termination authority",
	);
	assert.equal(m.process, c, "fail-closed cleanup keeps ownership");
});

test("unconfirmed cleanup rejects and retains owner; no replacement starts", async () => {
	const m = await manager();
	m.shutdownTimeoutMs = { normal: 5, restart: 5, force: 5 };
	const c = fakeChild();
	m.captureServe(c);
	await assert.rejects(m.stop(true), /unconfirmed/);
	assert.equal(m.process, c);
	assert.equal(await m.start(), false);
	assert.equal(await m.restart(), false);
	assert.deepEqual(c.signals, ["SIGTERM", "SIGKILL"]);
	c.exitCode = 0;
	c.emit("exit", 0, null);
});

test("spawn failure, disabled, external, and never-started managers have zero kills", async () => {
	for (const flag of ["isDisabled", "isExternalBackend", null]) {
		const m = await manager();
		if (flag) m[flag] = true;
		await m.stop(false);
		m.emergencyStopOwned();
		assert.equal(m.process, null);
	}
	const m = await manager();
	const c = fakeChild(undefined);
	c.pid = undefined;
	m.captureServe(c);
	c.emit("error", new Error("ENOENT"));
	await m.stop(false);
	assert.deepEqual(c.signals, []);
});

test("healthy endpoint replacement after owned exit is not termination authority", async () => {
	const m = await manager();
	assert.equal(await m.start(), true);
	await m.stop(true);
	const plan = await ownedServeLaunch([python], m.port, env);
	const replacement = spawn(plan.command, plan.args, {
		env: plan.env,
		stdio: "ignore",
	});
	children.push(replacement);
	await ready(m.port);
	await m.stop(true);
	assert.equal((await response(m.port)).pid, replacement.pid);
});

test("opaque launcher rejected; cli:main entrypoint works without __main__", async () => {
	const opaque = join(home, "opaque");
	writeFileSync(opaque, '#!/bin/sh\nexec python3 -m local_operator "$@"\n');
	assert.throws(() => consoleInterpreter(opaque), /Cannot safely own/);
	assert.equal(consoleInterpreter(join(home, "bin", "local-operator")), python);
	// The fixture intentionally has no __main__.py; every real HTTP test above
	// exercised the same console entrypoint used by the shipped launcher.
});

test("index quit preserves listeners, waits cleanup, bounds itself and exits nonzero on failure", async () => {
	const source = readFileSync("src/main/index.ts", "utf8");
	// Sliced from the first term of the derivation, so both the arithmetic and the
	// bound the handler arms are inside the code under test rather than assumed
	// from the file above them.
	const start = source.indexOf("const QUIT_FAILSAFE_MARGIN_MS");
	const end = source.indexOf("// Handle before-quit", start);
	const code = (await transform(source.slice(start, end), { loader: "ts" }))
		.code;
	for (const outcome of ["ok", "failed", "stuck"]) {
		const app = new EventEmitter();
		let quit = 0;
		let exit = null;
		let resolve;
		let reject;
		let done = false;
		const hooks = () => {};
		app.on("before-quit", hooks);
		app.on("will-quit", hooks);
		app.quit = () => quit++;
		app.exit = (c) => {
			exit = c;
		};
		const pending = new Promise((r, j) => {
			resolve = r;
			reject = j;
		});
		let stops = 0;
		// The window-side teardown this branch adds to the same handler reads these
		// two module-scope handles, so the sandbox supplies them. They record rather
		// than assert here: what is asserted is below, beside the handler.
		const viewerEndpointStub = {
			closed: 0,
			close() {
				this.closed++;
			},
		};
		const viewerRecordStub = {
			stopped: 0,
			stop() {
				this.stopped++;
			},
		};
		const backendService = {
			isOwnedCleanupComplete: () => done,
			stop: () => {
				stops++;
				return pending;
			},
		};
		// The handler's failsafe is the only timer it arms, so a recorder is enough
		// to drive it: `stuck` is the cleanup that never settles, and the bound is
		// what stops it leaving a windowless app behind (round 1 F5, round 2 F10).
		const timers = [];
		const cleared = [];
		const errors = [];
		vm.runInNewContext(code, {
			app,
			backendService,
			viewerEndpoint: viewerEndpointStub,
			viewerRecord: viewerRecordStub,
			logger: { error: (message) => errors.push(String(message)) },
			LogFileType: { BACKEND: "backend" },
			// The derivation's terms, as the module under test imports them.
			CONSOLE_RESOLUTION_WORST_MS,
			INTERPRETER_RESOLUTION_WORST_MS,
			OWNED_STOP_WORST_MS,
			READINESS_POLL_INTERVAL_MS,
			setTimeout: (fn, ms) => {
				const timer = { fn, ms, unref: () => {} };
				timers.push(timer);
				return timer;
			},
			clearTimeout: (timer) => cleared.push(timer),
		});
		let prevented = 0;
		app.emit("will-quit", {
			preventDefault() {
				prevented++;
			},
		});
		app.emit("will-quit", {
			preventDefault() {
				prevented++;
			},
		});
		assert.equal(stops, 1);
		assert.equal(quit, 0);
		assert.equal(prevented, 2);
		assert.ok(app.listeners("before-quit").includes(hooks));
		assert.ok(app.listeners("will-quit").includes(hooks));
		assert.equal(timers.length, 1, "the quit armed exactly one bound");
		// The branch's teardown sits ABOVE the owned-cleanup guard, so it runs on the
		// early-return path too — the case where there is no owned backend to stop and
		// the record would otherwise be left advertising a port nothing listens on.
		// Without the stubs above this path threw `viewerEndpoint is not defined`
		// (review round 4's rebase); with them it is asserted rather than assumed.
		assert.ok(
			viewerEndpointStub.closed >= 1,
			"the viewer endpoint is closed on the quit path",
		);
		assert.ok(
			viewerRecordStub.stopped >= 1,
			"the viewer record is removed on the quit path",
		);
		/*
		 * ...AND ITS PLACEMENT IS OBSERVED, NOT JUST ITS EFFECT (review round 5,
		 * R5-3). The two assertions above are satisfied wherever the teardown sits,
		 * because the two emissions before them both run it — so moving it BELOW the
		 * guard left every case green while the comment claimed otherwise. This third
		 * emission is the early-return path itself: `done` is true, so the guard
		 * returns without stopping anything (asserted by `prevented` not moving), and
		 * only a teardown placed above that return runs.
		 */
		done = true;
		const stoppedBeforeEarlyReturn = viewerRecordStub.stopped;
		const preventedBeforeEarlyReturn = prevented;
		app.emit("will-quit", {
			preventDefault() {
				prevented++;
			},
		});
		assert.equal(
			prevented,
			preventedBeforeEarlyReturn,
			"the owned-cleanup guard returned early, so this pass prevented nothing",
		);
		assert.ok(
			viewerRecordStub.stopped > stoppedBeforeEarlyReturn,
			"the viewer record is removed on the early-return path too, so the teardown must sit above the guard",
		);
		// Pinned to the derivation, not to a literal (round 3, F12): the bound must
		// cover every step the quit waits on, and it must not be an order of
		// magnitude above them either. Asserting a bare `<= 60_000` is what forbade
		// the correct bound and let the 60 s constant survive its own arithmetic.
		const derived =
			CONSOLE_RESOLUTION_WORST_MS +
			INTERPRETER_RESOLUTION_WORST_MS +
			OWNED_STOP_WORST_MS +
			READINESS_POLL_INTERVAL_MS;
		assert.ok(
			timers[0].ms >= derived,
			`bound ${timers[0].ms} ms must cover the ${derived} ms it waits on`,
		);
		assert.ok(
			timers[0].ms <= derived + 15_000,
			`bound ${timers[0].ms} ms must stay within its margin of ${derived} ms`,
		);
		if (outcome === "failed") reject(Error("cleanup"));
		else if (outcome === "ok") {
			done = true;
			resolve();
		}
		if (outcome === "stuck") {
			await new Promise((r) => setImmediate(r));
			assert.equal(
				exit,
				null,
				"nothing exits while the cleanup is still running",
			);
			timers[0].fn();
			assert.equal(
				exit,
				1,
				"the bound exits rather than leaving the app windowless",
			);
			assert.match(
				errors.join("\n"),
				/Owned backend cleanup did not finish within \d+ ms/,
			);
			continue;
		}
		await new Promise((r) => setImmediate(r));
		assert.equal(quit, outcome === "ok" ? 1 : 0);
		assert.equal(exit, outcome === "ok" ? null : 1);
		assert.equal(
			cleared.length,
			1,
			"a settled cleanup puts its bound out rather than leaving it to fire",
		);
	}
});

test("native update handoff awaits owned cleanup before markers/watchdog/install", async () => {
	const source = readFileSync("src/main/update-service.ts", "utf8");
	const start = source.indexOf('ipcMain.handle("quit-and-install",');
	const end = source.indexOf("\n\t\t/**", start);
	const code = (await transform(source.slice(start, end), { loader: "ts" }))
		.code;
	for (const failed of [false, true]) {
		const actions = [];
		let resolve;
		let reject;
		const pending = new Promise((r, j) => {
			resolve = r;
			reject = j;
		});
		let handler;
		const owner = {
			installPreflightInFlight: false,
			runInstallPreflight: async () => null,
			backendService: {
				stop: () => {
					actions.push("stop");
					return pending;
				},
				setAutoUpdating: () => {},
			},
			lastUpdateInfo: { version: "9.9.9" },
			launchWatchdog: () => {
				actions.push("watchdog");
				return null;
			},
			markerDir: () => home,
			downloadHelper: () => null,
		};
		const context = {
			ipcMain: {
				handle: (_, f) => {
					handler = f;
				},
			},
			logger: { info() {}, error() {} },
			LogFileType: { UPDATE_SERVICE: "update" },
			/*
			 * `isPackaged` is read in this same slice by the guard that keeps an
			 * unpackaged instance out of the shared marker the packaged app reads, and
			 * this handoff only ever runs in a packaged app - so the context has to
			 * answer it, or the handler returns before the cleanup this test is about.
			 */
			app: { getVersion: () => "9.9.8", isPackaged: true },
			writePendingInstallMarker: (_, marker) => {
				actions.push("marker");
				return marker;
			},
			autoUpdater: { quitAndInstall: () => actions.push("install") },
		};
		const run = vm.runInNewContext(`(function(){${code}})`, context);
		run.call(owner);
		const result = handler();
		await new Promise((r) => setImmediate(r));
		assert.deepEqual(actions, ["stop"]);
		assert.equal(owner.installPreflightInFlight, true);
		if (failed) reject(Error("unconfirmed"));
		else resolve();
		assert.equal(await result, !failed);
		assert.deepEqual(
			actions,
			failed ? ["stop"] : ["stop", "watchdog", "marker", "install"],
		);
	}
	assert.doesNotMatch(
		source,
		/registerBackendShutdown|forceTerminateBackendProcess|removeAllListeners\("before-quit"\)/,
	);
	for (const file of [
		"src/main/index.ts",
		"src/main/backend/backend-service.ts",
		"src/main/update-service.ts",
	]) {
		assert.doesNotMatch(
			readFileSync(file, "utf8"),
			/pkill|taskkill|ps aux|pgrep|wmic process/,
		);
	}
});

/**
 * The only way this suite can hold a Windows identity: there is no Windows host
 * here, so the launch plan is asserted rather than observed. What that proves is
 * the DECISION (which interpreter, with which environment, and which refusal),
 * not the platform - that a real Windows redirector reaches serve this way is
 * reasoned from CPython's documented venv layout and remains unverified without
 * a Windows host, as the PR thread says.
 */
/**
 * The probe now runs its own child - it has to be able to escalate its kill -
 * so the seam in these fixture bundles is `spawn`, not `execFile`.
 *
 * Each queued outcome is one answer: an identity array, `{ spawnError }` for a
 * candidate that is not there, `{ exit: { code, stderr } }` for one that ran and
 * failed, or `{ hang: true }` for one that never answers - which is how the
 * ceiling, the retry and the escalation are exercised without waiting out a real
 * 30 s ceiling. A `hang` child answers SIGKILL the way a real process does, and
 * records the signals it was sent, so the escalation is asserted rather than
 * assumed.
 */
function probeChild(outcome) {
	// An exhausted queue means the probe answered nothing useful, which is a child
	// that never answers - the same shape as `hang`.
	const answer = outcome ?? { hang: true };
	const child = new EventEmitter();
	child.pid = 40000 + Math.floor(Math.random() * 1000);
	child.stdout = new EventEmitter();
	child.stderr = new EventEmitter();
	child.signals = [];
	globalThis.__probeChildren ??= [];
	globalThis.__probeChildren.push(child);
	child.kill = (signal) => {
		child.signals.push(signal);
		if (signal === "SIGKILL")
			setImmediate(() => child.emit("close", null, signal));
		return true;
	};
	setImmediate(() => {
		if (answer.hang) return;
		if (answer.spawnError) {
			const error = new Error(answer.spawnError);
			error.code = answer.spawnError;
			child.emit("error", error);
			return;
		}
		if (answer.exit) {
			if (answer.exit.stderr)
				child.stderr.emit("data", Buffer.from(answer.exit.stderr));
			child.emit("close", answer.exit.code, null);
			return;
		}
		child.stdout.emit("data", Buffer.from(JSON.stringify(answer)));
		child.emit("close", 0, null);
	});
	return child;
}
globalThis.__probeChild = probeChild;

const probeStub = {
	name: "interpreter-probe",
	setup(builder) {
		// Only `spawn` is replaced - plus `execFileSync` with a live, non-zombie
		// answer for the `ps -o state=` probe discovery spends on a quiet record -
		// and only for the modules under test: every other child_process export
		// keeps working, so the bundle stays real.
		builder.onResolve({ filter: /^node:child_process$/ }, (args) =>
			args.namespace === "probe"
				? { path: "node:child_process", external: true }
				: { path: "probe", namespace: "probe" },
		);
		builder.onLoad({ filter: /.*/, namespace: "probe" }, () => ({
			loader: "js",
			contents:
				'export { exec, execFile, spawnSync } from "node:child_process"; export function execFileSync() { return "S"; } export function spawn(command,args,options){globalThis.__probeCalls.push({command,args,options});return globalThis.__probeChild(globalThis.__probeResults.shift());}',
		}));
	},
};

test("Windows launch spawns the venv's base interpreter, and refuses one that is not direct", async () => {
	const fixture = await buildFixture([isolatedMain(), probeStub]);
	globalThis.__probeCalls = [];
	// `Scripts\python.exe` inside any venv - a `uv`/`pipx` tool env and the
	// bundled venv alike - is a redirector that starts the base interpreter as
	// its own child. Owning the redirector would not own serve, and reaching the
	// child is a process-tree sweep, so the plan must name the BASE interpreter
	// with the venv's own import paths, and prove the base reported itself
	// (review round 1, F1).
	globalThis.__probeResults = [
		[
			"/venv/Scripts/python.exe",
			"/base/python.exe",
			true,
			["/venv/Lib/site-packages"],
		],
		["/base/python.exe", "/base/python.exe", true, ["/base/Lib/site-packages"]],
	];
	const plan = await fixture.ownedServeLaunch(
		["/venv/Scripts/python.exe"],
		12345,
		env,
		"win32",
	);
	assert.equal(plan.command, "/base/python.exe");
	assert.deepEqual(plan.args, [
		"-c",
		"from local_operator.cli import main; main()",
		"serve",
		"--port",
		"12345",
	]);
	assert.match(
		globalThis.__probeCalls[0].args[1],
		/from local_operator.cli import main/,
	);
	assert.equal(globalThis.__probeCalls[1].command, "/base/python.exe");
	assert.equal(
		plan.env.PYTHONPATH,
		`/venv/Lib/site-packages;${env.PYTHONPATH}`,
		"the base is told where the venv's own packages are, before any existing path",
	);
	assert.equal(
		globalThis.__probeCalls[1].options.env.PYTHONPATH,
		plan.env.PYTHONPATH,
		"the base was probed with the environment it will be spawned with",
	);

	// An interpreter that already IS the base needs no second probe and no
	// environment change - one code path, decided from the interpreter's report.
	globalThis.__probeCalls = [];
	globalThis.__probeResults = [
		["/base/python.exe", "/base/python.exe", true, ["/base/Lib/site-packages"]],
	];
	const direct = await fixture.ownedServeLaunch(
		["/base/python.exe"],
		12345,
		env,
		"win32",
	);
	assert.equal(direct.command, "/base/python.exe");
	assert.equal(
		direct.env,
		env,
		"a direct interpreter needs no environment change",
	);
	assert.equal(globalThis.__probeCalls.length, 1);

	// The base must report ITSELF, or the PID captured would not be serve.
	globalThis.__probeResults = [
		["/venv/Scripts/python.exe", "/base/python.exe", true, ["/venv/Lib"]],
		["/other/python.exe", "/other/python.exe", true, []],
	];
	await assert.rejects(
		fixture.ownedServeLaunch(["/venv/Scripts/python.exe"], 12345, env, "win32"),
		/reported itself as \/other\/python\.exe/,
	);

	// A base that cannot import the CLI even with the venv's paths is refused in
	// the terms a user can act on, rather than the app being unusable.
	globalThis.__probeResults = [
		["/venv/Scripts/python.exe", "/base/python.exe", true, ["/venv/Lib"]],
		["/base/python.exe", "/base/python.exe", false, []],
	];
	await assert.rejects(
		fixture.ownedServeLaunch(["/venv/Scripts/python.exe"], 12345, env, "win32"),
		/cannot import local_operator\.cli even with the venv's own import paths/,
	);

	// A candidate that is not there is one rejected claim, not the end of the
	// search: the next claim gets its own probe and can win (review round 2, F8).
	globalThis.__probeCalls = [];
	globalThis.__probeResults = [
		{ spawnError: "ENOENT" },
		["/venv/Scripts/python.exe", "/base/python.exe", true, ["/venv/Lib"]],
		["/base/python.exe", "/base/python.exe", true, []],
	];
	const afterMissing = await fixture.ownedServeLaunch(
		["/gone/python.exe", "/venv/Scripts/python.exe"],
		12345,
		env,
		"win32",
	);
	assert.equal(afterMissing.command, "/base/python.exe");
	assert.deepEqual(
		globalThis.__probeCalls.map((call) => call.command),
		["/gone/python.exe", "/venv/Scripts/python.exe", "/base/python.exe"],
		"the absent candidate is probed first, rejected, and the next one takes over",
	);

	// POSIX is unchanged: the same plan shape, and the environment untouched.
	globalThis.__probeCalls = [];
	globalThis.__probeResults = [
		["/python/python", "/python/python", true, ["/python/lib"]],
	];
	const posix = await fixture.ownedServeLaunch(["/python/python"], 12345, env);
	assert.equal(posix.command, "bash");
	assert.equal(posix.env, env, "the POSIX plan passes its environment through");
	// biome-ignore lint/performance/noDelete: this teardown returns the fixture global to ABSENT, which is the state the harness's own `globalThis.__…` checks read; `= undefined` would leave the property present.
	delete globalThis.__probeResults;
	// biome-ignore lint/performance/noDelete: this teardown returns the fixture global to ABSENT, which is the state the harness's own `globalThis.__…` checks read; `= undefined` would leave the property present.
	delete globalThis.__probeCalls;
});

test("a slow first probe is retried, and a stuck interpreter is killed and reported", async () => {
	const fixture = await buildFixture([isolatedMain(), probeStub]);
	// Milliseconds, so the ceiling, the retry and the escalation are measured
	// rather than waited out; production uses the module's own defaults.
	const tight = { totalMs: 4_000, attemptMs: 300, graceMs: 60, slackMs: 60 };
	globalThis.__probeCalls = [];
	globalThis.__probeChildren = [];
	// The probe pays a cold import of the CLI. Failing closed on the first slow
	// attempt turned a loaded machine's first run into a blocking modal with no
	// retry in that launch (QA round 2, observation 2), so a timeout is retried
	// once - the attempt that timed out warmed the bytecode cache.
	globalThis.__probeResults = [
		{ hang: true },
		["/python/python", "/python/python", true, []],
	];
	const plan = await fixture.ownedServeLaunch(
		["/python/python"],
		4321,
		env,
		"darwin",
		tight,
	);
	assert.equal(globalThis.__probeCalls.length, 2, "a timeout is retried once");
	assert.deepEqual(plan.args.slice(-2), ["--port", "4321"]);

	// A stuck interpreter: the first attempt is escalated - SIGTERM, then SIGKILL
	// when it does not die - the retry is spent, and the failure names the ceiling
	// instead of hanging the start path. `execFile`'s single signal is what left
	// this promise pending for good (review round 2, F9).
	globalThis.__probeCalls = [];
	globalThis.__probeChildren = [];
	globalThis.__probeResults = [{ hang: true }, { hang: true }];
	const started = Date.now();
	await assert.rejects(
		fixture.ownedServeLaunch(["/python/python"], 4321, env, "darwin", tight),
		/did not answer an identity probe within \d+ ms/, // the effective ceiling, which the shared budget can reduce
	);
	assert.ok(
		Date.now() - started < 3_000,
		"both attempts and their escalation fit inside the budget",
	);
	assert.equal(
		globalThis.__probeCalls.length,
		2,
		"a stuck interpreter is not retried forever",
	);
	assert.deepEqual(
		globalThis.__probeChildren.map((child) => child.signals),
		[
			["SIGTERM", "SIGKILL"],
			["SIGTERM", "SIGKILL"],
		],
		"each attempt escalates past a SIGTERM the interpreter ignored",
	);
	// biome-ignore lint/performance/noDelete: this teardown returns the fixture global to ABSENT, which is the state the harness's own `globalThis.__…` checks read; `= undefined` would leave the property present.
	delete globalThis.__probeResults;
	// biome-ignore lint/performance/noDelete: this teardown returns the fixture global to ABSENT, which is the state the harness's own `globalThis.__…` checks read; `= undefined` would leave the property present.
	delete globalThis.__probeCalls;
	// biome-ignore lint/performance/noDelete: this teardown returns the fixture global to ABSENT, which is the state the harness's own `globalThis.__…` checks read; `= undefined` would leave the property present.
	delete globalThis.__probeChildren;
});

test("interpreter candidates are claims: a later one is admitted when an earlier one is not there", async () => {
	// The real probe path with real children. The first claim cannot be probed at
	// all, the second is this suite's fixture interpreter, which really does import
	// the fixture `local_operator.cli` - so a wrong guess about where an interpreter
	// lives costs one probe instead of the app (review round 2, F8).
	const missing = join(home, "not-an-interpreter", "python");
	const plan = await ownedServeLaunch([missing, python], await freePort(), env);
	assert.equal(plan.command, "bash");
	assert.equal(
		plan.args[3],
		python,
		"the plan names the candidate that proved itself, not the first one offered",
	);

	await assert.rejects(
		ownedServeLaunch(
			[missing, join(home, "also-missing-python")],
			await freePort(),
			env,
			"darwin",
			{ totalMs: 2_000, attemptMs: 500, graceMs: 60, slackMs: 60 },
		),
		/No backend interpreter could be proven[\s\S]*not-an-interpreter[\s\S]*uv tool install local-operator/,
	);

	// No claims at all is its own message rather than a probe against nothing.
	await assert.rejects(
		ownedServeLaunch([], await freePort(), env),
		/No backend interpreter was resolved/,
	);
});

test("PATH discovery is not paid when a claim above it proves out", async () => {
	// Round 3, F14: the two discovery children are start-path latency, and
	// therefore quit-path latency, so they are asked for only after every claim
	// above them has failed.
	let asked = 0;
	const plan = await ownedServeLaunch(
		[python],
		await freePort(),
		env,
		"darwin",
		{},
		async () => {
			asked++;
			return [];
		},
	);
	assert.equal(asked, 0, "an admitted claim must not pay for PATH discovery");
	assert.equal(plan.args[3], python);

	let askedWhenNeeded = 0;
	await assert.rejects(
		ownedServeLaunch(
			[join(home, "not-here", "python")],
			await freePort(),
			env,
			"darwin",
			{ totalMs: 2_000, attemptMs: 500, graceMs: 60, slackMs: 60 },
			async () => {
				askedWhenNeeded++;
				return [];
			},
		),
		/No backend interpreter could be proven/,
	);
	assert.equal(
		askedWhenNeeded,
		1,
		"the fallback claims are asked when nothing above them proved out",
	);
});

test("an interpreter that exists but is not the backend is rejected, and the next claim is admitted", async () => {
	// Round 3, F13: the branch this fix depends on most - a real system Python
	// that cannot import the CLI - was carried by a comment and by no test. A path
	// that exists is not a backend; the probe decides.
	const probeEnv = { ...env };
	// biome-ignore lint/performance/noDelete: an ABSENT `PYTHONPATH` is not an empty one here - `PYTHONPATH=""` puts the cwd on `sys.path`, which is exactly the fixture this probe must not be able to import.
	delete probeEnv.PYTHONPATH;
	const wrong = [
		"/usr/bin/python3",
		"/opt/homebrew/bin/python3",
		"/usr/local/bin/python3",
	].find(
		(candidate) =>
			existsSync(candidate) &&
			spawnSync(candidate, ["-c", "import local_operator"], { env: probeEnv })
				.status !== 0,
	);
	if (!wrong) return; // no interpreter on this host without the fixture on its path

	// A second interpreter that really is a backend, carrying the fixture package
	// in its own site-packages so one environment serves both claims.
	const venv = join(home, "second-claim-venv");
	if (!existsSync(join(venv, "bin", "python"))) {
		const made = spawnSync(python, ["-m", "venv", "--without-pip", venv], {
			env: probeEnv,
			encoding: "utf8",
		});
		assert.equal(made.status, 0, made.stderr);
		const site = spawnSync(
			join(venv, "bin", "python"),
			["-c", "import site; print(site.getsitepackages()[0])"],
			{ env: probeEnv, encoding: "utf8" },
		).stdout.trim();
		cpSync(join(home, "local_operator"), join(site, "local_operator"), {
			recursive: true,
		});
	}
	const second = join(venv, "bin", "python");
	const wide = {
		totalMs: 20_000,
		attemptMs: 10_000,
		graceMs: 200,
		slackMs: 200,
	};
	const plan = await ownedServeLaunch(
		[wrong, second],
		await freePort(),
		probeEnv,
		"darwin",
		wide,
	);
	assert.equal(
		realpathSync(plan.args[3]),
		realpathSync(second),
		"the plan names the claim that proved itself, not the one that merely exists",
	);

	// And the rejected claim's message carries the cause rather than only the
	// traceback header it starts with (round 4, Q-21).
	await assert.rejects(
		ownedServeLaunch([wrong], await freePort(), probeEnv, "darwin", wide),
		/ImportError|ModuleNotFoundError/,
	);
});

test("a start failure during a shutdown is logged, and raises no modal", async () => {
	// Round 4, Q-20: `showErrorBox` parks the main thread, and the quit's bound is
	// a timer on that thread - so a failure raised while a quit is in flight must
	// not raise one. Driven directly, because the timing inside a start is not
	// something a test can hold still.
	const { BackendServiceManager: Manager } = await buildFixture([
		isolatedMain(
			"(title,message)=>{globalThis.__dialog.push([title,message]);}",
		),
	]);
	Manager.prototype.loadShellEnvironment = async () => {};
	globalThis.__dialog = [];
	const m = new Manager();
	m.shellEnv = { ...env };
	m.isDisabled = false;

	m.isAppClosing = false;
	m.reportStartFailure("Backend Error", "the backend did not start");
	assert.equal(
		globalThis.__dialog.length,
		1,
		"an ordinary start failure still tells the user",
	);
	assert.equal(m.isShuttingDown(), false);

	globalThis.__dialog = [];
	m.isAppClosing = true;
	m.reportStartFailure("Backend Error", "the backend did not start");
	assert.equal(
		globalThis.__dialog.length,
		0,
		"no modal while a quit is in flight: it would park the thread the quit needs",
	);
	assert.equal(m.isShuttingDown(), true);
	// biome-ignore lint/performance/noDelete: this teardown returns the fixture global to ABSENT, which is the state the harness's own `globalThis.__…` checks read; `= undefined` would leave the property present.
	delete globalThis.__dialog;
});

test("index's start-failure reporter consults the shutdown state, and nothing bypasses it", async () => {
	const source = readFileSync("src/main/index.ts", "utf8");
	// One call site, inside the guard: a second `showErrorBox` anywhere in this
	// file is a modal that can park a quit again. Comment mentions do not count.
	const dialogCalls = source
		.split("\n")
		.filter(
			(line) =>
				line.includes("dialog.showErrorBox") &&
				!line.trimStart().startsWith("*"),
		);
	assert.equal(
		dialogCalls.length,
		1,
		`exactly one dialog call, inside the shutdown-guarded reporter, not ${dialogCalls.length}`,
	);
	const start = source.indexOf("const reportBackendFailure");
	const end = source.indexOf("\n};\n", start);
	assert.ok(
		start > 0 && end > start,
		"the reporter is in the source where this test expects it",
	);
	const code = (await transform(source.slice(start, end + 4), { loader: "ts" }))
		.code;
	const call = (shuttingDown) => {
		const shown = [];
		const logged = [];
		vm.runInNewContext(
			`${code}\nreportBackendFailure("Backend Error: boom", "backend");`,
			{
				backendService: { isShuttingDown: () => shuttingDown },
				logger: { error: (message) => logged.push(String(message)) },
				LogFileType: { BACKEND: "backend" },
				dialog: {
					showErrorBox: (title, message) => shown.push([title, message]),
				},
			},
		);
		return { shown, logged };
	};
	const outside = call(false);
	assert.equal(
		outside.shown.length,
		1,
		"a start failure outside a shutdown is shown",
	);
	const during = call(true);
	assert.equal(
		during.shown.length,
		0,
		"a start failure during a shutdown is logged instead of parked in a modal",
	);
	assert.match(during.logged.join("\n"), /not shown; the app is shutting down/);
});

test("Windows candidates cover the layouts an installer can produce, and drop what is not there", async () => {
	const uvRoot = join(home, "uv", "tools");
	const pipxRoot = join(home, "pipx-venvs");
	const siblingDir = join(home, "windows-bin");
	mkdirSync(join(uvRoot, "local-operator", "Scripts"), { recursive: true });
	mkdirSync(join(pipxRoot, "venvs", "local-operator", "Scripts"), {
		recursive: true,
	});
	mkdirSync(siblingDir, { recursive: true });
	for (const file of [
		join(siblingDir, "python.exe"),
		join(uvRoot, "local-operator", "Scripts", "python.exe"),
		join(pipxRoot, "venvs", "local-operator", "Scripts", "python.exe"),
	])
		writeFileSync(file, "");
	const candidates = await windowsInterpreterCandidates(
		join(siblingDir, "local-operator.exe"),
		{ ...env, UV_TOOL_DIR: uvRoot, PIPX_HOME: pipxRoot },
	);
	assert.deepEqual(candidates, [
		join(siblingDir, "python.exe"),
		join(uvRoot, "local-operator", "Scripts", "python.exe"),
		join(pipxRoot, "venvs", "local-operator", "Scripts", "python.exe"),
	]);
	// `where`/`py` do not exist on this host, so the two PATH-side entries are the
	// part of this list no test here exercises - the PR thread says so rather than
	// implying coverage.
	const absent = await windowsInterpreterCandidates(
		join(home, "nothing-here", "local-operator.exe"),
		{ ...env, UV_TOOL_DIR: join(home, "no-such-tools") },
	);
	assert.deepEqual(
		absent,
		[],
		"claims that do not exist are not offered to a probe",
	);
	// The PATH-side claims are their own function now (round 3, F14), so the two
	// discovery children are only paid when nothing above them proved out. `where`
	// and `py` do not exist on this host, so this asserts the miss is handled and
	// not the Windows answer - the PR thread says so rather than implying coverage.
	assert.deepEqual(await windowsPathInterpreterCandidates(env), []);
});

test("a probe against an interpreter that ignores SIGTERM is killed and reported, not left pending", async () => {
	// A REAL child that ignores SIGTERM - the shape `execFile`'s single signal left
	// pending for good (review round 2, F9). The shim execs into python, so the PID
	// it records is the interpreter the probe signalled.
	const pidFile = join(home, "stubborn.pid");
	const stubborn = join(home, "bin", "stubborn-python");
	writeFileSync(
		stubborn,
		`#!/bin/sh\nexec ${JSON.stringify(python)} -c "import os, signal, time; open(os.environ['STUBBORN_PID_FILE'], 'w').write(str(os.getpid())); signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(60)" "$@"\n`,
	);
	chmodSync(stubborn, 0o700);
	const started = Date.now();
	await assert.rejects(
		ownedServeLaunch(
			[stubborn],
			1234,
			{ ...env, STUBBORN_PID_FILE: pidFile },
			"darwin",
			{ totalMs: 1_200, attemptMs: 900, graceMs: 150, slackMs: 150 },
		),
		/did not answer an identity probe within \d+ ms/, // the effective ceiling, not the configured one
	);
	const elapsed = Date.now() - started;
	assert.ok(
		elapsed < 5_000,
		`the escalation bounded the attempt (${elapsed} ms)`,
	);
	const pid = Number(readFileSync(pidFile, "utf8"));
	assert.ok(pid > 0, "the fixture recorded its interpreter pid");
	assert.throws(
		() => process.kill(pid, 0),
		"the interpreter that ignored SIGTERM is gone, not abandoned",
	);
});

test("the probe budget bounds the whole resolution, however many candidates there are", async () => {
	// Review round 2, F10: without a shared budget the bounds multiply per
	// candidate, and a quit that lands mid-start waits on all of them.
	const fixture = await buildFixture([isolatedMain(), probeStub]);
	globalThis.__probeCalls = [];
	globalThis.__probeChildren = [];
	globalThis.__probeResults = [];
	const started = Date.now();
	await assert.rejects(
		fixture.ownedServeLaunch(
			["/one/python", "/two/python", "/three/python", "/four/python"],
			4321,
			env,
			"darwin",
			{ totalMs: 700, attemptMs: 300, graceMs: 60, slackMs: 60 },
		),
		/No backend interpreter could be proven/,
	);
	const elapsed = Date.now() - started;
	assert.ok(
		elapsed < 4_000,
		`the resolution stayed inside its budget (${elapsed} ms)`,
	);
	assert.ok(
		globalThis.__probeCalls.length <= 4,
		"candidates are not probed past the budget",
	);
	// biome-ignore lint/performance/noDelete: this teardown returns the fixture global to ABSENT, which is the state the harness's own `globalThis.__…` checks read; `= undefined` would leave the property present.
	delete globalThis.__probeResults;
	// biome-ignore lint/performance/noDelete: this teardown returns the fixture global to ABSENT, which is the state the harness's own `globalThis.__…` checks read; `= undefined` would leave the property present.
	delete globalThis.__probeCalls;
	// biome-ignore lint/performance/noDelete: this teardown returns the fixture global to ABSENT, which is the state the harness's own `globalThis.__…` checks read; `= undefined` would leave the property present.
	delete globalThis.__probeChildren;
});

test("a start whose own cleanup cannot confirm exit reports instead of rejecting", async () => {
	// The only path on which a start fails AFTER capturing a child, and the one the
	// watchdog reaches through a void'd `setInterval`. The catch used to await the
	// memoised, already-rejected stop promise, so the rethrow skipped this
	// handler's dialog and `start()` rejected unhandled (review round 1, F3).
	const processStub = {
		name: "child-process-stub",
		setup(builder) {
			builder.onResolve({ filter: /^node:child_process$/ }, () => ({
				path: "child-process",
				namespace: "stub",
			}));
			builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
				loader: "js",
				contents: `
export function exec(command, options, callback) { const done = typeof options === "function" ? options : callback; done(null, { stdout: "", stderr: "" }); }
export function execFile(file, args, options, callback) { const done = typeof options === "function" ? options : callback; done(null, { stdout: "", stderr: "" }); }
export function spawn(command, args, options) { globalThis.__spawnCalls.push({ command, args, options }); if (args.includes("serve")) return globalThis.__spawned; globalThis.__probeCalls.push({ command, args, options }); return globalThis.__probeChild(globalThis.__probeResults.shift()); }
export function spawnSync() { return { status: 0, stdout: "" }; }
/* The zombie probe discovery.ts makes on macOS, and the only reason this stub
 * needs an answer for it: it asks the host's process table about a pid in order
 * to tell a wedged record from a corpse. "S" is a live, non-zombie state, which
 * is the answer the real probe gives on any doubt - so the manager's own logic
 * stays the subject here rather than this fixture's idea of a process table. */
export function execFileSync() { return "S"; }
`,
			}));
		},
	};
	const { BackendServiceManager: Manager } = await buildFixture([
		isolatedMain(
			"(title,message)=>{globalThis.__dialog.push([title,message]);}",
		),
		processStub,
	]);
	Manager.prototype.loadShellEnvironment = async () => {};
	globalThis.__dialog = [];
	globalThis.__spawnCalls = [];
	globalThis.__probeCalls = [];
	globalThis.__probeResults = [
		["/fixture/bin/python", "/fixture/bin/python", true, []],
	];
	const m = new Manager();
	m.shellEnv = { ...env };
	m.isDisabled = false;
	m.port = await freePort();
	m.backendUrl = `http://127.0.0.1:${m.port}`;
	m.checkExistingBackend = async () => false;
	// No PATH console script, so this takes the bundled-venv branch: it needs no
	// launcher file and still runs the real launch plan.
	m.checkLocalOperatorExists = async () => false;
	m.checkHealth = async () => false;
	m.shutdownTimeoutMs = { normal: 10, restart: 10, force: 10 };
	const child = fakeChild();
	globalThis.__spawned = child;
	const original = globalThis.setTimeout;
	globalThis.setTimeout = (fn, ms, ...args) =>
		original(fn, ms === 1000 ? 1 : ms, ...args);
	let started;
	try {
		started = await m.start();
	} finally {
		globalThis.setTimeout = original;
	}
	assert.equal(
		started,
		false,
		"a failed cleanup is reported, not thrown at the watchdog",
	);
	assert.equal(
		globalThis.__dialog.length,
		1,
		"the failure still reaches the user",
	);
	assert.match(
		globalThis.__dialog[0][1],
		/Error starting the Local Operator backend service/,
	);
	assert.deepEqual(
		child.signals,
		["SIGTERM", "SIGKILL"],
		"the failed start cleaned up its own child",
	);
	// biome-ignore lint/performance/noDelete: this teardown returns the fixture global to ABSENT, which is the state the harness's own `globalThis.__…` checks read; `= undefined` would leave the property present.
	delete globalThis.__dialog;
	// biome-ignore lint/performance/noDelete: this teardown returns the fixture global to ABSENT, which is the state the harness's own `globalThis.__…` checks read; `= undefined` would leave the property present.
	delete globalThis.__spawned;
	// biome-ignore lint/performance/noDelete: this teardown returns the fixture global to ABSENT, which is the state the harness's own `globalThis.__…` checks read; `= undefined` would leave the property present.
	delete globalThis.__probeResults;
	// biome-ignore lint/performance/noDelete: this teardown returns the fixture global to ABSENT, which is the state the harness's own `globalThis.__…` checks read; `= undefined` would leave the property present.
	delete globalThis.__probeCalls;
	// biome-ignore lint/performance/noDelete: this teardown returns the fixture global to ABSENT, which is the state the harness's own `globalThis.__…` checks read; `= undefined` would leave the property present.
	delete globalThis.__spawnCalls;
});

test("fatal and synchronous exit use owned manager without selecting processes", async () => {
	const source = readFileSync("src/main/index.ts", "utf8");
	const code = (
		await transform(
			source.slice(source.indexOf("// The exit event is synchronous:")),
			{ loader: "ts" },
		)
	).code;
	const processFixture = new EventEmitter();
	const calls = [];
	processFixture.exit = (code) => calls.push(["exit", code]);
	const backendService = {
		emergencyStopOwned: () => calls.push(["emergency"]),
		stop: async () => {
			calls.push(["stop"]);
			throw Error("unconfirmed");
		},
	};
	vm.runInNewContext(code, {
		process: processFixture,
		backendService,
		logger: { error() {} },
		LogFileType: { BACKEND: "backend" },
		posthogClient: { shutdown: () => calls.push(["telemetry"]) },
	});
	processFixture.emit("uncaughtException", Error("fatal"));
	await new Promise((r) => setImmediate(r));
	assert.deepEqual(calls, [["stop"], ["exit", 1]]);
	processFixture.emit("exit");
	assert.deepEqual(calls.slice(2), [["emergency"], ["telemetry"]]);
});
