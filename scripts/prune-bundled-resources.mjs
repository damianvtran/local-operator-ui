#!/usr/bin/env node
/**
 * Keep only the bundled runtime resources the app being packaged can run.
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
 * WHY IT PRUNES THE uv GROUP ON EVERY PLATFORM NOW. The bundled `uv` (see
 * `src/main/backend/uv-tool.ts`) is staged per architecture for the same reason
 * the interpreter is - the tool that installs the backend has to run on the
 * machine the artifact was built for - and every platform's copy lists carry it,
 * because Windows and Linux ship one too (they used to run pip unconditionally:
 * nothing staged a uv for them). So each packed app keeps its own architecture's
 * uv tree and deletes the other's, on all three platforms. Adding a second,
 * near-identical prune step beside this one would have been the obvious move and
 * the wrong one: two steps that walk the same bundle and delete the other
 * architecture's tree will drift, and the drift shows up as a larger download
 * nobody measures. So the groups are parameterised here instead, and
 * `bundledUvToolCheck` in `python-artifact-layout.mjs` asserts what survived on
 * the macOS artifact.
 *
 * The INTERPRETER group stays macOS's alone: `python-runtime-seed/<arch>` is a
 * tree only the macOS job stages (see `prunedGroupsFor`).
 *
 * `afterPack` is the right seam rather than a trimmed `extraResources` filter:
 * the filter is evaluated per target and would have to spell the architecture
 * twice, while electron-builder hands the hook the arch of the bundle it just
 * packed. It runs after the files are copied and BEFORE signing, which matters -
 * the trees are code-sealed as part of the `.app`, so anything removed after
 * signing would be a `file missing:` violation, the class no update-time heal
 * can repair (see `update-install.ts` `healPythonBytecode`).
 *
 * The "no .pyc/.pyo ships" invariant is unaffected: this only deletes whole
 * trees, never writes into the one it keeps, and `verify-macos-artifacts.mjs`
 * still walks what survived.
 *
 * Usage: configured as `build.afterPack`; not meant to be run by hand. The
 * exported function is what the unit test drives.
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
	LAYOUT,
	seedResourceDir,
	uvResourceDir,
} from "./bundled-runtime-layout.mjs";

/**
 * The directory each architecture's interpreter occupies, by the same names
 * `backend-installer.ts` probes. Read from the app's own layout definition so a
 * third spelling cannot appear beside them - this map and the app's `seedPath`
 * were the two that had to agree and did not (review R10 / QA Q2).
 */
export const PYTHON_RESOURCE_DIRS = Object.fromEntries(
	LAYOUT.architectures.map((arch) => [arch, seedResourceDir(arch)]),
);

/** And each architecture's `uv`, under its own resource namespace. */
export const UV_RESOURCE_DIRS = Object.fromEntries(
	LAYOUT.architectures.map((arch) => [arch, uvResourceDir(arch)]),
);

/**
 * Every tree this step prunes the off-architecture half out of, by group.
 *
 * Keyed by the group's name only so a failure can name WHAT could not be pruned
 * rather than dumping two paths nobody can tell apart.
 */
export const PRUNED_RESOURCE_GROUPS = {
	python: PYTHON_RESOURCE_DIRS,
	uv: UV_RESOURCE_DIRS,
};

/**
 * The groups a packed app of a given platform carries a keep-or-delete decision
 * for.
 *
 * `uv`: every platform. Each of the three build jobs stages its own release now
 * (`setup-python-resource.sh` for darwin and linux, `setup-python-resource.ps1`
 * for win32), `extraResources` copies both architectures' trees into every
 * packed app, and the app resolves the one its own machine runs.
 *
 * `python`: macOS alone, and deliberately. The tree it names is the interpreter
 * SEED (`python-runtime-seed/<arch>`), which only the macOS job stages; a
 * Windows or Linux artifact's copy list names `python`/`python_aarch64`, whose
 * trees - when a dev checkout has staged any - are not this repository's to
 * delete, and on those platforms those names are the live ones rather than the
 * retired spellings macOS refuses (review R1-3). Nothing there is pruned, which
 * is also why nothing there regressed.
 */
export function prunedGroupsFor(platform) {
	return Object.entries(PRUNED_RESOURCE_GROUPS).filter(
		([group]) => group !== "python" || platform === "darwin",
	);
}

/**
 * `builder-util`'s `Arch` enum, as `afterPack` receives it.
 *
 * The context carries the enum member, not its name: measured against a real
 * build, `--arm64` reaches the hook as `3`. The string spelling is accepted
 * beside it because that is what older electron-builder versions passed and a
 * build must not fail on the input shape it happens to get; nothing here
 * guesses, and an unrecognised value is refused rather than matched loosely.
 */
const ARCH_NAMES = {
	0: "ia32",
	1: "x64",
	2: "armv7l",
	3: "arm64",
	4: "universal",
};

/** The architecture name for an `afterPack` context's `arch`. */
export function archName(arch) {
	return typeof arch === "string" ? arch : (ARCH_NAMES[arch] ?? String(arch));
}

/** The packaged app's resources directory, where `extraResources` land. */
export function packagedResourcesDir({
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
 * Remove every resource tree this architecture cannot run.
 *
 * Throws on an arch with no mapping: the two names above are the only ones the
 * app can resolve, so a third architecture reaching this hook means the mac
 * target list and this map have diverged, and silently shipping both trees is
 * how that goes unnoticed until someone measures a download. A `universal`
 * build is refused for the same reason it was deleted from `mac.target` - it
 * runs as either architecture on different machines, so it needs both trees and
 * cannot be pruned at all.
 *
 * Returns `{ pruned, kept, resourcesDir }`: the paths removed, the paths left in
 * place (one per group this platform prunes - review N1: this was
 * `kept: string | null` while the module pruned a single tree, and the per-group
 * form is what a caller asking "what survived" wants), and the packaged
 * resources directory. The directory is returned on every platform now, because
 * the hook prunes something on every platform; `kept` is one entry shorter on
 * Windows and Linux, where the interpreter group is not this hook's to touch.
 */
export function pruneUnshippedBundledResources({
	appOutDir,
	arch,
	productFilename,
	platform = process.platform,
	log = console.log,
}) {
	const name = archName(arch);
	if (!Object.hasOwn(PYTHON_RESOURCE_DIRS, name)) {
		throw new Error(
			`Cannot prune the bundled runtime for arch "${name}": expected one of ${Object.keys(PYTHON_RESOURCE_DIRS).join(", ")}. A universal app runs as either architecture and needs both trees, so it cannot be pruned.`,
		);
	}
	const resourcesDir = packagedResourcesDir({
		appOutDir,
		productFilename,
		platform,
	});
	if (platform !== "darwin") {
		log(
			`Skipping the bundled interpreter seed: not macOS (${platform}), where nothing stages one`,
		);
	}
	const pruned = [];
	const kept = [];
	for (const [group, dirs] of prunedGroupsFor(platform)) {
		const keep = dirs[name];
		kept.push(keep);
		for (const [otherArch, relative] of Object.entries(dirs)) {
			if (otherArch === name) continue;
			const target = join(resourcesDir, relative);
			if (!existsSync(target)) continue;
			rmSync(target, { recursive: true, force: true });
			pruned.push(target);
		}
		// Named per group, so a build that pruned the interpreter and silently
		// kept the other architecture's uv says which half was missing rather
		// than reporting nothing to do.
		log(
			`Bundled ${group} for the ${name} app: kept ${join(resourcesDir, keep)}`,
		);
	}
	if (pruned.length > 0) {
		log(
			`Pruned bundled runtime resources the ${name} app cannot run: ${pruned.join(", ")}`,
		);
	} else {
		log(
			`No off-architecture bundled runtime resources found for ${name} in ${resourcesDir}`,
		);
	}
	return { pruned, kept, resourcesDir };
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
			"Cannot prune the bundled runtime: afterPack context has no packager.appInfo.productFilename",
		);
	}
	return pruneUnshippedBundledResources({
		appOutDir: context.appOutDir,
		arch: context.arch,
		productFilename,
		platform: context.electronPlatformName ?? process.platform,
	});
}
