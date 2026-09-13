#!/usr/bin/env node
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
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CODESIGN = "/usr/bin/codesign";
const SPCTL = "/usr/sbin/spctl";
const XCRUN = "/usr/bin/xcrun";

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

/** The directory names the two bundled interpreters occupy, in app resources. */
const BUNDLED_PYTHON_TREES = ["python", "python_aarch64"];

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
		entries = listDir(resources);
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
const INTERPRETER_BY_ARCH = { arm64: "python_aarch64", x86_64: "python" };

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
	if (error != null) return fail(`${error}; cannot tell which interpreter this app needs`);
	if (archs.length !== 1)
		return fail(
			`the app is ${archs.join(" + ")} (not a single architecture); a fat bundle needs both interpreters, and mac.target builds one per architecture`,
		);
	if (!Object.hasOwn(INTERPRETER_BY_ARCH, archs[0]))
		return fail(
			`the app is ${archs[0]}, which no bundled interpreter matches; mac.target builds arm64 and x64`,
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
export function findBundledBytecode(
	appPath,
	{ walk = defaultWalk } = {},
) {
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
				? "no bytecode under Contents/Resources/python[/_aarch64]"
				: `${found.length} stale bytecode file(s): ${found.slice(0, 4).join(", ")}${found.length > 4 ? ` (and ${found.length - 4} more)` : ""}`,
	};
}

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
	return { apps, dmgs, errors };
}

/** The first packaged app inside a `dist` directory, if the build produced one. */
export function discoverApp(distDir, options = {}) {
	return discoverArtifacts(distDir, options).apps[0] ?? null;
}

export function discoverDmg(distDir, options = {}) {
	return discoverArtifacts(distDir, options).dmgs[0] ?? null;
}

/** `spawnSync` runner: the real thing, used by the CLI. */
export function spawnRunner(command, args) {
	const result = spawnSync(command, args, { encoding: "utf8" });
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
	if (appPaths.length === 0) problems.push(`No packaged app found under ${dist}`);
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
	 */
	const results = [];
	for (const appPath of appPaths) {
		if (!existsSync(appPath)) {
			log(`No packaged app at ${appPath}`);
			return { ok: false, results: [] };
		}
		log(`Checking app: ${appPath}`);
		results.push(...runChecks({ appPath, dmgPath: null, run }));
		// Neither of the next two is a `codesign` question: both are about what the
		// build assembled, and they fail with the offending paths so the fix is
		// obvious.
		results.push(bundledBytecodeCheck(appPath));
		results.push(bundledPythonCheck(appPath, { run }));
	}
	for (const dmgPath of dmgPaths) {
		if (!existsSync(dmgPath)) {
			log(`No disk image at ${dmgPath}`);
			return { ok: false, results: [] };
		}
		log(`Checking disk image: ${dmgPath}`);
		results.push(...runChecks({ appPath: null, dmgPath, run }));
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
	}
	return { ok, results };
}

const isMain =
	process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
	const args = parseArgs(process.argv.slice(2));
	const { ok } = verifyArtifacts(args);
	process.exit(ok ? 0 : 1);
}
