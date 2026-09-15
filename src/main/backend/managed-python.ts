import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { mkdir, mkdtemp, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import { promisify } from "node:util";
import BUNDLED_PYTHON_LAYOUT from "../../shared/bundled-python-layout.json";
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
export const PYTHON_SEED_NAMESPACE = BUNDLED_PYTHON_LAYOUT.seedNamespace;
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

/**
 * The identity of a Python tree: the bytes it was SIGNED with.
 *
 * ONE definition, and that is the point. Bytecode caches are derived data, never
 * a signed byte, so they are excluded everywhere - and there used not to be a
 * "everywhere": the id published at provisioning was computed with caches
 * COUNTED, while every later comparison recomputed the tree's id with caches
 * IGNORED. On a seed carrying even one `.pyc` no comparison could ever hold, so
 * the published selection became permanently unusable and the user was told the
 * runtime had CHANGED (QA Q1). The seed's completeness and structure are
 * asserted separately by `runtimeManifest` without `allowCaches`, which is what
 * rejects a hardlink, a special file or an escaping link.
 */
export function runtimeIdentity(root: string, arch: string): string {
	return runtimeId(runtimeManifest(root, arch, true));
}

/**
 * The first entry two manifests disagree about, in the order a reader can act on.
 *
 * Exists so a mismatch names the file rather than the verdict: "the runtime has
 * changed" sends nobody anywhere, while "`lib/python3.12/os.py` does not match
 * the seed" says which tree is wrong (QA Q1).
 */
function firstDifference(
	expected: RuntimeManifest,
	actual: RuntimeManifest,
): string {
	const expectedByPath = new Map(expected.entries.map((e) => [e.path, e]));
	const actualByPath = new Map(actual.entries.map((e) => [e.path, e]));
	for (const [path, entry] of expectedByPath) {
		const other = actualByPath.get(path);
		if (!other) return `${path} is missing`;
		if (other.kind !== entry.kind)
			return `${path} is a ${other.kind}, not a ${entry.kind}`;
		if ((other.value ?? "") !== (entry.value ?? ""))
			return `${path} does not match the seed`;
	}
	for (const path of actualByPath.keys())
		if (!expectedByPath.has(path)) return `${path} was added`;
	return "the two trees differ in a way this message cannot name";
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
	// The names come from the layout definition the release gate, the pack hook and
	// the heal's predicate also read, so the seed's spelling cannot drift from any
	// of them again (review R10 / QA Q2).
	return options.packaged
		? join(options.resources, PYTHON_SEED_NAMESPACE, options.arch)
		: join(
				options.resources,
				(BUNDLED_PYTHON_LAYOUT.checkoutSeedNames as Record<string, string>)[
					options.arch
				],
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

/*
 * A runtime is addressed as `runtimes/<seed identity>-<uuid>`, one directory per
 * PROVISIONING GENERATION rather than one per seed.
 *
 * Why the generation in the name: the alternative is one directory per seed, and
 * then a runtime whose bytes no longer match its identity can only be repaired by
 * writing over a tree a live backend may be executing. The seeded path baked that
 * in - `prepareRuntime` threw "the runtime has changed" and left the app with a
 * published selection that could never be used again, while the installer offered
 * a Retry button that re-threw forever and nothing told the user to delete the
 * directory (review R8). With a generation in the name, a runtime that is missing,
 * unreadable or no longer the published bytes is simply not a candidate: nothing
 * is overwritten, the old bytes stay exactly where they were, and a fresh copy is
 * published beside it. It is the same shape `environments/<id>-<uuid>` already
 * had.
 */
export function runtimesRoot(options: ManagedPythonOptions): string {
	return join(managedPythonRoot(options), "runtimes");
}
export function environmentsRoot(options: ManagedPythonOptions): string {
	return join(managedPythonRoot(options), "environments");
}
/** The generation-name shape this module writes, and the only one it will reap. */
const GENERATION_NAME = /^[a-f0-9]{64}-[0-9a-f-]{8,}$/;

/**
 * A runtime generation of this seed that still hashes to `id`, if one is there.
 *
 * The identity is the whole test: a generation carrying extra cache files still
 * matches (caches are not signed bytes), and one whose bytes were changed does
 * not - it is skipped rather than refused, which is what makes a corrupted
 * runtime recoverable.
 */
function usableRuntimeGeneration(
	options: ManagedPythonOptions,
	id: string,
): string | null {
	let names: string[];
	try {
		names = fs.readdirSync(runtimesRoot(options));
	} catch {
		return null;
	}
	for (const name of names.sort()) {
		if (!name.startsWith(`${id}-`)) continue;
		const candidate = join(runtimesRoot(options), name);
		try {
			if (runtimeIdentity(candidate, options.arch) === id) return candidate;
		} catch {
			/* Not a readable runtime tree; not a candidate. */
		}
	}
	return null;
}

async function prepareRuntime(
	options: ManagedPythonOptions,
): Promise<{ runtime: string; id: string }> {
	const seed = seedPath(options);
	// The strict walk first: it is what rejects a hardlink, a special file or a
	// link escaping the seed, and it enumerates every file the copy must contain.
	const manifest = runtimeManifest(seed, options.arch);
	const id = runtimeIdentity(seed, options.arch);
	const existing = usableRuntimeGeneration(options, id);
	if (existing) return { runtime: existing, id };
	await verifyMachO(seed, manifest);
	const root = runtimesRoot(options);
	await mkdir(root, { recursive: true, mode: 0o700 });
	realDirectory(root);
	if (
		!inside(fs.realpathSync(managedPythonRoot(options)), fs.realpathSync(root))
	)
		throw new Error("Runtime directory escaped its managed root");
	const runtime = join(root, `${id}-${randomUUID()}`);
	const staging = await mkdtemp(join(root, ".preparing-"));
	// ditto copies the complete signed runtime, preserving relative symlinks and
	// modes. The private staging tree is never executed or selected, even on failure.
	await execute("/usr/bin/ditto", ["--noacl", seed, staging], {
		timeout: 120_000,
	});
	// ditto preserves descendants but leaves an existing mkdtemp root at 0700.
	// Match the seed root before hashing; the parent remains private at 0700.
	fs.chmodSync(staging, fs.lstatSync(seed).mode & 0o777);
	if (runtimeIdentity(staging, options.arch) !== id)
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

/**
 * A published selection, as a verdict rather than an exception.
 *
 * Why not an exception, which is what this used to be: `prepareManagedPython`
 * short-circuits on `managedSelectionReady`, and that read the selection FIRST -
 * so once a pointer existed, a runtime or environment that had gone missing, or
 * one whose bytes no longer matched, threw out of the read and made the re-copy
 * arm unreachable. Every retry walked the same path, the dialog offered a Retry
 * button that could not succeed, and the only recovery was deleting
 * `selected-environment.json` by hand - for states a backup restore, a disk
 * cleaner or a cautious `rm -rf` of an old runtime reach without asking
 * (review R8). "Not usable" is a verdict the caller acts on; it is not an error.
 */
export type ManagedSelectionState =
	| { kind: "ready"; selection: ManagedSelection }
	/** Nothing usable is published; preparing one is the answer. */
	| { kind: "unprepared"; detail: string }
	/** What was published is gone, unreadable or not the published bytes. */
	| { kind: "missing"; detail: string };

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Every structural rule the pointer must satisfy before anything is trusted. */
function selectionIsWellFormed(
	root: string,
	selection: ManagedSelection,
): boolean {
	return (
		selection.format === FORMAT &&
		RUNTIME_ID.test(selection.runtimeId) &&
		selection.runtime === join(root, "runtimes", selection.runtimeId)
	);
}

/**
 * The generation-keyed counterpart of the check above.
 *
 * The pointer names one generation, so the path must be inside `runtimes/` and
 * carry the identity it claims - the same shape the environment path is held to.
 */
function selectionMatchesGeneration(
	root: string,
	selection: ManagedSelection,
): boolean {
	return (
		selection.format === FORMAT &&
		RUNTIME_ID.test(selection.runtimeId) &&
		dirname(selection.runtime) === join(root, "runtimes") &&
		GENERATION_NAME.test(basename(selection.runtime)) &&
		selection.runtime.startsWith(
			join(root, "runtimes", `${selection.runtimeId}-`),
		) &&
		dirname(selection.venv) === join(root, "environments") &&
		selection.venv.startsWith(
			join(root, "environments", `${selection.runtimeId}-`),
		)
	);
}

export function inspectManagedSelection(
	options: ManagedPythonOptions,
): ManagedSelectionState {
	const root = managedPythonRoot(options);
	const pointer = join(root, POINTER);
	let raw: string;
	try {
		raw = fs.readFileSync(pointer, "utf8");
	} catch {
		return {
			kind: "unprepared",
			detail: `No environment is published for this instance (${pointer})`,
		};
	}
	let selection: ManagedSelection;
	try {
		selection = JSON.parse(raw) as ManagedSelection;
	} catch {
		return {
			kind: "unprepared",
			detail: `The published environment pointer is not readable: ${pointer}`,
		};
	}
	if (
		!selectionIsWellFormed(root, selection) &&
		!selectionMatchesGeneration(root, selection)
	)
		return {
			kind: "unprepared",
			detail: `The published environment pointer does not describe a managed environment: ${pointer}`,
		};
	for (const [what, path] of [
		["Python runtime", selection.runtime],
		["environment", selection.venv],
	] as const) {
		try {
			realDirectory(path);
		} catch (error) {
			return {
				kind: "missing",
				detail: `The selected ${what} is not there any more (${path}): ${describe(error)}`,
			};
		}
	}
	try {
		const ready = JSON.parse(
			fs.readFileSync(join(selection.venv, READY), "utf8"),
		);
		if (JSON.stringify(ready) !== JSON.stringify(selection))
			return {
				kind: "missing",
				detail: `The selected environment does not match the record published with it: ${selection.venv}`,
			};
	} catch (error) {
		return {
			kind: "missing",
			detail: `The selected environment is not complete (${selection.venv}): ${describe(error)}`,
		};
	}
	if (!fs.existsSync(join(selection.venv, "bin", "local-operator")))
		return {
			kind: "missing",
			detail: `The selected environment has no backend installed: ${selection.venv}`,
		};
	let home: string | undefined;
	try {
		home = PYVENV_HOME.exec(
			fs.readFileSync(join(selection.venv, "pyvenv.cfg"), "utf8"),
		)?.[1]?.trim();
	} catch (error) {
		return {
			kind: "missing",
			detail: `The selected environment has no readable pyvenv.cfg (${selection.venv}): ${describe(error)}`,
		};
	}
	if (home !== join(selection.runtime, "bin"))
		return {
			kind: "missing",
			detail: `The selected environment does not belong to its external Python runtime (${selection.venv} names ${home ?? "no runtime"})`,
		};
	let identity: string;
	try {
		identity = runtimeIdentity(selection.runtime, options.arch);
	} catch (error) {
		return {
			kind: "missing",
			detail: `The selected Python runtime could not be read (${selection.runtime}): ${describe(error)}`,
		};
	}
	if (identity !== selection.runtimeId) {
		let reason: string;
		try {
			reason = firstDifference(
				runtimeManifest(seedPath(options), options.arch, true),
				runtimeManifest(selection.runtime, options.arch, true),
			);
		} catch {
			reason = "the two trees could not be compared";
		}
		return {
			kind: "missing",
			detail: `The selected Python runtime is no longer the runtime that was published (${reason}); a fresh runtime will be published beside it`,
		};
	}
	return { kind: "ready", selection };
}

/**
 * The published selection, or null when there is not a usable one.
 *
 * Kept for the callers that only want a path, and now built on the verdict: a
 * broken selection answers null instead of throwing, which is what lets the
 * preparation path repair it (review R8).
 */
export function readManagedSelection(
	options: ManagedPythonOptions,
): ManagedSelection | null {
	const state = inspectManagedSelection(options);
	return state.kind === "ready" ? state.selection : null;
}

/**
 * Whether the published selection can be used right now.
 *
 * Deliberately cheap, and deliberately not a signature audit: the identity in the
 * pointer already pins the runtime's bytes, the generation is never mutated after
 * it is published, and `verifyMachO`'s per-Mach-O `codesign`+`otool` pair cost
 * ~100 subprocesses on a path `index.ts` awaited BEFORE creating the window -
 * measured at 2214/2262 ms for a 50-Mach-O tree (review R11). Mach-O verification
 * is a property of provisioning, where it still runs against the seed, the staged
 * copy and every candidate generation; a tree that no longer hashes to what was
 * published is refused by the identity check below whatever its signatures say.
 */
export async function managedSelectionReady(
	options: ManagedPythonOptions,
): Promise<boolean> {
	return inspectManagedSelection(options).kind === "ready";
}

/** How long a preparation may hold the lock before another gives up on it. Also
 * the age at which an abandoned staging tree is no longer possibly live: the
 * reaper runs INSIDE the lock, so a `.preparing-*` tree older than this cannot
 * belong to a preparation anything is still running. */
const PREPARATION_LOCK_MS = 120_000;

/**
 * Reclaim what a previous preparation left behind, inside this root and bounded.
 *
 * Why: every failed-and-retried setup left its `.preparing-*` staging tree (the
 * successful path renames it, a failure does not), every pip failure left an
 * `environments/<id>-<uuid>` behind, and every Python revision the seed changes
 * added a new ~47 MB runtime while the one before it stayed forever. Nothing
 * owned any of them, and there was no stated bound (review R12).
 *
 * The retention rule, deliberately narrow: the selected generation and the most
 * recently modified other generation in each root survive, so a restart or a
 * rollback mid-switch still has something to fall back to; a staging tree older
 * than the lock deadline is abandoned by construction. Only names this module
 * writes are ever considered - `[0-9a-f]{64}-<uuid>` and `.preparing-*` - so a
 * file an operator or a future version put here is left alone, and nothing
 * outside `managedPythonRoot` is read, walked or removed. Never a machine-wide
 * sweep, never a path we did not create.
 */
export function reapSupersededGenerations(
	options: ManagedPythonOptions,
	keep: { runtime?: string; venv?: string } = {},
	now = Date.now(),
): string[] {
	const removed: string[] = [];
	for (const [root, kept] of [
		[runtimesRoot(options), keep.runtime],
		[environmentsRoot(options), keep.venv],
	] as const) {
		let names: string[];
		try {
			names = fs.readdirSync(root);
		} catch {
			continue;
		}
		const survivors = new Set(kept ? [kept] : []);
		const generations: Array<{ path: string; mtimeMs: number }> = [];
		for (const name of names) {
			const path = join(root, name);
			if (name.startsWith(".preparing-")) {
				try {
					if (now - fs.statSync(path).mtimeMs < PREPARATION_LOCK_MS) continue;
					fs.rmSync(path, { recursive: true, force: true });
					removed.push(path);
				} catch {
					/* Left for the next start rather than reported as removed. */
				}
				continue;
			}
			if (!GENERATION_NAME.test(name) || survivors.has(path)) continue;
			try {
				generations.push({ path, mtimeMs: fs.statSync(path).mtimeMs });
			} catch {
				/* Not a readable generation. */
			}
		}
		generations.sort((a, b) => b.mtimeMs - a.mtimeMs);
		// One previous generation, and only one: the bound is the point.
		if (generations.length > 0) survivors.add(generations[0].path);
		for (const generation of generations.slice(1)) {
			try {
				fs.rmSync(generation.path, { recursive: true, force: true });
				removed.push(generation.path);
			} catch {
				/* Left for the next start rather than reported as removed. */
			}
		}
	}
	return removed;
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
		const deadline = Date.now() + PREPARATION_LOCK_MS;
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
		/*
		 * The verdict, not an exception, and this is what makes a broken install
		 * recoverable: a published selection whose runtime or environment is gone,
		 * unreadable or no longer the published bytes answers `missing`, and the
		 * answer is a FRESH generation published beside it - never an overwrite of
		 * whatever is there. `unprepared` (nothing published yet) takes the same
		 * path. Before this, the read threw and the re-copy below was unreachable, so
		 * every retry re-threw and the only recovery was deleting the pointer by hand
		 * (review R8).
		 */
		const state = inspectManagedSelection(options);
		if (state.kind === "ready") return state.selection;
		const superseded = state.kind === "missing" ? state.detail : null;
		const root = managedPythonRoot(options);
		reapSupersededGenerations(options);
		const { runtime, id } = await prepareRuntime(options);
		await mkdir(environmentsRoot(options), { recursive: true, mode: 0o700 });
		realDirectory(environmentsRoot(options));
		// This is the FINAL venv pathname. Never rename an installed venv: pip
		// entrypoints and activation scripts embed absolute paths into their bytes.
		const venv = join(environmentsRoot(options), `${id}-${randomUUID()}`);
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
		// Only now, with the new generation published, is it safe to reclaim what
		// this one replaces: the pointer names the survivor.
		reapSupersededGenerations(options, { runtime, venv });
		if (superseded)
			console.warn(
				`Replaced an unusable managed Python selection: ${superseded}`,
			);
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
