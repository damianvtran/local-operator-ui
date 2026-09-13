import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";

/**
 * Contract checks for the interpreter environment the app spawns python with.
 *
 * Why these cases: the app bundles a standalone CPython as an `extraResource`,
 * so the stdlib the backend venv runs on lives inside the code-sealed `.app`.
 * CPython writes `__pycache__/*.pyc` beside the sources it imports, and every
 * one of those writes breaks the signature ShipIt validates before an in-place
 * update - measured on the operator's installed 0.17.3: 308 `file added:` and 3
 * `file modified:` violations, all of them `.pyc`. `PYTHONPYCACHEPREFIX` is what
 * redirects those writes, and this is the test that it is actually set, that it
 * is never set to somewhere inside the bundle, and that nothing else in the
 * spawn environment is disturbed by setting it.
 *
 * Bundled from the shipped TypeScript in memory, the same way the update and
 * renderer contract tests do, so this is a test of the code that ships.
 */
const bundle = await build({
	stdin: {
		contents: 'export * from "./src/main/python-bytecode-cache";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const cache = await import(
	`data:text/javascript;base64,${Buffer.from(
		bundle.outputFiles[0].text,
	).toString("base64")}`
);
const {
	PYTHON_BYTECODE_CACHE_DIR_NAME,
	pythonBytecodeCacheDir,
	withPythonBytecodeCache,
} = cache;

/** The userData directory a packaged macOS run would hand in. */
const USER_DATA =
	"/Users/someone/Library/Application Support/local-operator-ui";

test("the cache directory is a child of userData, never of the bundle", () => {
	const dir = pythonBytecodeCacheDir(USER_DATA);
	assert.equal(dir, `${USER_DATA}/${PYTHON_BYTECODE_CACHE_DIR_NAME}`);

	// The property that matters, stated as a test rather than as a convention:
	// userData is outside the `.app` on every platform, which is why the cache
	// lives there rather than in the OS temp directory the app also owns.
	assert.ok(!dir.includes(".app"), `${dir} is not inside a bundle`);
});

test("the prefix is set when the environment has none", () => {
	const env = withPythonBytecodeCache({ PATH: "/usr/bin" }, USER_DATA);
	assert.equal(env.PYTHONPYCACHEPREFIX, pythonBytecodeCacheDir(USER_DATA));
});

test("every other variable survives, and the input is not mutated", () => {
	const original = {
		PATH: "/opt/homebrew/bin:/usr/bin",
		HOME: "/Users/someone",
		LOCAL_OPERATOR_DESKTOP_TOKEN: "token",
		PYTHONHASHSEED: "0",
	};
	const env = withPythonBytecodeCache(original, USER_DATA);
	assert.deepEqual(
		{ ...env, PYTHONPYCACHEPREFIX: undefined },
		{ ...original, PYTHONPYCACHEPREFIX: undefined },
	);
	assert.notEqual(env, original);
	assert.deepEqual(original, {
		PATH: "/opt/homebrew/bin:/usr/bin",
		HOME: "/Users/someone",
		LOCAL_OPERATOR_DESKTOP_TOKEN: "token",
		PYTHONHASHSEED: "0",
	});
});

test("an undefined value in the environment is passed through, not dropped", () => {
	// `process.env` on Windows carries `=C:` style keys with undefined values, and
	// dropping one on the way into a spawn environment is a behaviour change in
	// the backend's PATH handling rather than a tidy-up.
	const env = withPythonBytecodeCache(
		{ PATH: "/usr/bin", OMITTED: undefined },
		USER_DATA,
	);
	assert.ok("OMITTED" in env);
	assert.equal(env.OMITTED, undefined);
});

test("a prefix the operator set outside a bundle is respected", () => {
	// They already solved this problem for themselves. Rewriting their value
	// would move their bytecode somewhere they did not ask for.
	const env = withPythonBytecodeCache(
		{ PYTHONPYCACHEPREFIX: "/Users/someone/pycache" },
		USER_DATA,
	);
	assert.equal(env.PYTHONPYCACHEPREFIX, "/Users/someone/pycache");
});

test("a prefix pointing inside a .app bundle is replaced", () => {
	// Reachable in practice, not hypothetical: the backend service sources the
	// operator's shell rc files, so one `export` there would otherwise be
	// inherited by every python the app spawns - and this is the value that
	// reproduces the bug the module exists to prevent.
	const inBundle = [
		"/Applications/Local Operator.app/Contents/Resources/python_aarch64/pycache",
		"/private/var/folders/x/T/Some.app/Contents/Resources/pycache",
	];
	for (const value of inBundle) {
		const env = withPythonBytecodeCache(
			{ PYTHONPYCACHEPREFIX: value },
			USER_DATA,
		);
		assert.equal(env.PYTHONPYCACHEPREFIX, pythonBytecodeCacheDir(USER_DATA));
	}

	// A directory merely named `.app`-ish is not a bundle, so it stays: the test
	// is on whole path segments, and a substring test would rewrite a path the
	// operator deliberately chose.
	const notABundle = withPythonBytecodeCache(
		{ PYTHONPYCACHEPREFIX: "/Users/someone/appcache" },
		USER_DATA,
	);
	assert.equal(notABundle.PYTHONPYCACHEPREFIX, "/Users/someone/appcache");
});

test("an empty or whitespace-only prefix is treated as unset", () => {
	// Measured, not assumed: a copy of the shipped 0.17.0 interpreter tree goes
	// from 3 `.pyc` to 20 with `PYTHONPYCACHEPREFIX=` and to 23 with
	// `PYTHONPYCACHEPREFIX=" "` - both write into the bundle, which an empty
	// value makes CPython fall back to. Preserving either would leave the bug in
	// place while looking like the operator's own setting.
	for (const value of ["", "  "]) {
		const env = withPythonBytecodeCache(
			{ PYTHONPYCACHEPREFIX: value },
			USER_DATA,
		);
		assert.equal(env.PYTHONPYCACHEPREFIX, pythonBytecodeCacheDir(USER_DATA));
	}
});

// ---------------------------------------------------------------------------
// The wiring, not the helper: the spawn sites, the belt, the shipped scripts
// ---------------------------------------------------------------------------
//
// Why these cases exist: the helper above is a pure function, and a green suite
// for a pure function says nothing about whether the app calls it. Measured
// (review R2): deleting the application from `backend-service.ts` left the whole
// desktop suite green - 447 of 447 - with the original bug fully restored, so
// the PR's central claim ("every process that can run the bundled interpreter
// gets the prefix") was the one thing untested. These cases bind the
// application: the environment each spawn is handed, the shell environment the
// loaders leave behind, and the defaults the shipped install scripts carry.

/**
 * The process's own copy of the value this module exists to prevent.
 *
 * A value pointing inside the bundle is not hypothetical: the backend service
 * sources the operator's shell rc files, so one stray `export` there reaches
 * every python the app runs. Using it as the seed here is what makes the
 * assertions below prove a *replacement* rather than a gap being filled.
 */
const INSIDE_BUNDLE_PREFIX =
	"/Applications/Local Operator.app/Contents/Resources/python_aarch64/pycache";

/** Temp paths the stubbed Electron `app.getPath` hands the bundled module. */
const PATHS = { home: null, userData: null, appData: null, temp: tmpdir() };

/**
 * Resolve the app's own `?raw` script imports.
 *
 * The install scripts ship as strings Vite inlines (`./x.sh?raw`), so both
 * bundles here resolve that same specifier instead of re-reading the files: a
 * second copy of the text can agree with itself while the shipped one does not.
 */
const rawInstallScriptPlugin = {
	name: "raw-install-scripts",
	setup(builder) {
		builder.onResolve({ filter: /\.(sh|ps1)\?raw$/ }, (args) => ({
			path: resolve(args.resolveDir, args.path.replace(/\?raw$/, "")),
			namespace: "raw-install-script",
		}));
		builder.onLoad(
			{ filter: /.*/, namespace: "raw-install-script" },
			(args) => ({
				contents: readFileSync(args.path, "utf8"),
				loader: "text",
			}),
		);
	},
};

let mainProcessPromise = null;
let mainProcessBundleDir = null;
let installScriptsPromise = null;

/**
 * The shipped main-process modules that can run python - `backend-service`
 * (both spawn sites), `backend-installer` (the install script that creates the
 * venv) and `update-service` (the `pip show` / `pip install` probes) - bundled
 * together in memory with Electron stubbed instead of launched, the same
 * fixture shape `update-robustness.test.mjs` uses for the banner, because what
 * is under test is the environment a spawn is handed rather than a window.
 *
 * `spawn` is replaced by a recorder that starts nothing: these assertions must
 * never start a real backend on the operator's machine, and the options the
 * spawn is handed are the subject. `exec`, `execFile` and the rest stay real,
 * so the shell-environment loader and the update service's own probe run for
 * real against stubs rather than being simulated.
 */
async function loadMainProcess() {
	if (!mainProcessPromise) {
		mainProcessPromise = (async () => {
			PATHS.home = mkdtempSync(join(tmpdir(), "lo-bytecode-home-"));
			PATHS.userData = mkdtempSync(join(tmpdir(), "lo-bytecode-userdata-"));
			PATHS.appData = PATHS.userData;
			globalThis.__loTestPaths = PATHS;
			globalThis.__loSpawns = [];

			// The main-process graph reaches CJS dependencies (dotenv, zod), which
			// esbuild's ESM output cannot `require` without this shim.
			// The shim CJS dependencies need, plus one interception: the installer
			// reaches Electron through a bare `require("electron")` inside a method,
			// which esbuild's resolver never sees, so the runtime require has to be
			// pointed at the same stubbed module the graph got.
			const banner = {
				js: [
					'import { createRequire as __loCreateRequire } from "node:module";',
					'const __loRequire = __loCreateRequire(import.meta.url);',
					'const require = (id) => (id === "electron" && globalThis.__loElectronFixture ? globalThis.__loElectronFixture : __loRequire(id));',
					// Electron runs the main process as CJS, so the shipped modules use
					// `__dirname` freely; an ESM bundle has to define it. Nothing under
					// test reads through it - it names the installer window's own
					// preload and renderer files, which the BrowserWindow stub ignores.
					'const __dirname = process.cwd();',
					'const __filename = "";',
				].join(" "),
			};
			const electronFixture = `
				const paths = globalThis.__loTestPaths;
				export const app = {
					isPackaged: true,
					getPath: (name) => paths[name] ?? paths.userData,
					getVersion: () => "0.0.0-test",
					getName: () => "Local Operator",
					getAppPath: () => process.cwd(),
					whenReady: async () => {},
					on: () => app,
					once: () => app,
					quit: () => {},
					relaunch: () => {},
					exit: () => {},
					isReady: () => true,
					commandLine: { appendSwitch: () => {} },
					setAsDefaultProtocolClient: () => true,
					requestSingleInstanceLock: () => true,
					releaseSingleInstanceLock: () => {},
				};
				export const ipcMain = { handle: () => {}, on: () => {}, once: () => {}, removeHandler: () => {}, removeAllListeners: () => {} };
				export class BrowserWindow {
					constructor() {
						this.webContents = { send: () => {}, isDestroyed: () => false, on: () => {}, once: () => {}, setWindowOpenHandler: () => {} };
					}
					isDestroyed() { return false; }
					on() { return this; }
					once() { return this; }
					loadURL() {}
					loadFile() {}
					setMenuBarVisibility() {}
					show() {}
					focus() {}
					close() {}
					destroy() {}
					isVisible() { return false; }
					static getAllWindows() { return []; }
					static getFocusedWindow() { return null; }
				}
				export const dialog = { showMessageBox: async () => ({ response: 0 }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showErrorBox: () => {} };
				export const shell = { openExternal: async () => {}, openPath: async () => {} };
				export const nativeTheme = { shouldUseDarkColors: false, on: () => {} };
				export const screen = { getPrimaryDisplay: () => ({ id: 1, size: { width: 100, height: 100 } }), getAllDisplays: () => [], on: () => {} };
				export const systemPreferences = { getMediaAccessStatus: () => "granted", askForMediaAccess: async () => true };
				export const desktopCapturer = { getSources: async () => [] };
				export const safeStorage = { isEncryptionAvailable: () => false, encryptString: () => Buffer.from(""), decryptString: () => "" };
				export class Notification { static isSupported() { return false; } show() {} }
				export const Menu = { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) };
				export const session = { defaultSession: { webRequest: { onHeadersReceived: () => {} } } };
				globalThis.__loElectronFixture = { app, ipcMain, BrowserWindow, dialog, shell, nativeTheme, screen, systemPreferences, desktopCapturer, safeStorage, Notification, Menu, session };
			`;
			// The child-process seam. Only `spawn` is replaced: `which
			// local-operator` and the shell-rc sourcing run for real (or, where the
			// test stubs a probe, are stubbed on the instance rather than here).
			const childProcessFixture = `
				import { createRequire as __loRecorderRequire } from "node:module";
				import { EventEmitter } from "node:events";
				const __loReal = __loRecorderRequire(import.meta.url)("node:child_process");
				export const spawn = (cmd, args, options) => {
					globalThis.__loSpawns.push({ cmd, args, options });
					const child = new EventEmitter();
					child.pid = 4242;
					child.stdout = new EventEmitter();
					child.stderr = new EventEmitter();
					child.kill = () => true;
					child.unref = () => {};
					return child;
				};
				export const exec = __loReal.exec;
				export const execFile = __loReal.execFile;
				export const execSync = __loReal.execSync;
				export const execFileSync = __loReal.execFileSync;
				export const spawnSync = __loReal.spawnSync;
				export const fork = __loReal.fork;
				export default { ...__loReal, spawn };
			`;
			const fixture = (contents) => ({ contents, loader: "js" });

			const bundle = await build({
				stdin: {
					contents:
						'export * from "./src/main/backend/backend-service"; export * from "./src/main/backend/backend-installer"; export * from "./src/main/update-service";',
					resolveDir: process.cwd(),
				},
				bundle: true,
				format: "esm",
				platform: "node",
				write: false,
				// The graph also reaches CJS dependencies (dotenv, zod), which
				// esbuild's ESM output cannot `require` without this shim.
				banner,
				plugins: [
					rawInstallScriptPlugin,
					{
						name: "electron-and-spawn-fixtures",
						setup(builder) {
							builder.onResolve(
								{ filter: /^(electron|electron-updater|electron-log)$/ },
								(args) => ({ path: args.path, namespace: "fixture" }),
							);
							builder.onResolve({ filter: /^node:child_process$/ }, () => ({
								path: "child-process-recorder",
								namespace: "fixture",
							}));
							builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => {
								if (args.path === "child-process-recorder") {
									return fixture(childProcessFixture);
								}
								if (args.path === "electron") {
									return fixture(electronFixture);
								}
								if (args.path === "electron-updater") {
									return fixture(`
										export const autoUpdater = {
											on: () => {}, once: () => {}, removeAllListeners: () => {},
											checkForUpdates: async () => null,
											downloadUpdate: async () => [],
											quitAndInstall: () => {},
											setFeedURL: () => {},
											autoDownload: false,
											autoInstallOnAppQuit: false,
											logger: null,
										};
									`);
								}
								return fixture(`
									const logger = () => ({
										info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
										verbose: () => {}, silly: () => {},
										transports: {
											file: { resolvePath: () => "", level: "debug", format: "", maxSize: 0 },
											console: { level: "info" },
										},
									});
									const electronLog = logger();
									electronLog.create = () => logger();
									electronLog.initialize = () => {};
									export default electronLog;
								`);
							});
						},
					},
				],
			});

			mainProcessBundleDir = mkdtempSync(
				join(tmpdir(), "lo-bytecode-bundle-"),
			);
			const file = join(mainProcessBundleDir, "backend-service.mjs");
			writeFileSync(file, bundle.outputFiles[0].text);
			// Imported from a real path rather than a `data:` URL: the spawn
			// recorder's `createRequire` needs an `import.meta.url` it can resolve.
			return await import(file);
		})();
	}
	return mainProcessPromise;
}

/**
 * The shipped install scripts, loaded through the app's own `?raw` import path.
 *
 * Why the specifier rather than `readFileSync` of the same file: what ships is
 * the string Vite inlines into the main bundle, and re-reading the file here
 * would be a second copy of the text that can agree while the shipped one does
 * not. Resolving `./macos-install-script.sh?raw` is the same edge the app's
 * `scripts/index.ts` uses.
 */
async function loadInstallScripts() {
	if (!installScriptsPromise) {
		installScriptsPromise = (async () => {
			const bundle = await build({
				stdin: {
					contents: 'export * from "./src/main/backend/scripts/index";',
					resolveDir: process.cwd(),
				},
				bundle: true,
				format: "esm",
				platform: "node",
				write: false,
				plugins: [
					rawInstallScriptPlugin,
				],
			});
			return await import(
				`data:text/javascript;base64,${Buffer.from(
					bundle.outputFiles[0].text,
				).toString("base64")}`
			);
		})();
	}
	return installScriptsPromise;
}

/**
 * Run the shipped macOS install script's own bytes under a real `/bin/bash -x`,
 * in a temp `HOME`, and hand back the trace.
 *
 * The script's default is an executable fact, not a string: running it is what
 * shows which directory a standalone run actually writes bytecode to. Nothing
 * of the operator's machine is touched - `HOME` is a temp directory, the FFmpeg
 * the script would otherwise download is pre-placed so no network is used, and
 * the interpreter is a stub that fails at the venv probe, which the script only
 * reaches after the default has been applied.
 */
function runMacosInstallScript(scriptText, extraEnv) {
	const home = mkdtempSync(join(tmpdir(), "lo-install-script-home-"));
	const scriptPath = join(home, "macos-install-script.sh");
	writeFileSync(scriptPath, scriptText);

	const appDataDir = join(
		home,
		"Library",
		"Application Support",
		"Local Operator",
	);
	mkdirSync(join(appDataDir, "bin"), { recursive: true });
	const ffmpeg = join(appDataDir, "bin", "ffmpeg");
	writeFileSync(ffmpeg, "#!/bin/bash\nexit 0\n");
	chmodSync(ffmpeg, 0o755);

	const pythonStub = join(home, "python3-stub");
	writeFileSync(
		pythonStub,
		'#!/bin/bash\nif [[ "$1" == "--version" ]]; then echo "Python 3.12.0"; exit 0; fi\nexit 1\n',
	);
	chmodSync(pythonStub, 0o755);

	const env = { ...process.env, HOME: home, PYTHON_BIN: pythonStub, ...extraEnv };
	const result = spawnSync("/bin/bash", ["-x", scriptPath], {
		env,
		encoding: "utf8",
	});
	return { ...result, home, appDataDir };
}

after(() => {
	for (const dir of [
		PATHS.home,
		PATHS.userData,
		mainProcessBundleDir,
	]) {
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
	delete globalThis.__loTestPaths;
	delete globalThis.__loSpawns;
});

test("every backend spawn carries the prefix even with the shell-env load unresolved", async () => {
	const { BackendServiceManager } = await loadMainProcess();

	// The race, held open. `loadShellEnvironment()` is what writes `shellEnv`,
	// it is started un-awaited from the constructor, and `start()` has nothing
	// sequencing it - so a shell rc that takes seconds to source (nvm, pyenv,
	// conda init) leaves the first spawn reading the `{ ...process.env }` seed.
	// Withholding the platform load entirely is that state, made deterministic:
	// measured at 2000ms and 5000ms rc, the spawn got no prefix at all (review
	// R1).
	const withheld = () => new Promise(() => {});
	const originalLoad = BackendServiceManager.prototype.loadMacOSEnvironment;
	const originalPrefix = process.env.PYTHONPYCACHEPREFIX;
	BackendServiceManager.prototype.loadMacOSEnvironment = withheld;
	// And the seed carries a value pointing inside the bundle, because that is
	// what the spawn site has to correct rather than merely fill.
	process.env.PYTHONPYCACHEPREFIX = INSIDE_BUNDLE_PREFIX;

	const managers = [];
	try {
		// Both spawn sites, in the order `start()` chooses between them.
		for (const globalInstall of [true, false]) {
			const label = globalInstall ? "global install" : "bundled venv";
			globalThis.__loSpawns.length = 0;

			const manager = new BackendServiceManager();
			managers.push(manager);
			// This worktree's `.env` sets VITE_DISABLE_BACKEND_MANAGER=true for
			// `pnpm dev`, and `dotenv` (override: true) has already put that into
			// `process.env`. The subject here is the spawn environment, so the
			// flag is forced rather than the spawn being blamed for it.
			manager.isDisabled = false;
			// Stubbed on the instance, not at the module boundary: a real
			// `which local-operator` would pick the branch by what this machine
			// happens to have installed, and a real health probe would be a
			// request against whatever is listening on the app's port.
			manager.checkExistingBackend = async () => false;
			manager.checkLocalOperatorExists = async () => globalInstall;
			manager.checkHealth = async () => true;

			assert.equal(
				manager.shellEnv.PYTHONPYCACHEPREFIX,
				INSIDE_BUNDLE_PREFIX,
				`${label}: the withheld load is what makes this a race - shellEnv must still hold the unbelted seed`,
			);

			assert.equal(
				await manager.start(),
				true,
				`${label}: start() should report a started backend`,
			);

			assert.equal(
				globalThis.__loSpawns.length,
				1,
				`${label}: expected exactly one spawn, got ${JSON.stringify(
					globalThis.__loSpawns.map(({ cmd }) => cmd),
				)}`,
			);
			const [spawned] = globalThis.__loSpawns;
			const env = spawned.options.env;

			// The claim, asserted at the spawn: the interpreter this spawn runs
			// cannot write bytecode into the bundle.
			assert.equal(
				env.PYTHONPYCACHEPREFIX,
				pythonBytecodeCacheDir(PATHS.userData),
				`${label}: the spawn environment must carry the prefix`,
			);
			assert.ok(
				!env.PYTHONPYCACHEPREFIX.includes(".app"),
				`${label}: ${env.PYTHONPYCACHEPREFIX} is not outside every bundle`,
			);
			// Additive, never a replacement: the backend needs the operator's PATH
			// to reach gh and brew.
			assert.equal(env.PATH, process.env.PATH, `${label}: PATH survives`);
			assert.match(
				env.LOCAL_OPERATOR_DESKTOP_TOKEN,
				/^[0-9a-f]{64}$/,
				`${label}: the desktop token is still the rotated one`,
			);
			assert.notEqual(
				env,
				process.env,
				`${label}: the spawn gets its own object`,
			);
			if (process.platform !== "win32") {
				assert.equal(spawned.cmd, "bash", `${label}: the command is unchanged`);
				assert.match(
					spawned.args.join(" "),
					globalInstall ? /local-operator serve --port/ : /bin\/activate/,
					`${label}: the command is unchanged`,
				);
			}
		}
	} finally {
		BackendServiceManager.prototype.loadMacOSEnvironment = originalLoad;
		if (originalPrefix === undefined) delete process.env.PYTHONPYCACHEPREFIX;
		else process.env.PYTHONPYCACHEPREFIX = originalPrefix;
		for (const manager of managers) {
			manager.isRunning = false;
			await manager.stop();
		}
	}
});

test("the belt: shellEnv is corrected after the rc files have been sourced", async () => {
	const { BackendServiceManager } = await loadMainProcess();

	const originalHome = process.env.HOME;
	const originalPrefix = process.env.PYTHONPYCACHEPREFIX;
	// A synthetic rc that exports the value this module exists to prevent. It is
	// loaded by the shipped loader through a real `/bin/bash` - the loader finds
	// the first of its candidate files that exists, so the file name covers both
	// platforms this runs on - rather than by a stub of the loader, because the
	// loader is the thing that can inject the value.
	writeFileSync(
		join(PATHS.home, ".zshrc"),
		`export PYTHONPYCACHEPREFIX="${INSIDE_BUNDLE_PREFIX}"\n`,
	);
	writeFileSync(
		join(PATHS.home, ".bashrc"),
		`export PYTHONPYCACHEPREFIX="${INSIDE_BUNDLE_PREFIX}"\n`,
	);
	process.env.HOME = PATHS.home;
	delete process.env.PYTHONPYCACHEPREFIX;

	const manager = new BackendServiceManager();
	manager.isDisabled = false;
	try {
		await manager.loadShellEnvironment();
		assert.equal(
			manager.shellEnv.PYTHONPYCACHEPREFIX,
			pythonBytecodeCacheDir(PATHS.userData),
			"the shell environment must be corrected after the rc load, not leave the exported value",
		);
		assert.ok(
			!manager.shellEnv.PYTHONPYCACHEPREFIX.includes(".app"),
			"shellEnv must not point into a bundle",
		);
	} finally {
		process.env.HOME = originalHome;
		if (originalPrefix === undefined) delete process.env.PYTHONPYCACHEPREFIX;
		else process.env.PYTHONPYCACHEPREFIX = originalPrefix;
		manager.isRunning = false;
		await manager.stop();
	}
});

test("the shipped install scripts default the prefix to the app's own cache directory", async () => {
	const { linuxInstallScript, macosInstallScript, windowsInstallScript } =
		await loadInstallScripts();

	// The app and a standalone run of a script must not disagree about where
	// bytecode goes, so the directory name asserted here is the app's own
	// constant rather than a second spelling of it.
	const dirName = PYTHON_BYTECODE_CACHE_DIR_NAME;

	assert.match(
		macosInstallScript,
		new RegExp(`:\\s*"\\$\\{PYTHONPYCACHEPREFIX:=\\$APP_DATA_DIR/${dirName}\\}"`),
		"the macOS script must default the prefix itself",
	);
	assert.match(macosInstallScript, /^export PYTHONPYCACHEPREFIX$/m);
	assert.match(
		linuxInstallScript,
		new RegExp(
			`:\\s*"\\$\\{PYTHONPYCACHEPREFIX:=\\$\\{APP_DATA_DIR\\}/${dirName}\\}"`,
		),
		"the Linux script must default the prefix itself",
	);
	assert.match(linuxInstallScript, /^export PYTHONPYCACHEPREFIX$/m);
	assert.ok(
		windowsInstallScript.includes(
			`if (-not $env:PYTHONPYCACHEPREFIX) {`,
		) &&
			windowsInstallScript.includes(
				`PYTHONPYCACHEPREFIX = "$AppDataDir\\\\${dirName}"`,
			),
		"the Windows script must default the prefix itself",
	);

	// And the macOS default executed, since a match on the text says the line is
	// there rather than what it resolves to.
	const run = runMacosInstallScript(macosInstallScript, {
		PYTHONPYCACHEPREFIX: undefined,
	});
	try {
		const expected = pythonBytecodeCacheDir(run.appDataDir);
		const trace = run.stderr;
		// Bash's xtrace prints this assignment as the expanded argument of `:`,
			// so the line is read rather than pattern-matched to a `VAR=value`
			// spelling (measured: `+ : '<path>'`).
			const assignment = trace
				.split("\n")
			.find((line) => line.startsWith("+ : "));
		assert.ok(
			assignment?.includes(expected),
			`the default must resolve to ${expected}; assignment line: ${assignment}; trace head:\n${trace
				.split("\n")
				.slice(0, 12)
				.join("\n")}`,
			);
			assert.match(
			trace,
			/^\+ export PYTHONPYCACHEPREFIX$/m,
			"the script must export the prefix it defaulted, or the python it runs will not inherit it",
		);
			assert.ok(
			!trace.includes(".app"),
			"the default must not resolve inside a bundle",
		);
	} finally {
		rmSync(run.home, { recursive: true, force: true });
	}

		// A value the app already set is kept, so the script and the app cannot end
			// up disagreeing when the script is run from the app rather than standalone.
			const appValue = "/Users/someone/pycache";
		const runWithValue = runMacosInstallScript(macosInstallScript, {
		PYTHONPYCACHEPREFIX: appValue,
			});
			try {
		const preset = runWithValue.stderr
			.split("\n")
			.find((line) => line.startsWith("+ : "));
		assert.ok(
			preset?.includes(appValue),
			`a prefix the app set must be the one the script uses; assignment line: ${preset}`,
		);
		assert.ok(
			!runWithValue.stderr.includes(dirName),
			"the script must not override the app's own prefix",
		);
	} finally {
		rmSync(runWithValue.home, { recursive: true, force: true });
	}
});

/**
 * Wait for the recorder to see a spawn, without awaiting the flow that makes
 * it: the flows below are driven for their spawn options, and the children are
 * recorded rather than run - so a promise that waits on a real exit would never
 * settle.
 */
async function waitForSpawn(timeoutMs = 5000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (globalThis.__loSpawns.length > 0) return globalThis.__loSpawns[0];
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(
		`no spawn was recorded within ${timeoutMs}ms; the application is missing or the flow bailed earlier`,
	);
}

test("the installer's script spawn carries the prefix into the venv it creates", async () => {
	const { BackendInstaller } = await loadMainProcess();

	const resources = mkdtempSync(join(tmpdir(), "lo-resources-"));
	// `process.resourcesPath` is Electron's, and the constructor reads it
	// unguarded; under plain node it has to be seeded, and nothing beneath it has
	// to exist because the resources path only has to be named here.
	const hadResourcesPath = "resourcesPath" in process;
	const originalResourcesPath = process.resourcesPath;
	process.resourcesPath = resources;
	const installer = new BackendInstaller();
	// Where the bundled interpreter the install script uses would be: this is the
	// spawn whose python writes into the sealed bundle if the environment is
	// wrong, which is why the script creates the venv from it.
	installer.pythonPath = join(resources, "python_aarch64", "bin", "python3");

	globalThis.__loSpawns.length = 0;
	try {
		// Not awaited: the child is recorded rather than run, so `install()` never
		// settles. What is under test is the environment handed to the spawn.
		void installer.install();
		const spawned = await waitForSpawn();
		const env = spawned.options.env;
		assert.equal(
			env.PYTHONPYCACHEPREFIX,
			pythonBytecodeCacheDir(PATHS.userData),
			"the install script's own python must not write into the bundle",
		);
		assert.equal(env.ELECTRON_RESOURCE_PATH, resources);
		assert.equal(env.PYTHON_BIN, installer.pythonPath);
	} finally {
		if (hadResourcesPath) process.resourcesPath = originalResourcesPath;
		else delete process.resourcesPath;
		rmSync(resources, { recursive: true, force: true });
		// `install()` writes its script into the OS temp directory; reclaim it.
		rmSync(join(tmpdir(), `install-backend-${process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux"}.${process.platform === "win32" ? "ps1" : "sh"}`), { force: true });
	}
});

test("the update service's python probe runs with the prefix in the child's own environment", async () => {
	const { LocalOperatorStartupMode, UpdateService } = await loadMainProcess();

	const probeDir = mkdtempSync(join(tmpdir(), "lo-probe-python-"));
	// The interpreter reports its OWN environment to a file, and `execFile` really
	// runs it: the assertion is about what the bundled python inherits - the
	// thing that decides whether its stdlib writes bytecode into the sealed
	// bundle - rather than about what the app believes it passed. This probe is
	// `pip show`, which compiles stdlib modules.
	const envReport = join(probeDir, "child-env.txt");
	const stub = join(probeDir, "python3");
	writeFileSync(
		stub,
		`#!/bin/bash\nprintf '%s' "\${PYTHONPYCACHEPREFIX:-}" > '${envReport}'\necho "Name: local-operator"\necho "Version: 0.54.0"\n`,
	);
	chmodSync(stub, 0o755);

	const service = new UpdateService(
		{
			isDestroyed: () => false,
			webContents: { send: () => {}, isDestroyed: () => false },
		},
		{ getStartupMode: () => LocalOperatorStartupMode.APP_BUNDLED_VENV },
	);
	const interval = service.updateCheckInterval;
	try {
		assert.equal(
			await service.readBundledBackendVersion(stub),
			"0.54.0",
			"the probe's output must still parse",
		);
		assert.equal(
			readFileSync(envReport, "utf8"),
			pythonBytecodeCacheDir(PATHS.userData),
			"the child's own PYTHONPYCACHEPREFIX must point at the cache, not into a bundle",
		);
	} finally {
		if (interval) clearInterval(interval);
		rmSync(probeDir, { recursive: true, force: true });
	}
});
