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

/** The Tcl/Tk version this build ships (`9.0`).
 *
 * It is a token of its OWN rather than the Python version, because the two move
 * independently: the `20260901` build moved Tcl/Tk from 8.6 to 9.0 while the
 * Python line stayed 3.12, and the prune list's `lib/tk8.6/demos` entry then
 * pruned NOTHING - a silent no-op of the class `{pyver}` was introduced to stop,
 * and one the prune now refuses (`pruneSeed` throws for a named path that is not
 * there, and a path whose version token is stale is exactly what that catches). */
export const TK_VERSION = LAYOUT.python.tkVersion;

/**
 * Expand the version tokens in a path from the layout.
 *
 * `{pyver}`, `{pyminor}` and `{tkver}` are the ONLY spellings of those versions
 * in the definition file, so a version refresh cannot leave a stale
 * `python3.12` or `tk8.6` segment behind in a prune list - the failure mode that
 * makes a prune silently do nothing after a bump, which is the one direction this
 * whole area fails in (the tree still runs; it is just larger).
 */
export function expandVersionToken(relative, version = PYTHON_VERSION) {
	return relative
		.replaceAll("{pyver}", pythonAbi(version))
		.replaceAll("{pyminor}", version.split(".")[1] ?? "")
		.replaceAll("{tkver}", TK_VERSION);
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

/** The Tcl/Tk directory this seed must carry, expanded (`lib/tk9.0`).
 *
 * WHY A REQUIRED PATH FOR A VERSION NOTHING ELSE PINS (review R2-5): the ONLY
 * consumer of `{tkver}` is the optional demos entry, and an optional entry's
 * absence is the accepted outcome - so a refresh that moved Tcl/Tk while the
 * token stayed behind would prune nothing and look exactly like a correct build.
 * That is the silent-no-op class this file has already been bitten by twice
 * (`bin/idle3.{pyver}`, `lib/tk8.6/demos`), one token over. This directory is
 * what ties the token to the tree: it is content the prune deliberately KEEPS
 * (`tkinter` is a live module), so asserting its presence says nothing about what
 * is pruned and everything about whether the token still names this build. */
export const SEED_TK_DIR = expandVersionToken(LAYOUT.python.seedTkDir);

/** The seed content no import can reach, expanded.
 *
 * TWO LISTS, and the split is load-bearing: a path in `prunedSeedPaths` MUST
 * exist in the tree `20260901` builds, and `pruneSeed` throws when one does not
 * (`lib/tk8.6/demos` was spelled for the previous build, pruned nothing, and was
 * invisible in every log line and gate). A path in `prunedSeedPathsOptional` is
 * pruned when it is there and reported as absent when it is not, because the
 * Tcl/Tk demos are data no import needs but a build that ships them may put them
 * under a versioned directory.
 */
export const PRUNED_SEED_PATHS = LAYOUT.python.prunedSeedPaths.map((relative) =>
	expandVersionToken(relative),
);

/** The seed content that is pruned when present and is not required to be. */
export const PRUNED_SEED_OPTIONAL_PATHS = (
	LAYOUT.python.prunedSeedPathsOptional ?? []
).map((relative) => expandVersionToken(relative));

/** The `<major>.<minor>` segment's home in the seed, e.g. `lib/python3.12`. */
export const SEED_STDLIB_DIR = SEED_STDLIB_MARKER.split("/")
	.slice(0, 2)
	.join("/");

/** The `uv` release this app bundles. Pinned here and nowhere else. */
export const UV_VERSION = LAYOUT.uv.version;

/** `uv`'s own resource namespace under `Resources`, which `package.json`'s
 * `extraResources` maps into for every platform this app ships.
 *
 * WHICH PLATFORMS SHIP ONE, stated because the packaging lists and the staging
 * step have to agree or a build ships binaries its own machine cannot run (review
 * R1-3): all three ship one now. `scripts/setup-python-resource.sh` stages the
 * `*-apple-darwin` triples on macOS and the `*-unknown-linux-gnu` ones on Linux,
 * `scripts/setup-python-resource.ps1` stages the `*-pc-windows-msvc` ones on
 * Windows, and `publish.yml` runs the matching stager in each build job. The
 * `releaseTriples`/`archiveExtension`/`archiveMember` keys in the definition are
 * the release assets those stagers download - they are read rather than spelled in the
 * scripts, because a triple spelled twice is a triple that can disagree, and a
 * stager that downloads the wrong asset is a build that ships a binary the
 * artifact's machine cannot execute. */
export const UV_NAMESPACE = LAYOUT.uv.namespace;

/** The uv release's asset triple per platform and architecture
 * (`x86_64-unknown-linux-gnu` and friends). */
export const UV_RELEASE_TRIPLES = LAYOUT.uv.releaseTriples;

/** The archive suffix the pinned release publishes per platform: `tar.gz` for
 * the Unix triples, `zip` for the Windows ones. */
export const UV_ARCHIVE_EXTENSION = LAYOUT.uv.archiveExtension;

/**
 * The path of the `uv` binary inside a downloaded release archive, for a
 * platform and a release triple.
 *
 * The archives are NOT one shape: the `tar.gz` releases nest the binary under
 * `uv-<triple>/`, while the Windows `zip` is flat (`uv.exe` at the archive
 * root). A stager that assumes one shape extracts nothing on the other platform
 * and fails with an ENOENT naming the archive rather than the assumption, so the
 * shape is declared once here and expanded per caller.
 */
export function uvArchiveMember(platform, triple) {
	const template = LAYOUT.uv.archiveMember[platform];
	if (!template)
		throw new Error(
			`No uv archive member is declared for platform "${platform}"; src/shared/bundled-runtime-layout.json names ${Object.keys(LAYOUT.uv.archiveMember).join(", ")}`,
		);
	return template.replaceAll("{triple}", triple);
}

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
