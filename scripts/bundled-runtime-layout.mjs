#!/usr/bin/env node
/**
 * The bundled runtime's layout, read from the app's own definition of it.
 *
 * Why this module exists: the names this file covers were once spelled in six
 * places (the app's `managed-python.ts` and `update-install.ts`, `package.json`'s
 * `extraResources`, and three scripts). Five were updated with a rename; the
 * heal's predicate in `update-install.ts` was not, so on a bundle that branch
 * built every `.pyc` violation was unhealable by construction while the gate
 * that shares its job was green (review R10 / QA Q2).
 *
 * `src/shared/bundled-runtime-layout.json` is now the single definition, and this
 * is the one reader of it on the scripts side. The app imports the same file, so
 * a name can only be wrong in one place at a time.
 *
 * WHY IT IS CALLED "runtime" AND NOT "python" (renamed with the uv bundle): the
 * file no longer describes the interpreter alone - it pins the
 * `uv` tool that installs into the venv built on that interpreter, and its
 * namespace, binary names and version. A file whose name describes half of what
 * it holds is exactly the drift the rest of these comments exist to prevent, so
 * the name moved with the contents rather than beside them.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const LAYOUT = JSON.parse(
	readFileSync(
		fileURLToPath(
			new URL("../src/shared/bundled-runtime-layout.json", import.meta.url),
		),
		"utf8",
	),
);

/**
 * The one Python version this app bundles, and the standalone build it came from.
 *
 * Every version-bearing path below is DERIVED from these two, by way of
 * `{pyver}`: the stdlib marker, the prune list, and `python-artifact-layout.mjs`'s
 * completeness check. That is deliberate and it is the whole point of the token -
 * a refresh is now this line plus a regeneration, where it used to be a version
 * spelled out in five files (the marker, five prune paths, the gate's existence
 * check, and the two tests) that could disagree with each other and with the
 * artifact.
 */
export const PYTHON_VERSION = LAYOUT.python.version;
export const PYTHON_BUILD_DATE = LAYOUT.python.buildDate;

/** The `<major>.<minor>` of the declared version: what CPython puts in
 * `lib/python<X.Y>`, `bin/python<X.Y>`, `_sysconfigdata`'s `VERSION` and the
 * `ensurepip` wheel's name. */
export function pythonAbi(version = PYTHON_VERSION) {
	const [major, minor] = version.split(".");
	if (!major || !minor)
		throw new Error(
			`The declared Python version "${version}" is not <major>.<minor>[.<patch>]`,
		);
	return `${major}.${minor}`;
}

export const PYTHON_ABI = pythonAbi();

/** The minor alone (`12`), which is what CPython's versioned console scripts use:
 * `bin/2to3-3.12` carries the whole `<major>.<minor>` while `bin/idle3.12` and
 * `bin/pydoc3.12` carry the minor after the tool's own name. Measured against the
 * staged 3.12.14 tree; a single token for both spellings silently prunes nothing,
 * and `idle3.12` is the file this caught. */
export const PYTHON_MINOR = PYTHON_VERSION.split(".")[1];

/**
 * Expand the version tokens in a path from the layout.
 *
 * `{pyver}` and `{pyminor}` are the ONLY spellings of the ABI in the definition
 * file, so a version refresh cannot leave a stale `python3.12` segment behind in
 * a prune list - the failure mode that makes a prune silently do nothing after a
 * bump, which is the one direction this whole area fails in (the tree still runs;
 * it is just larger).
 */
export function expandVersionToken(relative, version = PYTHON_VERSION) {
	return relative
		.replaceAll("{pyver}", pythonAbi(version))
		.replaceAll("{pyminor}", version.split(".")[1] ?? "");
}

/** The seed directory this architecture ships under, relative to `Resources`. */
export const seedResourceDir = (arch) =>
	`${LAYOUT.python.seedNamespace}/${arch}`;

/** Every architecture's seed directory, in the layout's own order. */
export const SEED_RESOURCE_DIRS = LAYOUT.architectures.map(seedResourceDir);

/** The resource names a shipped bundle must never carry again, for a reason. */
export const LEGACY_RESOURCE_NAMES = LAYOUT.legacyResourceNames;

/**
 * Every resource directory that may hold bundled-interpreter bytecode.
 *
 * Both halves, deliberately: a bundle being *replaced* is the old layout, a
 * bundle being *healed* is either, and a predicate that lists only one of them
 * is how R10 happened.
 */
export const BYTECODE_TREE_NAMES = [
	...LEGACY_RESOURCE_NAMES,
	...SEED_RESOURCE_DIRS,
];

/** The file whose presence proves a tree is a complete interpreter, expanded. */
export const SEED_STDLIB_MARKER = expandVersionToken(
	LAYOUT.python.seedStdlibMarker,
);

/** The seed content no import can reach, expanded. */
export const PRUNED_SEED_PATHS = LAYOUT.python.prunedSeedPaths.map((relative) =>
	expandVersionToken(relative),
);

/** The `<major>.<minor>` segment's home in the seed, e.g. `lib/python3.12`. */
export const SEED_STDLIB_DIR = SEED_STDLIB_MARKER.split("/")
	.slice(0, 2)
	.join("/");

/** The `uv` release this app bundles. Pinned here and nowhere else. */
export const UV_VERSION = LAYOUT.uv.version;

/** `uv`'s own resource namespace under `Resources` (`package.json`'s
 * `extraResources` maps into it for every platform). */
export const UV_NAMESPACE = LAYOUT.uv.namespace;

/**
 * `lipo`'s name for each architecture this layout names.
 *
 * One translation, in the layout module, because two readers now ask the
 * question (`bundledPythonCheck` already inverted the artifact's own architecture
 * into its interpreter directory, and `bundledUvToolCheck` has to invert it into
 * `lipo`'s spelling): `lipo` says `x86_64` where the artifact filename and this
 * layout say `x64`, and a second table for that is a second thing to get wrong.
 */
export const LIPO_ARCH = { arm64: "arm64", x64: "x86_64" };

/** `uv`'s resource directory this architecture ships under, relative to
 * `Resources` - the same `<namespace>/<arch>` shape the interpreter seed uses. */
export const uvResourceDir = (arch) => `${LAYOUT.uv.namespace}/${arch}`;

/** Every architecture's `uv` resource directory, in the layout's own order. */
export const UV_RESOURCE_DIRS = LAYOUT.architectures.map(uvResourceDir);

/** The `uv` binary's file name on a platform (`platform` is `process.platform`). */
export function uvBinaryName(platform = process.platform) {
	const name = LAYOUT.uv.binaryNames[platform];
	if (!name)
		throw new Error(
			`No bundled uv binary name is defined for platform "${platform}"; src/shared/bundled-runtime-layout.json names ${Object.keys(LAYOUT.uv.binaryNames).join(", ")}`,
		);
	return name;
}
