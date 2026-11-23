/**
 * Which pull-request diffs still need the macOS Native App Proofs lane.
 *
 * WHY THIS EXISTS. `full-suite.yml` runs its classifier with `--all` on the
 * merge-gate path: a label says "run everything", and the whole point of that
 * run is that a label cannot narrow the suite it is asking for. That is right
 * for the desktop suite. It is wrong for `native-proofs`, which was gated on
 * `needs.changes.outputs.pack` — and `pack` under `--all` is always true. The
 * measurable consequence, read from this repository's own runs: 45197525243
 * (`feat/busy-delivery-desktop`) and 45111954815 (`fix/model-picker-footer…
 * both executed `Native App Proofs (macOS)` with a success, for diffs that
 * touch no native surface at all. Every labelled PR therefore spent one capped
 * macOS runner slot before it could merge, and the queue paid for it.
 *
 * WHAT IT IS NOT. This module does not touch `--all`, the desktop suite, or any
 * other job: those keep running the full inventory on a gate run. It answers
 * exactly one question, from the PR's own changed paths — "can a macOS packaged
 * app behave differently because of this diff?" — and `full-suite.yml` reads
 * that answer for `native-proofs` alone.
 *
 * FAIL-CLOSED, DELIBERATELY. The only way to skip the lane is to prove the
 * diff touches none of the surfaces below. An empty list, a missing list, an
 * unreadable file or a diff that could not be computed all mean "unknown", and
 * unknown runs the lane. The cost of being wrong in that direction is one
 * runner slot; the cost of being wrong in the other is a shipped app that
 * breaks on launch, which is what the lane exists to catch.
 *
 * THE RESIDUAL RISK, STATED RATHER THAN HIDDEN. The four proofs launch the
 * PACKED app and capture scenes, so renderer-only diffs can in principle change
 * what a scene shows. They are not in the surface list: the desktop-test shards
 * and the bytecode build cover renderer behaviour, and the proofs' distinctive
 * value is packaging, launch, and native integration (dock badge, notifications,
 * app icon), which is main-process and packaging work. If a renderer-only diff
 * ever breaks a native scene, the fix is one line in `NATIVE_PREFIXES` below —
 * not a redesign.
 *
 * `scripts/` AND `.github/` ARE DERIVED, NOT PREFIXES. Both used to be whole
 * prefixes, so a CI-only diff (#2066: `.github/workflows/ci.yml` plus three
 * `scripts/check-named-test*` / `entry-point.test.mjs` files) still spent a
 * macOS slot. Under those two trees a path is native only when the repository
 * itself says it reaches the packed app or the lane — see
 * `deriveNativeSurfaces` for the three sources and the D14 argument for why
 * the derivation cannot be narrowed by the diff it is judging.
 *
 * Usage::
 *
 *   git diff --name-only "$base" "$head" > "$RUNNER_TEMP/changed.txt"
 *   node scripts/native-scope.mjs --changed-file "$RUNNER_TEMP/changed.txt" \
 *     --github-output "$GITHUB_OUTPUT" --summary "$GITHUB_STEP_SUMMARY"
 *
 *   node scripts/native-scope.mjs --force true      # non-PR event: lane runs
 *   node scripts/native-scope.mjs --changed-file -   # read stdin
 */

import {
	appendFileSync,
	existsSync,
	readFileSync,
	readdirSync,
	statSync,
} from "node:fs";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { MAIN_BUNDLE_PREFIXES, MAIN_BUNDLE_ROOT_FILES } from "./ci-scope.mjs";
import { isEntryPoint } from "./entry-point.mjs";

/**
 * Paths that can change the PACKED app's behaviour, packaging or installation.
 *
 * Prefix match unless the entry ends in a `/`-free filename, in which case it
 * is an exact path. Every entry earns its place: `src/main` owns the Electron
 * main process, where the dock badge, notifications and window lifecycle live;
 * `src/preload` is the bridge every renderer call crosses; `build/` holds the
 * entitlements, icons and afterPack/afterSign hooks electron-builder runs;
 * `resources/` and `bin/` are copied into the artifact; `patches/` rewrites
 * dependencies that ship inside it. `scripts/` and `.github/` are NOT here:
 * they are `DERIVED_PREFIXES`, decided path by path from the repository.
 */
export const NATIVE_PREFIXES = [
	// THE MAIN CHUNK IS NOT RE-DECLARED HERE. `scripts/ci-scope.mjs` already owns
	// the answer to "which paths can change what ships in the main process" -
	// `src/main/`, `src/shared/`, `src/i18n/`, `scripts/vite-plugins/` and the two
	// tsconfigs - because the bytecode job needs exactly that set. A second copy
	// here would drift from it, and the drift is silent: a `src/shared` change
	// reaches the packed main process through 61 importers under `src/main`, and a
	// diff confined to it that skipped the lane would merge with no launch proof.
	...MAIN_BUNDLE_PREFIXES,
	// `src/preload/` is its own bundle, and `ci-scope.mjs` omits it because the
	// bytecode job is about the MAIN chunk. The lane is not: every renderer call
	// into a native capability crosses the preload bridge, so a diff confined to
	// it can change what a signed app does while no other per-PR job launches it.
	"src/preload/",
	// What the packaging and installation path adds on top: the entitlements,
	// icons and afterPack/afterSign hooks electron-builder runs; the trees copied
	// into the artifact or patched inside it; and the scripts and workflow that
	// drive the pack, the launch and the scenes.
	"build/",
	"resources/",
	"bin/",
	"patches/",
];

/**
 * Trees whose paths are native only when `deriveNativeSurfaces` names them.
 *
 * Everything else under them — CI-only helpers, `*.test.mjs` files the lane
 * never executes, other workflows — cannot change the packed app or what the
 * lane does, so spending a macOS slot on them proves nothing. If the derivation
 * cannot be completed, every path under these trees is native again.
 */
export const DERIVED_PREFIXES = ["scripts/", ".github/"];

/** The workflow that defines the lane, and the jobs in it that gate the lane. */
export const LANE_WORKFLOW = ".github/workflows/full-suite.yml";
/**
 * `changes` decides whether the lane runs (it executes this classifier),
 * `native-proofs` IS the lane, and `merge-gate` decides whether a skipped lane
 * is acceptable. Together they are the gating for this lane, so every script
 * any of them executes stays native: a diff that edits the classifier, the
 * lane's rig or the verdict cannot select itself out of the proof.
 */
export const LANE_GATING_JOBS = ["changes", "native-proofs", "merge-gate"];
/** Exact files whose change can repackage or re-sign the app. */
export const NATIVE_EXACT = new Set([
	// Root files the main chunk's shape depends on, from the same classifier.
	...MAIN_BUNDLE_ROOT_FILES,
	"package.json",
	"pnpm-lock.yaml",
	"pnpm-workspace.yaml",
	"electron.vite.config.mjs",
	"electron-builder.yml",
	"electron-builder.json",
	"electron-builder.json5",
	"forge.config.js",
	"forge.config.mjs",
]);

/** Name fragments: builder/forge configs and native binaries by extension. */
export const NATIVE_SUFFIXES = [
	".entitlements",
	".plist",
	".node",
	".dylib",
	".jsc",
];

const LEADING_DOT_SLASH = /^\.\//;

/** The repository this module lives in; the CLI resolves from here, not cwd. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// A repository-relative script path named in a workflow `run:` body or a
// package.json script, e.g. `node scripts/x.mjs` or `"./scripts/x.mjs"` inside
// a `node -e` import. `bin/` is matched too so its imports into `scripts/` are
// walked; membership is still filtered to DERIVED_PREFIXES.
const SCRIPT_TOKEN =
	/(?<![\w./-])(?:\.\/)?((?:scripts|bin)\/[\w@+./-]*?\.(?:mjs|cjs|js|mts|cts|ts|sh|py|json))(?![\w/-])/gu;
const LOCAL_USES = /^\s*-?\s*uses:\s*['"]?\.\/([^\s'"#]+)/u;
// `pnpm run x`, `pnpm x`, `npm run x`, `npm pack`, `yarn x` …
const PACKAGE_RUNNER =
	/\b(?:pnpm|npm|yarn)\s+(?:--?[\w-]+(?:=\S+)?\s+)*(?:run(?:-script)?\s+)?([\w:.-]+)/gu;
// Built-in package-manager commands and the lifecycle scripts they run. These
// are the hooks a lane can execute without naming a script file: the lane's
// `pnpm install` runs `postinstall`/`prepare`, its `npm pack` runs `prepack`.
const LIFECYCLE = {
	install: ["preinstall", "install", "postinstall", "prepare"],
	i: ["preinstall", "install", "postinstall", "prepare"],
	ci: ["preinstall", "install", "postinstall", "prepare"],
	add: ["preinstall", "install", "postinstall", "prepare"],
	pack: ["prepack", "prepare", "postpack"],
	publish: ["prepublishOnly", "prepack", "prepare", "postpack", "publish"],
};
// Static module edges a script can take to another repository file.
const IMPORT_EDGES = [
	/\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/gu,
	/\bimport\s*['"](\.{1,2}\/[^'"]+)['"]/gu,
	/\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/gu,
	/\brequire\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/gu,
];
const RESOLVE_SUFFIXES = [
	"",
	".mjs",
	".js",
	".cjs",
	".ts",
	".mts",
	".json",
	"/index.mjs",
	"/index.js",
	"/index.ts",
];
const WALKABLE = /\.(?:mjs|cjs|js|mts|cts|ts)$/u;
// A string literal naming a non-JS helper a script spawns, e.g.
// `join(SCRIPT_ROOT, "model_uncertainty_backend.py")` in the lane's
// model-uncertainty rig. Not an import, so IMPORT_EDGES cannot see it; it
// counts when the named file exists beside the script or from the root.
// Deliberately NOT JS or JSON: inventory scripts the gating jobs import name
// every test file as a literal, and following those made 1,337 paths native
// (measured), i.e. the old whole-prefix behaviour by another route.
const FILE_LITERAL = /["'`]((?:\.{0,2}\/)?[\w@+./-]+\.(?:py|sh))["'`]/gu;
// A Python helper's sibling-module imports (`import x`, `from x import y`).
const PYTHON_IMPORT = /^\s*(?:from|import)\s+([A-Za-z_]\w*)/gmu;
// Package scripts that build, pack, sign or notarize the artifact.
const PACKAGING_SCRIPT_NAME =
	/^(?:pre|post)?(?:build|pack|dist|release)(?::|$)|notar|sign/u;
const PACKAGING_COMMAND = /\belectron-(?:builder|vite)\b/u;

function toRelative(root, absolute) {
	const rel = relative(root, absolute);
	if (!rel || rel.startsWith("..") || rel.startsWith(sep)) return "";
	return rel.split(sep).join("/");
}

function isFile(path) {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

/**
 * The body of one top-level job in a workflow, with full-line comments removed.
 *
 * Line-based on purpose: the `changes` job runs this before any install, so a
 * YAML library is not available, and the job layout (`jobs:` children at two
 * spaces) is what GitHub itself requires. A job that cannot be found returns
 * `null`, which the caller treats as a failed derivation.
 */
export function jobBody(workflowText, jobName) {
	const lines = workflowText.split("\n");
	const start = lines.findIndex((line) =>
		new RegExp(
			`^  ${jobName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}:\\s*$`,
			"u",
		).test(line),
	);
	if (start < 0) return null;
	const body = [];
	for (const line of lines.slice(start + 1)) {
		if (/^ {0,2}\S/u.test(line)) break;
		if (/^\s*#/u.test(line)) continue;
		body.push(line);
	}
	return body.join("\n");
}

/**
 * Which paths under `scripts/` and `.github/` can change the packed app or the
 * native lane, read from the repository at `root`.
 *
 * The union of three sources, each read rather than restated:
 *  (a) SHIPPED: `package.json` `files`, electron-builder `build.files`,
 *      `extraResources`/`extraFiles`/`asarUnpack` (any platform section);
 *  (b) BUILD/PACK/SIGN: electron-builder hooks (any `build` string naming a
 *      script, e.g. `afterPack`, `afterSign`) and every script reachable from
 *      the package scripts that build, pack, dist, release, sign or notarize,
 *      including their `pre`/`post` hooks and `electron-vite`'s config;
 *  (c) THE LANE'S OWN RIG: every script the `LANE_GATING_JOBS` of
 *      `full-suite.yml` execute — named in a `run:` body, reached through a
 *      `pnpm`/`npm` script or lifecycle hook the job runs, or inside a local
 *      composite action the job `uses:` (whose whole directory is native).
 * Each seed's static relative imports are then followed transitively.
 *
 * WHY THIS KEEPS D14 ("a diff touching the gating cannot narrow itself"). Every
 * input this function reads is itself native: `full-suite.yml` (the gating for
 * THIS lane), `package.json`, the composite actions, `electron.vite.config.js`
 * and every file whose imports were walked are all in the result or in the
 * static lists. So the only way to shrink the derived set is a diff that
 * touches a file in it — and that diff selects the lane. `native-scope.mjs`
 * and its imports are in it because the `changes` job executes them.
 *
 * FAIL-CLOSED. Unreadable or unparseable `package.json` / `full-suite.yml`, a
 * gating job missing from the workflow, or a lane job that names no script at
 * all yields `{ ok: false }`, and `isNativeSurface` then treats every path
 * under `DERIVED_PREFIXES` as native.
 *
 * Beyond imports, a walked file's string literals that name an existing `.py`
 * or `.sh` helper (beside it or from the root) are followed, and Python helpers follow their
 * sibling-module imports — the lane's model-uncertainty rig runs
 * `scripts/model_uncertainty_backend.py` by `join(SCRIPT_ROOT, "…py")`.
 *
 * Residual risk, stated: a path a rig assembles from pieces (no literal names
 * the whole file, e.g. `join("scripts", dir, name)`) is not seen.
 */
export function deriveNativeSurfaces(root = REPO_ROOT) {
	const files = new Set();
	const prefixes = new Set();
	const errors = [];
	const fail = (message) => ({
		ok: false,
		files,
		prefixes: [...prefixes],
		errors: [...errors, message],
	});

	let pkg;
	try {
		pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
		if (!pkg || typeof pkg !== "object") throw new Error("not an object");
	} catch (error) {
		return fail(`package.json unreadable or unparseable (${error.message})`);
	}
	let workflow;
	try {
		workflow = readFileSync(join(root, LANE_WORKFLOW), "utf8");
	} catch (error) {
		return fail(`${LANE_WORKFLOW} unreadable (${error.message})`);
	}

	const scripts =
		pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
	const seeds = new Set();
	const visitedScripts = new Set();

	const addPath = (raw) => {
		const path = normalize(raw.replace(LEADING_DOT_SLASH, ""))
			.split(sep)
			.join("/");
		if (!path || path.startsWith("..")) return;
		seeds.add(path);
	};
	const addPrefix = (raw) => {
		const path = raw.replace(LEADING_DOT_SLASH, "").replace(/\/+$/u, "");
		if (path) prefixes.add(`${path}/`);
	};

	// Every package script, lifecycle hook and file a command line names.
	const scanCommand = (text) => {
		for (const match of text.matchAll(SCRIPT_TOKEN)) addPath(match[1]);
		if (/\belectron-vite\b/u.test(text)) {
			for (const name of [
				"electron.vite.config.js",
				"electron.vite.config.mjs",
				"electron.vite.config.ts",
			]) {
				if (isFile(join(root, name))) addPath(name);
			}
		}
		for (const match of text.matchAll(PACKAGE_RUNNER)) {
			const name = match[1];
			const explicitRun = /\brun(?:-script)?\s+$/u.test(
				match[0].slice(0, match[0].length - name.length),
			);
			if (!explicitRun && LIFECYCLE[name]) {
				for (const hook of LIFECYCLE[name]) runScript(hook);
			} else runScript(name);
		}
	};
	const runScript = (name) => {
		if (visitedScripts.has(name)) return;
		visitedScripts.add(name);
		for (const key of [`pre${name}`, name, `post${name}`]) {
			if (typeof scripts[key] !== "string") continue;
			if (key !== name) visitedScripts.add(key);
			scanCommand(scripts[key]);
		}
	};

	// (a) Shipped trees and files.
	const shippedEntries = [];
	const collectShipped = (section) => {
		if (!section || typeof section !== "object") return;
		// Only `files` trees are walked for imports: they hold the app's own JS
		// (`bin/`). The resource trees are binaries and runtimes (resources/python
		// is thousands of files) and contribute membership only.
		for (const key of ["files", "asarUnpack", "extraResources", "extraFiles"]) {
			const value = section[key];
			const list = Array.isArray(value) ? value : value ? [value] : [];
			for (const entry of list) {
				const path =
					typeof entry === "string"
						? entry
						: entry && typeof entry.from === "string"
							? entry.from
							: "";
				if (path) shippedEntries.push({ path, walk: key === "files" });
			}
		}
	};
	collectShipped(pkg);
	const build = pkg.build && typeof pkg.build === "object" ? pkg.build : {};
	collectShipped(build);
	for (const section of Object.values(build)) collectShipped(section);
	for (const { path: entry, walk } of shippedEntries) {
		if (entry.startsWith("!") || entry.includes("node_modules")) continue;
		// `scripts/x/**/*` -> `scripts/x`: the tree the glob ships.
		const base = entry
			.replace(LEADING_DOT_SLASH, "")
			.replace(/\/?\*.*$/u, "")
			.replace(/\/+$/u, "");
		if (!base) continue;
		const absolute = join(root, base);
		if (isFile(absolute)) addPath(base);
		else {
			addPrefix(base);
			// Walk the shipped tree's own modules so a `bin/` file that requires
			// `../scripts/x.js` makes that file native too. Only JS is listed, and
			// only for trees that exist in this checkout (`out/` is a build output).
			const stack = walk && existsSync(absolute) ? [absolute] : [];
			while (stack.length) {
				const dir = stack.pop();
				let entries = [];
				try {
					entries = readdirSync(dir, { withFileTypes: true });
				} catch {
					continue;
				}
				for (const dirent of entries) {
					if (dirent.name === "node_modules") continue;
					const child = join(dir, dirent.name);
					if (dirent.isDirectory()) stack.push(child);
					else if (WALKABLE.test(dirent.name)) {
						const rel = toRelative(root, child);
						if (rel) addPath(rel);
					}
				}
			}
		}
	}

	// (b) electron-builder hooks: any string in `build` naming a script file.
	const walkBuildStrings = (value) => {
		if (typeof value === "string") scanCommand(value);
		else if (Array.isArray(value)) value.forEach(walkBuildStrings);
		else if (value && typeof value === "object")
			Object.values(value).forEach(walkBuildStrings);
	};
	walkBuildStrings(build);
	// (b) Package scripts that build, pack, sign or notarize.
	for (const [name, command] of Object.entries(scripts)) {
		if (name.startsWith("//") || typeof command !== "string") continue;
		if (PACKAGING_SCRIPT_NAME.test(name) || PACKAGING_COMMAND.test(command))
			runScript(name);
	}

	// (c) The gating jobs, and the local composite actions they use.
	let laneNamedAScript = false;
	const visitedActions = new Set();
	const scanWorkflowText = (text) => {
		const before = seeds.size + visitedScripts.size;
		scanCommand(text);
		if (seeds.size + visitedScripts.size > before) laneNamedAScript = true;
		for (const line of text.split("\n")) {
			const uses = LOCAL_USES.exec(line);
			if (!uses) continue;
			const actionDir = uses[1].replace(/\/+$/u, "");
			if (visitedActions.has(actionDir)) continue;
			visitedActions.add(actionDir);
			addPrefix(actionDir);
			for (const name of ["action.yml", "action.yaml"]) {
				const path = join(root, actionDir, name);
				if (!isFile(path)) continue;
				try {
					scanWorkflowText(
						readFileSync(path, "utf8")
							.split("\n")
							.filter((l) => !/^\s*#/u.test(l))
							.join("\n"),
					);
				} catch (error) {
					errors.push(`${actionDir}/${name} unreadable (${error.message})`);
				}
			}
		}
	};
	for (const job of LANE_GATING_JOBS) {
		const body = jobBody(workflow, job);
		if (body === null)
			return fail(`${LANE_WORKFLOW} has no \`${job}\` job to derive from`);
		laneNamedAScript = false;
		scanWorkflowText(body);
		if (job === "native-proofs" && !laneNamedAScript)
			return fail("the native-proofs job names no script: derivation is empty");
	}
	if (errors.length) return fail("a composite action could not be read");

	// Transitive static relative imports from every seed.
	const queue = [...seeds];
	const walked = new Set();
	while (queue.length) {
		const path = queue.shift();
		if (walked.has(path)) continue;
		walked.add(path);
		files.add(path);
		const isPython = path.endsWith(".py");
		if (!WALKABLE.test(path) && !isPython) continue;
		let text;
		try {
			text = readFileSync(join(root, path), "utf8");
		} catch {
			// Named but absent (e.g. the diff deletes it): the name stays native,
			// there is just nothing further to follow.
			continue;
		}
		const follow = (rel) => {
			if (rel && !walked.has(rel)) queue.push(rel);
		};
		if (isPython) {
			// Stdlib names resolve to no sibling file and are dropped.
			for (const match of text.matchAll(PYTHON_IMPORT)) {
				const sibling = join(root, dirname(path), `${match[1]}.py`);
				if (isFile(sibling)) follow(toRelative(root, sibling));
			}
			continue;
		}
		for (const edge of IMPORT_EDGES) {
			for (const match of text.matchAll(edge)) {
				const target = resolve(root, dirname(path), match[1]);
				const hit = RESOLVE_SUFFIXES.map((suffix) => `${target}${suffix}`).find(
					isFile,
				);
				follow(toRelative(root, hit ?? target));
			}
		}
		// Spawned helpers named by a literal: a miss would let a rig change skip
		// its own proof.
		for (const match of text.matchAll(FILE_LITERAL)) {
			const literal = match[1].replace(LEADING_DOT_SLASH, "");
			const hit = [
				resolve(root, dirname(path), literal),
				resolve(root, literal),
			].find(isFile);
			if (hit) follow(toRelative(root, hit));
		}
	}

	// An empty `scripts/` result means the reading went wrong (the lane always
	// runs at least one script), not that nothing is native.
	if (![...files].some((path) => path.startsWith("scripts/")))
		return fail("no native script was derived");
	// The gating workflow itself: editing it can change or remove the lane.
	files.add(LANE_WORKFLOW);
	return { ok: true, files, prefixes: [...prefixes], errors };
}

const derivedByRoot = new Map();
/** `deriveNativeSurfaces(root)`, computed once per root per process. */
export function nativeSurfacesFor(root = REPO_ROOT) {
	if (!derivedByRoot.has(root))
		derivedByRoot.set(root, deriveNativeSurfaces(root));
	return derivedByRoot.get(root);
}

/**
 * True when `path` is a surface the native lane must prove.
 *
 * Kept as its own exported predicate rather than folded into the loop below so
 * the tests can assert one path at a time and name the rule that matched.
 * `derived` defaults to this repository's own derivation.
 */
export function isNativeSurface(path, derived = nativeSurfacesFor()) {
	if (!path) return false;
	const normalized = path.replace(LEADING_DOT_SLASH, "").trim();
	if (!normalized) return false;
	if (NATIVE_EXACT.has(normalized)) return true;
	if (NATIVE_PREFIXES.some((prefix) => normalized.startsWith(prefix)))
		return true;
	const lower = normalized.toLowerCase();
	if (NATIVE_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return true;
	if (!DERIVED_PREFIXES.some((prefix) => normalized.startsWith(prefix)))
		return false;
	// Unknown derivation: the whole tree is native, as it was before.
	if (!derived?.ok) return true;
	if (derived.files.has(normalized)) return true;
	return derived.prefixes.some((prefix) => normalized.startsWith(prefix));
}

/**
 * The decision, from a list of changed paths.
 *
 * An EMPTY list is "unknown", not "nothing native": a diff that could not be
 * computed and a diff with no files are indistinguishable at this layer, and
 * only one of those is safe to treat as a skip. Both run the lane.
 */
export function requiresNativeProof(paths, derived = nativeSurfacesFor()) {
	if (!Array.isArray(paths) || paths.length === 0) return true;
	return paths.some((path) => isNativeSurface(path, derived));
}

/** The paths that decided it, for the summary line. */
export function nativeSurfacePaths(paths, derived = nativeSurfacesFor()) {
	if (!Array.isArray(paths)) return [];
	return paths.filter((path) => isNativeSurface(path, derived));
}

function parseArguments(argv) {
	const options = {
		changedFile: "",
		githubOutput: "",
		summary: "",
		force: "",
		root: REPO_ROOT,
		help: false,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "-h" || argument === "--help") {
			options.help = true;
			continue;
		}
		if (argument === "--force") {
			options.force = argv[index + 1] ?? "";
			index += 1;
			continue;
		}
		const [flag, inline] = argument.split("=", 2);
		const value = inline ?? argv[index + 1];
		if (inline === undefined) index += 1;
		if (flag === "--changed-file") options.changedFile = value ?? "";
		else if (flag === "--github-output") options.githubOutput = value ?? "";
		else if (flag === "--summary") options.summary = value ?? "";
		else if (flag === "--root") options.root = resolve(value ?? REPO_ROOT);
		else throw new Error(`unknown argument: ${argument}`);
	}
	return options;
}

function readChangedPaths(source) {
	const text =
		source === "-" ? readFileSync(0, "utf8") : readFileSync(source, "utf8");
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

export function main(argv = process.argv.slice(2)) {
	const options = parseArguments(argv);
	if (options.help) {
		console.log(
			"native-scope: decide whether a diff needs macOS Native App Proofs\n\n" +
				"  --changed-file <f>   newline-separated paths, or - for stdin.\n" +
				"  --force true|false   skip the file entirely (non-PR events pass true).\n" +
				"  --github-output <f>  write `native=<true|false>` here ($GITHUB_OUTPUT).\n" +
				"  --summary <f>        append the human-readable report here.\n" +
				"  --root <dir>         repository to derive scripts/.github surfaces from\n" +
				"                       (default: this script's own repository, not cwd).\n",
		);
		return 0;
	}

	let native = true;
	let surfaces = [];
	let reason = "";
	if (options.force === "true" || options.force === "false") {
		native = options.force === "true";
		reason =
			options.force === "true"
				? "forced by --force true (not a pull request: the lane keeps running)"
				: "forced by --force false";
	} else if (!options.changedFile) {
		reason = "no --changed-file given: unknown scope, so the lane runs";
	} else {
		try {
			const paths = readChangedPaths(options.changedFile);
			const derived = nativeSurfacesFor(options.root);
			if (!derived.ok) {
				// Said out loud: a silent fallback would make every CI-only PR
				// pay for a macOS slot again with nobody knowing why.
				const why = `could not derive scripts/.github surfaces (${derived.errors.join("; ")}): every scripts/ and .github/ path is native`;
				console.error(`native-scope: ${why}`);
				if (options.summary)
					appendFileSync(
						options.summary,
						`**Native scope fail-closed:** ${why}\n\n`,
					);
			}
			native = requiresNativeProof(paths, derived);
			surfaces = nativeSurfacePaths(paths, derived);
			reason = native
				? surfaces.length
					? `diff touches a native surface (${surfaces.slice(0, 5).join(", ")}${surfaces.length > 5 ? ", …" : ""})`
					: "the changed-path list was empty: unknown scope, so the lane runs"
				: `no native surface in ${paths.length} changed path(s)`;
		} catch (error) {
			native = true;
			reason = `could not read the changed-path list (${error.message}): unknown scope, so the lane runs`;
		}
	}

	const value = native ? "true" : "false";
	if (options.githubOutput)
		appendFileSync(options.githubOutput, `native=${value}\n`);
	if (options.summary) {
		appendFileSync(
			options.summary,
			`**Native App Proofs:** ${value} — ${reason}\n\n`,
		);
	}
	console.log(`native=${value} (${reason})`);
	return 0;
}

if (isEntryPoint(import.meta.url)) {
	try {
		process.exit(main());
	} catch (error) {
		console.error(`native-scope: ${error.message}`);
		process.exit(2);
	}
}
