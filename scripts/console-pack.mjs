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
 * Usage by hand: `node scripts/console-pack.mjs --resources <dir> --platform darwin --arch arm64`
 */

import { chmodSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { isEntryPoint } from "./entry-point.mjs";
import { archName } from "./prune-python-resource.mjs";

/** The executable node-pty forks through on macOS. */
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
 * Assert the helper's exec bit in the packed tree, and set it if missing.
 *
 * THROWS when the helper is absent on a platform that needs one: a darwin or
 * linux artifact without `spawn-helper` cannot fork a pty at all, and a build that
 * shipped it would be a build whose console is silently broken until a user
 * reports it. Windows has no helper (its binaries are executable by extension), so
 * there the absence is expected and reported instead.
 */
export function ensureSpawnHelperMode(root, target) {
	const path = join(prebuildDir(root, target), SPAWN_HELPER_NAME);
	if (!existsSync(path)) {
		if (target.platform === "win32") {
			return { path: null, mode: null, healed: false, missing: false };
		}
		throw new Error(
			`The packaged app has no node-pty ${SPAWN_HELPER_NAME} for ${target.platform}-${target.arch} at ${path}. A pty cannot be forked without it, and the last time this was wrong the app worked in development and failed at the first spawn. Check the asarUnpack entry for node-pty in package.json.`,
		);
	}
	const mode = statSync(path).mode & 0o777;
	if ((mode & 0o100) !== 0) {
		return { path, mode, healed: false, missing: false };
	}
	chmodSync(path, SPAWN_HELPER_MODE);
	return { path, mode, healed: true, missing: false };
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
	log(
		`[console] packaged node-pty: kept prebuilds/${prune.kept.join(", ") || "(none)"}, removed ${prune.removed.length} foreign prebuild director${prune.removed.length === 1 ? "y" : "ies"} (${(prune.bytes / (1024 * 1024)).toFixed(1)} MB), spawn-helper mode ${helper.mode === null ? "(absent)" : `0${helper.mode.toString(8)}${helper.healed ? ` -> 0${SPAWN_HELPER_MODE.toString(8)}` : " (already executable)"}`}`,
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
	const report = prepareConsoleNative({
		appOutDir: join(resources, "..", ".."),
		productFilename: "",
		arch: args.get("--arch") ?? process.arch,
		platform: args.get("--platform") ?? process.platform,
		log: (line) => console.log(line),
	});
	if (!report.found) process.exit(1);
	if (report.helper?.mode !== null && report.helper?.mode !== undefined) {
		console.log(
			`spawn-helper mode: 0${report.helper.mode.toString(8)}${report.helper.healed ? " (healed)" : " (already executable)"}`,
		);
	}
}

// Through the shared helper, not a string comparison: `process.argv[1]` is
// whatever the caller typed while `import.meta.url` is physical, and a symlinked
// path made this file's own entry point silently do nothing.
if (isEntryPoint(import.meta.url)) main(process.argv.slice(2));
