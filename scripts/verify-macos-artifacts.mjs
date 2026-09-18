#!/usr/bin/env node
import { spawnSync } from "node:child_process";
/**
 * Assert that the macOS release artifacts are actually installable.
 *
 * Why this exists: the 0.17.0 release shipped an app that was signed,
 * notarized and stapled, and a DMG that was none of those things
 * (`dmg.sign: false`, `mac.notarize: false`, only the app notarized by the
 * `afterSign` hook). `codesign --verify --deep --strict` on the app passed, so
 * nothing in the pipeline noticed; on a user's machine the freshly downloaded
 * image reported `rejected / source=no usable signature` to
 * `spctl -a -vvv -t open --context context:primary-signature`. The checks below
 * are the ones a user's Gatekeeper performs, run against the real artifacts
 * before they are attached to a release.
 *
 * Every check is a hard failure: a release that cannot be opened is worse than a
 * release that is late.
 *
 * Usage: node scripts/verify-macos-artifacts.mjs [--dist dist] [--app path] [--dmg path]
 * Exit: 0 when every check passes, 1 otherwise (including when an artifact is missing).
 */
import {
	closeSync,
	existsSync,
	lstatSync,
	openSync,
	readdirSync,
	rmSync,
	statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
	BYTECODE_TREE_NAMES,
	LAYOUT,
	seedResourceDir,
} from "./bundled-python-layout.mjs";
import { isEntryPoint } from "./entry-point.mjs";
import {
	PRUNED_SEED_PATHS,
	SEED_STDLIB_MARKER,
	machOFiles,
	seedExecBitFiles,
	seedModeViolations,
} from "./prune-python-seed.mjs";
import {
	finalContainerChecks,
	finalMetadataChecks,
	privatePythonSeedCheck,
} from "./python-artifact-layout.mjs";

const CODESIGN = "/usr/bin/codesign";
const SPCTL = "/usr/sbin/spctl";
const XCRUN = "/usr/bin/xcrun";

/**
 * The rendered WebAuthn keychain access group, as it appears in a signed app's
 * entitlements: `keychain-access-groups` carrying `<TEAM_ID>.<BUNDLE_ID>.webauthn`.
 *
 * WHY THE SHAPE AND NOT THE VALUE: the team id is a release secret
 * (`APPLE_TEAM_ID`) that is not available to this gate, and the group is derived
 * from it at build time (`scripts/render-mac-entitlements.mjs`). What a release
 * can prove without the secret is that the entitlement LANDED and that the group
 * has the one shape `src/main/webauthn.ts` accepts; the app itself compares the
 * full value against its own signature at runtime and stays inert if it differs.
 *
 * WHY THIS CHECK EXISTS AT ALL (reviewer round 1, finding 6): every failure
 * downstream of the entitlement is designed to be SILENT — the app logs one line
 * naming the reason and goes inert — so a release whose rendered plist never
 * reached the signature would ship a passkey feature that can never work, with
 * nothing in the pipeline saying so.
 */
export const WEBAUTHN_GROUP_PATTERN =
	/<key>keychain-access-groups<\/key>\s*<array>[\s\S]*?<string>[^<]*\.webauthn<\/string>/;

/** Whether an entitlements plist (from `codesign -d --entitlements :-`) carries a
 * WebAuthn keychain access group. Exported so its test can assert both verdicts. */
export function hasWebauthnEntitlement(plistText) {
	return WEBAUTHN_GROUP_PATTERN.test(plistText);
}

/**
 * The checks, in the order a user's machine performs them.
 *
 * `expect` is a predicate over the raw result rather than an exit code: `spctl`
 * answers "accepted" on stdout for a Developer ID signature and "rejected" for
 * everything else, and both of those can exit 0 - so the verdict has to read
 * the output, not the status that reports whether spctl itself ran.
 */
export function artifactChecks({ appPath, dmgPath }) {
	const checks = [];
	if (appPath) {
		checks.push(
			{
				id: "app-codesign",
				scope: "app",
				target: appPath,
				description: "codesign --verify --deep --strict on the app",
				command: CODESIGN,
				args: ["--verify", "--deep", "--strict", "--verbose=2", appPath],
				expect: (result) => result.status === 0,
			},
			{
				id: "app-spctl",
				scope: "app",
				target: appPath,
				description: "spctl -a -vvv -t exec on the app",
				command: SPCTL,
				args: ["-a", "-vvv", "-t", "exec", appPath],
				expect: (result) => /accepted/.test(`${result.stdout}${result.stderr}`),
			},
			{
				id: "app-stapler",
				scope: "app",
				target: appPath,
				description: "stapler validate on the app",
				command: XCRUN,
				args: ["stapler", "validate", appPath],
				expect: (result) => result.status === 0,
			},
			{
				id: "app-webauthn-entitlement",
				scope: "app",
				target: appPath,
				description: "the signature carries the WebAuthn keychain access group",
				// `:-` writes the plist to stdout and exits 0 with empty output for a
				// signature that has none — which is exactly the failure this catches.
				command: CODESIGN,
				args: ["-d", "--entitlements", ":-", appPath],
				expect: (result) => hasWebauthnEntitlement(result.stdout),
			},
		);
	}
	if (dmgPath) {
		checks.push(
			{
				id: "dmg-spctl",
				scope: "dmg",
				target: dmgPath,
				description: "spctl -a -vvv -t open on the disk image",
				// context:primary-signature asks about the image's own signature -
				// the one a quarantined download is judged by - rather than about
				// the app inside it.
				command: SPCTL,
				args: [
					"-a",
					"-vvv",
					"-t",
					"open",
					"--context",
					"context:primary-signature",
					dmgPath,
				],
				expect: (result) => /accepted/.test(`${result.stdout}${result.stderr}`),
			},
			{
				id: "dmg-stapler",
				scope: "dmg",
				target: dmgPath,
				description: "stapler validate on the disk image",
				command: XCRUN,
				args: ["stapler", "validate", dmgPath],
				expect: (result) => result.status === 0,
			},
		);
	}
	return checks;
}

/** The directory names the bundled interpreters occupy, in app resources.
 *
 * Both namespaces, from the app's own layout definition: the legacy pair is what
 * a bundle being REPLACED carries, and the seed directories are what a bundle
 * this branch builds carries. A predicate that names only one of them is how the
 * heal drifted from the gate (review R10 / QA Q2).
 */
const BUNDLED_PYTHON_TREES = BYTECODE_TREE_NAMES;

/**
 * The bundled-interpreter trees a packaged app actually carries.
 *
 * `extraResources` lists both names for every build, and the app resolves only
 * the one its architecture runs (`backend-installer.ts` `findPython`), so a
 * bundle with two trees carries an interpreter the machine cannot execute - half
 * the interpreter's weight again, in every download and every update. `afterPack`
 * (`scripts/prune-python-resource.mjs`) is what removes the other one, and this
 * is the check that the removal happened: the failure mode is a silent 47 MB,
 * because a bundle carrying both trees still runs perfectly.
 */
export function bundledPythonTrees(appPath, { listDir = readdirSync } = {}) {
	const resources = join(appPath, "Contents", "Resources");
	if (!existsSync(resources)) return [];
	let entries = [];
	try {
		entries = listDir(join(resources, "python-runtime-seed")).map(
			(name) => `python-runtime-seed/${name}`,
		);
	} catch {
		return [];
	}
	return entries.filter((name) => BUNDLED_PYTHON_TREES.includes(name));
}

const LIPO = "/usr/bin/lipo";

/**
 * The interpreter directory each architecture resolves, from
 * `backend-installer.ts` `findPython`. A directory *absent* from this map is a
 * failure rather than a default: with a fallback the check would demand `python`
 * of an architecture nobody has mapped, and a third architecture is exactly the
 * case where the answer should be someone looking at this file rather than a
 * guess that happens to pass.
 */
const INTERPRETER_BY_ARCH = {
	arm64: seedResourceDir("arm64"),
	x86_64: seedResourceDir("x64"),
};

/**
 * A `lipo` architecture name as the artifact filename spells it.
 *
 * `lipo` says `x86_64` and `mac.artifactName` says `x64`; translating in one
 * place is what keeps the comparison in `bundledPythonCheck` from having to
 * know both spellings. An unrecognised name is passed through unchanged, so it
 * fails the comparison with both values named rather than matching by accident.
 */
const ARTIFACT_ARCH_NAMES = { x86_64: "x64" };
function toArtifactArch(arch) {
	return ARTIFACT_ARCH_NAMES[arch] ?? arch;
}

/**
 * The architecture a packaged app runs as, read from the bundle itself.
 *
 * `lipo -archs` on the framework binary rather than on the launcher: the path is
 * fixed in every Electron bundle (`Contents/MacOS/<product>` needs the
 * `CFBundleExecutable` name first), and the answer is the same. Both are thin in
 * a per-architecture app; a fat answer means the bundle is not one, which the
 * caller reports rather than rounding to a nearby architecture.
 */
export function bundleArchitectures(appPath, { run = spawnRunner } = {}) {
	const binary = join(
		appPath,
		"Contents",
		"Frameworks",
		"Electron Framework.framework",
		"Versions",
		"A",
		"Electron Framework",
	);
	if (!existsSync(binary)) {
		return { archs: [], error: `no framework binary at ${binary}` };
	}
	const result = run(LIPO, ["-archs", binary]);
	const archs = `${result.stdout}`.trim().split(/\s+/).filter(Boolean);
	if (result.status !== 0 || archs.length === 0) {
		return { archs: [], error: `lipo could not read ${binary}` };
	}
	return { archs };
}

/**
 * A failure entry in the same shape as the other checks.
 *
 * Both halves are asserted for a reason: "exactly one tree" without "the right
 * tree" passes for an arm64 bundle that pruned the aarch64 interpreter and kept
 * the x86_64 one, which is a bundle that cannot start its backend at all. The
 * expected directory name is the one `backend-installer.ts` probes for the
 * architecture the bundle actually is.
 */
export function bundledPythonCheck(appPath, options = {}) {
	const trees = bundledPythonTrees(appPath, options);
	const { archs, error } = bundleArchitectures(appPath, options);
	// The architecture the container's own NAME claims, which is the only place
	// that statement exists: an artifact whose app disagrees with its filename is
	// wrong for whichever machines the name was meant to serve, and nothing inside
	// the app can tell. `null` (an unpacked `dist` app) asks for no cross-check.
	const expectArch = options.expectArch ?? null;
	const describe = (trees.length === 0 ? ["none"] : trees)
		.map((name) => `Contents/Resources/${name}`)
		.join(", ");
	const fail = (output) => ({
		id: "app-one-bundled-python",
		scope: "app",
		target: appPath,
		description: "the bundled python interpreter tree this architecture needs",
		passed: false,
		output,
	});
	if (error != null)
		return fail(`${error}; cannot tell which interpreter this app needs`);
	if (archs.length !== 1)
		return fail(
			`the app is ${archs.join(" + ")} (not a single architecture); a fat bundle needs both interpreters, and mac.target builds one per architecture`,
		);
	if (!Object.hasOwn(INTERPRETER_BY_ARCH, archs[0]))
		return fail(
			`the app is ${archs[0]}, which no bundled interpreter matches; mac.target builds arm64 and x64`,
		);
	if (expectArch != null && toArtifactArch(archs[0]) !== expectArch)
		return fail(
			`the artifact names ${expectArch} but the app inside it is ${archs[0]}; it installs on the build machine and cannot start on the one it was built for`,
		);
	const expected = INTERPRETER_BY_ARCH[archs[0]];
	if (trees.length !== 1 || trees[0] !== expected)
		return fail(
			`the ${archs[0]} app ships ${describe}, but it resolves Contents/Resources/${expected}`,
		);
	return {
		id: "app-one-bundled-python",
		scope: "app",
		target: appPath,
		description: "the bundled python interpreter tree this architecture needs",
		passed: true,
		output: `${archs[0]} app ships only Contents/Resources/${expected}`,
	};
}

/**
 * Bytecode the bundled interpreters must not ship, as a check of its own.
 *
 * Why this exists: this is the check that would have caught 0.17.0/0.18.0
 * before upload. The app bundles a standalone CPython as an `extraResource`,
 * and CPython rewrites a `.pyc` whose recorded source mtime does not match the
 * source - which packaging and installing guarantee, since both reset `.py`
 * mtimes. So any `.pyc` that ships is stale by construction and is rewritten
 * on the user's first launch, inside the code-sealed `.app`. Measured on the
 * shipped 0.17.0 image: exactly 3 `.pyc`, all under
 * `python_aarch64/lib/python3.12/encodings/__pycache__`, recording source mtime
 * 1748584453 against sources carrying 1789072763. The rewrite of one of those is
 * a `file modified:` violation, which no update-time heal can undo, so the
 * bundle is stuck on the reinstall remedy - while a bundle that shipped nothing
 * would only ever have `file added:` violations, which the pre-flight does heal.
 *
 * A filesystem walk rather than `codesign` output on purpose: this has to fail
 * on the artifact as built, before it is signed, and it has to name the paths.
 */
export function findBundledBytecode(appPath, { walk = defaultWalk } = {}) {
	const found = [];
	for (const name of BUNDLED_PYTHON_TREES) {
		const root = join(appPath, "Contents", "Resources", name);
		if (!existsSync(root)) continue;
		for (const relative of walk(root)) {
			const base = relative.split(/[\\/]/).pop() ?? relative;
			if (base.endsWith(".pyc") || base.endsWith(".pyo")) {
				found.push(join(root, relative));
			}
		}
	}
	return found;
}

/** Every file under `root`, relative to it. */
function defaultWalk(root, relative = "") {
	const files = [];
	for (const entry of readdirSync(join(root, relative), {
		withFileTypes: true,
	})) {
		const child = relative ? join(relative, entry.name) : entry.name;
		if (entry.isDirectory()) files.push(...defaultWalk(root, child));
		else files.push(child);
	}
	return files;
}

/**
 * The three seed checks, and why they are assertions rather than prose in a
 * document.
 *
 * A seed change fails SILENTLY in the direction that costs the release: the
 * interpreter still runs, the app still starts, and the only symptom is that
 * every user downloads and extracts the content the change was made to remove.
 * The pruned paths are the sharpest case - "the pruned paths are absent" is
 * trivially true for a tree where they were never spelled the same way again,
 * which is what a Python version bump does. So each check asserts what the
 * packaged bundle must still contain as well as what it must not, and the pair
 * fails loudly when either half stops holding.
 *
 * They live beside `bundledPythonCheck` rather than with the artifact-layout
 * checks because each one walks a tree the build assembled, which is what this
 * file's app checks do; the artifact-layout module reads containers.
 */

/** A check result in the shape this file's app checks use. */
function appCheck(id, appPath, description, work) {
	try {
		return {
			id,
			scope: "app",
			target: appPath,
			description,
			passed: true,
			output: work() ?? "",
		};
	} catch (error) {
		return {
			id,
			scope: "app",
			target: appPath,
			description,
			passed: false,
			output: error.message,
		};
	}
}

/** The architecture seed directory a packaged app carries.
 *
 * `null` when the app carries none or several: which one it *should* carry is
 * `privatePythonSeedCheck`'s assertion (one directory, matching the artifact's
 * own architecture), and answering it a second time here is how two checks come
 * to disagree. Each caller turns a missing root into a failing check naming it.
 */
export function seedRoot(appPath) {
	try {
		const parent = join(appPath, "Contents", "Resources", LAYOUT.seedNamespace);
		const names = readdirSync(parent).filter((name) =>
			LAYOUT.architectures.includes(name),
		);
		return names.length === 1 ? join(parent, names[0]) : null;
	} catch {
		return null;
	}
}

/** `lstat` without a throw: `existsSync` answers false for a dangling symlink,
 * and a dangling symlink is content the bundle must not carry either. */
function lstatOrNull(path) {
	try {
		return lstatSync(path);
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}

/** The standard-library directory, derived from the marker rather than spelled
 * again: the marker is the one place the seed's Python version is written, so a
 * second `lib/python3.12` literal here would be the copy that goes stale. */
const STDLIB_RELATIVE = dirname(dirname(SEED_STDLIB_MARKER));

/** The seed content no import can reach, which the build must remove. */
export function prunedSeedCheck(appPath) {
	return appCheck(
		"app-pruned-python-seed",
		appPath,
		"the seed content no import can reach stays out of the bundle",
		() => {
			const root = seedRoot(appPath);
			if (root == null)
				throw new Error(
					`No single Contents/Resources/${LAYOUT.seedNamespace}/<arch> directory to check`,
				);
			const back = PRUNED_SEED_PATHS.filter(
				(relative) => lstatOrNull(join(root, relative)) !== null,
			);
			if (back.length > 0)
				throw new Error(
					`${back.length} pruned path(s) are back under the seed: ${back.join(", ")}. scripts/setup-python-resource.sh runs scripts/prune-python-seed.mjs; a build that skips it ships them again.`,
				);
			return `${PRUNED_SEED_PATHS.length} pruned path(s) absent`;
		},
	);
}

/** Execute bits under the seed, which only a Mach-O file may carry.
 *
 * The count is asserted beside the predicate because the predicate alone is
 * satisfied by a seed with no execute bit anywhere - including the interpreter
 * itself, which the app executes through its managed copy. */
export function seedModeCheck(appPath) {
	return appCheck(
		"app-seed-exec-bits",
		appPath,
		"every execute bit under the seed belongs to a Mach-O file",
		() => {
			const root = seedRoot(appPath);
			if (root == null)
				throw new Error(
					`No single Contents/Resources/${LAYOUT.seedNamespace}/<arch> directory to check`,
				);
			const violations = seedModeViolations(root);
			if (violations.length > 0)
				throw new Error(
					`${violations.length} seed file(s) carry an execute bit without a Mach-O header: ${violations.slice(0, 4).join(", ")}${violations.length > 4 ? ` (and ${violations.length - 4} more)` : ""}`,
				);
			const execBits = seedExecBitFiles(root).length;
			const machO = machOFiles(root).length;
			if (machO === 0)
				throw new Error(
					"No Mach-O file under the seed at all: the interpreter and its library are gone",
				);
			if (execBits !== machO)
				throw new Error(
					`${execBits} seed file(s) carry an execute bit but ${machO} are Mach-O; the two counts must agree`,
				);
			return `${machO} Mach-O file(s), each carrying the execute bit and nothing else`;
		},
	);
}

/** The bootstrap a venv is built from, which the pruning must not reach.
 *
 * `macos-install-script.sh` creates its venv with `-m venv` and then asserts
 * `bin/pip` exists, and the pip there comes from `ensurepip`'s bundled wheel -
 * not from the seed's own `site-packages`, whose pip is a different, older
 * version (measured: the venv built from the pruned seed reports pip 25.0.1
 * from `ensurepip/_bundled/pip-25.0.1-py3-none-any.whl`, while the seed's own
 * `site-packages` carries 24.3.1). Both halves are asserted, with the
 * interpreter itself, because the failure this catches is a future prune that
 * looks tidy and leaves an install with no pip to install from. */
export function seedBootstrapCheck(appPath) {
	return appCheck(
		"app-seed-venv-bootstrap",
		appPath,
		"the seed can still build a venv with pip",
		() => {
			const root = seedRoot(appPath);
			if (root == null)
				throw new Error(
					`No single Contents/Resources/${LAYOUT.seedNamespace}/<arch> directory to check`,
				);
			const missing = [];
			for (const relative of [
				"bin/python3",
				`${STDLIB_RELATIVE}/venv/__init__.py`,
			])
				if (!existsSync(join(root, relative))) missing.push(relative);
			let wheels = [];
			try {
				wheels = readdirSync(
					join(root, STDLIB_RELATIVE, "ensurepip", "_bundled"),
				).filter((name) => /^pip-.*\.whl$/.test(name));
			} catch {
				// Reported as a missing path below rather than as a thrown error, so
				// one failing check names every half that is absent.
			}
			if (wheels.length === 0)
				missing.push(`${STDLIB_RELATIVE}/ensurepip/_bundled/pip-*.whl`);
			if (missing.length > 0)
				throw new Error(`the seed cannot build a venv: ${missing.join(", ")}`);
			return `venv bootstrap present (${wheels.join(", ")})`;
		},
	);
}

/** A failure entry shaped like the other checks, so the CLI reports it alike. */
export function bundledBytecodeCheck(appPath, options = {}) {
	const found = findBundledBytecode(appPath, options);
	return {
		id: "app-no-bundled-bytecode",
		scope: "app",
		target: appPath,
		description: "no .pyc/.pyo in the bundled python trees",
		passed: found.length === 0,
		output:
			found.length === 0
				? `no bytecode under Contents/Resources/${BUNDLED_PYTHON_TREES.join(", ")}`
				: `${found.length} stale bytecode file(s): ${found.slice(0, 4).join(", ")}${found.length > 4 ? ` (and ${found.length - 4} more)` : ""}`,
	};
}

/*
 * The bundled-interpreter seal check that used to live here is gone with the
 * mechanism it asserted. It was a write probe over `Contents/Resources/python
 * [/_aarch64]`, and it could not hold: `ditto` carries an access-control entry
 * but the ZIP Squirrel stages does not, so the bundle a user updates *into* is
 * unsealed by construction. The invariant that replaces it is structural and
 * checkable on any container - the interpreter ships as inert data under
 * `python-runtime-seed/<arch>` and no legacy resource name exists beside it
 * (`privatePythonSeedCheck` in `python-artifact-layout.mjs`), so there is no
 * tree in the bundle for a venv to resolve into.
 */

/** Run each check with the given runner and judge it. */
export function runChecks({ appPath, dmgPath, run }) {
	return artifactChecks({ appPath, dmgPath }).map((check) => {
		const result = run(check.command, check.args);
		const passed = check.expect(result);
		return {
			id: check.id,
			scope: check.scope,
			description: check.description,
			target: check.target,
			passed,
			output: [result.stdout, result.stderr]
				.join("\n")
				.trim()
				.split("\n")
				.filter((line) => line.trim().length > 0)
				.slice(0, 4)
				.join(" | "),
		};
	});
}

export function summarize(results) {
	const failures = results.filter((result) => !result.passed);
	return { ok: failures.length === 0, failures };
}

/**
 * Everything under `dist` the gate is responsible for.
 *
 * Why a plural discovery rather than "the first match": `mac.target` builds a
 * dmg and a zip for each architecture, so asserting only the first image was
 * complete by accident rather than by construction, and a malformed bundle or
 * image for a second architecture would have shipped unaudited (review R9).
 *
 * Each entry is inspected inside a try/catch: a broken symlink where an image
 * should be is a failing check with a reason, not an exception out of discovery.
 */
export function discoverArtifacts(distDir, { listDir = readdirSync } = {}) {
	const apps = [];
	const dmgs = [];
	const zips = [];
	const errors = [];
	if (!existsSync(distDir)) return { apps, dmgs, errors };

	let entries = [];
	try {
		entries = listDir(distDir);
	} catch (error) {
		errors.push(`${distDir}: ${error.message ?? String(error)}`);
		return { apps, dmgs, errors };
	}

	for (const entry of entries) {
		if (entry.endsWith(".zip")) {
			zips.push(join(distDir, entry));
			continue;
		}
		if (entry.endsWith(".dmg")) {
			dmgs.push(join(distDir, entry));
			continue;
		}
		if (!entry.startsWith("mac")) continue;
		const candidate = join(distDir, entry);
		try {
			if (!statSync(candidate).isDirectory()) continue;
			for (const inner of listDir(candidate)) {
				if (!inner.endsWith(".app")) continue;
				const appPath = join(candidate, inner);
				// statSync, not existsSync: a dangling symlink where a bundle should be
				// is a discovery failure with a reason, rather than a candidate that
				// silently disappears from the set to be checked (review R9).
				try {
					if (statSync(appPath)) apps.push(appPath);
				} catch (error) {
					errors.push(`${appPath}: ${error.message ?? String(error)}`);
				}
			}
		} catch (error) {
			errors.push(`${candidate}: ${error.message ?? String(error)}`);
		}
	}
	return { apps, dmgs, zips, errors };
}

/** The first packaged app inside a `dist` directory, if the build produced one. */
export function discoverApp(distDir, options = {}) {
	return discoverArtifacts(distDir, options).apps[0] ?? null;
}

export function discoverDmg(distDir, options = {}) {
	return discoverArtifacts(distDir, options).dmgs[0] ?? null;
}

/** `spawnSync` runner: the real thing, used by the CLI.
 *
 * `input` exists for one caller - the disk image's license agreement, which
 * `hdiutil` reads from stdin and refuses to mount without - and is threaded
 * through rather than worked around with a `yes |` shell, so the checker keeps
 * spawning the tool it names and nothing else.
 */
export function spawnRunner(command, args, input = undefined) {
	const result = spawnSync(command, args, { encoding: "utf8", input });
	return {
		status: result.status ?? 1,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? result.error?.message ?? "",
	};
}

function parseArgs(argv) {
	const args = { dist: "dist", app: null, dmg: null };
	for (let index = 0; index < argv.length; index++) {
		if (argv[index] === "--dist") args.dist = argv[index + 1];
		if (argv[index] === "--app") args.app = argv[index + 1];
		if (argv[index] === "--dmg") args.dmg = argv[index + 1];
	}
	return args;
}

export function verifyArtifacts({
	dist = "dist",
	app = null,
	dmg = null,
	run = spawnRunner,
	log = console.log,
} = {}) {
	const discovered = discoverArtifacts(dist);
	const appPaths = app ? [app] : discovered.apps;
	const dmgPaths = dmg ? [dmg] : discovered.dmgs;

	const problems = [];
	if (appPaths.length === 0)
		problems.push(`No packaged app found under ${dist}`);
	if (dmgPaths.length === 0) problems.push(`No disk image found under ${dist}`);
	for (const error of discovered.errors) {
		problems.push(`An artifact under ${dist} could not be read: ${error}`);
	}
	if (problems.length > 0) {
		for (const problem of problems) log(problem);
		return { ok: false, results: [] };
	}

	/*
	 * Every image is asserted, and the app checks run against each app bundle:
	 * the whole point of this gate is that no artifact reaches a release without
	 * having been asked the questions a user's Gatekeeper asks.
	 *
	 * `arch` is what the container's filename claims (see `artifactArch`), so the
	 * app extracted from a `-x64.zip` is held to being an x64 app; it is `null`
	 * for an unpacked `dist` app, whose own architecture is the only statement
	 * there is.
	 */
	const results = [];
	const checkApp = (path, arch = null) => [
		...runChecks({ appPath: path, dmgPath: null, run }),
		bundledBytecodeCheck(path),
		bundledPythonCheck(path, { run, expectArch: arch }),
		privatePythonSeedCheck(path, { expectArch: arch }),
		// The three halves of the seed's weight, each asserted where the build
		// assembled it: the content nothing imports, the execute bits that mean
		// nothing in a bundle, and the venv bootstrap the pruning must not have
		// reached.
		prunedSeedCheck(path),
		seedModeCheck(path),
		seedBootstrapCheck(path),
	];
	for (const appPath of appPaths) {
		if (!existsSync(appPath)) {
			log(`No packaged app at ${appPath}`);
			return { ok: false, results: [] };
		}
		log(`Checking app: ${appPath}`);
		results.push(...runChecks({ appPath, dmgPath: null, run }));
		// Neither of the next six is a `codesign` question: all are about what the
		// build assembled, and they fail with the offending paths so the fix is
		// obvious.
		results.push(bundledBytecodeCheck(appPath));
		results.push(bundledPythonCheck(appPath, { run }));
		results.push(privatePythonSeedCheck(appPath));
		results.push(prunedSeedCheck(appPath));
		results.push(seedModeCheck(appPath));
		results.push(seedBootstrapCheck(appPath));
	}
	for (const dmgPath of dmgPaths) {
		if (!existsSync(dmgPath)) {
			log(`No disk image at ${dmgPath}`);
			return { ok: false, results: [] };
		}
		log(`Checking disk image: ${dmgPath}`);
		results.push(...runChecks({ appPath: null, dmgPath, run }));
		results.push(...finalContainerChecks(dmgPath, { run, checkApp }));
	}
	for (const zip of discovered.zips ?? [])
		results.push(...finalContainerChecks(zip, { run, checkApp }));
	if (!app && !dmg) {
		if (!discovered.zips?.length)
			results.push({
				id: "final-zip-required",
				passed: false,
				description: "in-app update ZIP exists",
				output: "No ZIP found",
			});
		results.push(
			...finalMetadataChecks(dist, [...dmgPaths, ...(discovered.zips ?? [])]),
		);
	}

	for (const result of results) {
		log(
			`${result.passed ? "PASS" : "FAIL"} ${result.id}: ${result.description}${result.passed ? "" : ` -> ${result.output}`}`,
		);
	}
	const { ok, failures } = summarize(results);
	if (!ok) {
		log(
			`\n${failures.length} of ${results.length} artifact checks failed. The release must not be published until every check above passes.`,
		);
		// The bytecode check is the one whose remedy is in the build rather than in
		// the signing step, so its remedy is named here - a message that says only
		// "signing failed" would send the reader looking in the wrong place.
		const bytecode = failures.find(
			(result) => result.id === "app-no-bundled-bytecode",
		);
		if (bytecode) {
			log(
				`The app ships the bundled interpreter's stale bytecode: ${bytecode.output}. Run scripts/setup-python-resource.sh, or delete the __pycache__ directories under Contents/Resources/python[_aarch64], before building.`,
			);
		}
		const interpreters = failures.find(
			(result) => result.id === "app-one-bundled-python",
		);
		if (interpreters) {
			log(
				`The app does not ship the bundled interpreter its architecture needs: ${interpreters.output}. The afterPack step in scripts/prune-python-resource.mjs keeps only that tree, and it runs before signing, so fix the build rather than the bundle.`,
			);
		}
		// Both remedies below are in the seeding step rather than in the signing
		// step, so they are named here: a reader sent looking at signatures would be
		// looking in the wrong place.
		const seed = failures.find((result) =>
			["app-pruned-python-seed", "app-seed-exec-bits"].includes(result.id),
		);
		if (seed) {
			log(
				`The bundled seed is not the pruned one: ${seed.output}. scripts/setup-python-resource.sh runs scripts/prune-python-seed.mjs over the tree it downloads, so fix the build rather than the bundle.`,
			);
		}
	}
	return { ok, results };
}

// Through `scripts/entry-point.mjs`, not a lexical comparison of
// `process.argv[1]`: reached through a symlinked path this file used to load, run
// nothing and exit 0, and `publish.yml`'s artifact gate reads that status as a
// pass — a failing gate becoming a passing one.
if (isEntryPoint(import.meta.url)) {
	const args = parseArgs(process.argv.slice(2));
	const { ok } = verifyArtifacts(args);
	process.exit(ok ? 0 : 1);
}
