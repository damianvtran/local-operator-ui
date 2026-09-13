#!/usr/bin/env node
/**
 * Keep only the bundled Python interpreter the app being packaged can run.
 *
 * Why this exists: `extraResources` copies BOTH standalone interpreters
 * (`resources/python` for x64, `resources/python_aarch64` for arm64) into every
 * build, because the copy list is not architecture-aware. The app itself is:
 * `backend-installer.ts` `findPython()` probes `python_aarch64` on arm64 and
 * `python` on x64, and `python-bytecode-cache.ts` treats an absent tree as the
 * normal case for the architecture this build does not ship. So half of the
 * bundled interpreter - about 47 MB - was dead weight in every image, and in
 * the universal build both halves were carried for every user.
 *
 * `afterPack` is the right seam rather than a trimmed `extraResources` filter:
 * the filter is evaluated per target and would have to spell the architecture
 * twice, while electron-builder hands the hook the arch of the bundle it just
 * packed. It runs after the files are copied and BEFORE signing, which matters -
 * the tree is code-sealed as part of the `.app`, so anything removed after
 * signing would be a `file missing:` violation, the class no update-time heal
 * can repair (see `update-install.ts` `healPythonBytecode`).
 *
 * The "no .pyc/.pyo ships" invariant is unaffected: this only deletes a whole
 * tree, never writes into the one it keeps, and `verify-macos-artifacts.mjs`
 * still walks what survived.
 *
 * Scope: macOS only. The two trees this prunes are mac standalone interpreters
 * (`setup-python-resource.sh` downloads the `*-apple-darwin-install_only`
 * builds), and no Windows or Linux job assembles them - `publish.yml` runs
 * `pnpm setup-python` in the macOS job alone. Leaving `--win`/`--linux` output
 * byte-identical to what those platforms produce today is the point.
 *
 * Usage: configured as `build.afterPack`; not meant to be run by hand. The
 * exported function is what the unit test drives.
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * The directory each architecture's interpreter occupies, by the same names
 * `backend-installer.ts` probes and `python-bytecode-cache.ts` lists. Kept as
 * one map so a third spelling cannot appear beside them.
 */
export const PYTHON_RESOURCE_DIRS = {
	arm64: "python_aarch64",
	x64: "python",
};

/**
 * `builder-util`'s `Arch` enum, as `afterPack` receives it.
 *
 * The context carries the enum member, not its name: measured against a real
 * build, `--arm64` reaches the hook as `3`. The string spelling is accepted
 * beside it because that is what older electron-builder versions passed and a
 * build must not fail on the input shape it happens to get; nothing here
 * guesses, and an unrecognised value is refused rather than matched loosely.
 */
const ARCH_NAMES = { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64", 4: "universal" };

/** The architecture name for an `afterPack` context's `arch`. */
export function archName(arch) {
	return typeof arch === "string" ? arch : (ARCH_NAMES[arch] ?? String(arch));
}

/** The packaged app's resources directory, where `extraResources` land. */
export function pythonResourcesDir({
	appOutDir,
	productFilename,
	platform = process.platform,
}) {
	// macOS wraps the app in a bundle; the other platforms put `resources`
	// beside the executable inside the unpacked app directory.
	return platform === "darwin"
		? join(appOutDir, `${productFilename}.app`, "Contents", "Resources")
		: join(appOutDir, "resources");
}

/**
 * Remove the interpreter tree this architecture cannot run.
 *
 * Throws on an arch with no mapping: the two names above are the only ones the
 * app can resolve, so a third architecture reaching this hook means the mac
 * target list and this map have diverged, and silently shipping both trees is
 * how that goes unnoticed until someone measures a download. A `universal`
 * build is refused for the same reason it was deleted from `mac.target` - it
 * runs as either architecture on different machines, so it needs both trees and
 * cannot be pruned at all.
 */
export function pruneUnshippedPythonResources({
	appOutDir,
	arch,
	productFilename,
	platform = process.platform,
	log = console.log,
}) {
	if (platform !== "darwin") {
		log(`Skipping Python resource pruning: not macOS (${platform})`);
		return { pruned: [], kept: null, resourcesDir: null };
	}
	const name = archName(arch);
	if (!Object.hasOwn(PYTHON_RESOURCE_DIRS, name)) {
		throw new Error(
			`Cannot prune bundled Python for arch "${name}": expected one of ${Object.keys(PYTHON_RESOURCE_DIRS).join(", ")}. A universal app runs as either architecture and needs both trees, so it cannot be pruned.`,
		);
	}
	const keep = PYTHON_RESOURCE_DIRS[name];
	const resourcesDir = pythonResourcesDir({
		appOutDir,
		productFilename,
		platform,
	});
	const pruned = [];
	for (const name of Object.values(PYTHON_RESOURCE_DIRS)) {
		if (name === keep) continue;
		const target = join(resourcesDir, name);
		if (!existsSync(target)) continue;
		rmSync(target, { recursive: true, force: true });
		pruned.push(target);
	}
	if (pruned.length > 0) {
		log(`Pruned bundled Python the ${name} app cannot run: ${pruned.join(", ")}`);
	} else {
		log(`No off-architecture bundled Python found for ${name} in ${resourcesDir}`);
	}
	return { pruned, kept: join(resourcesDir, keep), resourcesDir };
}

/**
 * The electron-builder `afterPack` hook.
 *
 * A missing `packager.appInfo` is a programming error rather than a build
 * condition: electron-builder always supplies it, and defaulting here would
 * silently guess the bundle's name and prune a directory that is not there.
 */
export default async function afterPack(context) {
	const productFilename = context.packager?.appInfo?.productFilename;
	if (productFilename == null) {
		throw new Error(
			"Cannot prune bundled Python: afterPack context has no packager.appInfo.productFilename",
		);
	}
	return pruneUnshippedPythonResources({
		appOutDir: context.appOutDir,
		arch: context.arch,
		productFilename,
		platform: context.electronPlatformName ?? process.platform,
	});
}
