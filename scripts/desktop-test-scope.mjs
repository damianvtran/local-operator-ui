/**
 * Narrows the desktop suite to the test files a diff can actually reach.
 *
 * WHY THIS EXISTS. `pnpm test:desktop` is the whole suite regardless of the
 * diff: 178 files, measured at 121-326 s per review round on this laptop, and
 * one of the largest repeated costs in the UI loop - every review round and
 * every QA pass pays it to re-prove files the diff never touched. CI already
 * asks `scripts/ci-scope.mjs` a scope question per pull request; this module
 * asks the same classifier the next question down ("which of the suite's files
 * can this diff reach?") instead of keeping a second opinion about what a
 * source change is.
 *
 * WHAT IT REFUSES TO PROVE. The reason a narrowed run is dangerous is that a
 * test it skips may have been the one that would have gone red, and a green
 * narrowed run looks exactly like a green full one. So the rule this module
 * follows is: a test file may be skipped ONLY when every mechanism by which it
 * could observe the changed paths has been enumerated. Concretely, per test
 * file:
 *
 *  - every module specifier in it (`import`/`export ... from`, `require`,
 *    `import()`, and the `export * from "./src/..."` strings the suite's
 *    esbuild bundles are built from) is resolved, and each resolved module's
 *    own imports are followed transitively;
 *  - every repo-rooted path literal anywhere in the file (`"src/main/index.ts"`
 *    read as text, `scripts/fixtures/${name}.json`, an `HOOKS_DIR` constant) is
 *    a reference; a reference to a DIRECTORY covers that whole subtree, which is
 *    what makes `readdirSync(dir)` and `readFileSync(join(dir, name))` sound
 *    without modelling either;
 *  - a file access whose argument cannot be grounded in a path literal, a temp
 *    dir or the file's own URL is an UNRESOLVED REFERENCE CLASS. That test is
 *    not skipped: it is selected for every diff (`always-selected` below), and
 *    the scope line says how many files are riding on that rule.
 *
 * FAIL CLOSED. Whole suite, with the reason printed, when the diff is not
 * confined to `src/**` plus the suite's own test files - the classifier's
 * `ci`, `manifest`, `lock` and `evidence` categories, any named-live tree that
 * is not `src/` (`scripts/`, `bin/`, `build/`, `resources/`, `tsconfig*.json`,
 * `biome.json`), and anything the classifier does not recognise at all. The
 * same for a git failure, an unreadable suite list, and a `src/**` diff on a
 * tree where no test file could be analysed. The classifier's own verdict is
 * reused for the cheap end of the range: a prose-only diff sets no `unit` flag
 * in CI, so this runs nothing and says so, quoting the classifier's reason.
 *
 * WHAT IT DOES NOT COVER. A reference composed ENTIRELY at runtime - a path
 * decoded out of a fixture with no literal anywhere in the test file - is
 * invisible to any static model, and a test whose every file access is written
 * that way would be analysed as bounded. The detector for the reachable version
 * of that pattern is the unresolved-class rule above (it is what a variable
 * argument hits); the residual case is recorded here rather than claimed away,
 * which is why `--scope` prints the always-selected count a reviewer can weigh.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import {
	FLAG_REASONS,
	categoryOf,
	classify,
	collectPaths,
	isNamedLivePath,
	resolveBase,
} from "./ci-scope.mjs";

/** What a plan tells the runner to do. */
export const SCOPE_MODES = {
	/** Nothing in the suite can observe this diff; run no files. */
	NONE: "none",
	/** Run exactly `files`. */
	SCOPED: "scoped",
	/** Run the whole suite; `reason` says which rule refused to narrow. */
	WHOLE: "whole",
};

/**
 * Path and specifier regexes, at module scope.
 *
 * `useTopLevelRegex` is a warning here rather than a rule with teeth, but these
 * are the patterns that decide what a test file can reach: compiling them once
 * is the difference between a scan of 172 files costing milliseconds and costing
 * a recompile per file, and a scope step that is slow enough to notice is one
 * somebody will turn off.
 */
const TRAILING_PUNCTUATION = /[.,;:)`'"]+$/;
const LEADING_SLASH = /^\//;
const MODULE_EXTENSION = /\.(?:ts|tsx|mjs|js|cjs)$/;
const MODULE_SHAPED = /^[@\w][\w./@-]*$/;
const SCHEME_PREFIX = /^(?:data|node|https?|file):/;
const PURE_LITERAL = /^["'`][^"'`]*["'`]$/;
const FOR_OF_BINDING =
	/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+of\s+([^)]+)\)/g;
const NEW_URL_LITERAL = /new URL\(\s*["'`]([^"'`]+)["'`]/g;

/** Roots a repo-relative path can start with, for the token scan. */
const REPO_ROOT_NAMES = [
	"src",
	"scripts",
	"docs",
	"resources",
	"build",
	"bin",
	"tests",
];

/**
 * A repo-rooted path token anywhere in a file's text.
 *
 * The lookbehind refuses a token that continues a longer word (`foo/src/x` still
 * matches, deliberately: it is a path either way) but keeps `./src/x` and
 * `${dir}/src/x` - the two shapes this suite actually writes - matching, which a
 * `^`-anchored or whitespace-anchored pattern would both miss.
 */
const TOKEN_PATTERN = new RegExp(
	`(?<![\\w.@-])((?:${REPO_ROOT_NAMES.join("|")})/[A-Za-z0-9_@.\\/-]+)`,
	"g",
);

/** `const NAME = (a, b) =>` and `const NAME = a =>` . */
const HELPER_ARROW =
	/(?:^|[^\w$])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\(?\s*([A-Za-z_$][\w$,\s]*?)\s*\)?\s*=>/g;

/** `function NAME(a, b)` and `export function NAME(a, b)`. */
const HELPER_FUNCTION = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g;

/** One plain identifier, which is all a groundable parameter may be. */
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** Calls that read something, whose target must be grounded (see the docstring). */
const READ_CALL_PATTERN =
	/\b(readFileSync|readFile|readdirSync|readdir|readFileSync|existsSync|statSync|lstatSync|createReadStream|globSync|glob|require|import)\s*\(/g;

/** A `const NAME = <expr>` binding, used to ground one level of indirection. */
/**
 * A `const NAME = <expr>` binding, used to ground one level of indirection.
 *
 * The value may continue onto INDENTED following lines and stops at the first
 * `;`: this suite writes `const bundlePath = new URL(` / `\t"./_x.bundle.mjs",` /
 * `\timport.meta.url,` / `);`, and a single-line pattern read that value as
 * empty. Capturing a continuation line can only ever ADD evidence about a call
 * it is the argument of, so the loose end is the safe one; the `[^;]` bound is
 * what keeps one statement from swallowing the next.
 */
const BINDING_PATTERN =
	/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^\n;]+(?:\n[ \t]+[^\n;]+)*)/g;

/** Resolution order, in the order the bundlers in this repo use it. */
const FILE_EXTENSIONS = [
	"",
	".ts",
	".tsx",
	".mjs",
	".js",
	".cjs",
	".json",
	".css",
];
const INDEX_EXTENSIONS = [".ts", ".tsx", ".mjs", ".js", ".cjs"];

/** How deep a call argument is resolved through local bindings before giving up. */
const BINDING_DEPTH = 3;

/** Markers that ground a path in something outside the repository. */
const OUTSIDE_MARKERS = [
	"tmpdir",
	"mkdtemp",
	"TMPDIR",
	"import.meta.url",
	"randomUUID",
	"process.pid",
	// A bundle handed to the test as a `data:` URL, or a remote page: a fixed
	// target that is not a path in this repository at all.
	"data:text/",
	"data:application/",
	"http://",
	"https://",
	"file://",
	"node:",
];

/**
 * The alias table from `electron.vite.config.js`, parsed rather than copied.
 *
 * A second copy of these eight mappings would be a table that drifts silently:
 * a new alias added to the vite config would leave this module resolving a
 * specifier against nothing, which reads as an unresolved class and fails
 * closed - safe, but permanently, and for a reason nobody would find. Parsing
 * keeps one source of truth; `desktop-test-scope.test.mjs` pins that all eight
 * are still found.
 */
export function aliasTable(root) {
	const text = readFileSync(join(root, "electron.vite.config.js"), "utf8");
	const aliases = [];
	for (const match of text.matchAll(
		/^\s*"(@[\w-]+)":\s*resolve\("([^"]+)"\)/gm,
	)) {
		aliases.push({ name: match[1], target: match[2] });
	}
	return aliases;
}

/**
 * The suite, as a list of repo-relative test paths.
 *
 * Read from `package.json` rather than passed in: `test:desktop`'s list is what
 * CI runs, `scripts/test-inventory.test.mjs` keeps it complete, and a narrowed
 * run has to be a SUBSET of it. A second list here would eventually disagree
 * with the one CI uses, which is the drift that produces "the suite is green"
 * about a suite nobody ran.
 */
export function readSuiteFiles(root) {
	const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	const command = pkg.scripts?.["test:desktop"] ?? "";
	const files = (command.match(/scripts\/[\w.-]+\.test\.mjs/g) ?? []).map(
		(path) => path.replace(/\\/g, "/"),
	);
	return [...new Set(files)];
}

/** `true` when `path` is a directory in the tree. */
function isDirectory(root, path) {
	try {
		return statSync(join(root, path)).isDirectory();
	} catch {
		return false;
	}
}

/**
 * `true` when a bare specifier names something the install can resolve.
 *
 * Asked of the resolver rather than guessed from `node_modules/<head>`: this
 * tree's store is pnpm's, where a transitive dependency lives under
 * `node_modules/.pnpm/...` and never at the top level, so a directory check
 * reports a perfectly installed package as unresolvable - and "unresolvable"
 * selects a whole test file for no reason. Node builtins (`child_process`)
 * resolve to their own name, which is also outside this repository.
 */
function isInstalledPackage(root, specifier) {
	try {
		const resolved = createRequire(join(root, "package.json")).resolve(
			specifier,
		);
		return typeof resolved === "string" && resolved.length > 0;
	} catch {
		return false;
	}
}

/**
 * Resolve one module specifier to a repo-relative file, or say why it could not.
 *
 * `external` (a bare package name) is the one answer that is not a failure: it
 * is by construction outside this repository, so nothing in the diff can be it.
 */
export function resolveSpecifier(spec, fromFile, root, aliases) {
	const clean = spec.split("?")[0];
	if (!clean)
		return { kind: "unresolved", reason: `empty specifier in ${fromFile}` };
	if (clean.startsWith("node:")) return { kind: "external" };
	const candidates = [];
	if (clean.startsWith(".")) {
		// TWO bases, because this suite writes its module specifiers in two
		// conventions: `import ... from "./helper.mjs"` beside the test file, and
		// the esbuild entry strings (`export * from "./src/renderer/..."`), which
		// are resolved by the bundler against `resolveDir: process.cwd()` - the
		// repository root - not against the file that carries the string. Trying
		// both in order is safe in the direction that matters: an extra candidate
		// can only add a reference, never hide one, and a specifier that resolves
		// under NEITHER is reported unresolved, which selects the test.
		candidates.push(resolve(dirname(join(root, fromFile)), clean));
		candidates.push(resolve(root, clean));
	} else {
		const alias = aliases.find(
			(entry) => clean === entry.name || clean.startsWith(`${entry.name}/`),
		);
		if (alias) {
			candidates.push(
				join(
					root,
					alias.target,
					clean.slice(alias.name.length).replace(LEADING_SLASH, ""),
				),
			);
		} else if (isInstalledPackage(root, clean)) {
			// A bare specifier - `react`, `esbuild`, `@tanstack/react-query` - that
			// IS installed is outside this repository by construction, so no diff in
			// it can be the dependency. Checked against disk rather than assumed:
			// "not installed" is the answer that has to land in the unresolved
			// class, because a specifier that names neither this repository nor an
			// installed package is one this graph cannot account for.
			return { kind: "external" };
		} else if (MODULE_SHAPED.test(clean)) {
			// Module-shaped, but neither a path in this repository nor an installed
			// package: a name this graph cannot account for, which is the
			// unresolved class rather than a dependency to ignore.
			return {
				kind: "unresolved",
				reason: `specifier "${clean}" (from ${fromFile}) is neither a repo path nor an installed package`,
			};
		} else {
			// Not module-shaped at all - a sentence fragment the statement pattern
			// caught next to a keyword. Nothing can resolve it, and no diff in this
			// repository can be it.
			return { kind: "prose" };
		}
	}
	for (const candidate of candidates) {
		for (const extension of FILE_EXTENSIONS) {
			const path = `${candidate}${extension}`;
			if (existsSync(path) && !isDirectory(root, relative(root, path))) {
				return { kind: "file", path: relative(root, path).replace(/\\/g, "/") };
			}
		}
		for (const extension of INDEX_EXTENSIONS) {
			const path = join(candidate, `index${extension}`);
			if (existsSync(path)) {
				return { kind: "file", path: relative(root, path).replace(/\\/g, "/") };
			}
		}
	}
	return {
		kind: "unresolved",
		reason: `no file for specifier "${clean}" (from ${fromFile})`,
	};
}

/**
 * Every static module specifier in a file's text.
 *
 * Anchored to the four statements that actually carry one - `import x from`, a
 * bare `import "x"`, `export ... from`, `import(...)`/`require(...)` - rather
 * than to the keyword followed by any quoted string. The loose version matched
 * English prose (`... far from "this app may use it"`) and the string arguments
 * of unrelated calls, and every such match became an unresolved reference that
 * selected a whole test file for no reason. Over-selection is safe but it is not
 * free: a scope line that always says "run everything" is the change not
 * working, so the pattern has to be about statements.
 *
 * A specifier carrying `${}` is returned as INTERPOLATED rather than resolved:
 * it names something the graph cannot know (`import(\`./src/${name}.ts\`)`), so
 * the caller must treat it as an unresolved class.
 */
function specifiersOf(text) {
	const found = [];
	// The KEYWORD is required before `from`, and a line anchor is deliberately
	// NOT used. Requiring `import`/`export` is what keeps English prose
	// (`... far from "the app"`) out of a scan whose every hit becomes a
	// dependency; anchoring the keyword to the start of a line would drop the
	// roots this graph is built from, because several files write their esbuild
	// entry as a single-line template
	// (`const spec = `export * from "./src/..."`;`).
	const reExport = /\b(?:import|export)\b[^\n]*?\bfrom\s*["']([^"'\n]+)["']/g;
	const sideEffect = /\bimport\s*["']([^"'\n]+)["']/g;
	const dynamic =
		/\b(?:import|require)\s*\(\s*(?:"([^"\n]+)"|'([^'\n]+)'|`([^`\n]*)`)/g;
	for (const match of text.matchAll(reExport)) {
		found.push({ spec: match[1], interpolated: match[1].includes("${") });
	}
	for (const match of text.matchAll(sideEffect)) {
		found.push({ spec: match[1], interpolated: match[1].includes("${") });
	}
	for (const match of text.matchAll(dynamic)) {
		const literal = match[1] ?? match[2];
		if (literal === undefined) {
			found.push({ spec: match[3] ?? "", interpolated: true });
			continue;
		}
		// A quoted specifier can still be interpolated: several of these files build
		// a bundle as TEXT, and the `${}` inside it belongs to the generated module
		// rather than to this one. The generated target is what runs, so the
		// specifier is only as knowable as the template that produced it.
		found.push({ spec: literal, interpolated: literal.includes("${") });
	}
	return found;
}

/** A URL scheme, or a `data:` bundle: a target that is not a repo path at all. */
function isSchemeSpecifier(spec) {
	return SCHEME_PREFIX.test(spec);
}

/**
 * The text of the first argument of the call whose `(` ends at `openIndex`.
 *
 * A balanced scan rather than a regex because the arguments in this suite are
 * routinely multi-line `join(...)` calls; a regex that stopped at the first `)`
 * would read `readdirSync(join(root, "x"))` as `join(root, "x"` and then ground
 * it on the wrong thing.
 */
function firstArgument(text, openIndex) {
	let depth = 0;
	for (let index = openIndex; index < text.length; index += 1) {
		const char = text[index];
		if (char === "(") depth += 1;
		else if (char === ")") {
			depth -= 1;
			if (depth === 0) return text.slice(openIndex + 1, index);
		}
	}
	return text.slice(openIndex + 1);
}

/**
 * Substitute the values of local `const` bindings into a `${}`-interpolated text.
 *
 * Several files build a module specifier out of a directory constant:
 * `` `./${SOURCE}/run-detail-model` `` where `SOURCE` is `"src/renderer/src/features"`.
 * That is not an unboundable specifier - the value is written down one line up -
 * so the graph can resolve it exactly as it resolves a literal, and only a
 * `${\u2026}` that survives substitution (a loop variable, a parameter) is the
 * unresolved class.
 */
function substituteBindings(text, bindings, depth = 0) {
	if (depth > BINDING_DEPTH) return text;
	return text.replace(/\$\{([A-Za-z_$][\w$]*)\}/g, (match, name) => {
		const value = bindings.get(name);
		if (value === undefined) return match;
		// A binding captured with its quotes is substituted without them; anything
		// that is not a bare literal keeps its text and stays interpolated.
		const literal = /^\s*(["'`])(.*)\1\s*$/.exec(value);
		return literal ? literal[2] : value.trim();
	});
}

/** Local `const`/`let` bindings of a file, for grounding call arguments. */
function bindingsOf(text) {
	const bindings = new Map();
	for (const match of text.matchAll(BINDING_PATTERN)) {
		if (!bindings.has(match[1])) bindings.set(match[1], match[2]);
	}
	// `for (const file of readdirSync(tmp)) { readFileSync(file) }` is grounded by
	// what it iterates: the loop variable IS a path inside that listing, so
	// without this the commonest temp-dir fixture in the suite reads as an
	// unresolved class and drags its whole file into every run.
	for (const match of text.matchAll(FOR_OF_BINDING)) {
		if (!bindings.has(match[1])) bindings.set(match[1], match[2]);
	}
	return bindings;
}

/**
 * Expand a call argument through local bindings until it is grounded or not.
 *
 * Only identifiers bound IN THIS FILE are followed, and only `BINDING_DEPTH`
 * levels: the point is to see `readdirSync(HOOKS_DIR)` as the `src/...` path its
 * declaration carries, not to interpret the program. An identifier that is a
 * parameter, an import or a value computed from other data stays opaque, which
 * is the honest answer and lands the call in the unresolved class.
 */
function expandArgument(argument, bindings, depth = 0, seen = new Set()) {
	if (depth > BINDING_DEPTH) return argument;
	let expanded = argument;
	for (const match of argument.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
		const name = match[1];
		if (seen.has(name)) continue;
		const value = bindings.get(name);
		if (value === undefined) continue;
		seen.add(name);
		expanded += ` ${expandArgument(value, bindings, depth + 1, seen)}`;
	}
	return expanded;
}

/**
 * Functions whose every argument is enumerable AT ITS CALL SITES.
 *
 * WHY THIS IS NEEDED. The commonest shape in this suite is a two-line local
 * helper - `const source = (path) => readFileSync(path, "utf8")`, or
 * `function pycFilesUnder(dir)` - whose call sites all pass a literal path. Read
 * on its own, `readFileSync(path, "utf8")` cannot be grounded in anything, and a
 * rule that stops there selects the whole file for every diff. But the value
 * `path` can take is written down: it is the argument at each call of a helper
 * that never leaves this file. So the parameter is grounded exactly when the
 * helper is CLOSED - named nowhere but its own definition and its call sites (no
 * pass-through as a value, no `obj[name]`), with every call-site argument itself
 * grounded - which is what this computes.
 *
 * WHAT IT REFUSES. A helper whose name appears anywhere it is not called escapes
 * this file (exported, passed to `.map`, stored in an object), so its parameters
 * stay ungrounded; a parameter shared by two definitions stays ungrounded; a
 * parameter with a default or a destructuring pattern stays ungrounded; a call
 * whose argument is not itself grounded stays ungrounded. Every one of those
 * leaves the owning file in the always-selected set, which is the fail-closed
 * direction - this rule may only ever ADD evidence about what a file can read.
 */
function closedHelpers(text, bindings) {
	const definitions = new Map();
	const record = (name, params) => {
		const entries = definitions.get(name) ?? [];
		entries.push(params);
		definitions.set(name, entries);
	};
	for (const match of text.matchAll(HELPER_FUNCTION))
		record(match[1], match[2]);
	for (const match of text.matchAll(HELPER_ARROW)) record(match[1], match[2]);

	const closed = new Map();
	for (const [name, recorded] of definitions) {
		// Two definitions of one name (a shadowed helper) make "every call site"
		// unanswerable.
		if (recorded.length !== 1) continue;
		const params = recorded[0]
			.split(",")
			.map((param) => param.trim())
			.filter(Boolean);
		if (params.length === 0) continue;
		if (!params.every((param) => IDENTIFIER.test(param))) continue;

		const mentions = [...text.matchAll(wordPattern(name))];
		const calls = mentions.filter((match) => {
			const after = text.slice(match.index + name.length);
			const before = text.slice(Math.max(0, match.index - 9), match.index);
			return /^\s*\(/.test(after) && !/function\s*$/.test(before);
		});
		// `mentions` counts every appearance; one that is neither a call nor the
		// assignment that defines an arrow is a value this helper was handed to,
		// which is the escape this refuses.
		const arrows = mentions.filter((match) =>
			/^\s*=\s*\(?[^=()]*\)?\s*=>/.test(text.slice(match.index + name.length)),
		);
		if (mentions.length !== calls.length + arrows.length) continue;
		if (calls.length === 0) continue;

		const callArguments = calls.map((match) =>
			firstArgument(text, match.index + match[0].length - 1),
		);
		if (
			!callArguments.every((argument) =>
				argumentIsGrounded(expandArgument(argument, bindings)),
			)
		) {
			continue;
		}
		closed.set(name, { params, callArguments });
	}
	return closed;
}

/** `\bNAME\b` as a pattern, for counting the mentions of one name. */
function wordPattern(name) {
	return new RegExp(`\\b${name}\\b`, "g");
}

/**
 * The text of the first top-level argument in an argument list.
 *
 * `readFileSync("package.json", "utf8")` names a fixed target in its FIRST
 * argument, and testing the whole list as one literal says it does not. Only the
 * first argument is cut, and the cut is a scan rather than a parse: a wrong cut
 * makes the evidence text smaller, which can only ever ground FEWER reads.
 */
function firstTopLevelArgument(argumentList) {
	let depth = 0;
	let quote = "";
	for (let index = 0; index < argumentList.length; index += 1) {
		const char = argumentList[index];
		if (quote) {
			if (char === "\\") index += 1;
			else if (char === quote) quote = "";
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			quote = char;
			continue;
		}
		if ("([{".includes(char)) depth += 1;
		else if (")]}".includes(char)) depth -= 1;
		else if (char === "," && depth === 0) return argumentList.slice(0, index);
	}
	return argumentList;
}

/** Whether an expanded argument is grounded in a path literal or an outside dir. */
function argumentIsGrounded(expanded) {
	if (TOKEN_PATTERN.test(expanded)) {
		// The pattern is stateful (`g`); reset it so the next call starts clean.
		TOKEN_PATTERN.lastIndex = 0;
		return true;
	}
	TOKEN_PATTERN.lastIndex = 0;
	if (OUTSIDE_MARKERS.some((marker) => expanded.includes(marker))) return true;
	// A single string literal with no interpolation names one fixed target, and
	// one this repository may or may not contain - `import("react")`, a
	// `node_modules` path, a fixture beside the test. It cannot be a path built
	// from data, which is the class this check exists to catch. Quotes escaped for
	// a generated script (several of these files write one as TEXT) are still that
	// same literal, so they are unescaped before the test rather than counted as
	// unprovable.
	const literal = expanded.trim().replace(/\\"/g, '"').replace(/\\'/g, "'");
	return PURE_LITERAL.test(literal);
}

/**
 * Everything one test file may read, and the reasons it cannot be proven to have
 * listed everything.
 *
 * `paths` are exact repo-relative files; `subtrees` are repo-relative directory
 * prefixes, each of which covers every file beneath it. `unbounded` is a list of
 * human reasons, non-empty exactly when some reference could not be grounded.
 */
export function analyseTestFile(root, file, aliases) {
	const text = readFileSync(join(root, file), "utf8");
	const paths = new Set();
	const subtrees = new Set();
	const unbounded = [];
	const roots = new Set();
	const bindings = bindingsOf(text);

	for (const { spec, interpolated } of specifiersOf(text)) {
		if (isSchemeSpecifier(spec)) continue;
		// A specifier assembled from a local constant is resolved after the
		// substitution; one that is still `${}` afterwards names something only the
		// runtime knows.
		const resolvedSpec = interpolated
			? substituteBindings(spec, bindings)
			: spec;
		if (resolvedSpec.includes("${")) {
			unbounded.push(
				`${file}: module specifier is built at runtime (\`${spec.slice(0, 40)}\`)`,
			);
			continue;
		}
		const resolution = resolveSpecifier(resolvedSpec, file, root, aliases);
		if (resolution.kind === "external" || resolution.kind === "prose") continue;
		if (resolution.kind === "unresolved") {
			unbounded.push(resolution.reason);
			continue;
		}
		paths.add(resolution.path);
		if (isDirectory(root, resolution.path)) subtrees.add(`${resolution.path}/`);
		roots.add(resolution.path);
	}

	if (text.includes("import.meta.glob")) {
		unbounded.push(
			`${file}: import.meta.glob builds its module list at build time`,
		);
	}

	for (const match of text.matchAll(TOKEN_PATTERN)) {
		const token = match[1].replace(TRAILING_PUNCTUATION, "");
		if (!token || token.length < 3) continue;
		if (isDirectory(root, token)) subtrees.add(`${token}/`);
		// The literal is recorded even when nothing exists at it: a diff that
		// ADDS that path is exactly the diff this reference is about.
		paths.add(token);
	}

	const closed = closedHelpers(text, bindings);
	for (const match of text.matchAll(READ_CALL_PATTERN)) {
		const openIndex = match.index + match[0].length - 1;
		const argument = firstArgument(text, openIndex);
		const expanded = expandArgument(argument, bindings);
		if (
			argumentIsGrounded(expanded) ||
			argumentIsGrounded(firstTopLevelArgument(expanded))
		) {
			continue;
		}
		// The parameters of a closed helper are grounded by its call sites, so every
		// argument those calls pass is evidence for this read: if the read mentions
		// such a parameter, the values it can receive are exactly the ones written at
		// the call sites, and those are grounded by construction.
		const evidence = [expanded];
		for (const helper of closed.values()) {
			if (helper.params.some((param) => wordPattern(param).test(expanded))) {
				evidence.push(...helper.callArguments);
			}
		}
		if (argumentIsGrounded(evidence.join(" "))) continue;
		const call = match[1];
		const shown = argument.trim().replace(/\s+/g, " ").slice(0, 60);
		unbounded.push(`${file}: ${call}(${shown}) is not grounded in a path`);
	}

	for (const match of text.matchAll(NEW_URL_LITERAL)) {
		const resolution = resolveSpecifier(match[1], file, root, aliases);
		if (resolution.kind === "file") paths.add(resolution.path);
	}

	return { file, paths, subtrees, roots: [...roots], unbounded };
}

/**
 * The transitive static import closure of a set of modules.
 *
 * `unresolved` carries every specifier that could not be resolved, for the same
 * reason `analyseTestFile` reports them: the caller must treat the owning test as
 * unprovable rather than as unaffected.
 */
export function moduleClosure(root, entries, aliases, closure = new Set()) {
	const queue = [...entries];
	const unresolved = [];
	while (queue.length > 0) {
		const file = queue.shift();
		if (closure.has(file)) continue;
		closure.add(file);
		if (!MODULE_EXTENSION.test(file)) continue;
		let text;
		try {
			text = readFileSync(join(root, file), "utf8");
		} catch {
			unresolved.push(`${file}: unreadable while walking its imports`);
			continue;
		}
		for (const { spec, interpolated } of specifiersOf(text)) {
			if (isSchemeSpecifier(spec)) continue;
			if (interpolated) {
				unresolved.push(
					`${file}: module specifier is built at runtime (\`${spec.slice(0, 40)}\`)`,
				);
				continue;
			}
			const resolution = resolveSpecifier(spec, file, root, aliases);
			if (resolution.kind === "external" || resolution.kind === "prose")
				continue;
			if (resolution.kind === "unresolved") {
				unresolved.push(resolution.reason);
				continue;
			}
			if (!closure.has(resolution.path)) queue.push(resolution.path);
		}
	}
	return { closure, unresolved };
}

/** A path the diff changed, normalised to repo-relative POSIX form. */
function normalisePath(path) {
	const trimmed = String(path ?? "")
		.replace(/\\/g, "/")
		.trim();
	return trimmed.startsWith("./") ? trimmed.slice(2) : trimmed;
}

/**
 * The decision: which files to run, or which rule refused to narrow.
 *
 * `paths` is passed in rather than collected here so the rules can be tested
 * against a literal change set (see `desktop-test-scope.test.mjs`), and
 * `collectPaths`/`resolveBase` - the classifier's own git plumbing - stay the
 * only way either of them is answered in a real run.
 */
export function planDesktopTestScope({ paths, root, suite = null }) {
	const changed = [...new Set(paths.map(normalisePath).filter(Boolean))].sort();
	const whole = (reason) => ({
		mode: SCOPE_MODES.WHOLE,
		files: [],
		reason,
		detail: { changed },
	});
	const none = (reason, detail = {}) => ({
		mode: SCOPE_MODES.NONE,
		files: [],
		reason,
		detail: { changed, ...detail },
	});

	if (changed.length === 0) {
		return none(
			"no changed paths: nothing in the suite can be observing this diff",
		);
	}

	// The classifier answers the cheap end of the range, and its own reason is
	// carried through so the two modules cannot disagree about WHY nothing ran.
	const flags = classify(changed, "");
	if (flags.unit !== true) {
		return none(`classifier sets no unit flag: ${FLAG_REASONS.unit}`);
	}

	const suiteFiles = suite === null ? readSuiteFiles(root) : [...suite];
	const suiteSet = new Set(suiteFiles);
	if (suiteSet.size === 0) {
		return whole("the suite list in package.json could not be read");
	}

	const testChanges = [];
	const sourceChanges = [];
	for (const path of changed) {
		const category = categoryOf(path);
		if (category === "docs") {
			// Prose. The classifier treats it as inert - no job in the workflow set
			// reads it, and the desktop suite's own `docs/` hits are comments - so a
			// document next to code the diff ALSO touches must not drag the whole
			// suite in with it. Failing closed on it would make every pull request
			// that edits a README run everything, which is the cost this change
			// exists to remove.
			continue;
		}
		if (category !== "other") {
			// `ci`, `manifest`, `lock`, `evidence`: the classifier already treats
			// each as an input to the whole job set, and evidence is read at
			// runtime by tests whose paths this graph does not model.
			return whole(
				`structural change: ${path} (classifier category "${category}")`,
			);
		}
		if (suiteSet.has(path)) {
			testChanges.push(path);
			continue;
		}
		if (path.startsWith("src/")) {
			sourceChanges.push(path);
			continue;
		}
		if (isNamedLivePath(path)) {
			// `scripts/` (rigs, gates, fixtures), `bin/`, `build/`,
			// `resources/`, `tsconfig*.json`, `biome.json`, the vite config: every
			// one of them is an input the suite reads as a whole, and none of them
			// is a module the per-test graph can attribute to a file.
			return whole(
				`structural change: ${path} (named live tree, not a suite test file)`,
			);
		}
		return whole(`unrecognised path: ${path} (fail closed rather than guess)`);
	}

	if (sourceChanges.length === 0 && testChanges.length === 0) {
		return none(
			"every changed path is classified inert and no suite test file moved",
			{ sourceChanges, testChanges },
		);
	}

	const aliases = aliasTable(root);
	const selected = new Map();
	const alwaysSelected = [];
	const unresolvedClasses = [];
	const referenced = new Set();

	for (const file of suiteFiles) {
		if (testChanges.includes(file)) {
			selected.set(file, "the test file itself changed");
			continue;
		}
		let analysis;
		try {
			analysis = analyseTestFile(root, file, aliases);
		} catch (error) {
			// A file the model cannot even read is not a file it may skip.
			selected.set(file, `unreadable: ${error.message}`);
			continue;
		}
		if (analysis.unbounded.length > 0) {
			selected.set(
				file,
				`unresolved reference class: ${analysis.unbounded[0]}${
					analysis.unbounded.length > 1
						? ` (+${analysis.unbounded.length - 1} more)`
						: ""
				}`,
			);
			alwaysSelected.push(file);
			unresolvedClasses.push(...analysis.unbounded);
			continue;
		}
		const direct = sourceChanges.find(
			(path) =>
				analysis.paths.has(path) ||
				[...analysis.subtrees].some((prefix) => path.startsWith(prefix)),
		);
		if (direct !== undefined) {
			selected.set(file, `references ${direct}`);
			for (const path of analysis.paths) referenced.add(path);
			continue;
		}
		if (sourceChanges.length > 0) {
			const { closure, unresolved } = moduleClosure(
				root,
				analysis.roots,
				aliases,
			);
			if (unresolved.length > 0) {
				selected.set(
					file,
					`unresolved reference class: ${unresolved[0]}${
						unresolved.length > 1 ? ` (+${unresolved.length - 1} more)` : ""
					}`,
				);
				alwaysSelected.push(file);
				unresolvedClasses.push(...unresolved);
				continue;
			}
			const imported = sourceChanges.find((path) => closure.has(path));
			if (imported !== undefined) {
				selected.set(file, `imports ${imported}`);
				for (const path of closure) referenced.add(path);
			}
		}
	}

	if (selected.size === 0) {
		return none(
			`no suite file reaches ${sourceChanges.length} changed source path(s): ${sourceChanges
				.slice(0, 3)
				.join(", ")}${sourceChanges.length > 3 ? ", ..." : ""}`,
			{ sourceChanges, testChanges, suite: suiteSet.size },
		);
	}

	return {
		mode: SCOPE_MODES.SCOPED,
		files: [...selected.keys()].sort(),
		reason: `${
			selected.size - alwaysSelected.length
		} of ${suiteSet.size} suite files are reachable; ${alwaysSelected.length} always-selected (unresolved reference class)`,
		detail: {
			changed,
			sourceChanges,
			testChanges,
			suite: suiteSet.size,
			reasons: selected,
			alwaysSelected,
			unresolvedClasses: [...new Set(unresolvedClasses)],
			referenced: [...referenced].sort(),
		},
	};
}

/** Collect the diff and plan, in one call, for a real run. */
export function planFromGit({ root, since = "origin/main" }) {
	const base = resolveBase(since, root);
	if (base === null) {
		return {
			mode: SCOPE_MODES.WHOLE,
			files: [],
			reason: `could not resolve a diff base from "${since}" (refusing to guess a change set)`,
			detail: { changed: [] },
		};
	}
	const paths = collectPaths(base, true, root);
	if (paths === null) {
		return {
			mode: SCOPE_MODES.WHOLE,
			files: [],
			reason:
				"git could not report the change set (refusing to read that as an empty diff)",
			detail: { changed: [] },
		};
	}
	const plan = planDesktopTestScope({ paths, root, base });
	return { ...plan, base };
}

/** The one line a reader uses to know what ran, and why. */
export function formatScopeLine(plan, { total = null } = {}) {
	const head = `desktop scope [${plan.mode}]: ${plan.reason}`;
	const base = plan.base ? `, base ${plan.base.slice(0, 9)}` : "";
	if (plan.mode === SCOPE_MODES.SCOPED) {
		return `${head}${base}, running ${plan.files.length}${
			total === null ? "" : `/${total}`
		} file(s)`;
	}
	return `${head}${base}`;
}
