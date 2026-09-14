import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { mkdir, mkdtemp, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { withPythonBytecodeCache } from "../python-bytecode-cache";

const execute = promisify(execFile);

/*
 * Every pattern this module matches with lives here rather than inline: they run
 * on import (the managed-root and selection readers) and beside each filesystem
 * walk, and Biome's `useTopLevelRegex` is right that re-creating them per call is
 * work the module does once per process instead.
 */
/** A path that is inside an `.app` bundle, which no managed Python may be. */
const APP_BUNDLE_PATH = /\.app(?:\/|$)/i;
/** A CPython bytecode cache file, which the seed must not carry. */
const BYTECODE_EXTENSION = /\.py[co]$/;
/** `otool -l`'s per-command separator, used to read load commands one at a time. */
const OTOOL_LOAD_COMMAND = /Load command \d+/;
/** The load commands that name a dependency, as opposed to `LC_ID_DYLIB`. */
const LC_LOAD_COMMAND_KIND =
	/cmd LC_(?:LOAD|LOAD_WEAK|REEXPORT|LAZY_LOAD|LOAD_UPWARD)_DYLIB\b/;
/** The install name inside one of those commands. */
const DYLIB_INSTALL_NAME = /\n\s*name (.+?) \(offset/;
/** A runtime identity is a sha256, so anything else is a corrupt pointer. */
const RUNTIME_ID = /^[a-f0-9]{64}$/;
/** `home = <path>` in a venv's `pyvenv.cfg`. */
const PYVENV_HOME = /^home\s*=\s*(.+)$/m;
/** A preparation lock is a bare pid, which is what `shlock` writes. */
const LOCK_OWNER = /^\s*\d+\s*$/;
/** A legacy in-bundle interpreter path, in a launcher or a shebang. */
const LEGACY_BUNDLE_PYTHON_PATH =
	/\.app\/Contents\/Resources\/python(?:_aarch64)?\//;
export const PYTHON_SEED_NAMESPACE = "python-runtime-seed";
const FORMAT = 1;
const READY = "environment-ready.json";
const POINTER = "selected-environment.json";

export interface ManagedPythonOptions {
	support: string;
	resources: string;
	packaged: boolean;
	arch: string;
}
interface ManifestEntry {
	path: string;
	mode: number;
	kind: "directory" | "file" | "symlink";
	value?: string;
}
export interface RuntimeManifest {
	format: number;
	platform: "darwin";
	arch: string;
	entries: ManifestEntry[];
}
export interface ManagedSelection {
	format: number;
	runtimeId: string;
	runtime: string;
	venv: string;
	backendVersion: string;
}

function inside(root: string, path: string): boolean {
	const rel = relative(root, path);
	return (
		rel === "" ||
		(!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
	);
}
function outsideApp(path: string): void {
	if (!isAbsolute(path) || APP_BUNDLE_PATH.test(path)) {
		throw new Error(
			`Managed Python must live outside every application bundle: ${path}`,
		);
	}
}
function realDirectory(path: string): void {
	const stat = fs.lstatSync(path);
	if (!stat.isDirectory() || stat.isSymbolicLink())
		throw new Error(`Not a private directory: ${path}`);
}
function isCache(path: string): boolean {
	return (
		path.split("/").includes("__pycache__") || BYTECODE_EXTENSION.test(path)
	);
}

/** Hash the FINAL signed bytes, not the download version or a pre-signing digest.
 * Relative links stay relative when copied. A link escaping the seed, a hardlink,
 * or a special file would let another tree change a supposedly private runtime.
 * Cache files may appear in the external runtime; they are not signed seed bytes.
 */
export function runtimeManifest(
	root: string,
	arch: string,
	allowCaches = false,
): RuntimeManifest {
	if (!["arm64", "x64"].includes(arch))
		throw new Error(`Unsupported Python architecture: ${arch}`);
	realDirectory(root);
	const realRoot = fs.realpathSync(root);
	const entries: ManifestEntry[] = [
		{ path: ".", mode: fs.lstatSync(root).mode & 0o777, kind: "directory" },
	];
	function walk(directory: string): void {
		for (const name of fs.readdirSync(directory).sort()) {
			const path = join(directory, name);
			const rel = relative(root, path).split(sep).join("/");
			if (allowCaches && isCache(rel)) continue;
			const stat = fs.lstatSync(path);
			const mode = stat.mode & 0o777;
			if (stat.isSymbolicLink()) {
				const target = fs.readlinkSync(path);
				if (
					isAbsolute(target) ||
					!inside(root, resolve(dirname(path), target)) ||
					!inside(realRoot, fs.realpathSync(path))
				) {
					throw new Error(`Python seed link escapes its runtime: ${rel}`);
				}
				entries.push({ path: rel, mode, kind: "symlink", value: target });
			} else if (stat.isDirectory()) {
				entries.push({ path: rel, mode, kind: "directory" });
				walk(path);
			} else if (stat.isFile() && (allowCaches || stat.nlink === 1)) {
				// Backend process branding legitimately links the external executable
				// into venvs (including transient atomic-replace aliases). Link count
				// is not integrity after provisioning: hash/mode/signatures are.
				// Seed and staging still reject links and copy independence is proven.
				entries.push({
					path: rel,
					mode,
					kind: "file",
					value: createHash("sha256")
						.update(fs.readFileSync(path))
						.digest("hex"),
				});
			} else {
				throw new Error(
					`Python seed contains a hardlink or special file: ${rel}`,
				);
			}
		}
	}
	walk(root);
	entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	return { format: FORMAT, platform: "darwin", arch, entries };
}
export function runtimeId(manifest: RuntimeManifest): string {
	return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}
export function managedPythonRoot(options: ManagedPythonOptions): string {
	outsideApp(options.support);
	return join(
		options.support,
		"managed-python",
		options.packaged ? "packaged" : "dev",
	);
}
function seedPath(options: ManagedPythonOptions): string {
	return options.packaged
		? join(options.resources, PYTHON_SEED_NAMESPACE, options.arch)
		: join(
				options.resources,
				options.arch === "arm64" ? "python_aarch64" : "python",
			);
}
function pythonPath(runtime: string): string {
	return join(runtime, "bin", "python3");
}

/** Nested Mach-O signatures travel with the copy. Never sign, repair or execute
 * the seed here. Reject absolute non-system load dependencies: a complete copy
 * must not quietly retain a dependency on the replaced application.
 */
async function verifyMachO(
	root: string,
	manifest: RuntimeManifest,
): Promise<void> {
	let binaries = 0;
	for (const entry of manifest.entries) {
		if (entry.kind !== "file") continue;
		const path = join(root, entry.path);
		const fd = fs.openSync(path, "r");
		const magic = Buffer.alloc(4);
		try {
			fs.readSync(fd, magic, 0, 4, 0);
		} finally {
			fs.closeSync(fd);
		}
		if (
			![
				"cffaedfe",
				"cefaedfe",
				"feedfacf",
				"feedface",
				"cafebabe",
				"bebafeca",
			].includes(magic.toString("hex"))
		)
			continue;
		binaries++;
		await execute("/usr/bin/codesign", ["--verify", "--strict", path], {
			timeout: 30_000,
		});
		const { stdout } = await execute("/usr/bin/otool", ["-l", path], {
			timeout: 30_000,
		});
		// LC_ID_DYLIB is the library's install name, NOT a dependency. Standalone
		// Python uses /install/... there while consumers load it via @executable_path.
		for (const command of stdout.split(OTOOL_LOAD_COMMAND)) {
			if (!LC_LOAD_COMMAND_KIND.test(command)) continue;
			const dependency = DYLIB_INSTALL_NAME.exec(command)?.[1];
			if (
				dependency &&
				isAbsolute(dependency) &&
				!dependency.startsWith("/usr/lib/") &&
				!dependency.startsWith("/System/Library/")
			) {
				throw new Error(
					`Python runtime has an external load dependency: ${dependency}`,
				);
			}
		}
	}
	if (binaries === 0)
		throw new Error("Python seed contains no signed Mach-O binaries");
}

async function prepareRuntime(
	options: ManagedPythonOptions,
): Promise<{ runtime: string; id: string }> {
	const seed = seedPath(options);
	const manifest = runtimeManifest(seed, options.arch);
	const id = runtimeId(manifest);
	const runtime = join(managedPythonRoot(options), "runtimes", id);
	if (fs.existsSync(runtime)) {
		if (runtimeId(runtimeManifest(runtime, options.arch, true)) !== id)
			throw new Error(
				"The selected Python runtime has changed. It was preserved, not overwritten.",
			);
		await verifyMachO(runtime, manifest);
		return { runtime, id };
	}
	await verifyMachO(seed, manifest);
	await mkdir(dirname(runtime), { recursive: true, mode: 0o700 });
	realDirectory(dirname(runtime));
	if (
		!inside(
			fs.realpathSync(managedPythonRoot(options)),
			fs.realpathSync(dirname(runtime)),
		)
	)
		throw new Error("Runtime directory escaped its managed root");
	const staging = await mkdtemp(join(dirname(runtime), ".preparing-"));
	// ditto copies the complete signed runtime, preserving relative symlinks and
	// modes. The private staging tree is never executed or selected, even on failure.
	await execute("/usr/bin/ditto", ["--noacl", seed, staging], {
		timeout: 120_000,
	});
	// ditto preserves descendants but leaves an existing mkdtemp root at 0700.
	// Match the seed root before hashing; the parent remains private at 0700.
	fs.chmodSync(staging, fs.lstatSync(seed).mode & 0o777);
	if (runtimeId(runtimeManifest(staging, options.arch)) !== id)
		throw new Error("The Python runtime copy did not match its signed seed");
	for (const entry of manifest.entries) {
		if (entry.kind !== "file") continue;
		const source = fs.statSync(join(seed, entry.path));
		const copied = fs.statSync(join(staging, entry.path));
		if (source.dev === copied.dev && source.ino === copied.ino)
			throw new Error(`Runtime copy shares a seed inode: ${entry.path}`);
	}
	await verifyMachO(staging, manifest);
	await rename(staging, runtime);
	return { runtime, id };
}

export function readManagedSelection(
	options: ManagedPythonOptions,
): ManagedSelection | null {
	const root = managedPythonRoot(options);
	const pointer = join(root, POINTER);
	if (!fs.existsSync(pointer)) return null;
	const selection = JSON.parse(
		fs.readFileSync(pointer, "utf8"),
	) as ManagedSelection;
	if (
		selection.format !== FORMAT ||
		!RUNTIME_ID.test(selection.runtimeId) ||
		selection.runtime !== join(root, "runtimes", selection.runtimeId) ||
		dirname(selection.venv) !== join(root, "environments") ||
		!selection.venv.startsWith(
			join(root, "environments", `${selection.runtimeId}-`),
		)
	) {
		throw new Error(
			"Invalid managed Python selection; existing files were left untouched",
		);
	}
	realDirectory(selection.runtime);
	realDirectory(selection.venv);
	const ready = JSON.parse(
		fs.readFileSync(join(selection.venv, READY), "utf8"),
	);
	if (
		JSON.stringify(ready) !== JSON.stringify(selection) ||
		!fs.existsSync(join(selection.venv, "bin", "local-operator"))
	) {
		throw new Error("The selected backend environment is not ready");
	}
	const home = PYVENV_HOME.exec(
		fs.readFileSync(join(selection.venv, "pyvenv.cfg"), "utf8"),
	)?.[1]?.trim();
	if (home !== join(selection.runtime, "bin"))
		throw new Error(
			"The selected backend does not belong to its external Python runtime",
		);
	return selection;
}
export async function managedSelectionReady(
	options: ManagedPythonOptions,
): Promise<boolean> {
	const selection = readManagedSelection(options);
	if (!selection) return false;
	const manifest = runtimeManifest(seedPath(options), options.arch);
	if (runtimeId(manifest) !== selection.runtimeId) return false;
	if (
		runtimeId(runtimeManifest(selection.runtime, options.arch, true)) !==
		selection.runtimeId
	)
		throw new Error(
			"The selected Python runtime has changed; no existing environment was modified",
		);
	await verifyMachO(selection.runtime, manifest);
	return true;
}

/** Only use OS process liveness for the small preparation lock, never for backend
 * discovery or killing. macOS shlock uses atomic links and reclaims dead owners;
 * a crashed preparation leaves an unselected generation, not a retargeted venv.
 * In-process serialization also matters: two callers have the same OS PID.
 */
let preparation: Promise<unknown> = Promise.resolve();
async function locked<T>(root: string, work: () => Promise<T>): Promise<T> {
	const previous = preparation;
	let release = () => {};
	preparation = new Promise<void>((done) => {
		release = done;
	});
	await previous;
	const path = join(root, "preparation.lock");
	let acquired = false;
	try {
		await mkdir(root, { recursive: true, mode: 0o700 });
		realDirectory(root);
		outsideApp(fs.realpathSync(root));
		const deadline = Date.now() + 120_000;
		while (!acquired) {
			if (
				fs.existsSync(path) &&
				(fs.lstatSync(path).isSymbolicLink() ||
					!LOCK_OWNER.test(fs.readFileSync(path, "utf8")))
			)
				throw new Error("Unrecognized preparation lock was preserved");
			try {
				await execute(
					"/usr/bin/shlock",
					["-p", String(process.pid), "-f", path],
					{ timeout: 5_000 },
				);
				acquired = true;
			} catch {
				if (Date.now() >= deadline)
					throw new Error(
						"Another Local Operator instance is preparing its backend. Retry when it finishes.",
					);
				await new Promise((done) => setTimeout(done, 250));
			}
		}
		return await work();
	} finally {
		if (
			acquired &&
			fs.readFileSync(path, "utf8").trim() === String(process.pid)
		)
			fs.unlinkSync(path);
		release();
	}
}

const IMPORT_PROBE = `import sys, sysconfig, os, json, encodings, webbrowser, _ssl, _sqlite3
paths = [sys._base_executable, sys.base_prefix, sysconfig.get_path('stdlib'), encodings.__file__, webbrowser.__file__] + sys.path
paths += [getattr(m, '__file__', '') for m in (_ssl, _sqlite3)]
assert all('.app/' not in os.path.realpath(p).lower() for p in paths if p), paths
print(json.dumps({'base_executable': sys._base_executable, 'base_prefix': sys.base_prefix, 'paths': paths}))`;

/** Smoke the actual backend before publishing readiness. Its HOME and every
 * backend state directory are synthetic, even on a real user's machine; only
 * the owned child is terminated. This is not adoption of a pre-existing server.
 */
async function smokeEnvironment(
	venv: string,
	env: NodeJS.ProcessEnv,
): Promise<string> {
	const python = join(venv, "bin", "python");
	await execute(python, ["-I", "-B", "-c", IMPORT_PROBE], {
		env,
		timeout: 30_000,
	});
	const { stdout: version } = await execute(
		python,
		[
			"-I",
			"-B",
			"-c",
			"import importlib.metadata; print(importlib.metadata.version('local-operator'))",
		],
		{ env, timeout: 30_000 },
	);
	const home = await mkdtemp(join(tmpdir(), "local-operator-backend-smoke-"));
	// An allowlist, not HOME layered over ambient state overrides or API keys.
	const isolated = withPythonBytecodeCache(
		{
			PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
			HOME: home,
			TMPDIR: home,
			LANG: "en_US.UTF-8",
			TERM: "xterm-256color",
			LOCAL_OPERATOR_HOME: join(home, ".local-operator"),
			LOCAL_OPERATOR_CONFIG_DIR: join(home, "config"),
			XDG_CONFIG_HOME: join(home, "config"),
			XDG_CACHE_HOME: join(home, "cache"),
			XDG_DATA_HOME: join(home, "data"),
		},
		home,
	);
	const socket = createServer();
	await new Promise<void>((done, reject) => {
		socket.once("error", reject);
		socket.listen(0, "127.0.0.1", done);
	});
	const address = socket.address();
	if (!address || typeof address === "string")
		throw new Error("Could not allocate backend smoke port");
	await new Promise<void>((done) => socket.close(() => done()));
	const child = spawn(
		join(venv, "bin", "local-operator"),
		["serve", "--host", "127.0.0.1", "--port", String(address.port)],
		{ env: isolated, stdio: "ignore" },
	);
	let failed: Error | null = null;
	child.on("error", (error) => {
		failed = error;
	});
	try {
		const deadline = Date.now() + 60_000;
		while (Date.now() < deadline) {
			if (failed) throw failed;
			if (child.exitCode !== null)
				throw new Error(`Backend smoke exited with ${child.exitCode}`);
			try {
				const response = await fetch(
					`http://127.0.0.1:${address.port}/health`,
					{ signal: AbortSignal.timeout(1_000) },
				);
				if (response.ok) return version.trim();
			} catch {
				/* Not listening yet; the total deadline is bounded above. */
			}
			await new Promise((done) => setTimeout(done, 200));
		}
		throw new Error(
			"The prepared backend did not become healthy; the previous selection was preserved",
		);
	} finally {
		if (child.exitCode === null && child.pid) {
			child.kill("SIGTERM");
			await Promise.race([
				new Promise((done) => child.once("exit", done)),
				new Promise((done) => setTimeout(done, 5_000)),
			]);
			if (child.exitCode === null) child.kill("SIGKILL");
		}
	}
}

export async function prepareManagedPython(
	options: ManagedPythonOptions,
	install: (venv: string, python: string) => Promise<boolean>,
): Promise<ManagedSelection> {
	return locked(managedPythonRoot(options), async () => {
		if (await managedSelectionReady(options))
			return readManagedSelection(options) as ManagedSelection;
		const { runtime, id } = await prepareRuntime(options);
		const root = managedPythonRoot(options);
		await mkdir(join(root, "environments"), { recursive: true, mode: 0o700 });
		realDirectory(join(root, "environments"));
		// This is the FINAL venv pathname. Never rename an installed venv: pip
		// entrypoints and activation scripts embed absolute paths into their bytes.
		const venv = join(root, "environments", `${id}-${randomUUID()}`);
		if (!(await install(venv, pythonPath(runtime))))
			throw new Error(
				"Backend preparation did not complete. Your previous environment and data were preserved.",
			);
		const env = withPythonBytecodeCache({ ...process.env }, options.support);
		const backendVersion = await smokeEnvironment(venv, env);
		const selection: ManagedSelection = {
			format: FORMAT,
			runtimeId: id,
			runtime,
			venv,
			backendVersion,
		};
		const bytes = `${JSON.stringify(selection)}\n`;
		await writeFile(join(venv, READY), bytes, { flag: "wx", mode: 0o600 });
		const temporary = join(root, `.selection-${randomUUID()}.json`);
		await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
		await rename(temporary, join(root, POINTER));
		return selection;
	});
}

/** A PATH entry can still be the legacy managed venv. Inspect the resolved
 * launcher/shebang rather than treating `which` as proof of independence.
 * Nothing here runs or repairs that interpreter, even if its bundle is gone.
 */
export function isLegacyManagedCommand(
	command: string,
	support: string,
): boolean {
	const legacy = [
		join(support, "local-operator-venv"),
		join(support, "local-operator-venv-dev"),
	];
	const candidates = [command];
	try {
		candidates.push(fs.realpathSync(command));
	} catch {
		/* Broken legacy links must not become globals. */
	}
	try {
		candidates.push(fs.readFileSync(command, "utf8").slice(0, 4096));
	} catch {
		/* An unreadable command is not evidence of a managed launcher. */
	}
	return candidates.some(
		(candidate) =>
			legacy.some((path) => candidate.includes(`${path}/`)) ||
			LEGACY_BUNDLE_PYTHON_PATH.test(candidate),
	);
}
