import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { EventEmitter, once } from "node:events";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
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
const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/main/backend/backend-service"; export * from "./src/main/backend/owned-serve-launch";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "cjs",
	platform: "node",
	write: false,
	plugins: [
		{
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
							? `export const app={getPath:()=>${JSON.stringify(home)}}; export const dialog={showErrorBox:()=>{}};`
							: a.path === "./logger"
								? 'export const logger={info(){},warn(){},error(){}}; export const LogFileType={BACKEND:"backend"};'
								: 'export const backendConfig={VITE_DISABLE_BACKEND_MANAGER:"false",VITE_LOCAL_OPERATOR_API_URL:"http://127.0.0.1:1111"};',
				}));
			},
		},
	],
});
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(
	createRequire(import.meta.url),
	module,
	module.exports,
);
const { BackendServiceManager, ownedServeLaunch, consoleInterpreter } =
	module.exports;
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
async function sentinel() {
	const port = await freePort();
	const plan = await ownedServeLaunch(python, port, env);
	const child = spawn(plan.command, plan.args, { env, stdio: "ignore" });
	children.push(child);
	await ready(port);
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
	const staleExit = a.listeners("exit")[0];
	const stopping = m.stopGeneration(ga, true);
	a.exitCode = 0;
	a.emit("exit", 0, null);
	const b = fakeChild(a.pid);
	m.captureServe(b);
	staleExit(0, null);
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
	const replacement = spawn(plan.command, plan.args, { env, stdio: "ignore" });
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

test("Windows launch verifies direct interpreter and refuses venv redirectors", async () => {
	const b = await build({
		stdin: {
			contents: 'export * from "./src/main/backend/owned-serve-launch";',
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: "cjs",
		platform: "node",
		write: false,
		plugins: [
			{
				name: "interpreter-probe",
				setup(builder) {
					builder.onResolve({ filter: /^node:child_process$/ }, () => ({
						path: "probe",
						namespace: "probe",
					}));
					builder.onLoad({ filter: /.*/, namespace: "probe" }, () => ({
						loader: "js",
						contents:
							"export function execFile(command,args,options,callback){globalThis.__ownedProbeArgs=args;callback(null,{stdout:JSON.stringify(globalThis.__ownedProbeIdentity)});}",
					}));
				},
			},
		],
	});
	const fixture = { exports: {} };
	new Function("require", "module", "exports", b.outputFiles[0].text)(
		createRequire(import.meta.url),
		fixture,
		fixture.exports,
	);
	// Absolute POSIX paths keep this contract portable on the macOS/Linux test
	// runners; the injected platform exercises Windows' direct-spawn decision.
	globalThis.__ownedProbeIdentity = [
		"/python/python.exe",
		"/python/python.exe",
		true,
	];
	const plan = await fixture.exports.ownedServeLaunch(
		"/python/python.exe",
		12345,
		env,
		"win32",
	);
	assert.equal(plan.command, "/python/python.exe");
	assert.deepEqual(plan.args, [
		"-c",
		"from local_operator.cli import main; main()",
		"serve",
		"--port",
		"12345",
	]);
	assert.match(
		globalThis.__ownedProbeArgs[1],
		/from local_operator.cli import main/,
	);
	globalThis.__ownedProbeIdentity = [
		"/venv/python.exe",
		"/base/python.exe",
		true,
	];
	await assert.rejects(
		fixture.exports.ownedServeLaunch("/venv/python.exe", 12345, env, "win32"),
		/redirector/,
	);
	delete globalThis.__ownedProbeIdentity;
	delete globalThis.__ownedProbeArgs;
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
