import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { EventEmitter, once } from "node:events";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import vm from "node:vm";
import { build, transform } from "esbuild";

// No GUI, user rc files, inherited cmux attachment, or real backend is involved.
// Only fixture ChildProcess handles may be signalled; detached fixtures shut
// themselves down over their own HTTP endpoint instead of PID rediscovery.
const home = mkdtempSync(join(tmpdir(), "owned-serve-"));
const env = Object.fromEntries(
	Object.entries(process.env).filter(
		([key]) =>
			!key.startsWith("CMUX_") &&
			!key.startsWith("LOCAL_OPERATOR_") &&
			key !== "PYTHONHOME",
	),
);
Object.assign(env, {
	HOME: home,
	XDG_CONFIG_HOME: home,
	PYTHONPATH: home,
	PYTHONDONTWRITEBYTECODE: "1",
	PATH: `${home}/bin:${env.PATH}`,
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
const { BackendServiceManager, ownedServeLaunch, consoleInterpreter } = bundle;
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
	const plan = await ownedServeLaunch(python, port, env);
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
	const a = await manager(),
		b = await manager(),
		external = await sentinel();
	const durable = await freePort();
	detachedPorts.push(durable);
	a.shellEnv.DURABLE_PORT = String(durable);
	assert.equal(await a.start(), true);
	assert.equal(await b.start(), true);
	const aChild = a.process,
		bChild = b.process;
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
	const child = m.process,
		exit = once(child, "exit");
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
	const child = m.process,
		exit = once(child, "exit");
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
	const first = m.restart(),
		second = m.restart();
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
	assert.equal(m.process, b, "a retired generation's late exit is not authority");
	assert.equal(m.ownedServe, gb, "manager ownership still names the replacement");
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
	assert.deepEqual(c.signals, [], "a reaped handle is not a termination authority");
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
	const m = await manager(),
		c = fakeChild(undefined);
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
	const plan = await ownedServeLaunch(python, m.port, env);
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

test("index quit preserves listeners, waits cleanup, exits nonzero on failure", async () => {
	const source = readFileSync("src/main/index.ts", "utf8");
	const start = source.indexOf("let backendQuitPending");
	const end = source.indexOf("// Handle before-quit", start);
	const code = (await transform(source.slice(start, end), { loader: "ts" }))
		.code;
	for (const failed of [false, true]) {
		const app = new EventEmitter();
		let quit = 0,
			exit = null,
			resolve,
			reject,
			done = false;
		const hooks = () => {};
		app.on("before-quit", hooks);
		app.on("will-quit", hooks);
		app.quit = () => quit++;
		app.exit = (c) => (exit = c);
		const pending = new Promise((r, j) => {
			resolve = r;
			reject = j;
		});
		let stops = 0;
		const backendService = {
			isOwnedCleanupComplete: () => done,
			stop: () => {
				stops++;
				return pending;
			},
		};
		vm.runInNewContext(code, {
			app,
			backendService,
			logger: { error() {} },
			LogFileType: { BACKEND: "backend" },
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
		if (failed) reject(Error("cleanup"));
		else {
			done = true;
			resolve();
		}
		await new Promise((r) => setImmediate(r));
		assert.equal(quit, failed ? 0 : 1);
		assert.equal(exit, failed ? 1 : null);
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
		let resolve, reject;
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
			ipcMain: { handle: (_, f) => (handler = f) },
			logger: { info() {}, error() {} },
			LogFileType: { UPDATE_SERVICE: "update" },
			app: { getVersion: () => "9.9.8" },
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
const probeStub = {
	name: "interpreter-probe",
	setup(builder) {
		// Only `execFile` is replaced, and only for the modules under test: every
		// other child_process export keeps working, so the bundle stays real.
		builder.onResolve({ filter: /^node:child_process$/ }, (args) =>
			args.namespace === "probe"
				? { path: "node:child_process", external: true }
				: { path: "probe", namespace: "probe" },
		);
		builder.onLoad({ filter: /.*/, namespace: "probe" }, () => ({
			loader: "js",
			contents:
				'export { exec, spawn, spawnSync } from "node:child_process"; export function execFile(command,args,options,callback){globalThis.__probeCalls.push({command,args,options});const next=globalThis.__probeResults.shift();callback(next instanceof Error?next:null,{stdout:JSON.stringify(next),stderr:""});}',
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
		"/venv/Scripts/python.exe",
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
		"/base/python.exe",
		12345,
		env,
		"win32",
	);
	assert.equal(direct.command, "/base/python.exe");
	assert.equal(direct.env, env, "a direct interpreter needs no environment change");
	assert.equal(globalThis.__probeCalls.length, 1);

	// The base must report ITSELF, or the PID captured would not be serve.
	globalThis.__probeResults = [
		["/venv/Scripts/python.exe", "/base/python.exe", true, ["/venv/Lib"]],
		["/other/python.exe", "/other/python.exe", true, []],
	];
	await assert.rejects(
		fixture.ownedServeLaunch("/venv/Scripts/python.exe", 12345, env, "win32"),
		/reported itself as \/other\/python\.exe/,
	);

	// A base that cannot import the CLI even with the venv's paths is refused in
	// the terms a user can act on, rather than the app being unusable.
	globalThis.__probeResults = [
		["/venv/Scripts/python.exe", "/base/python.exe", true, ["/venv/Lib"]],
		["/base/python.exe", "/base/python.exe", false, []],
	];
	await assert.rejects(
		fixture.ownedServeLaunch("/venv/Scripts/python.exe", 12345, env, "win32"),
		/cannot import local_operator\.cli even with the venv's own import paths/,
	);

	// POSIX is unchanged: the same plan shape, and the environment untouched.
	globalThis.__probeCalls = [];
	globalThis.__probeResults = [
		["/python/python", "/python/python", true, ["/python/lib"]],
	];
	const posix = await fixture.ownedServeLaunch("/python/python", 12345, env);
	assert.equal(posix.command, "bash");
	assert.equal(posix.env, env, "the POSIX plan passes its environment through");
	delete globalThis.__probeResults;
	delete globalThis.__probeCalls;
});

test("a slow first probe is retried, and a stuck interpreter is reported not swallowed", async () => {
	const fixture = await buildFixture([isolatedMain(), probeStub]);
	const timedOut = () =>
		Object.assign(new Error("Command failed: identity probe"), {
			killed: true,
			signal: "SIGTERM",
		});
	// The probe pays a cold import of the CLI. Failing closed on the first slow
	// attempt turned a loaded machine's first run into a blocking modal with no
	// retry in that launch (QA round 2, observation 2), so a timeout is retried
	// once - the attempt that timed out warmed the bytecode cache.
	globalThis.__probeCalls = [];
	globalThis.__probeResults = [
		timedOut(),
		["/python/python", "/python/python", true, []],
	];
	const plan = await fixture.ownedServeLaunch("/python/python", 4321, env);
	assert.equal(globalThis.__probeCalls.length, 2, "a timeout is retried once");
	assert.deepEqual(plan.args.slice(-2), ["--port", "4321"]);

	globalThis.__probeCalls = [];
	globalThis.__probeResults = [timedOut(), timedOut()];
	await assert.rejects(
		fixture.ownedServeLaunch("/python/python", 4321, env),
		/did not answer an identity probe within 30000 ms on 2 attempts: \/python\/python/,
	);
	assert.equal(
		globalThis.__probeCalls.length,
		2,
		"a stuck interpreter is not retried forever",
	);
	delete globalThis.__probeResults;
	delete globalThis.__probeCalls;
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
export function execFile(command, args, options, callback) { globalThis.__probeCalls.push({ command, args, options }); const next = globalThis.__probeResults.shift(); callback(next instanceof Error ? next : null, { stdout: JSON.stringify(next), stderr: "" }); }
export function spawn(command, args, options) { globalThis.__spawnCalls.push({ command, args, options }); return globalThis.__spawned; }
export function spawnSync() { return { status: 0, stdout: "" }; }
`,
			}));
		},
	};
	const { BackendServiceManager: Manager } = await buildFixture([
		isolatedMain("(title,message)=>{globalThis.__dialog.push([title,message]);}"),
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
	assert.equal(globalThis.__dialog.length, 1, "the failure still reaches the user");
	assert.match(
		globalThis.__dialog[0][1],
		/Error starting the Local Operator backend service/,
	);
	assert.deepEqual(
		child.signals,
		["SIGTERM", "SIGKILL"],
		"the failed start cleaned up its own child",
	);
	delete globalThis.__dialog;
	delete globalThis.__spawned;
	delete globalThis.__probeResults;
	delete globalThis.__probeCalls;
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
