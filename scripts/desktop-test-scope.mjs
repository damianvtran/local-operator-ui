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

/**
 * How many BINDING HOPS an argument is resolved through before giving up.
 *
 * A hop is an identifier replaced by its initializer - the thing that can run
 * away. Descending into a member, a call's arguments or a concatenation strictly
 * shrinks the expression and is free, which matters because `new URL("./x",
 * import.meta.url)` used to spend the whole budget on its own arguments.
 */
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
	let text;
	try {
		text = readFileSync(join(root, ALIAS_SOURCE), "utf8");
	} catch {
		// Not every root this module is asked about is a checkout of this
		// repository - the runner's own tests plan inside temp fixtures - and an
		// unreadable alias source is a reason to refuse to narrow, never a crash
		// halfway through planning.
		return null;
	}
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
	/*
	 * The pattern carries `/` so a suite file in a subdirectory is part of the list
	 * rather than silently missing from it (review round 1, MINOR-2); the second
	 * scan is what keeps that from having to be true by inspection - every token
	 * that looks like a test file must come back from the first one, or the list is
	 * not the list CI runs and the caller has to fail closed rather than call the
	 * rest "the suite".
	 */
	const pattern = /scripts\/[\w./-]+\.test\.mjs/g;
	const files = (command.match(pattern) ?? []).map((path) =>
		path.replace(/\\/g, "/"),
	);
	const mentioned = (command.match(/[^\s"']+\.test\.mjs/g) ?? []).map((path) =>
		path.replace(/\\/g, "/"),
	);
	const seen = new Set(files);
	const unparsed = [...new Set(mentioned.filter((path) => !seen.has(path)))];
	if (unparsed.length > 0) {
		throw new Error(
			`the test:desktop list names test files this module cannot read as suite entries: ${unparsed.join(", ")}`,
		);
	}
	return [...seen];
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
function isInstalledPackage(root, specifier, cache = INSTALLED_PACKAGES) {
	const cacheKey = `${root}\u0000${specifier}`;
	if (cache.has(cacheKey)) return cache.get(cacheKey);
	let answer = false;
	try {
		const resolved = requireFor(root).resolve(specifier);
		answer = typeof resolved === "string" && resolved.length > 0;
	} catch {
		answer = false;
	}
	cache.set(cacheKey, answer);
	return answer;
}

/**
 * Whether a bare specifier is installed: a fact about the filesystem, answered
 * once per process. It is asked for every bare specifier of every module in every
 * closure, and each answer costs a resolver walk.
 */
const INSTALLED_PACKAGES = new Map();

/**
 * One `createRequire` per resolved root.
 *
 * `resolveSpecifier` asks this question for every bare specifier of every module
 * in the closure, and building a resolver each time walks the same directory
 * up and back. The roots in one plan are a handful, so the instances are kept.
 */
const REQUIRE_FOR_ROOT = new Map();
function requireFor(root) {
	let require = REQUIRE_FOR_ROOT.get(root);
	if (require === undefined) {
		require = createRequire(join(root, "package.json"));
		REQUIRE_FOR_ROOT.set(root, require);
	}
	return require;
}

/**
 * Resolve one module specifier to a repo-relative file, or say why it could not.
 *
 * `external` (a bare package name) is the one answer that is not a failure: it
 * is by construction outside this repository, so nothing in the diff can be it.
 */
export function resolveSpecifier(spec, fromFile, root, aliases, cache = null) {
	const cacheKey =
		cache === null ? null : `${fromFile}\u0000${spec}\u0000${root}`;
	if (cacheKey !== null && cache.has(cacheKey)) return cache.get(cacheKey);
	const resolved = resolveSpecifierUncached(spec, fromFile, root, aliases);
	if (cacheKey !== null) cache.set(cacheKey, resolved);
	return resolved;
}

/**
 * Resolution WITHOUT the cache `resolveSpecifier` keeps around it.
 *
 * Split out so the memo is a wrapper rather than a conditional through the body:
 * a resolver that returns early from six places is a resolver where a missed
 * `cache.set` is invisible, and this module's whole claim is that a missing
 * resolution is reported rather than assumed.
 */
function resolveSpecifierUncached(spec, fromFile, root, aliases) {
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
export function bindingsOf(text) {
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

/** A quoted string with no interpolation: it can only hold its own characters. */
const QUOTED_LITERAL = /^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/;

/** A backtick literal, interpolated or not. */
const TEMPLATE_LITERAL = /^`[\s\S]*`$/;

/** Calls whose value is a path when every argument of them is a path. */
const PATH_CALL_NAMES = new Set([
	"join",
	"resolve",
	"fileURLToPath",
	"dirname",
	"normalize",
	"realpathSync",
	"pathToFileURL",
]);

/** `new URL(<literal>, import.meta.url)`, which several files use as a root. */
const NEW_URL_CALL = /^new\s+URL\s*\(([\s\S]*)\)$/;

/**
 * The same call with its closing paren missing.
 *
 * `BINDING_PATTERN` captures a binding up to the first `;`, so a call written
 * across lines whose last line is `);` loses its final paren:
 * `new URL(\n\t"./_x.bundle.mjs",\n\timport.meta.url,` is what arrives. The value is
 * still built out of the arguments that were captured - a missing piece can only
 * leave a reference UNDER-grounded, which the caller handles by failing closed.
 */
const NEW_URL_OPEN = /^new\s+URL\s*\(([\s\S]*)$/;

/**
 * A property access whose OWN text may be taken as a path or a root.
 *
 * Only a base that names the environment or the module's own location is here. A
 * property of a value the file holds - `entry.path`, `list.files` - is DATA, and
 * data is the shape review round 1's blocker arrived as, so it is refused rather
 * than scanned for tokens.
 */
const RECOGNISED_PATH_BASE =
	/^(?:import\.meta|process\.env|process|path|os|__dirname|__filename)\b/;

/** A `base.split(...)`/`.slice(...)` whose value still comes from `base`. */
const DERIVED_PATH =
	/^([\s\S]+?)\.(?:replace|replaceAll|slice|substring|trim|toString)\s*\(/;

/**
 * The text of an expression whose VALUE must be built out of the paths written in
 * it, or `null` when that cannot be proven.
 *
 * WHY THIS IS NOT A TEXT EXPANSION. Grounding a read by concatenating the source
 * of every binding whose NAME occurs in its argument lets a repo literal in a
 * DIFFERENT expression ground a dynamic one: with
 * `const list = JSON.parse(readFileSync("scripts/fixtures/list.json", "utf8"))`
 * and `readFileSync(entry.path)` inside `for (const entry of list.files)`, the
 * fixture's own path grounded `entry.path` - so a diff to the file that test reads
 * selected nothing, printed `[none]`, and exited 0. Review round 1, BLOCKER-1. The
 * token has to come from the expression the read actually depends on, so this
 * walks that expression's own chain and answers one question per node: is this
 * value necessarily built out of path text?
 *
 * The rules are a WHITELIST, because `null` is the load-bearing answer: a string
 * literal is its own value; `join`/`resolve`/`fileURLToPath`/`dirname`/`new URL`
 * are when every argument is; `+` is when both sides are; a `.replace`/`.slice` of
 * a path is; a `const` binding is when its initializer is; a `for…of` variable is
 * when the thing it iterates is a listing of a directory this repository or the
 * host knows. EVERYTHING ELSE - a call result, a parsed fixture, a property of
 * data, a parameter, an import, a loop variable over data - is `null`, and the
 * caller then fails closed rather than guessing. A shape nobody wrote a rule for
 * is therefore ungrounded, not "probably fine".
 */
export function pathExpressionText(
	expression,
	bindings,
	depth = 0,
	seen = new Set(),
) {
	if (depth > BINDING_DEPTH) return null;
	let text = expression.trim();
	while (isWrapped(text)) text = text.slice(1, -1).trim();
	if (text.length === 0) return null;
	if (QUOTED_LITERAL.test(text)) return text;
	if (TEMPLATE_LITERAL.test(text)) {
		if (!text.includes("${")) return text;
		return substitutePathTemplate(text, bindings, depth, seen);
	}

	// `readdirSync(dir)` and friends: every entry is a CHILD of `dir`, so the
	// directory's own text is what grounds them - and a listing we cannot resolve
	// leaves the entries ungrounded, which is the fixture-driven case.
	const listing =
		/^(?:readdirSync|readdir|globSync|glob)\s*\(([\s\S]*)\)$/.exec(text);
	if (listing) {
		// Same depth: this is a descent, not a hop through a binding.
		return pathExpressionText(
			firstTopLevelArgument(listing[1]),
			bindings,
			depth,
			seen,
		);
	}

	/*
	 * Calls whose RESULT is outside this repository by construction - a temp
	 * directory, the home directory. Their own text carries the marker that says so
	 * (`tmpdir`, `mkdtemp`), which is the same evidence the rest of this module uses
	 * for "not a path in this repository", so the answer is the call's own text.
	 */
	const outsideCall =
		/^(?:[\w$.]+\s*\.\s*)?(mkdtempSync|mkdtemp|tmpdir|homedir|randomUUID)\s*\(/.exec(
			text,
		);
	if (outsideCall) return text;

	const url = NEW_URL_CALL.exec(text) ?? NEW_URL_OPEN.exec(text);
	if (url) return everyArgumentText(url[1], bindings, depth, seen);

	const call =
		/^(?:([A-Za-z_$][\w$.]*)\s*\.\s*)?([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)$/.exec(
			text,
		) ??
		/^(?:([A-Za-z_$][\w$.]*)\s*\.\s*)?([A-Za-z_$][\w$]*)\s*\(([\s\S]*)$/.exec(
			text,
		);
	if (call) {
		// A call's value is path text only for the path operations themselves. Any
		// other call - `JSON.parse(...)`, a helper, `.map(...)` - returns something
		// this module cannot see into, which is null.
		if (!PATH_CALL_NAMES.has(call[2])) return null;
		return everyArgumentText(call[3], bindings, depth, seen);
	}

	// An array literal of paths, which is how several fixtures iterate.
	if (text.startsWith("[") && text.endsWith("]")) {
		const parts = topLevelArguments(text.slice(1, -1)).map((part) =>
			pathExpressionText(part, bindings, depth, seen),
		);
		if (parts.length === 0 || parts.some((part) => part === null)) return null;
		return parts.join(" ");
	}

	const derived = DERIVED_PATH.exec(text);
	if (derived) {
		// The value still comes from the base; the replacement or the slice width is
		// not something this module pretends to evaluate.
		return pathExpressionText(derived[1], bindings, depth + 1, seen);
	}

	/*
	 * A member of a path expression whose base this module CAN resolve:
	 * `bundlePath.href` where `bundlePath` is `new URL("./_x.bundle.mjs",
	 * import.meta.url)`, which is how most of this suite hands a built bundle to
	 * `import()`. The base resolving is what makes this safe - `entry.path` and
	 * `list.files` are members of DATA, and their base does not resolve.
	 */
	const member = /^([\s\S]+?)\.(href|pathname|path|url|toString)$/.exec(text);
	if (member) {
		const base = pathExpressionText(member[1], bindings, depth, seen);
		return base === null ? null : `${base} ${text}`;
	}

	if (IDENTIFIER.test(text)) {
		if (RECOGNISED_PATH_BASE.test(text)) return text;
		if (seen.has(text)) return null;
		const value = bindings.get(text);
		if (value === undefined) return null;
		return pathExpressionText(
			value,
			bindings,
			depth + 1,
			new Set([...seen, text]),
		);
	}

	if (text.includes(".")) {
		return RECOGNISED_PATH_BASE.test(text) ? text : null;
	}

	const plus = splitTopLevelPlus(text);
	if (plus) {
		const parts = plus.map((part) =>
			pathExpressionText(part, bindings, depth, seen),
		);
		if (parts.some((part) => part === null)) return null;
		return parts.join(" ");
	}

	return null;
}

/** The one file this module reads for the vite alias table. */
const ALIAS_SOURCE = "electron.vite.config.js";

/** The concatenated text of every top-level argument, or `null` if any fails. */
function everyArgumentText(argumentList, bindings, depth, seen) {
	const parts = topLevelArguments(argumentList).map((part) =>
		pathExpressionText(part, bindings, depth, seen),
	);
	if (parts.length === 0 || parts.some((part) => part === null)) return null;
	return parts.join(" ");
}

/**
 * A `${}`-interpolated template whose holes are all path expressions.
 *
 * Each hole is resolved with the same rules as the argument itself, so
 * `` `./${SOURCE}/x` `` where `SOURCE` is a string literal resolves - the value is
 * written down one line up - while a hole holding a loop variable or a call result
 * does not, and the template returns `null`. That is the same fail-closed answer
 * the specifier path already gives for a `${}` that survives substitution.
 */
function substitutePathTemplate(text, bindings, depth, seen) {
	const body = text.replace(/\$\{([^}]*)\}/g, (match, inner) => {
		const resolved = pathExpressionText(inner, bindings, depth, seen);
		return resolved === null ? match : resolved.replace(/^["'`]|["'`]$/g, "");
	});
	return body.includes("${") ? null : body;
}

/** Whether the text is one balanced `(...)` around everything inside it. */
function isWrapped(text) {
	if (!text.startsWith("(") || !text.endsWith(")")) return false;
	let depth = 0;
	let quote = "";
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (quote) {
			if (char === "\\") index += 1;
			else if (char === quote) quote = "";
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			quote = char;
			continue;
		}
		if (char === "(") depth += 1;
		if (char === ")") {
			depth -= 1;
			if (depth === 0) return index === text.length - 1;
		}
	}
	return false;
}

/**
 * Split an argument list at its TOP-LEVEL commas.
 *
 * A scan rather than a parse, for the same reason `firstArgument` is: the
 * arguments in this suite are multi-line `join(...)` calls, and a comma inside
 * one of them is not a separator. Splitting wrongly can only make the pieces
 * smaller, and a piece that no longer resolves is `null`, which is the fail-closed
 * direction.
 */
function topLevelArguments(argumentList) {
	const parts = [];
	let depth = 0;
	let quote = "";
	let start = 0;
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
		else if (char === "," && depth === 0) {
			parts.push(argumentList.slice(start, index));
			start = index + 1;
		}
	}
	const last = argumentList.slice(start).trim();
	if (last.length > 0) parts.push(last);
	return parts.filter((part) => part.trim().length > 0);
}

/** Split a `+` concatenation at its top level, or `null` when there is none. */
function splitTopLevelPlus(text) {
	const parts = [];
	let depth = 0;
	let quote = "";
	let start = 0;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
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
		else if (char === "+" && depth === 0) {
			parts.push(text.slice(start, index));
			start = index + 1;
		}
	}
	if (parts.length === 0) return null;
	parts.push(text.slice(start));
	return parts;
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

		const callArguments = calls.map((match) => {
			const [first] = topLevelArguments(
				firstArgument(text, match.index + match[0].length - 1),
			);
			return first ?? "";
		});
		/*
		 * A call site grounds the helper's parameter only when the ARGUMENT IT PASSES is
		 * itself a path expression. Scanning the argument's text for a repo-shaped token
		 * is what let a fixture literal one expression away ground a dynamic read (review
		 * round 1, BLOCKER-1), so an argument that does not resolve leaves the helper
		 * open - which puts the read that uses its parameter in the unresolved class
		 * rather than in a selection that cannot be proven.
		 */
		const resolvedArguments = callArguments.map((argument) =>
			pathExpressionText(argument, bindings),
		);
		if (
			!resolvedArguments.every(
				(resolved) =>
					resolved !== null &&
					(argumentIsGrounded(resolved) ||
						argumentIsGrounded(firstTopLevelArgument(resolved))),
			)
		) {
			continue;
		}
		// The RESOLVED arguments, not the raw ones: the evidence a read is judged
		// against is the text that resolved, so a call site cannot smuggle a token in
		// through a part of its argument that is not a path expression.
		closed.set(name, { params, callArguments: resolvedArguments });
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
		/*
		 * `firstArgument` returns the WHOLE argument list (everything up to the call's
		 * closing paren), so `readFileSync(path, "utf8")` arrives as
		 * `path, "utf8"`. Only the first top-level argument is the read's target - the
		 * rest are the encoding, options, or a helper's second parameter - and
		 * resolving the list as one expression is what left a resolvable target looking
		 * unprovable.
		 */
		const [firstArgumentText] = topLevelArguments(argument);
		/*
		 * The grounding has to come from THIS expression's own chain. `resolved` is that
		 * chain or `null`; `null` means the value cannot be proven to be built from path
		 * text, and it is not settled by scanning the raw argument for a repo-shaped
		 * token - a scan that would accept `readFileSync(entry.path)` because some other
		 * expression in the file mentions a repository path. The raw text is kept for the
		 * closed-helper mention test below, which is about the read's shape rather than
		 * about its value.
		 */
		const resolved =
			firstArgumentText === undefined
				? null
				: pathExpressionText(firstArgumentText, bindings);
		/*
		 * A read whose target is a QUOTED LITERAL is a fixed path in this
		 * repository - the suite runs from the repository root - and recording it
		 * is what makes such a file selectable by the path it reads instead of
		 * merely "grounded". Without this, a test that reads `"README.md"` is
		 * bounded by nothing the graph can name, and a change to that file would
		 * select no test at all.
		 */
		const literal = resolved?.trim() ?? "";
		if (
			(QUOTED_LITERAL.test(literal) || TEMPLATE_LITERAL.test(literal)) &&
			!literal.includes("${")
		) {
			const value = literal.slice(1, -1);
			if (isRelativeRepoPath(value)) paths.add(value);
		}
		const expanded = resolved ?? argument;
		if (
			resolved !== null &&
			(argumentIsGrounded(resolved) ||
				argumentIsGrounded(firstTopLevelArgument(resolved)))
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
export function moduleClosure(
	root,
	entries,
	aliases,
	closure = new Set(),
	cache = null,
) {
	/*
	 * MEMOISED BY ITS ENTRY SET. Most of this suite's files import the same shared
	 * bundle roots, so without this the identical walk is repeated once per test
	 * file: measured at 275 s inside one ~2 min plan on a loaded host, walking the
	 * closures of 118 bounded files (review round 1, MAJOR-1). The cache belongs to
	 * one plan, so it cannot go stale between runs, and a hit contributes the same
	 * closure and the same unresolved list it would have walked.
	 */
	const key = cache === null ? null : [...entries].sort().join("\u0000");
	if (key !== null && cache.has(key)) {
		const hit = cache.get(key);
		for (const file of hit.closure) closure.add(file);
		return { closure, unresolved: [...hit.unresolved] };
	}
	const queue = [...entries];
	const unresolved = [];
	// One resolution cache per plan, shared with every closure walk it makes: the
	// specifier questions are the same ones asked over and over.
	let resolutions = null;
	if (cache !== null) {
		if (cache.resolutions === undefined) cache.resolutions = new Map();
		resolutions = cache.resolutions;
	}
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
			const resolution = resolveSpecifier(
				spec,
				file,
				root,
				aliases,
				resolutions,
			);
			if (resolution.kind === "external" || resolution.kind === "prose")
				continue;
			if (resolution.kind === "unresolved") {
				unresolved.push(resolution.reason);
				continue;
			}
			if (!closure.has(resolution.path)) queue.push(resolution.path);
		}
	}
	if (key !== null) {
		cache.set(key, { closure: [...closure], unresolved: [...unresolved] });
	}
	return { closure, unresolved };
}

/**
 * Whether a literal read target names a file in this repository.
 *
 * Relative and not a URL: `"./docs/x.png"`, `"src/main/index.ts"` and `"README.md"`
 * are all repo paths because the suite runs from the repository root, while
 * `/tmp/x`, `file:///x` and `https://x` are not paths here at all.
 */
function isRelativeRepoPath(value) {
	if (value.length === 0) return false;
	if (value.startsWith("/") || value.startsWith("~")) return false;
	return !/^[a-zA-Z][\w+.-]*:/.test(value);
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

	let suiteFiles;
	try {
		suiteFiles = suite === null ? readSuiteFiles(root) : [...suite];
	} catch (error) {
		// A suite list this module cannot read in full is not a list it may narrow
		// against: the whole suite runs, and the reason names the read.
		return whole(
			`the suite list in package.json could not be read: ${error.message}`,
		);
	}
	const suiteSet = new Set(suiteFiles);
	if (suiteSet.size === 0) {
		return whole("the suite list in package.json could not be read");
	}

	// The classifier still answers the cheap end of the range and its own reason is
	// carried through, so the two modules cannot disagree about WHY nothing ran.
	// What it may NOT do is decide before the graph has looked: a suite file that
	// RECORDS a path in the changed set is reading it, and `docs/**` is where that
	// used to be settled by category alone (review round 1, MINOR-1). So the flags
	// are read here and the NONE decision moved below the graph, where it is taken
	// on the graph's own evidence rather than on a textual guess about it.
	const flags = classify(changed, "");

	const testChanges = [];
	const sourceChanges = [];
	const referenceChanges = [];
	for (const path of changed) {
		const category = categoryOf(path);
		if (category === "docs") {
			// Prose by the classifier - but the GRAPH decides, not the category: a
			// suite file that records this path is a reader, and selecting it is both
			// cheaper and no less safe than failing closed to the whole suite, while a
			// document no suite file records contributes nothing at all (which is what
			// keeps a README change free). Review round 1, MINOR-1.
			referenceChanges.push(path);
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

	const aliases = aliasTable(root);
	// A root whose alias source cannot be read is not a root this module can reason
	// about: every unresolved-specifier question would be answered against the wrong
	// table, and the answer is a narrowed run built on it. Fail closed, with the
	// reason printed - the alternative is an uncaught ENOENT that takes the caller
	// down mid-plan rather than running the suite (found on CI, where a fixture
	// repository had a `package.json` and nothing else).
	if (aliases === null) {
		return whole(
			`the vite alias table could not be read under the plan root (${ALIAS_SOURCE} is missing)`,
		);
	}
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
		const direct = [...sourceChanges, ...referenceChanges].find(
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

	/*
	 * A file selected because the DIFF reaches it is the difference between "run
	 * this" and "run the always-selected class again". Those files are in every
	 * scoped plan by construction - their own reads are unbounded - so counting them
	 * as evidence that a diff is observable would run 68 files for a README change
	 * that nothing reads.
	 */
	const reached = [...selected.values()].filter(
		(why) =>
			why.startsWith("references ") ||
			why.startsWith("imports ") ||
			why === "the test file itself changed",
	);
	if (selected.size === 0 || (reached.length === 0 && flags.unit !== true)) {
		if (flags.unit !== true) {
			// The classifier's own sentence, because the classifier's flag is WHY
			// nothing ran - said after the graph has confirmed that nothing records
			// these paths either.
			return none(`classifier sets no unit flag: ${FLAG_REASONS.unit}`, {
				sourceChanges,
				testChanges,
				referenceChanges,
				suite: suiteSet.size,
			});
		}
		return none(
			`no suite file reaches ${
				sourceChanges.length + referenceChanges.length
			} changed path(s): ${[...sourceChanges, ...referenceChanges]
				.slice(0, 3)
				.join(", ")}${sourceChanges.length > 3 ? ", ..." : ""}`,
			{
				sourceChanges,
				testChanges,
				referenceChanges,
				suite: suiteSet.size,
				alwaysSelected,
			},
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
			referenceChanges,
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
