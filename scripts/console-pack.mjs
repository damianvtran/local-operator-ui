#!/usr/bin/env node
/**
 * The packaged side of the console's one native dependency.
 *
 * Why this exists as a build step AND as a runtime check: the two traps node-pty
 * ships with fail in ways no signature check can see.
 *
 *   1. The published tarball carries `prebuilds/<platform>-<arch>/spawn-helper`
 *      at mode **0644**, and nothing in the install fixes it — `scripts/prebuild.js`
 *      only *checks* for the directory, `scripts/post-install.js` only prunes
 *      `build/Release`, and pnpm 10 skips a dependency's install scripts unless it
 *      is in `onlyBuiltDependencies`. A pty spawned against that file dies
 *      `FATAL Error: posix_spawnp failed.` (measured, node-pty 1.1.0).
 *   2. `prebuilds/` must be **unpacked** from the asar, not merely rewritten.
 *      node-pty rewrites `app.asar` to `app.asar.unpacked` before forking, so the
 *      path looks right in a fully-packed archive and the spawn still fails,
 *      because the rewritten path does not exist until the directory is unpacked.
 *   3. WHERE the helper is is a per-platform answer, and WHETHER one exists at all is
 *      another. node-pty's own sources say both, and neither is a choice this repo
 *      gets to make:
 *
 *        - `binding.gyp` declares the `spawn-helper` target inside
 *          `['OS=="mac"', {...}]` and nowhere else (gyp evaluated with `-DOS=linux`
 *          generates `pty.target.mk` alone; with `-DOS=mac` it also generates
 *          `spawn-helper.target.mk`), and `src/unix/pty.cc` execs it only under
 *          `#if defined(__APPLE__)` - the non-Apple branch is `forkpty(3)`, where the
 *          helper path is assigned and never read. So a helper is REQUIRED on darwin
 *          and EXPECTED ABSENT on linux and win32; a Linux artifact whose console
 *          forks the user's shell needs no helper, and none can be built for it.
 *        - the helper is forked out of the directory the native module loaded from
 *          (`lib/unixTerminal.js`: `native.dir + '/spawn-helper'`), which is the
 *          first of `build/Release`, `build/Debug`, `prebuilds/<platform>-<arch>`
 *          that answers (`lib/utils.js`) - see `nativeDirs`.
 *
 *      Both halves were got wrong by the guard this file replaced. It demanded a
 *      helper on Linux, where the platform has none and no toolchain can produce
 *      one, so `afterPack` failed the publish of v0.29.12 AFTER `@electron/rebuild`
 *      had finished cleanly and no Linux artifact was produced; and it looked only
 *      in the prebuild directory, which is not where a rebuilt macOS tree's module
 *      is forked from.
 *
 * This file runs inside `afterPack`, which is before signing, so a mode fixed here
 * is a mode that is signed. The RUNTIME heal (`src/main/console/pty.ts`) is the
 * other half and is not a duplicate: an in-app update stages a ZIP through Squirrel
 * ShipIt with no step that re-asserts file modes, and `codesign`'s seal does not
 * cover modes — so a helper delivered 0644 by an update passes every signature
 * check and fails only at `posix_spawn`.
 *
 * The PRUNE is here rather than at install time because it is target-dependent: the
 * package ships ~58 MB of win32 prebuilds and `.pdb` files against ~136 KB for
 * darwin-arm64, and deleting them from `node_modules` at install time would break a
 * Windows build on a machine that had run a macOS one. `afterPack` knows the
 * platform and architecture it is packing.
 *
 * Usage from the hook: `prepareConsoleNative(context)`.
 * Usage by hand: `node scripts/console-pack.mjs --resources <dir> --platform linux --arch x64`
 */

import { chmodSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { isEntryPoint } from "./entry-point.mjs";
import { archName } from "./prune-python-resource.mjs";

/** The executable node-pty forks through on the platforms that have one. */
export const SPAWN_HELPER_NAME = "spawn-helper";

/** The mode it must have: what the upstream build produces, and what `fork(2)`
 * needs. Not `0700` — a per-user install that later runs as another user must not
 * lose the helper to a mode the build did not set. */
export const SPAWN_HELPER_MODE = 0o755;

/** The native module whose directory decides which helper is forked. */
export const NATIVE_MODULE_NAME = "pty.node";

/**
 * The platforms whose pty forks a `spawn-helper`, measured from node-pty rather
 * than assumed: `binding.gyp` declares that target inside `['OS=="mac"', {...}]`
 * only, and `src/unix/pty.cc` execs it only under `#if defined(__APPLE__)` — every
 * other platform takes `forkpty(3)`, where the helper path is assigned and never
 * read. A helper is REQUIRED on darwin and EXPECTED ABSENT elsewhere; see trap 3
 * in the header for the publish this distinction cost.
 */
export const SPAWN_HELPER_PLATFORMS = ["darwin"];

/** Whether an artifact for this platform must carry a helper at all. */
export function forksSpawnHelper(platform) {
	return SPAWN_HELPER_PLATFORMS.includes(platform);
}

/** Where the unpacked package lands inside a packed app. */
export function consoleNativeRoot(resourcesDir) {
	return join(resourcesDir, "app.asar.unpacked", "node_modules", "node-pty");
}

/** The prebuild directory for one target. */
export function prebuildDir(root, target) {
	return join(root, "prebuilds", `${target.platform}-${target.arch}`);
}

/**
 * The directories node-pty loads its native module from, in node-pty's own order.
 *
 * MEASURED FROM THE PACKAGE, NOT ASSUMED (`node_modules/node-pty/lib/utils.js`,
 * `loadNativeModule`): the loader tries `build/Release`, then `build/Debug`, then
 * `prebuilds/<platform>-<arch>`. `lib/unixTerminal.js` then forks the helper out of
 * whichever of those the module loaded from (`native.dir + '/spawn-helper'`), so
 * "where is the helper" and "where did the module load" are one question and the
 * location is not ours to choose: a `spawn-helper` anywhere else is a file nothing
 * forks. Ordering this list any other way would assert the mode of a file the app
 * does not run on a tree that holds both.
 *
 * Entry 1 is the one a source build writes into: node-pty ships no Linux prebuild, so
 * its install script compiles there (with the same `binding.gyp`, which builds a helper
 * for macOS only), and `@electron/rebuild` does the same to a tree being packed for the
 * Electron ABI. Entry 3 is the darwin/win32 case the published tarball serves without
 * compiling anything. `build/Debug` is kept because node-pty's own loader names it;
 * electron-builder does not unpack that directory, so in a packed app it is always
 * absent.
 *
 * NOT IDENTICAL TO THE LOADER, deliberately: `lib/utils.js` probes those three names
 * relative to `lib/` as well as to the package root (`relative = ['..', '.']`), and a
 * packed node-pty resolves the package-root spelling. Searching only the package root
 * can therefore miss a helper in a tree that answers under `lib/` - a false throw on a
 * shape no pack produces, never a false pass, which is the direction this list is
 * allowed to be wrong in.
 */
export function nativeDirs(root, target) {
	return [
		join(root, "build", "Release"),
		join(root, "build", "Debug"),
		prebuildDir(root, target),
	];
}

/** Every path the helper could be at, in the order it will be looked for. */
export function spawnHelperPaths(root, target) {
	return nativeDirs(root, target).map((dir) => join(dir, SPAWN_HELPER_NAME));
}

/** The directory the native module — and therefore the helper — is loaded from, or
 * null when no searched directory holds one. This is the loader's own answer to
 * "which of these will be used", as far as a filesystem can give it: a `.node` the
 * running Electron cannot `dlopen` falls through to the next directory at run time. */
export function nativeModuleDir(root, target) {
	return (
		nativeDirs(root, target).find((dir) =>
			existsSync(join(dir, NATIVE_MODULE_NAME)),
		) ?? null
	);
}

/**
 * The resources directory of the bundle just packed.
 *
 * macOS wraps the app in a bundle and the other platforms put `resources` beside
 * the executable — the same split (and the same reasoning) as
 * `prune-python-resource.mjs`, resolved here rather than shared because that
 * module's own resolver is private to its prune step.
 */
export function resourcesDirFor({
	appOutDir,
	productFilename,
	platform = process.platform,
}) {
	return platform === "darwin"
		? join(appOutDir, `${productFilename}.app`, "Contents", "Resources")
		: join(appOutDir, "resources");
}

/**
 * The inverse of `resourcesDirFor`, for a caller that has the RESOURCES directory in
 * hand rather than the `afterPack` context: the CLI below, and anybody reproducing a
 * pack by hand.
 *
 * WHY IT IS THE INVERSE RATHER THAN A FIXED PAIR OF `..`: the release that this file
 * was repaired for failed on Linux, and on Linux the CLI could not be pointed at a
 * packed tree at all - the old arithmetic walked two levels up for every platform,
 * which resolved `--platform linux` to `<app-out>/resources` and reported "no unpacked
 * node-pty ... nothing to prepare" (a false green, from the tool whose whole job is
 * refusing one), and resolved `--platform darwin` to a `.app` with no product name.
 * The shapes are already split here, so the inverse is too: macOS nests resources
 * three levels inside the bundle and the bundle is named after the product, the other
 * platforms put `resources` directly under the app output directory.
 */
export function appOutDirFor({ resourcesDir, platform = process.platform }) {
	if (platform !== "darwin") {
		return { appOutDir: join(resourcesDir, ".."), productFilename: "" };
	}
	const bundle = join(resourcesDir, "..", "..");
	return {
		appOutDir: join(bundle, ".."),
		productFilename: basename(bundle).replace(/\.app$/, ""),
	};
}

/**
 * Remove every prebuild directory but this artifact's.
 *
 * The target directory is kept even when empty, because its absence is a different
 * state to node-pty (`prebuild.js` treats a missing directory as "rebuild from
 * source") and a build that removed it would be reporting the opposite of what it
 * did.
 */
export function pruneForeignPrebuilds(root, target) {
	const prebuilds = join(root, "prebuilds");
	const report = { kept: [], removed: [], bytes: 0 };
	let entries;
	try {
		entries = readdirSync(prebuilds);
	} catch {
		// No prebuilds at all: a Linux source build keeps its binary in
		// `build/Release`, and there is nothing to prune.
		return report;
	}
	const keep = `${target.platform}-${target.arch}`;
	for (const entry of entries) {
		const path = join(prebuilds, entry);
		if (entry === keep) {
			report.kept.push(entry);
			continue;
		}
		report.bytes += directoryBytes(path);
		rmSync(path, { recursive: true, force: true });
		report.removed.push(entry);
	}
	return report;
}

/**
 * Assert every helper present's exec bit in the packed tree, and set it where missing.
 *
 * THE PLATFORM DECIDES WHETHER A HELPER IS EXPECTED AT ALL (`forksSpawnHelper`, from
 * node-pty's own `binding.gyp` and `src/unix/pty.cc`): darwin forks one and REQUIRES it
 * here, while linux and win32 fork the user's shell directly and have none to require.
 * The guard that this replaced demanded one on every platform, which made it fail a
 * Linux artifact no toolchain can build a helper for - the v0.29.12 publish - and that
 * is the failure this step's shape exists to keep from coming back in the other
 * direction: a platform that should have a helper and does not is still fatal, loud, and
 * named.
 *
 * EVERY helper present, not just the first: a tree that holds both a tarball prebuild
 * and a source build ships two of these files, node-pty forks the one in the directory
 * its native module loaded from, and which one that is cannot be decided from the
 * filesystem - a `build/Release/pty.node` the running Electron cannot `dlopen` falls
 * through to the prebuild at run time, silently. Healing only the first would leave the
 * fallback at whatever mode the tarball or a ZIP-delivered update gave it, and the
 * failure this heals is `FATAL Error: posix_spawnp failed.`
 *
 * The report LEADS with the directory the module loads from when a helper is there
 * (`nativeModuleDir`), falls back to the first helper otherwise, and carries every file
 * this step looked at so the log line can name each one it had to fix. On the two
 * platforms that fork no helper, `path: null` and `required: false` are the expected
 * answer rather than a missing file, and the caller reports it as such.
 */
export function ensureSpawnHelperMode(root, target) {
	const candidates = spawnHelperPaths(root, target);
	const required = forksSpawnHelper(target.platform);
	const helpers = candidates
		.filter((candidate) => existsSync(candidate))
		.map((path) => {
			const mode = statSync(path).mode & 0o777;
			if ((mode & 0o100) !== 0) return { path, mode, healed: false };
			chmodSync(path, SPAWN_HELPER_MODE);
			return { path, mode, healed: true };
		});
	if (helpers.length === 0) {
		if (!required) {
			return {
				path: null,
				mode: null,
				healed: false,
				required,
				reason: `no helper, and ${target.platform}-${target.arch} forks none`,
				// No helper is wanted here, so a module with nothing beside it is the
				// expected shape rather than something to report.
				moduleDirWithoutHelper: null,
				helpers,
			};
		}
		throw new Error(
			`The packaged app has no node-pty ${SPAWN_HELPER_NAME} for ${target.platform}-${target.arch} at any of ${candidates.join(", ")}, and that platform forks one. A pty cannot be forked without it, and the last time this was wrong the app worked in development and failed at the first spawn. Check the asarUnpack entry for node-pty in package.json.`,
		);
	}
	const loaded = nativeModuleDir(root, target);
	const primary =
		helpers.find((helper) => dirname(helper.path) === loaded) ?? helpers[0];
	return {
		path: primary.path,
		mode: primary.mode,
		// One answer to "did this step have to fix something?", which is what a caller
		// reports; the per-file truth is in `helpers`.
		healed: helpers.some((helper) => helper.healed),
		required,
		// A directory that holds the native module and no helper beside it: the loader's
		// first choice may be unusable, so it is reported rather than assumed harmless.
		moduleDirWithoutHelper:
			required &&
			loaded !== null &&
			!existsSync(join(loaded, SPAWN_HELPER_NAME))
				? loaded
				: null,
		helpers,
	};
}

/**
 * What `afterPack` calls: prune, then fix the mode, then report.
 *
 * Returns a report rather than logging inside the caller, so the same function is
 * what the test drives and what the build runs — a build step that could only be
 * tested by running a full electron-builder pack is a step nobody tests.
 */
export function prepareConsoleNative({
	appOutDir,
	productFilename,
	arch,
	platform = process.platform,
	log = () => {},
}) {
	const resourcesDir = resourcesDirFor({
		appOutDir,
		productFilename,
		platform,
	});
	const root = consoleNativeRoot(resourcesDir);
	if (!existsSync(root)) {
		log(
			`[console] no unpacked node-pty at ${root}; nothing to prepare (the dependency is absent from this build)`,
		);
		return { found: false, root, prune: null, helper: null };
	}
	const target = { platform, arch: archName(arch) };
	const prune = pruneForeignPrebuilds(root, target);
	const helper = ensureSpawnHelperMode(root, target);
	// The line reports the mode it FOUND and the mode it left, because "healed"
	// without the numbers is a claim a reader cannot check against the artifact.
	// It names WHICH directory each helper came out of for the same reason and a
	// second one: since v0.29.12 the answer is platform-dependent, and a reader
	// comparing this line against a tree cannot tell a source build's
	// `build/Release` from a tarball prebuild without it. A tree can carry both, and
	// then the line names both.
	const helpers =
		helper.helpers.length === 0
			? `(none, and ${target.platform}-${target.arch} forks none)`
			: helper.helpers
					.map(
						(entry) =>
							`${relative(root, entry.path)} mode 0${entry.mode.toString(8)}${entry.healed ? ` -> 0${SPAWN_HELPER_MODE.toString(8)}` : " (already executable)"}`,
					)
					.join(", ");
	log(
		`[console] packaged node-pty: kept prebuilds/${prune.kept.join(", ") || "(none)"}, removed ${prune.removed.length} foreign prebuild director${prune.removed.length === 1 ? "y" : "ies"} (${(prune.bytes / (1024 * 1024)).toFixed(1)} MB), spawn-helper ${helpers}`,
	);
	if (helper.moduleDirWithoutHelper !== null) {
		// Some searched directory holds the native module and no helper beside it, which
		// is the one shape a filesystem can show is not ours to reason about further: the
		// loader takes the first `pty.node` it can dlopen, and if that is this one it forks
		// a path that does not exist. Reported rather than thrown, because the directory
		// that wins depends on the architecture the run-time Electron can load - a
		// cross-arch pack leaves exactly this state on purpose.
		log(
			`[console] node-pty's native module is at ${relative(root, helper.moduleDirWithoutHelper)} with no ${SPAWN_HELPER_NAME} beside it; if the loader takes that directory, the first pty fork on this platform fails`,
		);
	}
	return { found: true, root, prune, helper };
}

/** Best-effort sizes, so the log line can say what the prune reclaimed. An
 * unreadable entry contributes 0 rather than failing a build over a number that is
 * only evidence. */
function directoryBytes(path) {
	let total = 0;
	let entries;
	try {
		const stats = statSync(path);
		if (stats.isFile()) return stats.size;
		entries = readdirSync(path);
	} catch {
		return 0;
	}
	for (const entry of entries) total += directoryBytes(join(path, entry));
	return total;
}

/** The manual entry point, for a packaging proof that wants to run this against a
 * tree someone else produced. */
function main(argv) {
	const args = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		args.set(argv[index], argv[index + 1]);
	}
	const resources = args.get("--resources");
	if (!resources) {
		console.error(
			"usage: node scripts/console-pack.mjs --resources <resources dir> [--platform darwin] [--arch arm64]",
		);
		process.exit(2);
	}
	const platform = args.get("--platform") ?? process.platform;
	const report = prepareConsoleNative({
		...appOutDirFor({ resourcesDir: resources, platform }),
		arch: args.get("--arch") ?? process.arch,
		platform,
		log: (line) => console.log(line),
	});
	if (!report.found) process.exit(1);
	for (const entry of report.helper.helpers) {
		console.log(
			`spawn-helper ${relative(report.root, entry.path)}: mode 0${entry.mode.toString(8)}${entry.healed ? ` -> 0${SPAWN_HELPER_MODE.toString(8)}` : " (already executable)"}`,
		);
	}
	if (report.helper.helpers.length === 0) {
		console.log(`spawn-helper: ${report.helper.reason}`);
	}
}

// Through the shared helper, not a string comparison: `process.argv[1]` is
// whatever the caller typed while `import.meta.url` is physical, and a symlinked
// path made this file's own entry point silently do nothing.
if (isEntryPoint(import.meta.url)) main(process.argv.slice(2));
