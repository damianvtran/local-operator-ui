import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	appendFileSync,
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
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
/**
 * The backend path decision, bundled the same way: which environment an instance
 * uses is what decides whether an unpackaged run can write into the packaged
 * app's bundle at all.
 */
const pathsBundle = await build({
	stdin: {
		contents: 'export * from "./src/main/backend/venv-paths";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const venvPaths = await import(
	`data:text/javascript;base64,${Buffer.from(
		pathsBundle.outputFiles[0].text,
	).toString("base64")}`
);
const {
	DEV_VENV_DIR_NAME,
	PACKAGED_VENV_DIR_NAME,
	VENV_PATH_ENV,
	isUnpreparedVenvPath,
	legacyEnvironmentReport,
	managedVenvPath,
	venvInterpreter,
} = venvPaths;

const {
	VENV_BYTECODE_GUARD_FILE,
	ensureVenvBytecodeGuard,
	PYTHON_BYTECODE_CACHE_DIR_NAME,
	pythonBytecodeCacheDir,
	venvBytecodeGuardSource,
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
		{
			...env,
			PYTHONPYCACHEPREFIX: undefined,
			PYTHONDONTWRITEBYTECODE: undefined,
		},
		{
			...original,
			PYTHONPYCACHEPREFIX: undefined,
			PYTHONDONTWRITEBYTECODE: undefined,
		},
	);
	assert.notEqual(env, original);
	assert.deepEqual(original, {
		PATH: "/opt/homebrew/bin:/usr/bin",
		HOME: "/Users/someone",
		LOCAL_OPERATOR_DESKTOP_TOKEN: "token",
		PYTHONHASHSEED: "0",
	});
});

test("the refusal is set beside the redirect, and overrides a stale falsy value", () => {
	// The two travel together because each answers a case the other does not: the
	// prefix decides where a write goes (so it fails open when the value is
	// relative, unwritable or dropped), and the flag means no write is attempted
	// at all. CPython was measured for the two falsy spellings - `0` and the empty
	// string - and both left `sys.dont_write_bytecode` False, which is exactly the
	// state a stray `export PYTHONDONTWRITEBYTECODE=0` in a shell rc would put
	// every python the app spawns into.
	for (const value of [undefined, "0", "", "  "]) {
		const env = withPythonBytecodeCache(
			{ PYTHONDONTWRITEBYTECODE: value },
			USER_DATA,
		);
		assert.equal(
			env.PYTHONDONTWRITEBYTECODE,
			"1",
			`an inherited ${JSON.stringify(value)} must not re-enable bytecode writes`,
		);
	}

	// And the flag alone is not the answer either: a prefix that points into a
	// bundle is replaced in the same call, so the pair is what a spawn receives
	// whichever way it is called.
	const env = withPythonBytecodeCache(
		{ PYTHONPYCACHEPREFIX: INSIDE_BUNDLE_PREFIX },
		USER_DATA,
	);
	assert.equal(env.PYTHONDONTWRITEBYTECODE, "1");
	assert.equal(env.PYTHONPYCACHEPREFIX, pythonBytecodeCacheDir(USER_DATA));
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
			process.resourcesPath ??= join(PATHS.home, "resources");
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
					"const __loRequire = __loCreateRequire(import.meta.url);",
					'const require = (id) => (id === "electron" && globalThis.__loElectronFixture ? globalThis.__loElectronFixture : __loRequire(id));',
					// Electron runs the main process as CJS, so the shipped modules use
					// `__dirname` freely; an ESM bundle has to define it. Nothing under
					// test reads through it - it names the installer window's own
					// preload and renderer files, which the BrowserWindow stub ignores.
					"const __dirname = process.cwd();",
					'const __filename = "";',
				].join(" "),
			};
			const electronFixture = `
				const paths = globalThis.__loTestPaths;
				export const app = {
					// A getter rather than a literal, so a test can put the app on the
					// other side of the seal's packaged/dev decision: the installer reads
					// this at construction, and the seal is gated on it.
					get isPackaged() {
						return globalThis.__loTestAppIsPackaged ?? true;
					},
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

			mainProcessBundleDir = mkdtempSync(join(tmpdir(), "lo-bytecode-bundle-"));
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
				plugins: [rawInstallScriptPlugin],
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
 * True when the script's own trace shows it resolved `VENV_PATH` to `path`.
 *
 * Bash's xtrace quotes an assignment whose value has spaces (`+ VENV_PATH='...'`),
 * which is every macOS path this test produces, so the assertion matches the
 * trace's spelling rather than the shell's source text.
 */
function venvAssignment(trace, path) {
	return trace
		.split("\n")
		.some(
			(line) =>
				line === `+ VENV_PATH='${path}'` || line === `+ VENV_PATH=${path}`,
		);
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

	const env = {
		...process.env,
		HOME: home,
		[VENV_PATH_ENV]: join(home, "selected-environment"),
		PYTHON_BIN: pythonStub,
		...extraEnv,
	};
	const result = spawnSync("/bin/bash", ["-x", scriptPath], {
		env,
		encoding: "utf8",
	});
	return { ...result, home, appDataDir };
}

after(() => {
	for (const dir of [PATHS.home, PATHS.userData, mainProcessBundleDir]) {
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
			// The refusal travels with the redirect: a spawn that carries one and not
			// the other is the state this pair exists to prevent, and it is asserted
			// at the spawn rather than only on the builder.
			assert.equal(
				env.PYTHONDONTWRITEBYTECODE,
				"1",
				`${label}: the interpreter must not be able to write bytecode at all`,
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
		assert.equal(
			manager.shellEnv.PYTHONDONTWRITEBYTECODE,
			"1",
			"and the refusal must be there for every reader of shellEnv, not only at the spawns",
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
		new RegExp(
			`:\\s*"\\$\\{PYTHONPYCACHEPREFIX:=\\$APP_DATA_DIR/${dirName}\\}"`,
		),
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
		windowsInstallScript.includes(`if (-not $env:PYTHONPYCACHEPREFIX) {`) &&
			windowsInstallScript.includes(
				`PYTHONPYCACHEPREFIX = "$AppDataDir\\\\${dirName}"`,
			),
		"the Windows script must default the prefix itself",
	);

	// The refusal half, in all three: a standalone run of a script has no app to
	// inherit an environment from, and the pythons it starts (venv creation, pip)
	// are the ones that compiled the operator's in-bundle cache in the field.
	// These run before the script's first python, so they are the whole guarantee
	// for a run nobody's app is managing.
	assert.match(
		macosInstallScript,
		/^export PYTHONDONTWRITEBYTECODE=1$/m,
		"the macOS script must refuse bytecode writes as well as redirecting them",
	);
	assert.match(
		linuxInstallScript,
		/^export PYTHONDONTWRITEBYTECODE=1$/m,
		"the Linux script must refuse bytecode writes as well as redirecting them",
	);
	assert.match(
		windowsInstallScript,
		/^\$env:PYTHONDONTWRITEBYTECODE = "1"$/m,
		"the Windows script must refuse bytecode writes as well as redirecting them",
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
		// Every `: ` assignment in the trace, not the first: the script now defaults
		// two variables this way (the venv path and the prefix), and bash's xtrace
		// prints both as `+ : '<value>'`.
		const assignments = trace
			.split("\n")
			.filter((line) => line.startsWith("+ : "));
		assert.ok(
			assignments.some((line) => line.includes(expected)),
			`the default must resolve to ${expected}; assignment lines: ${assignments.join(" | ")}; trace head:\n${trace
				.split("\n")
				.slice(0, 14)
				.join("\n")}`,
		);
		assert.match(
			trace,
			/^\+ export PYTHONPYCACHEPREFIX$/m,
			"the script must export the prefix it defaulted, or the python it runs will not inherit it",
		);
		assert.match(
			trace,
			/^\+ export PYTHONDONTWRITEBYTECODE=1$/m,
			"and it must export the refusal with it, or the pythons it starts can still write into the tree",
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
			.filter((line) => line.startsWith("+ : "));
		assert.ok(
			preset.some((line) => line.includes(appValue)),
			`a prefix the app set must be the one the script uses; assignment lines: ${preset.join(" | ")}`,
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

/**
 * The dev arm of the same handoff, which is the configuration that was measured
 * wrong: an unpackaged instance's install must build its own environment.
 *
 * QA could not run this path end to end - doing so writes into the operator's
 * shared app-support tree - so it is covered here instead: the value the spawn is
 * handed is `managedVenvPath`'s answer for an unpackaged instance, and it is not
 * the packaged name.
 */
test("an unpackaged instance hands the script its own environment, not the packaged app's", async () => {
	const { BackendInstaller } = await loadMainProcess();

	const resources = mkdtempSync(join(tmpdir(), "lo-resources-dev-venv-"));
	const hadResourcesPath = "resourcesPath" in process;
	const originalResourcesPath = process.resourcesPath;
	const originalPackaged = globalThis.__loTestAppIsPackaged;
	process.resourcesPath = resources;
	globalThis.__loTestAppIsPackaged = false;
	try {
		const installer = new BackendInstaller();
		const expected = managedVenvPath({
			platform: process.platform,
			home: PATHS.home,
			appDataPath: PATHS.userData,
			packaged: false,
		});
		assert.equal(
			installer.venvPath,
			expected,
			"the instance's own environment is the unpackaged one",
		);
		assert.notEqual(
			installer.venvPath,
			managedVenvPath({
				platform: process.platform,
				home: PATHS.home,
				appDataPath: PATHS.userData,
				packaged: true,
			}),
			"and it must differ from the packaged app's, or the split is not a split",
		);

		globalThis.__loSpawns.length = 0;
		installer.pythonPath = join(PATHS.home, "external-python");
		void installer.installEnvironment();
		const spawned = await waitForSpawn();
		assert.equal(
			spawned.options.env[VENV_PATH_ENV],
			expected,
			"the script must be told, since it cannot derive it: left to itself it builds the packaged name",
		);
	} finally {
		if (hadResourcesPath) process.resourcesPath = originalResourcesPath;
		else delete process.resourcesPath;
		if (originalPackaged === undefined) delete globalThis.__loTestAppIsPackaged;
		else globalThis.__loTestAppIsPackaged = originalPackaged;
		rmSync(resources, { recursive: true, force: true });
		rmSync(
			join(
				tmpdir(),
				`install-backend-${process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux"}.${process.platform === "win32" ? "ps1" : "sh"}`,
			),
			{ force: true },
		);
	}
});

/**
 * The install scripts take the path the app resolved, and only the two that can
 * safely default (Linux, Windows) fall back to the packaged name when nobody's
 * app started them; macOS refuses instead, because its default is the environment
 * this split exists to keep a second instance out of.
 *
 * Why this is a case of its own: the venv split is only real if the script that
 * creates the environment agrees with the app about which environment it is. A
 * review measured the shipped macOS script building `.../local-operator-venv`
 * under a dev instance whose own answer was `.../local-operator-venv-dev`, i.e.
 * a dev run creating, pip-installing into and `rm -rf`ing the packaged app's
 * environment. The text half is checked because the ps1 cannot be executed here;
 * the macOS half is executed, because a match on the text says the line is there
 * rather than what the script resolves.
 */
test("the install scripts consume the resolved final environment path", async () => {
	const { linuxInstallScript, macosInstallScript, windowsInstallScript } = await loadInstallScripts();
	assert.ok(macosInstallScript.includes('VENV_PATH="$LOCAL_OPERATOR_VENV_PATH"'));
	assert.ok(linuxInstallScript.includes('VENV_PATH="$LOCAL_OPERATOR_VENV_PATH"'));
	assert.ok(windowsInstallScript.includes('$VenvPath = $env:LOCAL_OPERATOR_VENV_PATH'));
	const unset = runMacosInstallScript(macosInstallScript, { [VENV_PATH_ENV]: undefined });
	assert.notEqual(unset.status, 0);
	assert.match(unset.stderr, /Pass the resolved managed environment path/);
	const selected = join(PATHS.home, "managed-python", "dev", "environments", "selected-generation");
	const supplied = runMacosInstallScript(macosInstallScript, { [VENV_PATH_ENV]: selected });
	assert.ok(venvAssignment(supplied.stderr, selected));
});

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
		installer.pythonPath = join(PATHS.home, "external-python");
		void installer.installEnvironment();
		const spawned = await waitForSpawn();
		const env = spawned.options.env;
		assert.equal(
			env.PYTHONPYCACHEPREFIX,
			pythonBytecodeCacheDir(PATHS.userData),
			"the install script's own python must not write into the bundle",
		);
		assert.equal(env.ELECTRON_RESOURCE_PATH, resources);
		assert.equal(env.PYTHON_BIN, installer.pythonPath);
		assert.equal(
			env.PYTHONDONTWRITEBYTECODE,
			"1",
			"the script's own venv creation and pip runs are pythons we start",
		);
		assert.equal(
			env[VENV_PATH_ENV],
			installer.venvPath,
			"the script cannot derive the environment it may build and rm -rf; it is handed it",
		);
		assert.equal(
			env[VENV_PATH_ENV],
			managedVenvPath({
				platform: process.platform,
				home: PATHS.home,
				appDataPath: PATHS.userData,
				packaged: true,
			}),
			"and the value must be the app's own decision for this instance",
		);
	} finally {
		if (hadResourcesPath) process.resourcesPath = originalResourcesPath;
		else delete process.resourcesPath;
		rmSync(resources, { recursive: true, force: true });
		// `install()` writes its script into the OS temp directory; reclaim it.
		rmSync(
			join(
				tmpdir(),
				`install-backend-${process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux"}.${process.platform === "win32" ? "ps1" : "sh"}`,
			),
			{ force: true },
		);
	}
});

/** Hash every file under `dir`, so a seal can be shown not to change content. */
function hashTree(dir) {
	const digest = createHash("sha256");
	const walk = (current) => {
		for (const entry of readdirSync(current, { withFileTypes: true }).sort(
			(a, b) => a.name.localeCompare(b.name),
		)) {
			const child = join(current, entry.name);
			digest.update(child.slice(dir.length));
			if (entry.isDirectory()) walk(child);
			else digest.update(readFileSync(child));
		}
	};
	walk(dir);
	return digest.digest("hex");
}

/** The write CPython performs for a cache entry: a directory, then the .pyc. */
function writeCacheEntry(tree, relative) {
	const target = join(tree, relative);
	mkdirSync(target, { recursive: true });
	writeFileSync(join(target, "mod.cpython-312.pyc"), "bytecode");
}

/**
 * The access-control entries `path` carries, one string per `ls -le` line.
 *
 * `ls` is the only tool here that can see an ACE - `stat` cannot - which is why
 * the idempotence assertion goes through it rather than through a mode.
 */
function aceLines(path) {
	const run = spawnSync("/bin/ls", ["-led", path], { encoding: "utf8" });
	assert.equal(run.status, 0, `ls -le must report on ${path}: ${run.stderr}`);
	return run.stdout
		.split("\n")
		.filter((line) => /^\s*\d+:\s/.test(line))
		.map((line) => line.trim());
}

test("the installer never executes the macOS in-bundle seed", async () => {
	const { BackendInstaller } = await loadMainProcess();
	const installer = new BackendInstaller();
	if (process.platform === "darwin") assert.equal(installer.findPython(), null);
});

test("the update service's python probe runs with the guards in the child's own environment", async () => {
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
		`#!/bin/bash\nprintf '%s %s' "\${PYTHONPYCACHEPREFIX:-}" "\${PYTHONDONTWRITEBYTECODE:-}" > '${envReport}'\necho "Name: local-operator"\necho "Version: 0.54.0"\n`,
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
			`${pythonBytecodeCacheDir(PATHS.userData)} 1`,
			"the child's own environment must carry both guards: the prefix, pointing at the cache rather than into a bundle, and the refusal",
		);
	} finally {
		if (interval) clearInterval(interval);
		rmSync(probeDir, { recursive: true, force: true });
	}
});

test("every python-running runCommand call site in the update service passes the guarded environment", () => {
	// The `pip install --upgrade` spawn reaches the same bundled interpreter as
	// the probe above, but it sits behind the whole update flow - the seal
	// pre-flight, the disk-space check and a backend stop - so this binds it at
	// the source instead of driving that flow to reach it. A call site that runs
	// python without `env: this.pythonSpawnEnv()` is the defect, and deleting the
	// `env:` from the pip run is exactly what review M1 and QA Q2 measured: the
	// probe's own spawned child is asserted above, so the two halves together
	// cover every python this file can start.
	const source = readFileSync(
		join(process.cwd(), "src/main/update-service.ts"),
		"utf8",
	).replace(/\r\n/g, "\n");

	// The declaration is a `runCommand(` too, and matching it would have this
	// case reading its own signature rather than a call site.
	const declaration = source.indexOf("function runCommand(");
	const calls = [];
	for (
		let at = source.indexOf("runCommand(");
		at !== -1;
		at = source.indexOf("runCommand(", at + 1)
	) {
		if (at === declaration + "function ".length) continue;
		let depth = 0;
		let end = at + "runCommand".length;
		for (; end < source.length; end++) {
			if (source[end] === "(") depth++;
			else if (source[end] === ")" && --depth === 0) break;
		}
		calls.push({
			at,
			line: source.slice(0, at).split("\n").length,
			text: source.slice(at, end + 1),
		});
	}

	// Which of them run python: the command handed in is the interpreter this app
	// ships, either by path or through the pip command builder. `codesign` is the
	// file's other call site and wants the inherited environment, not this one.
	const pythonCalls = calls.filter(({ text }) =>
		/pythonPath|pip\.command/.test(text),
	);

	// Asserted rather than assumed, so a reorganisation cannot make this pass by
	// finding nothing: the probe and the pip upgrade are the two that exist.
	assert.equal(
		calls.length,
		3,
		`expected the file's three runCommand call sites, found ${calls.length}`,
	);
	assert.equal(
		pythonCalls.length,
		2,
		`expected two python-running call sites, found ${pythonCalls.length}`,
	);
	for (const { line, text } of pythonCalls) {
		assert.match(
			text,
			/env:\s*this\.pythonSpawnEnv\(\)/,
			`the python spawn at src/main/update-service.ts:${line} must pass the guarded environment: ${text.replace(/\s+/g, " ")}`,
		);
	}
});

// ---------------------------------------------------------------------------
// The app-managed venv: the pythons this app never spawns

/**
 * A venv on disk with one `site-packages`, built the way CPython's `venv`
 * module builds it.
 *
 * A directory tree rather than a real `python -m venv`: what is under test is
 * where the guard is written and what it says, and a real venv would add a
 * network-shaped dependency to a check about one file's placement. The
 * behavioural half - that CPython imports this file and honours it - is the
 * case after these, which runs a real interpreter.
 */
function makeVenv(layout = join("lib", "python3.12", "site-packages")) {
	const venvPath = mkdtempSync(join(tmpdir(), "lo-venv-"));
	mkdirSync(join(venvPath, layout), { recursive: true });
	return venvPath;
}

test("the guard is written into the venv's own site-packages", () => {
	const venvPath = makeVenv();
	try {
		const guard = ensureVenvBytecodeGuard(venvPath);
		const expected = join(
			venvPath,
			"lib",
			"python3.12",
			"site-packages",
			VENV_BYTECODE_GUARD_FILE,
		);
		assert.equal(guard.path, expected);
		assert.equal(guard.written, true, guard.reason);
		assert.equal(readFileSync(expected, "utf8"), venvBytecodeGuardSource());
		// The property, not the text: the file turns bytecode writing off, which
		// is what a process using this venv inherits whether or not it was this
		// app that started it.
		assert.match(
			readFileSync(expected, "utf8"),
			/^sys\.dont_write_bytecode = True$/m,
		);

		// Idempotent by content, because this runs at every start.
		const second = ensureVenvBytecodeGuard(venvPath);
		assert.equal(second.written, false);
		assert.match(second.reason, /already refuses bytecode writes/);
	} finally {
		rmSync(venvPath, { recursive: true, force: true });
	}
});

test("a venv without site-packages is reported, not created", () => {
	const venvPath = mkdtempSync(join(tmpdir(), "lo-venv-empty-"));
	try {
		const guard = ensureVenvBytecodeGuard(venvPath);
		assert.equal(guard.path, null);
		assert.equal(guard.written, false);
		assert.match(guard.reason, /no site-packages/);
		assert.deepEqual(
			readdirSync(venvPath),
			[],
			"nothing may be created in a venv that is not there yet",
		);
	} finally {
		rmSync(venvPath, { recursive: true, force: true });
	}
});

test("a sitecustomize.py that is not ours is left exactly as it is", () => {
	const venvPath = makeVenv();
	const theirs = join(
		venvPath,
		"lib",
		"python3.12",
		"site-packages",
		VENV_BYTECODE_GUARD_FILE,
	);
	const ownText = "print('the operator put this here')\n";
	writeFileSync(theirs, ownText);
	try {
		const guard = ensureVenvBytecodeGuard(venvPath);
		assert.equal(guard.written, false);
		assert.match(guard.reason, /is not ours/);
		assert.equal(
			readFileSync(theirs, "utf8"),
			ownText,
			"a file the app did not write must never be replaced, whatever it does",
		);
	} finally {
		rmSync(venvPath, { recursive: true, force: true });
	}
});

test("a previous revision's guard is refreshed rather than kept", () => {
	// The sentinel is what makes a stale guard ours to replace: a file carrying it
	// was written by this app, so keeping an old revision would leave the venv
	// running whatever that revision said.
	const venvPath = makeVenv();
	const theirs = join(
		venvPath,
		"lib",
		"python3.12",
		"site-packages",
		VENV_BYTECODE_GUARD_FILE,
	);
	writeFileSync(
		theirs,
		"# Local Operator bytecode guard. Do not edit; the app rewrites this file.\n",
	);
	try {
		const guard = ensureVenvBytecodeGuard(venvPath);
		assert.equal(guard.written, true, guard.reason);
		assert.equal(readFileSync(theirs, "utf8"), venvBytecodeGuardSource());
	} finally {
		rmSync(venvPath, { recursive: true, force: true });
	}
});

test("a real CPython imports the guard and stops writing bytecode", (t) => {
	// The mechanism, measured rather than reasoned about: `site` imports
	// `sitecustomize` from a directory on `sys.path`, so a real interpreter run
	// with the guard's own bytes on `PYTHONPATH` reports `sys.dont_write_bytecode`
	// True and leaves no `__pycache__` beside the module it imports. The control
	// run - the same import without the guard - is asserted beside it, because a
	// test that cannot produce the write cannot prove it was prevented.
	const scratch = mkdtempSync(join(tmpdir(), "lo-guard-real-"));
	const guardDir = join(scratch, "site-packages");
	const moduleDir = join(scratch, "modules");
	mkdirSync(guardDir, { recursive: true });
	mkdirSync(moduleDir, { recursive: true });
	writeFileSync(
		join(guardDir, VENV_BYTECODE_GUARD_FILE),
		venvBytecodeGuardSource(),
	);
	writeFileSync(join(moduleDir, "lo_probe_module.py"), "VALUE = 1\n");

	const run = (extraEnv) =>
		spawnSync(
			"python3",
			[
				"-c",
				`import sys; sys.path.insert(0, ${JSON.stringify(moduleDir)}); import lo_probe_module; print(sys.dont_write_bytecode)`,
			],
			{ encoding: "utf8", env: { ...process.env, ...extraEnv } },
		);
	const cacheDir = join(moduleDir, "__pycache__");
	try {
		const control = run({ PYTHONPATH: "" });
		if (control.error) {
			t.skip(`no python3 on PATH to measure with: ${control.error.message}`);
			return;
		}
		assert.equal(
			control.stdout.trim(),
			"False",
			`the control run must be able to write: ${control.stderr}`,
		);
		assert.ok(
			existsSync(cacheDir),
			"the control run must have produced a __pycache__",
		);

		rmSync(cacheDir, { recursive: true, force: true });
		const guarded = run({ PYTHONPATH: guardDir });
		assert.equal(
			guarded.stdout.trim(),
			"True",
			`the guard must be imported by site: ${guarded.stderr}`,
		);
		assert.equal(
			existsSync(cacheDir),
			false,
			"a process that imports the guard must write no bytecode at all, not merely somewhere else",
		);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// Every spawn site, enumerated

/**
 * `source` with comments blanked out, keeping every offset and newline.
 *
 * Needed because the scan below is textual: a `spawn (` inside a doc comment -
 * and this codebase has several, they are how these rules are explained - is
 * not a call site, and a table that demanded one would be asserting on prose.
 * Length-preserving so the line numbers it reports are the file's own.
 */
function blankComments(source) {
	let out = "";
	let i = 0;
	while (i < source.length) {
		const ch = source[i];
		const next = source[i + 1];
		if (ch === "/" && next === "/") {
			while (i < source.length && source[i] !== "\n") {
				out += " ";
				i += 1;
			}
			continue;
		}
		if (ch === "/" && next === "*") {
			out += "  ";
			i += 2;
			while (
				i < source.length &&
				!(source[i] === "*" && source[i + 1] === "/")
			) {
				out += source[i] === "\n" ? "\n" : " ";
				i += 1;
			}
			out += "  ";
			i += 2;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			out += ch;
			i += 1;
			while (i < source.length) {
				if (source[i] === "\\") {
					out += `${source[i]}${source[i + 1] ?? ""}`;
					i += 2;
					continue;
				}
				out += source[i];
				if (source[i] === ch) {
					i += 1;
					break;
				}
				i += 1;
			}
			continue;
		}
		out += ch;
		i += 1;
	}
	return out;
}

const CHILD_PROCESS_NAMES = [
	"spawn",
	"spawnSync",
	"exec",
	"execSync",
	"execFile",
	"execFileSync",
];

/** Every `.ts` under `src/main`, excluding test files. */
function mainProcessSources() {
	const files = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const child = join(dir, entry.name);
			if (entry.isDirectory()) walk(child);
			else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
				files.push(child);
			}
		}
	};
	walk(join(process.cwd(), "src", "main"));
	return files.sort();
}

/**
 * Every child-process call site in the shipping main-process sources, in file
 * order, with the balanced text of its argument list.
 *
 * What it counts: names imported from `node:child_process` in that file, and the
 * `require("node:child_process").name(` spelling `index.ts` uses. `RegExp.exec`
 * is deliberately not a child process, so a `.exec(` whose receiver is anything
 * else is skipped — which is also why the receiver is checked rather than the
 * name alone.
 */
function findChildProcessSites() {
	const sites = [];
	for (const file of mainProcessSources()) {
		const raw = readFileSync(file, "utf8");
		const source = blankComments(raw);
		const imported = new Set();
		for (const match of raw.matchAll(
			/import\s*\{([^}]*)\}\s*from\s*"node:child_process"/g,
		)) {
			for (const part of match[1].split(",")) {
				const name = part.trim();
				if (name) imported.add(name);
			}
		}
		if (imported.size === 0 && !/require\("node:child_process"\)/.test(raw)) {
			continue;
		}
		const found = [];
		for (const name of CHILD_PROCESS_NAMES) {
			if (!imported.has(name)) {
				const pattern = new RegExp(
					`require\\("node:child_process"\\)\\.${name}\\s*\\(`,
					"g",
				);
				for (const match of source.matchAll(pattern)) {
					found.push({ name, at: match.index + match[0].indexOf(name) });
				}
				continue;
			}
			for (const match of source.matchAll(
				new RegExp(`(?<!\\.)\\b${name}\\s*\\(`, "g"),
			)) {
				found.push({ name, at: match.index });
			}
		}
		found.sort((a, b) => a.at - b.at);
		const seen = {};
		for (const site of found) {
			seen[site.name] = (seen[site.name] ?? 0) + 1;
			let depth = 0;
			let end = source.indexOf("(", site.at);
			for (; end < source.length; end += 1) {
				if (source[end] === "(") depth += 1;
				else if (source[end] === ")" && (depth -= 1) === 0) break;
			}
			sites.push({
				file: relative(process.cwd(), file),
				line: raw.slice(0, site.at).split("\n").length,
				name: site.name,
				index: seen[site.name],
				text: raw.slice(source.indexOf("(", site.at) + 1, end),
			});
		}
	}
	return sites;
}

/**
 * The guarded environment a spawn has to pass, asserted on the call's own text.
 *
 * Not the only assertion about it: the cases above drive the three spawn classes
 * that run our interpreter and read the environment the child is actually given
 * (`backendSpawnEnv`, the install script's `env`, the update service's
 * `pythonSpawnEnv`). This is the coverage half - every site in the file, and a
 * new one fails for being absent rather than for what it does.
 */
const GUARDED_ENV =
	/withPythonBytecodeCache|backendSpawnEnv\(\)|pythonSpawnEnv\(\)/;

/**
 * A spawn that runs an interpreter this app ships, and the guard it must carry.
 */
function runsPython(file, name, index, env, why, binding) {
	return { file, name, index, kind: "python", env, why, binding };
}

/** A spawn that starts no interpreter, with the command it starts. */
function runsCommand(file, name, index, command, why) {
	return { file, name, index, kind: "command", command, why };
}

/**
 * A spawn whose command is the caller's, with the call sites that decide it.
 */
function passThrough(file, name, index, why) {
	return { file, name, index, kind: "passthrough", why };
}

/**
 * Every child-process spawn site in the main process, and what it must carry.
 *
 * Why a table the test walks rather than a case per site: the failure this file
 * exists to remove is a spawn site that forgets the guard, and the site that
 * forgets it is the one somebody adds next month. The scan above finds every
 * site; anything it finds that is not named here fails, so the table is the
 * place a new spawn has to be considered - either with the guarded environment
 * it passes, or with the reason no interpreter runs under it.
 *
 * The command rows are the second half of the same property: they assert the
 * command the call actually starts, so a row cannot go on claiming "no
 * interpreter here" after the command under it changed.
 */
const SPAWN_SITES = [
	runsPython(
		"src/main/backend/managed-python.ts", "spawn", 1, /env:\s*isolated/,
		"the owned backend-preparation smoke child; its env is the blocked allowlist bound to withPythonBytecodeCache",
		/const isolated = withPythonBytecodeCache\(/,
	),
	runsCommand(
		"src/main/backend/backend-installer.ts",
		"spawn",
		1,
		/"taskkill"/,
		"kills a stuck install process by pid; taskkill is a macOS/Windows tool, not an interpreter",
	),
	runsPython(
		"src/main/backend/backend-installer.ts",
		"spawn",
		2,
		/*
		 * A property SHORTHAND, not the word `env`.
		 *
		 * This row matched `/\benv\b/`, which `env: process.env` satisfies - so it
		 * asserted that the property was called `env` and would have stayed green for
		 * an unguarded spawn that handed the script the ambient environment (review
		 * R6). It now requires `env` to be passed as a bare shorthand, and the binding
		 * below requires that identifier to be the one `withPythonBytecodeCache`
		 * built, which is the pair the managed-python row above already uses.
		 */
		/(?:\{|,)\s*env\s*,/,
		"the install script, which creates the venv with the bundled interpreter and pips into it, so its `env` is built by `withPythonBytecodeCache` (asserted by the installer case above)",
		/const env: Record<string, string \| undefined> =\s*withPythonBytecodeCache\(/,
	),
	runsPython(
		"src/main/backend/backend-service.ts",
		"spawn",
		1,
		/env:\s*this\.backendSpawnEnv\(\)/,
		"the global-install backend, whose `python` is the interpreter we ship",
	),
	runsPython(
		"src/main/backend/backend-service.ts",
		"spawn",
		2,
		/env:\s*this\.backendSpawnEnv\(\)/,
		"the app-bundled venv backend, built on the interpreter inside the sealed bundle",
	),
	runsCommand(
		"src/main/backend/backend-service.ts",
		"spawn",
		3,
		/"taskkill"/,
		"kills the backend by pid",
	),
	runsCommand(
		"src/main/backend/backend-service.ts",
		"spawn",
		4,
		/"taskkill"/,
		"kills the backend by pid, forcibly",
	),
	// `index.ts` is the process-cleanup block: every site is a ps/pkill/pgrep or
	// taskkill/tasklist call, none of which is an interpreter. Listed one by one
	// rather than exempted as a file, because a file-level exemption is exactly
	// what a new `spawn(pythonPath)` there would hide behind.
	runsCommand("src/main/index.ts", "execSync", 1, /taskkill .*python\.exe/, "kills stray python processes on Windows"),
	runsCommand("src/main/index.ts", "execSync", 2, /taskkill .*local-operator\.exe/, "kills the global install on Windows"),
	runsCommand("src/main/index.ts", "execSync", 3, /pkill -f "local-operator serve"/, "stops the backend, gracefully"),
	runsCommand("src/main/index.ts", "execSync", 4, /pkill -9 -f "local-operator serve"/, "stops the backend, forcibly"),
	runsCommand("src/main/index.ts", "execSync", 5, /tasklist .*python\.exe/, "lists python processes on Windows"),
	runsCommand("src/main/index.ts", "execSync", 6, /tasklist .*local-operator\.exe/, "lists the global install on Windows"),
	runsCommand("src/main/index.ts", "execSync", 7, /pgrep -f "local-operator serve"/, "asks whether the backend is still up"),
	runsCommand("src/main/index.ts", "execSync", 8, /taskkill .*python\.exe \/t/, "final cleanup on Windows"),
	runsCommand("src/main/index.ts", "execSync", 9, /pkill -9 -f python/, "final cleanup on Unix"),
	runsCommand("src/main/index.ts", "execSync", 10, /taskkill .*python\.exe/, "the same cleanup on the error path"),
	runsCommand("src/main/index.ts", "execSync", 11, /taskkill .*local-operator\.exe/, "the same, for the global install"),
	runsCommand("src/main/index.ts", "execSync", 12, /pkill -f "local-operator serve"/, "the same, gracefully"),
	runsCommand("src/main/index.ts", "execSync", 13, /sleep 1 && pkill -9/, "the same, after a grace period"),
	runsCommand("src/main/index.ts", "spawnSync", 1, /"cmd\.exe"/, "the same cleanup through cmd.exe"),
	runsCommand("src/main/index.ts", "spawnSync", 2, /"cmd\.exe"/, "the same, for the global install"),
	runsCommand("src/main/index.ts", "spawnSync", 3, /"bash"/, "the same cleanup through bash"),
	runsCommand("src/main/index.ts", "spawnSync", 4, /"bash"/, "the same, after a grace period"),
	runsCommand("src/main/index.ts", "spawnSync", 5, /"cmd\.exe"/, "the relaunch path's cleanup"),
	runsCommand("src/main/index.ts", "spawnSync", 6, /"cmd\.exe"/, "the relaunch path's cleanup, for the global install"),
	runsCommand("src/main/index.ts", "spawnSync", 7, /"bash"/, "the relaunch path's cleanup on Unix"),
	runsCommand("src/main/index.ts", "spawnSync", 8, /"bash"/, "the relaunch path's cleanup, after a grace period"),

	passThrough(
		"src/main/update-service.ts",
		"execFile",
		1,
		"the update service's `runCommand`: it runs `codesign` (inherited environment, its own call sites below) and the two python probes, and the python call sites pass `pythonSpawnEnv()` - asserted by the runCommand case above",
	),
	passThrough(
		"src/main/update-service.ts",
		"execFileSync",
		1,
		"`readCommandOutput`, used for /bin/ps and /usr/bin/defaults - no interpreter among its call sites",
	),
	runsCommand(
		"src/main/update-service.ts",
		"spawnSync",
		1,
		/"\/bin\/launchctl"/,
		"removes ShipIt's launchd job",
	),
	runsCommand(
		"src/main/update-service.ts",
		"spawnSync",
		2,
		/jobProbe/,
		"asks launchd whether ShipIt's job is loaded; `jobProbe` is `/bin/launchctl` from `watchdogSignals`",
	),
	runsCommand(
		"src/main/update-service.ts",
		"spawn",
		1,
		/"sh"/,
		"the relaunch watchdog: a shell script that waits for the swap and starts the app again. It runs no interpreter; the app it starts applies the guards to its own spawns, and the watchdog's `env` is the inherited one plus the plan's variables",
	),
];

test("every child-process spawn site is enumerated, and the python ones carry the guards", () => {
	const sites = findChildProcessSites();
	// Asserted rather than assumed, so a scanner that silently stopped matching
	// cannot make this pass by finding nothing: one site per row is the table's
	// own count.
	assert.equal(
		sites.length > 0,
		true,
		"the scan found no child-process call sites at all, which means the scan is broken rather than that the app starts nothing",
	);

	// The other half of every python row, asserted once because there is one
	// builder: the shared environment has to set BOTH variables - the prefix
	// decides where a write goes, the flag is what refuses it - and a per-site
	// grep for a name would pass on a file that merely mentions it (review R6).
	const builder = readFileSync(
		join(process.cwd(), "src/main/python-bytecode-cache.ts"),
		"utf8",
	);
	assert.match(
		builder,
		/PYTHONPYCACHEPREFIX:\s*prefix/,
		"the guarded environment must set PYTHONPYCACHEPREFIX to the prefix it resolved",
	);
	assert.match(
		builder,
		/PYTHONDONTWRITEBYTECODE:\s*"1"/,
		"and PYTHONDONTWRITEBYTECODE, unconditionally: the spawns that reach it are the ones we start",
	);

	const key = (site) => `${site.file}#${site.name}#${site.index}`;
	const rows = new Map(SPAWN_SITES.map((row) => [key(row), row]));

	const unlisted = sites.filter((site) => !rows.has(key(site)));
	assert.deepEqual(
		unlisted.map(
			(site) =>
				`${site.file}:${site.line} ${site.name} #${site.index}: ${site.text.replace(/\s+/g, " ").trim().slice(0, 80)}`,
		),
		[],
		"every spawn site must be named in SPAWN_SITES - either with the guarded environment it passes (runsPython), or with the command it starts and the reason no interpreter runs under it (runsCommand/passThrough). A new site fails here on purpose: that is the site most likely to have forgotten the guard.",
	);

	const stale = SPAWN_SITES.filter(
		(row) => !sites.some((site) => key(site) === key(row)),
	);
	assert.deepEqual(
		stale.map(key),
		[],
		"SPAWN_SITES names a call site that is no longer there; remove the row with the call, so the table stays a description of the tree",
	);

	for (const site of sites) {
		const row = rows.get(key(site));
		const where = `${site.file}:${site.line} ${site.name} #${site.index}`;
		if (row.kind === "python") {
			assert.match(
				site.text,
				row.env,
				`${where} runs an interpreter we ship and must hand it the guarded environment (${row.why})`,
			);
			assert.match(
				readFileSync(join(process.cwd(), site.file), "utf8"),
				GUARDED_ENV,
				`${where} must build its environment with withPythonBytecodeCache (or the service's own wrapper): ${row.why}`,
			);
			if (row.binding) {
				assert.match(
					readFileSync(join(process.cwd(), site.file), "utf8"),
					row.binding,
					`${where} passes an environment that must be bound to the guarded builder: ${row.why}`,
				);
			}
		} else if (row.kind === "command") {
			assert.match(
				site.text,
				row.command,
				`${where} must still start the command its row names (${row.why})`,
			);
		}
	}
});

// ---------------------------------------------------------------------------
// Which interpreter environment an instance uses

test("a packaged and an unpackaged instance never share a venv", () => {
	for (const platform of ["darwin", "linux", "win32"]) {
		const input = { platform, home: PATHS.home, appDataPath: PATHS.userData };
		const packaged = managedVenvPath({ ...input, packaged: true });
		const dev = managedVenvPath({ ...input, packaged: false });
		assert.notEqual(packaged, dev);
		if (platform === "darwin") {
			// Nothing is published in this fixture, so both answers are the sentinel -
			// and it is spelled so a reader cannot mistake it for a directory
			// (review N3).
			assert.match(packaged, /managed-python[/]packaged[/]no-environment-selected$/);
			assert.match(dev, /managed-python[/]dev[/]no-environment-selected$/);
			assert.ok(isUnpreparedVenvPath(packaged));
			assert.ok(isUnpreparedVenvPath(dev));
		} else {
			assert.ok(packaged.endsWith(PACKAGED_VENV_DIR_NAME));
			assert.ok(dev.endsWith(DEV_VENV_DIR_NAME));
			assert.ok(!isUnpreparedVenvPath(packaged));
		}
	}
});

test("the bundle a venv's interpreter resolves its stdlib from is read from pyvenv.cfg", () => {
	const home = mkdtempSync(join(tmpdir(), "lo-venv-bundle-"));
	const app = join(home, "Applications", "Local Operator.app");
	mkdirSync(join(app, "Contents", "Resources", "python_aarch64", "bin"), {
		recursive: true,
	});
	const venv = join(home, "venv");
	mkdirSync(venv, { recursive: true });
	writeFileSync(
		join(venv, "pyvenv.cfg"),
		[
			`home = ${join(app, "Contents", "Resources", "python_aarch64", "bin")}`,
			"include-system-site-packages = false",
			"version = 3.12.10",
			`executable = ${join(app, "Contents", "Resources", "python_aarch64", "bin", "python3.12")}`,
			"",
		].join("\n"),
	);
	try {
		// The field measurement, reproduced: this is what the operator's
		// app-managed venv says today, and it is why a dev instance's backend start
		// writes into the installed app.
		assert.deepEqual(venvInterpreter(venv), { kind: "bundled", bundle: app });

		// An unpackaged instance's own venv is built on the checkout's interpreter
		// tree: same tail, no bundle, nothing to repair from here.
		writeFileSync(
			join(venv, "pyvenv.cfg"),
			`home = /Users/someone/local-operator/resources/python_aarch64/bin\n`,
		);
		assert.deepEqual(venvInterpreter(venv), { kind: "none" });

		// And a system or uv-managed python has no bundle behind it either.
		writeFileSync(join(venv, "pyvenv.cfg"), "home = /opt/homebrew/bin\n");
		assert.deepEqual(venvInterpreter(venv), { kind: "none" });

		// A bundle the venv names that is GONE is its own answer, not the same one as
		// "no bundle here": this is the operator's state today, and the start-up
		// repair names the path it could not find rather than staying silent (QA Q3).
		const gone = join(home, "Gone.app");
		writeFileSync(
			join(venv, "pyvenv.cfg"),
			`home = ${join(gone, "Contents", "Resources", "python", "bin")}\n`,
		);
		assert.deepEqual(venvInterpreter(venv), { kind: "missing", bundle: gone });
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
	assert.deepEqual(
		venvInterpreter(join(tmpdir(), "lo-venv-that-does-not-exist-xyz")),
		{ kind: "none" },
	);
});

/**
 * The wiring, not the guard: constructing the installer must put the guard in
 * the venv THIS instance will run, at start-up, because the installs already on
 * a disk were created before the guard existed.
 */
test("constructing the macOS installer does not edit a legacy venv", async () => {
	const { BackendInstaller } = await loadMainProcess();
	const legacy = join(PATHS.home, "Library", "Application Support", "Local Operator", "local-operator-venv", "lib", "python3.12", "site-packages");
	mkdirSync(legacy, { recursive: true });
	const userGuard = join(legacy, "sitecustomize.py");
	writeFileSync(userGuard, "# unknown user work\n");
	new BackendInstaller();
	assert.equal(readFileSync(userGuard, "utf8"), "# unknown user work\n");
});

// ---------------------------------------------------------------------------
// What the rounds asked for, pinned where the copy lives

test("the pre-split environments are reported from the paths that actually exist", (t) => {
	// Review R7: the start-up report was written for the environment an install
	// from before this change built, and it handed `managedVenvPath`'s answer to
	// `venvInterpreter`. On darwin that answer is either the post-split selection
	// venv - whose `pyvenv.cfg` names the external runtime by construction - or the
	// sentinel, so both iterations took the `continue` and nothing was ever logged
	// for the one state the function exists to describe.
	const home = mkdtempSync(join(tmpdir(), "lo-legacy-venv-"));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const support = join(home, "Library", "Application Support", "Local Operator");
	const legacy = join(support, "local-operator-venv");
	mkdirSync(join(legacy, "bin"), { recursive: true });
	/*
	 * A fixture bundle INSIDE this temp directory, not the operator's installed
	 * app. The first version of this test named `/Applications/Local Operator.app`
	 * and asserted the "still built on the installed bundle" line - which exists on
	 * the machine it was written on and nowhere else, so it was asserting a
	 * property of that machine and would have failed on any runner (measured: it
	 * did, on `ubuntu-latest`). `venvInterpreter` decides "bundled" from the
	 * `pyvenv.cfg` `home` alone plus whether the bundle named there is on disk, so
	 * a fixture bundle makes the same assertion true anywhere. The directory is
	 * what makes it "bundled" rather than "missing"; nothing is executed.
	 */
	const bundle = join(home, "Fixture.app");
	const bundledBin = join(bundle, "Contents", "Resources", "python_aarch64", "bin");
	mkdirSync(bundledBin, { recursive: true });
	writeFileSync(
		join(legacy, "pyvenv.cfg"),
		`home = ${bundledBin}\n`,
	);

	// The input the old report used, for the record: neither answer resolves
	// anything, which is the whole bug.
	for (const packaged of [true, false]) {
		const answer = managedVenvPath({
			platform: "darwin",
			home,
			appDataPath: USER_DATA,
			packaged,
		});
		assert.notEqual(answer, legacy);
		assert.equal(venvInterpreter(answer).kind, "none", answer);
	}

	const lines = legacyEnvironmentReport(support);
	assert.equal(lines.length, 1);
	assert.match(lines[0], /pre-split environment at .*local-operator-venv/);
	// The fixture bundle from this temp directory, by its own path: the assertion
	// is about what `venvInterpreter` resolves, not about what this machine has
	// installed.
	assert.match(lines[0], /built on the interpreter inside .*Fixture\.app/);
	assert.ok(
		lines[0].includes(bundle),
		`the line must name the bundle the venv actually points at: ${lines[0]}`,
	);
	assert.match(lines[0], /left exactly as it is/);

	// The bundle gone is a DIFFERENT fact, and it is stated as one.
	const gone = join(home, "Gone.app");
	writeFileSync(
		join(legacy, "pyvenv.cfg"),
		`home = ${join(gone, "Contents", "Resources", "python_aarch64", "bin")}\n`,
	);
	const afterReplacement = legacyEnvironmentReport(support);
	assert.equal(afterReplacement.length, 1);
	assert.match(afterReplacement[0], /names an interpreter bundle that is not on disk/);
	assert.ok(afterReplacement[0].includes(gone));

	// And a machine with no pre-split environment says nothing at all.
	assert.deepEqual(legacyEnvironmentReport(join(home, "elsewhere")), []);
});

test("the setup failure dialog says what happened before what was recorded", async () => {
	// Design D4: `detail: error.message` handed the user a raw internals string -
	// `Runtime directory escaped its managed root`, `ENOENT: … lstat '…'`. The
	// plain sentence now comes first, the app's own message follows under a label,
	// and the support root is named rather than whichever internal path failed.
	const { backendSetupFailureDetail } = await loadMainProcess();
	const support = "/Users/someone/Library/Application Support/Local Operator";

	const full = backendSetupFailureDetail(
		new Error("ditto: /Users/x/Library/Application Support/Local Operator/managed-python/packaged/runtimes/.preparing-a/b: No space left on device"),
		support,
	);
	assert.match(full, /^What happened: This Mac ran out of disk space/);
	assert.match(full, /The app recorded: ditto: /);
	assert.match(full, /Where its environment lives: .*managed-python$/);

	const concurrent = backendSetupFailureDetail(
		new Error("Another Local Operator instance is preparing its backend"),
		support,
	);
	assert.match(concurrent, /^What happened: Another copy of Local Operator is setting up/);

	// An internal-sounding error is not shown as the user's situation, and the raw
	// string it came from is still there for the support thread.
	const internal = backendSetupFailureDetail(
		new Error("Runtime directory escaped its managed root"),
		support,
	);
	assert.doesNotMatch(internal.split("\n")[0], /escaped its managed root/);
	assert.match(internal, /The app recorded: Runtime directory escaped its managed root/);
	assert.doesNotMatch(internal, /\.app/);
});

test("the macOS installer no longer claims to have chosen a Python directory", async () => {
	// Review N1: every run printed `Detected CPU architecture: arm64, using Python
	// directory name: python_aarch64` for an in-bundle search this script does not
	// perform - it installs from `PYTHON_BIN`. The line stated the opposite of how
	// the script finds Python.
	const { macosInstallScript } = await loadInstallScripts();
	assert.doesNotMatch(macosInstallScript, /PYTHON_DIR_NAME/);
	assert.doesNotMatch(macosInstallScript, /using Python directory name/);
	const run = runMacosInstallScript(macosInstallScript, { PYTHON_BIN: undefined });
	assert.doesNotMatch(`${run.stdout}${run.stderr}`, /Detected CPU architecture/);
	// The refusal it does make is untouched: the caller must say which interpreter.
	assert.equal(run.status, 1);
	assert.match(run.stderr, /Pass an external prepared Python executable/);
});
