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
 *     like) say what they read;
 *   - LITERAL PINS (`literalPins`): a test whose own text carries the changed
 *     file's path, path without extension, trailing path segments or
 *     non-generic basename as a string literal - the "reads src as text and
 *     pins a literal" class, 7 of 13 real red UI PR runs.
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
	// Tree-wide row-state source audit ("no template literal builds a row state
	// or a rung beside a substitution", ~line 2875): it red fix/prompt-markdown-
	// fidelity (run 42057109287) over a canvas file the PR's own tests never
	// named. It shares its file with 26 unit tests; the whole file is the guard
	// until that audit is split out (59 s alone at load ~260, 2026-11-07).
	"scripts/chat-sidebar-selection.test.mjs",
	// Chrome launch-site inventory: a new rig that launches Chrome without the
	// mock-keychain switch (scripts/chrome-keychain.mjs owns its spelling) puts
	// a keychain prompt on the operator's screen, and a NEW file's absence from
	// the inventory is invisible to a diff walk.
	"scripts/chrome-keychain.test.mjs",
	"scripts/ci-log-guard.test.mjs",
	// No tracked file carries a git conflict marker - including `.md`, which
	// the selection treats as INERT, so only a guard can see it.
	"scripts/conflict-markers.test.mjs",
	"scripts/desktop-test-memory-guard.test.mjs",
	// The shard memory ceiling is a property of the whole tree: every test file a
	// PR adds grows one lane by hash, so no diff-scoped selection can see the lane
	// cross 204 files (the size that exhausted the 7.8 GB budget twice). The whole
	// planner file is the guard because it is cheap (0.5 s incl. the real 786-file
	// walk) and because the ceiling assertion must fail on a pull request, not only
	// in main's full-suite run where the shards actually execute.
	"scripts/desktop-test-shards.test.mjs",
	"scripts/focus-stability-ci-policy.test.mjs",
	"scripts/lane-registration.test.mjs",
	// No tracked source file constructs a WebSocket: a property of every file,
	// including ones no test imports.
	"scripts/no-websocket-plane.test.mjs",
	// Spawn-site inventories: every new Electron/evidence rig must register.
	// Three of 13 real red UI PR runs (browser-google-signin-trust,
	// browser-clipboard-write, notifications-glass-composition) were this
	// class, and a diff-scoped selection cannot see a NEW file's absence.
	"scripts/notification-spawn-sites.test.mjs",
	"scripts/run-desktop-tests.test.mjs",
	// Every literal `/settings?section=` route names a live section, wherever
	// the route string is written.
	"scripts/settings-section-routes.test.mjs",
	"scripts/telemetry-spawn-sites.test.mjs",
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
// Plain string literals (no escapes, no `${}`), the unit `literalPins` reads.
const STRING_LITERAL = /(["'`])([^"'`\\\n$]{1,300})\1/g;
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
	const testLiterals = new Map();
	for (const file of files) {
		if (!PARSED.test(file)) continue;
		const text = stripComments(readFileSync(join(root, file), "utf8"));
		if (TEST_FILE.test(file))
			testLiterals.set(
				file,
				new Set([...text.matchAll(STRING_LITERAL)].map((m) => m[2])),
			);
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
	return { importers, dirMentions, testLiterals };
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

/**
 * Stems too common to mean one file: `"index"` or `"types"` written in a test
 * names nothing in particular, so only their full paths count as a pin.
 */
const GENERIC_STEMS = new Set([
	"index",
	"main",
	"types",
	"utils",
	"constants",
	"styles",
	"config",
	"preload",
	"app",
	"test",
]);

/**
 * The tests whose OWN source text pins `path` with a string literal: the full
 * repository path, the path without its extension, its last segments
 * (`"team-bridge/team-bridge-page.tsx"`), or - for a non-generic name - the bare
 * basename with or without extension.
 *
 * WHY, measured rather than assumed: of 13 real red UI pull-request runs
 * (2026-10..11), 7 were caught by a test that READS a source file as text and
 * pins literals in it (`shell-path.test.mjs` over `src/main/index.ts`,
 * `default-on-banner.test.mjs` over `team-bridge-page.tsx`, ...). No import
 * edge connects those tests to the file, and their names say nothing about it,
 * so an import graph alone misses every one. Direct only: a pin is a statement
 * about THAT file's text, which a change to one of its importers cannot break.
 */
export function literalPins(path, testLiterals) {
	if (!testLiterals) return [];
	const base = posix.basename(path);
	const stem = base.replace(/\.[^.]+$/, "");
	const noExt = path.replace(/\.[^./]+$/, "");
	const bare =
		stem.length >= 4 && !GENERIC_STEMS.has(stem) ? new Set([base, stem]) : null;
	const hits = [];
	for (const [test, literals] of testLiterals) {
		if (test === path) continue;
		for (const raw of literals) {
			const literal = raw.replace(/^(?:\.\.?\/)+/, "");
			if (
				literal === path ||
				literal === noExt ||
				(literal.includes("/") &&
					(path.endsWith(`/${literal}`) || noExt.endsWith(`/${literal}`))) ||
				bare?.has(literal)
			) {
				hits.push(test);
				break;
			}
		}
	}
	return hits;
}

function packageScripts() {
	return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts;
}

/**
 * The exact command that runs one EXEMPT test. A reached exempt file is not
 * run by `--run` (it is exempt from the shared lanes for a reason - display,
 * memory, its own step), and since the desktop suite left PR CI nothing runs
 * it before merge unless the agent does; a bare file name made them work out
 * how (PR #1750 QA round 1, M2). Preference order: the package.json script
 * that names the file (the command its owners maintain), then a `pnpm ...`
 * the EXEMPT reason opens with, then the guarded runner - never a bare
 * `node --test`, which has no memory bound.
 */
export function exemptCommand(
	file,
	{ scripts = packageScripts(), reason = EXEMPT[file] ?? "" } = {},
) {
	const named = Object.entries(scripts ?? {})
		.filter(
			([name, body]) =>
				!name.startsWith("//") &&
				typeof body === "string" &&
				body.split(/\s+/).includes(file),
		)
		.map(([name]) => name)
		.sort();
	if (named.length) return `pnpm ${named[0]}`;
	const lead = /^`(pnpm [^`]+)`/.exec(reason);
	if (lead) return lead[1];
	return `node ${RUNNER} ${file}`;
}

/** The changed paths that are reachable from each test; see the module docstring. */
export function selectTests(
	changed,
	{ graph, inventory, exempt = EXEMPT, scripts },
) {
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
		for (const test of literalPins(path, graph.testLiterals)) seen.add(test);
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
		exemptRuns: [...exemptHit.keys()].sort().map((file) => ({
			file,
			command: exemptCommand(file, { scripts, reason: exempt[file] ?? "" }),
		})),
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
			`- Reached but exempt from the desktop suite, so \`--run\` did not run them; run each yourself: ${(selection.exemptRuns ?? selection.exempt.map((file) => ({ file }))).map(({ file, command }) => (command ? `\`${file}\` → \`${command}\`` : `\`${file}\``)).join(", ")}`,
		);
	if (selection.unreached.length)
		lines.push(
			`- UNREACHED by any test (covered only by the full suite on main): ${selection.unreached.map((f) => `\`${f}\``).join(", ")}`,
		);
	if (selection.broad.length)
		lines.push(
			`- BROAD change (${selection.broad.map((f) => `\`${f}\``).join(", ")}): a graph cannot bound it; add the tests you judge it reaches - the full suite runs on \`main\` (full-suite.yml), not here`,
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
			exemptRuns: [],
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
		for (const { file, command } of selection.exemptRuns)
			console.error(`  exempt (not run): ${file} - run it with \`${command}\``);
		for (const path of selection.broad)
			console.error(
				`  BROAD: ${path} - a graph cannot bound this; add the tests you judge it reaches (the full suite runs on main, not on PRs)`,
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
