#!/usr/bin/env node
/**
 * Which desktop test files a change can reach, and the evidence of running them.
 *
 *     pnpm test:affected                          # list, base = merge-base with origin/main
 *     pnpm test:affected --run --evidence         # run them, print the PR evidence block
 *     node scripts/affected-tests.mjs --since <ref> --run
 *     node scripts/affected-tests.mjs src/main/foo.ts scripts/bar.mjs
 *     pnpm test:guards                            # the GUARD_TESTS alone (CI's `Guards` job)
 *
 * WHY THIS EXISTS. The desktop suite left pull-request CI (ci.yml's header for
 * `guards`; full-suite.yml runs it on `main` and nightly). A pull request now
 * records a TARGETED local run instead, and "targeted" has to be derived rather
 * than remembered: a list an agent writes by hand is the list of tests it
 * already believed in. This module turns a diff into that list, runs it through
 * the same guarded runner the full suite uses (scripts/run-desktop-tests.mjs:
 * concurrency, memory and lane bounds all apply), and prints a markdown block
 * for the PR's `## Targeted test evidence` section.
 *
 * HOW A TEST IS SELECTED. The suite is `node --test` over scripts/, not a runner
 * with a `related` mode, and most tests reach `src/**` through esbuild entry
 * points or by reading files rather than through `import`. So the graph has two
 * kinds of edge, and a test is selected when a changed path is reachable from it:
 *
 *   - IMPORTS: static/dynamic `import`, `export ... from` and `require` of a
 *     relative or vite-aliased (`@renderer/...`, see electron.vite.config.js)
 *     specifier, followed through every source file under src/, scripts/, bin/
 *     and i18n/, so a change to a deep renderer util reaches the test that
 *     bundles the component using it;
 *   - MENTIONS: a repository path written in a test or a script helper, either as
 *     a string literal (`"src/renderer/src/features/chat/chat-page.tsx"`) or as a
 *     `join(root, "src", "main", ...)` of literals, or a bare sibling file name
 *     (`join(import.meta.dirname, "x.mjs")`). A mentioned DIRECTORY covers
 *     everything under it - that is how tree walks (i18n literal guards and the
 *     like) say what they read.
 *
 * WHAT IT REFUSES TO DO: fall back to the whole suite silently. The graph is an
 * under-approximation (a path built at runtime is invisible to it), so it says
 * so instead of hiding it: paths no test reaches are listed as UNREACHED, and a
 * change to something every test depends on (the install, a tsconfig, the
 * runner) is flagged BROAD with the explicit full-suite spelling. The safety net
 * for what it misses is full-suite.yml, which files a `ci-main-red` issue.
 *
 * GUARD_TESTS is the ONE list of tree-wide guards: assertions about the whole
 * repository (every test runs somewhere, every lane is registered, the runner
 * and its memory guard behave) that a diff-scoped selection is blind to by
 * construction. Every selection includes them, and ci.yml's `Guards` job runs
 * exactly this list through `pnpm test:guards`.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EXEMPT, discoverDesktopTests } from "./desktop-test-inventory.mjs";
import { isEntryPoint } from "./entry-point.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER = "scripts/run-desktop-tests.mjs";

/**
 * The tree-wide guards. Chosen because each asserts a property of the WHOLE
 * tree or of the CI machinery, runs in seconds, and has no esbuild bundle or
 * Electron boot behind it. The release contracts (publish, version-bump,
 * release-safety, ci-scope) are deliberately NOT here: they already run in
 * ci.yml's `check-types` job, and listing them twice would make two places
 * that must agree. Adding a guard here adds it to CI; keep it cheap.
 */
export const GUARD_TESTS = Object.freeze([
	"scripts/affected-tests.test.mjs",
	"scripts/ci-log-guard.test.mjs",
	"scripts/desktop-test-memory-guard.test.mjs",
	"scripts/focus-stability-ci-policy.test.mjs",
	"scripts/lane-registration.test.mjs",
	"scripts/run-desktop-tests.test.mjs",
	"scripts/test-inventory.test.mjs",
]);

/**
 * Paths every desktop test depends on through the install or the runner. A
 * change here cannot be bounded by a graph, so it is reported BROAD rather than
 * mapped to whatever happens to mention it.
 */
const BROAD = [
	/^package\.json$/,
	/^pnpm-lock\.yaml$/,
	/^pnpm-workspace\.yaml$/,
	/^\.npmrc$/,
	/^tsconfig[^/]*\.json$/,
	/^electron\.vite\.config\.[cm]?[jt]s$/,
	/^scripts\/run-desktop-tests\.mjs$/,
	/^scripts\/desktop-test-[^/]+\.mjs$/,
	/^scripts\/desktop-suite-[^/]+\.(mjs|sh)$/,
];

/** Prose and repository metadata: no test can be reached through them. */
const INERT = [
	/\.md$/i,
	/^\.github\/(?!workflows\/)/,
	/^LICENSE/,
	/^\.gitignore$/,
];

/** The graph's source roots, and the file kinds it parses for edges. */
const SOURCE_ROOTS = ["src", "scripts", "bin", "i18n"];
const PARSED = /\.(mjs|cjs|js|jsx|ts|tsx|mts|cts)$/;
const TEST_FILE = /\.test\.mjs$/;
const RESOLVE_EXTENSIONS = [
	"",
	".ts",
	".tsx",
	".js",
	".mjs",
	".cjs",
	".jsx",
	".json",
	"/index.ts",
	"/index.tsx",
	"/index.js",
	"/index.mjs",
];

/** electron.vite.config.js's renderer aliases, prefix -> repository directory. */
export const ALIASES = Object.freeze({
	"@renderer": "src/renderer/src",
	"@components": "src/renderer/src/components",
	"@features": "src/renderer/src/features",
	"@shared": "src/renderer/src/shared",
	"@assets": "src/renderer/src/assets",
	"@hooks": "src/renderer/src/hooks",
	"@api": "src/renderer/src/api",
	"@store": "src/renderer/src/store",
});

const SPECIFIER =
	/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bnew URL\s*\(\s*)["'`]([^"'`\n]+)["'`]/g;
const PATH_LITERAL =
	/["'`]((?:\.\.\/)*(?:src|scripts|bin|i18n|docs|resources|build|\.github)\/[\w@./-]+)["'`]/g;
const SIBLING_LITERAL =
	/["'`]([\w.-]+\.(?:mjs|cjs|js|sh|json|html|tsx?))["'`]/g;
const JOIN_CALL =
	/\b(?:join|resolve)\(\s*[\w.]+\s*,((?:\s*["'][^"'\n]+["']\s*,?)+)\s*\)/g;

/** Every file under the source roots, repository-relative, links not followed. */
function walk(root) {
	const files = [];
	const visit = (dir) => {
		let entries;
		try {
			entries = readdirSync(join(root, dir), { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
			const path = `${dir}/${entry.name}`;
			if (entry.isDirectory()) visit(path);
			else if (entry.isFile()) files.push(path);
		}
	};
	for (const dir of SOURCE_ROOTS) visit(dir);
	return files;
}

/**
 * Block comments and whole-line `//` comments removed. This repository's
 * scripts cite paths in prose constantly ("ci.yml's Lint job", an incident's
 * file:line), and counting those as reads made `chrome-keychain.mjs` - which
 * names ci.yml only in its docstring - drag ~60 browser tests into a
 * workflow-only change. Trailing `//` is left alone: it is also how a URL
 * starts inside a string.
 */
export function stripComments(text) {
	return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function onDisk(root, path) {
	try {
		return statSync(join(root, path)).isFile();
	} catch {
		return false;
	}
}

/** Resolve a specifier written in `from` to a repository file, or null. */
export function resolveSpecifier(from, specifier, exists) {
	let base = null;
	if (specifier.startsWith("./") || specifier.startsWith("../"))
		base = posix.normalize(posix.join(posix.dirname(from), specifier));
	else
		for (const [alias, dir] of Object.entries(ALIASES))
			if (specifier === alias || specifier.startsWith(`${alias}/`)) {
				base = dir + specifier.slice(alias.length);
				break;
			}
	if (base === null) return null;
	return resolvePath(base.replace(/\?.*$/, ""), exists);
}

/** A repository path as written, with the import extensions probed, or null. */
export function resolvePath(base, exists) {
	if (base.startsWith("../")) return null;
	for (const extension of RESOLVE_EXTENSIONS)
		if (exists(base + extension)) return base + extension;
	return null;
}

/** The repository paths a file names, as written (files or directories). */
export function mentionedPaths(text) {
	const found = new Set();
	for (const match of text.matchAll(PATH_LITERAL))
		found.add(match[1].replace(/^(?:\.\.\/)+/, "").replace(/\/$/, ""));
	for (const match of text.matchAll(JOIN_CALL)) {
		const parts = [...match[1].matchAll(/["']([^"'\n]+)["']/g)].map(
			(m) => m[1],
		);
		const path = posix.normalize(parts.join("/")).replace(/^(?:\.\.\/)+/, "");
		if (
			/^(src|scripts|bin|i18n|docs|resources|build|\.github)(\/|$)/.test(path)
		)
			found.add(path.replace(/\/$/, ""));
	}
	return found;
}

/**
 * The reverse graph of a tree: path -> the files that import or mention it, plus
 * the directory mentions (dir -> files naming it). Built once per invocation.
 */
export function buildGraph(root = ROOT) {
	const files = walk(root);
	const known = new Set(files);
	const exists = (path) => known.has(path);
	const importers = new Map();
	const dirMentions = new Map();
	const add = (map, key, value) => {
		if (!map.has(key)) map.set(key, new Set());
		map.get(key).add(value);
	};
	for (const file of files) {
		if (!PARSED.test(file)) continue;
		const text = stripComments(readFileSync(join(root, file), "utf8"));
		for (const match of text.matchAll(SPECIFIER)) {
			const target = resolveSpecifier(file, match[1], exists);
			if (target && target !== file) add(importers, target, file);
		}
		// Mentions are read from scripts/ only: that is where the tests and their
		// helpers live, and a src/ file naming a path is product copy, not a read.
		if (!file.startsWith("scripts/")) continue;
		// A bare sibling name (`join(import.meta.dirname, "ci-log-guard.mjs")`) is
		// how a test spawns the script it covers; it is a read of that sibling.
		const siblings = [...text.matchAll(SIBLING_LITERAL)].map((m) =>
			posix.join(posix.dirname(file), m[1]),
		);
		for (const path of [...mentionedPaths(text), ...siblings]) {
			// Outside the walked roots (`.github/workflows/ci.yml`, `docs/...`) a
			// mention is only an edge when the file is really there.
			const target =
				resolvePath(path, exists) ?? (onDisk(root, path) ? path : null);
			if (target && target !== file) add(importers, target, file);
			else if (
				!target &&
				!COARSE_DIRS.has(path) &&
				existsSync(join(root, path)) &&
				statSync(join(root, path)).isDirectory()
			)
				add(dirMentions, path, file);
		}
	}
	return { importers, dirMentions };
}

/**
 * Directories whose mention says nothing about what a file READS. Measured on
 * this tree (2026-11-07): `src/renderer/src/shared` was named by 82 files,
 * `.../features` by 75, `src/renderer/src` by 70 and `scripts` by 30 - almost
 * all of them esbuild `alias` tables and `root` joins, not tree walks - and
 * honouring them selected 330 of ~780 tests for a one-file sidebar change. A
 * walk over one of these roots is the whole-tree guard class, which belongs in
 * `GUARD_TESTS`, not in a diff's selection.
 */
const COARSE_DIRS = new Set([
	...SOURCE_ROOTS,
	"docs",
	"resources",
	"build",
	"src/main",
	"src/preload",
	"src/renderer",
	"src/shared",
	...Object.values(ALIASES),
]);

/** The changed paths that are reachable from each test; see the module docstring. */
export function selectTests(changed, { graph, inventory, exempt = EXEMPT }) {
	const tests = new Set(inventory);
	const exemptSet = new Set(Object.keys(exempt));
	const selected = new Map(); // test -> the changed paths that reached it
	const exemptHit = new Map();
	const unreached = [];
	const broad = [];
	const inert = [];
	const dirs = [...graph.dirMentions.keys()];
	for (const path of changed) {
		// A test file is never broad: changing it selects exactly itself.
		if (!TEST_FILE.test(path) && BROAD.some((pattern) => pattern.test(path)))
			broad.push(path);
		if (INERT.some((pattern) => pattern.test(path))) {
			inert.push(path);
			continue;
		}
		const seen = new Set([path]);
		const queue = [path];
		while (queue.length) {
			const node = queue.shift();
			// A test file is a leaf: other files name tests only to LIST them
			// (inventories, registrations), and following those edges turned a
			// one-line helper change into a third of the suite.
			if (node !== path && TEST_FILE.test(node)) continue;
			const next = new Set(graph.importers.get(node) ?? []);
			for (const dir of dirs)
				if (node.startsWith(`${dir}/`))
					for (const file of graph.dirMentions.get(dir)) next.add(file);
			for (const file of next)
				if (!seen.has(file)) {
					seen.add(file);
					queue.push(file);
				}
		}
		let reached = false;
		for (const node of seen) {
			const into = tests.has(node)
				? selected
				: exemptSet.has(node)
					? exemptHit
					: null;
			if (!into) continue;
			reached = true;
			if (!into.has(node)) into.set(node, new Set());
			into.get(node).add(path);
		}
		if (!reached) unreached.push(path);
	}
	const guards = GUARD_TESTS.filter((test) => !selected.has(test));
	const files = [...new Set([...selected.keys(), ...guards])].sort();
	return {
		files,
		affected: [...selected.keys()].sort(),
		guards,
		exempt: [...exemptHit.keys()].sort(),
		unreached: unreached.sort(),
		broad: broad.sort(),
		inert: inert.sort(),
	};
}

function git(args, cwd = ROOT) {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** Changed paths since `base`: committed, staged, unstaged and untracked. */
export function changedSince(base, cwd = ROOT) {
	const tracked = git(["diff", "--name-only", base], cwd).split("\n");
	const untracked = git(
		["ls-files", "--others", "--exclude-standard"],
		cwd,
	).split("\n");
	return [...new Set([...tracked, ...untracked].filter(Boolean))].sort();
}

/** `# pass 3` (TAP, piped) and `ℹ pass 3` (spec, TTY) summary counts. */
export function parseCounts(output) {
	const counts = {};
	for (const match of output.matchAll(
		/^(?:#|ℹ) (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)\s*$/gm,
	))
		counts[match[1]] = (counts[match[1]] ?? 0) + Number(match[2]);
	return counts;
}

/** The PR evidence block. Plain data in, markdown out, so it is testable. */
export function evidenceMarkdown({ range, changed, selection, command, run }) {
	const lines = [
		"## Targeted test evidence",
		"",
		`- Range: \`${range}\``,
		`- Changed paths: ${changed.length} (inert ${selection.inert.length}, unreached ${selection.unreached.length}, broad ${selection.broad.length})`,
		`- Selected: ${selection.files.length} test files (${selection.affected.length} affected + ${selection.guards.length} guards)`,
	];
	if (selection.exempt.length)
		lines.push(
			`- Reached but exempt from the desktop suite (they run where \`EXEMPT\` says): ${selection.exempt.map((f) => `\`${f}\``).join(", ")}`,
		);
	if (selection.unreached.length)
		lines.push(
			`- UNREACHED by any test (covered only by the full suite on main): ${selection.unreached.map((f) => `\`${f}\``).join(", ")}`,
		);
	if (selection.broad.length)
		lines.push(
			`- BROAD change (${selection.broad.map((f) => `\`${f}\``).join(", ")}): a graph cannot bound it; run \`pnpm test:desktop\` deliberately if it matters`,
		);
	if (run) {
		const c = run.counts;
		lines.push(
			`- Result: **${run.exitCode === 0 ? "PASS" : "FAIL"}** (exit ${run.exitCode}) - tests ${c.tests ?? "?"}, pass ${c.pass ?? "?"}, fail ${c.fail ?? "?"}, skipped ${c.skipped ?? 0}, cancelled ${c.cancelled ?? 0}`,
			`- Wall time: ${(run.wallMs / 1000).toFixed(1)} s`,
		);
	} else lines.push("- Result: not run (`--run` was not given)");
	lines.push(
		"",
		"<details><summary>Exact command</summary>",
		"",
		"```sh",
		command,
		"```",
		"",
		"</details>",
	);
	return lines.join("\n");
}

const USAGE = `usage: affected-tests.mjs [--since <ref>] [--guards] [--run] [--evidence] [--json] [path ...]
  --since <ref>  diff base (default: git merge-base origin/main HEAD)
  path ...       explicit changed paths instead of a diff
  --guards       GUARD_TESTS only (what ci.yml's Guards job runs)
  --run          run the selection through ${RUNNER}
  --evidence     print the "## Targeted test evidence" markdown block
  --json         print the selection as JSON`;

export function parseArgs(argv) {
	const args = {
		since: null,
		paths: [],
		guards: false,
		run: false,
		evidence: false,
		json: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--since") {
			args.since = argv[++i];
			if (!args.since) throw new Error("--since needs a ref");
		} else if (arg === "--guards") args.guards = true;
		else if (arg === "--run") args.run = true;
		else if (arg === "--evidence") args.evidence = true;
		else if (arg === "--json") args.json = true;
		else if (arg === "-h" || arg === "--help") args.help = true;
		else if (arg.startsWith("-"))
			throw new Error(`Unknown flag ${arg}\n${USAGE}`);
		else args.paths.push(arg.replace(/^\.\//, ""));
	}
	if (args.since && args.paths.length)
		throw new Error("--since and explicit paths are exclusive");
	return args;
}

/** Spawn the runner, tee its output, and count what it reported. */
function runSelection(files) {
	const started = Date.now();
	const child = spawn(process.execPath, [RUNNER, ...files], {
		cwd: ROOT,
		stdio: ["inherit", "pipe", "pipe"],
	});
	let output = "";
	child.stdout.on("data", (chunk) => {
		output += chunk;
		process.stderr.write(chunk);
	});
	child.stderr.on("data", (chunk) => process.stderr.write(chunk));
	return new Promise((resolveRun, reject) => {
		child.once("error", reject);
		child.once("exit", (code, signal) =>
			resolveRun({
				exitCode: code ?? (signal ? 128 : 1),
				counts: parseCounts(output),
				wallMs: Date.now() - started,
			}),
		);
	});
}

export async function main(argv) {
	const args = parseArgs(argv);
	if (args.help) {
		console.log(USAGE);
		return 0;
	}
	const inventory = discoverDesktopTests(ROOT);
	let changed = [];
	let range = "(guards only)";
	let selection;
	if (args.guards) {
		selection = {
			files: [...GUARD_TESTS],
			affected: [],
			guards: [...GUARD_TESTS],
			exempt: [],
			unreached: [],
			broad: [],
			inert: [],
		};
	} else {
		if (args.paths.length) {
			changed = [...new Set(args.paths)].sort();
			range = "(explicit paths)";
		} else {
			const base = args.since ?? git(["merge-base", "origin/main", "HEAD"]);
			const dirty = git(["status", "--porcelain"]) ? "+worktree" : "";
			range = `${git(["rev-parse", "--short=12", base])}..${git(["rev-parse", "--short=12", "HEAD"])}${dirty}`;
			changed = changedSince(base);
		}
		selection = selectTests(changed, { graph: buildGraph(ROOT), inventory });
	}
	for (const guard of GUARD_TESTS)
		if (!inventory.includes(guard))
			throw new Error(
				`GUARD_TESTS names ${guard}, which is not in the desktop inventory`,
			);
	const command = `node ${RUNNER} ${selection.files.join(" ")}`;
	if (args.json)
		console.log(
			JSON.stringify({ range, changed, ...selection, command }, null, 2),
		);
	else if (!args.evidence) {
		console.error(
			`affected-tests: ${range}, ${changed.length} changed paths -> ${selection.files.length} test files (${selection.affected.length} affected + ${selection.guards.length} guards)`,
		);
		for (const path of selection.unreached)
			console.error(`  unreached: ${path}`);
		for (const path of selection.broad)
			console.error(
				`  BROAD: ${path} - a graph cannot bound this; \`pnpm test:desktop\` is the deliberate full run`,
			);
		if (!args.run) console.log(selection.files.join("\n"));
	}
	const run = args.run ? await runSelection(selection.files) : null;
	if (args.evidence)
		console.log(evidenceMarkdown({ range, changed, selection, command, run }));
	return run ? run.exitCode : 0;
}

if (isEntryPoint(import.meta.url)) {
	try {
		process.exitCode = await main(process.argv.slice(2));
	} catch (error) {
		console.error(`affected-tests failed: ${error.message}`);
		process.exitCode = 2;
	}
}
