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
 *   3. WHERE the helper is is a per-platform answer, and a probe that knows only
 *      one of them is a probe that fails the platforms it cannot see. The
 *      published tarball carries prebuilds for darwin-arm64, darwin-x64,
 *      win32-arm64 and win32-x64 and no linux one at all, and the package's own
 *      install script (`node scripts/prebuild.js || node-gyp rebuild`) compiles
 *      from source when the running platform has no prebuild - so on Linux, and
 *      in any tree electron-builder has rebuilt for the Electron ABI, the helper
 *      arrives under `build/Release`. A prebuild-only search threw the Linux
 *      publish of v0.29.12 dead AFTER the file it said was missing had been
 *      built. `nativeDirs` is therefore node-pty's own loader order rather than
 *      one hard-coded directory.
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
import { basename, join, relative } from "node:path";
import { isEntryPoint } from "./entry-point.mjs";
import { archName } from "./prune-python-resource.mjs";

/** The executable node-pty forks through on the platforms that have one. */
export const SPAWN_HELPER_NAME = "spawn-helper";

/** The mode it must have: what the upstream build produces, and what `fork(2)`
 * needs. Not `0700` — a per-user install that later runs as another account must
 * not lose the helper to a mode the build did not set. */
export const SPAWN_HELPER_MODE = 0o755;

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
 * Entry 1 is the one the Linux artifact depends on: node-pty ships no Linux
 * prebuild, so its install script compiles from source and the helper lands in
 * `build/Release` (also where `@electron/rebuild` puts it in a tree being packed for
 * the Electron ABI). Entry 3 is the darwin/win32 case the published tarball serves
 * without compiling anything. `build/Debug` is kept because node-pty's own loader
 * names it; electron-builder does not unpack that directory, so in a packed app it is
 * always absent.
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
 * EVERY helper present, not just the first: a tree that holds both a tarball prebuild
 * and a source build ships two of these files, node-pty forks the one in the directory
 * its native module loaded from, and which one that is cannot be decided from the
 * filesystem - a `build/Release/pty.node` the running Electron cannot `dlopen` falls
 * through to the prebuild at run time, silently. Healing only the first would leave the
 * fallback at whatever mode the tarball or a ZIP-delivered update gave it, and the
 * failure this heals is `FATAL Error: posix_spawnp failed.`
 *
 * The report still LEADS with the loader's own first choice, because that is the header
 * node-pty will fork through on a tree where the source build loads; `helpers` carries
 * every file this step looked at, so the log line can name each one it had to fix.
 *
 * The directories are node-pty's own (`nativeDirs`), NOT the prebuild directory alone:
 * a source build - which is every Linux artifact, and any tree electron-builder has
 * rebuilt for the Electron ABI - keeps its helper in `build/Release` and never creates
 * the prebuild directory a prebuild-only probe looked in. The mode it heals to (0o755)
 * and the Windows answer are unchanged.
 *
 * THROWS when NO directory holds one on a platform that needs it: a darwin or linux
 * artifact without `spawn-helper` cannot fork a pty at all, and a build that shipped
 * one would be a build whose console is silently broken until a user reports it. The
 * message names every directory searched, because "not where I looked" and "nowhere"
 * are different failures and only the second one is this throw's. Windows has no helper
 * (its binaries are executable by extension), so there the absence is expected and
 * reported instead.
 */
export function ensureSpawnHelperMode(root, target) {
	const candidates = spawnHelperPaths(root, target);
	const helpers = candidates
		.filter((candidate) => existsSync(candidate))
		.map((path) => {
			const mode = statSync(path).mode & 0o777;
			if ((mode & 0o100) !== 0) return { path, mode, healed: false };
			chmodSync(path, SPAWN_HELPER_MODE);
			return { path, mode, healed: true };
		});
	if (helpers.length === 0) {
		if (target.platform === "win32") {
			return { path: null, mode: null, healed: false, missing: false, helpers };
		}
		throw new Error(
			`The packaged app has no node-pty ${SPAWN_HELPER_NAME} for ${target.platform}-${target.arch} at any of ${candidates.join(", ")}. A pty cannot be forked without it, and the last time this was wrong the app worked in development and failed at the first spawn. Check the asarUnpack entry for node-pty in package.json.`,
		);
	}
	const [primary] = helpers;
	return {
		path: primary.path,
		mode: primary.mode,
		// One answer to "did this step have to fix something?", which is what a caller
		// reports; the per-file truth is in `helpers`.
		healed: helpers.some((helper) => helper.healed),
		missing: false,
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
			? "(none present)"
			: helper.helpers
					.map(
						(entry) =>
							`${relative(root, entry.path)} mode 0${entry.mode.toString(8)}${entry.healed ? ` -> 0${SPAWN_HELPER_MODE.toString(8)}` : " (already executable)"}`,
					)
					.join(", ");
	log(
		`[console] packaged node-pty: kept prebuilds/${prune.kept.join(", ") || "(none)"}, removed ${prune.removed.length} foreign prebuild director${prune.removed.length === 1 ? "y" : "ies"} (${(prune.bytes / (1024 * 1024)).toFixed(1)} MB), spawn-helper ${helpers}`,
	);
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
			`spawn-helper ${relative(report.root, entry.path)}: mode 0${entry.mode.toString(8)}${entry.healed ? " (healed)" : " (already executable)"}`,
		);
	}
}

// Through the shared helper, not a string comparison: `process.argv[1]` is
// whatever the caller typed while `import.meta.url` is physical, and a symlinked
// path made this file's own entry point silently do nothing.
if (isEntryPoint(import.meta.url)) main(process.argv.slice(2));
