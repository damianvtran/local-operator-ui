#!/usr/bin/env node
/**
 * Fail when a workflow step that BUILDS or PACKS the app does not set every
 * environment variable the vite plugin refuses to build without.
 *
 * WHY THIS EXISTS. `scripts/vite-plugins/replace-backend-config.ts` throws
 * unless four variables are set - `VITE_GOOGLE_CLIENT_ID`,
 * `VITE_GOOGLE_CLIENT_SECRET`, `VITE_MICROSOFT_CLIENT_ID`,
 * `VITE_MICROSOFT_TENANT_ID` - and it does so from `config()`/`loadConfig`,
 * i.e. BEFORE compilation: a step that omits one does not produce a partial
 * artifact, it fails with `failed to load config from electron.vite.config.js`
 * and `Error: VITE_GOOGLE_CLIENT_ID is not set`. That failure is the entire
 * output of the step, and it is invisible until somebody reads one log.
 *
 * Someone therefore did not. `signed-update-candidate.yml`'s build step set the
 * signing variables and never the four, so the workflow failed in `build` on
 * every dispatch it ever had - runs 35009147986, 35011068051, 35016174653,
 * 35021403386 and 35027593846, five of five - and the `exact-update` job it
 * exists to feed (the unmodified incumbent updater driving itself onto the
 * candidate's exact signed bytes) has consequently NEVER RUN. The repository had
 * already hit this once locally and written the workaround down
 * (`docs/evidence/settings-app-updates-section/RECOVERY.md`: a plain `pnpm build`
 * exited 1 until all four were exported), which is the shape of a rule that
 * lives in prose: it is followed by whoever read it, and the next step that
 * builds is authored by whoever did not.
 *
 * WHY THE LIST IS DERIVED RATHER THAN COPIED. A second hand-written list of the
 * four names is a copy that can drift from the plugin it describes - and the
 * direction it drifts is silent: a fifth guard added to the plugin would leave
 * this check green while the new variable stayed unset in every workflow. The
 * names are therefore parsed out of the plugins themselves, and
 * `check-build-env.test.mjs` asserts the derived list is exactly these four, so
 * a change to the plugin either keeps the check honest or fails the suite.
 *
 * WHICH PLUGINS, AND WHY THAT IS WHERE THE BOUNDARY BELONGS. The names come from
 * every plugin `electron.vite.config.js` imports out of `scripts/vite-plugins/`,
 * unioned - not from `replace-backend-config.ts` alone. That closes the shape
 * this script's name promises: a second guard-bearing plugin wired into the
 * build is a second set of variables every build step needs, and reading one
 * file while a second refuses to build would leave the gate green for the
 * variable nobody set. It is not a plugin-discovery mechanism and does not try
 * to be: a guard-bearing plugin the config does NOT import (a `uses:` step, a
 * separate vite invocation, a plugin wired through another config) is missed,
 * and so is a guard written in a shape GUARDED_NAME does not match (a loop over
 * a table, `=== undefined`). When a second guard-bearing plugin is added,
 * wiring it into `electron.vite.config.js` is what puts it under this gate; if
 * it is wired in somewhere this cannot read, teach `defaultVitePlugins()` the
 * config, and if its guard is written differently, teach GUARDED_NAME the
 * shape. Both refusals below are fail-closed for the same reason: a derivation
 * that finds nothing must throw rather than clear every workflow.
 *
 * WHY THE COMMAND SET MATCHES ON TOKENS AND NOT ON SUBSTRINGS. `publish.yml`
 * discusses electron-builder in six comments inside `run:` blocks it does not
 * build in, and the check would be worthless if it cried wolf on all six - a
 * gate that is noisy on a compliant tree gets deleted rather than fixed. The
 * `run:` script is tokenized into command segments, comments are dropped the way
 * the shell drops them, and only a command in COMMAND POSITION counts. A
 * package.json script reached through `pnpm <script>` is followed one hop,
 * because `pnpm dist:mac` (how `publish.yml` builds) is `pnpm run build &&
 * electron-builder ...` and a check that missed it would miss the shape a new
 * workflow copies.
 *
 * WHY AN INVOCATION IT CANNOT FOLLOW IS A FAILURE AND NOT A SILENCE. The hop
 * walk used to return "not a build" for a `pnpm <script>` it could not resolve
 * (no such script in package.json, no such binary on disk) or could not finish
 * following (the MAX_SCRIPT_HOPS cap), which made an unresolvable build step
 * green AND absent from the report - the failure mode this repository writes
 * contracts against. Both are now reported against the workflow, the job, the
 * step and the invocation, with the reason, and they fail the run: `pnpm <word>`
 * that is neither a script nor an installed binary is a step pnpm refuses to
 * start, so it is the same class as a step that dies in the vite plugin. The cap
 * is unchanged and still documented: it is the shape that now shows up in a
 * report instead of nowhere.
 *
 * WHY THE SECRET NAME IS CHECKED TOO. Requiring the variables to be SET is not
 * enough on its own, because `VITE_GOOGLE_CLIENT_ID: ${{ secrets.GOOGLE_CLIENTID }}`
 * is set, resolves to the empty string (an unknown secret is not an error in
 * Actions), and reproduces this file's whole defect - while a swapped binding
 * (`...CLIENT_ID: secrets.GOOGLE_CLIENT_SECRET`) ships a bundle wired to the
 * wrong client, which is worse than the crash. The canonical name for each
 * required variable is therefore derived from the tree's own build steps and a
 * step that binds it to a different `secrets.*` name fails, naming both. The
 * derivation is consensus over the tree, which is the one source available: the
 * repository's secret names cannot be read from the tree, so a tree mistyped
 * the SAME way in every build step is not caught by this, and that is the
 * residual rather than an accident. A value that is empty, or absent, also
 * fails now, because it is the runtime state the plugin refuses.
 *
 * WHAT THIS DOES NOT COVER, stated rather than implied. It reads `run:` steps
 * only: a `uses:` step or a composite action that builds the app is not seen,
 * nor is a build reached through `node some-script.mjs`. It asserts the
 * variables are SET and BOUND TO A NON-EMPTY REFERENCE, not that the value is
 * valid - a placeholder literal still satisfies it, and only a real build does
 * not. And it says nothing about whether a workflow runs at all: the defect this
 * closes is a step that could never complete, not a job nobody dispatched.
 *
 * Usage: node scripts/check-build-env.mjs [--workflows <dir>] [--package <path>]
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntryPoint } from "./entry-point.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Where the checked-in workflows live. */
export const DEFAULT_WORKFLOWS_DIR = join(repoRoot, ".github", "workflows");

/** The config that decides which vite plugins the build actually loads. */
export const DEFAULT_VITE_CONFIG = join(repoRoot, "electron.vite.config.js");

/**
 * The second place `pnpm <word>` resolves a word that is not a script, and the
 * reason an unresolvable invocation can be told from a binary one: pnpm falls
 * back to an installed binary (`pnpm biome check` is this repository's own lint
 * script), so a word that is neither a script nor a `.bin` entry is the one pnpm
 * refuses to start. Read from disk rather than assumed: a fresh clone with no
 * `node_modules` cannot answer this, and `binaryExists` returns false there, so
 * the report says which command to run rather than passing the step.
 */
export const DEFAULT_BIN_DIR = join(repoRoot, "node_modules", ".bin");

/** Where the plugins the config imports live. */
export const DEFAULT_VITE_PLUGIN_DIR = join(repoRoot, "scripts", "vite-plugins");

/**
 * The import a plugin arrives through, clause and all. The binding matters
 * because "imported" is not the question this gate asks - "loaded by the build"
 * is, and a config that imports a plugin and never passes it to `plugins:` is a
 * plugin the build does not load. The specifier is written extensionless, the way
 * the config writes it; the file on disk is resolved separately.
 */
const PLUGIN_IMPORT =
	/import\s+(?:(?<only>[\w$]+)\s*,?\s*)?(?:\{(?<named>[^}]*)\})?\s*from\s+["']\.\/scripts\/vite-plugins\/(?<module>[A-Za-z0-9._-]+)["']/g;

/**
 * The guard-bearing plugins the build loads, read from the config that loads
 * them.
 *
 * `replace-backend-config.ts` alone would leave the gate green for a SECOND
 * plugin that refuses to build without its own variable, so the list is the set
 * of `scripts/vite-plugins/` modules `electron.vite.config.ts` imports. An
 * imported identifier is required to be USED elsewhere in the config, so an
 * import left behind by a removal does not quietly widen the gate; a module
 * with no guard of its own (`desktop-proxy.ts` reads its environment with
 * `||`, inside request handlers rather than at config load) contributes no
 * names and is not an error - the union is what has to be non-empty.
 *
 * Throws rather than returning an empty list: a config refactor that stops
 * matching PLUGIN_IMPORT would otherwise turn this into a gate that checks
 * nothing, which is the failure this whole file exists to prevent.
 */
export function defaultVitePlugins(
	configPath = DEFAULT_VITE_CONFIG,
	pluginDir = DEFAULT_VITE_PLUGIN_DIR,
) {
	const source = readFileSync(configPath, "utf8");
	// Imports are stripped before the usage test, or every imported module would
	// count as used by the very line that imports it.
	const body = source
		.split("\n")
		.filter((line) => !/^\s*import\b/.test(line))
		.join("\n");
	const wired = [];
	for (const match of source.matchAll(PLUGIN_IMPORT)) {
		const bindings = [
			match.groups.only,
			...(match.groups.named ?? "")
				.split(",")
				.map((entry) => entry.trim().split(/\s+as\s+/).pop())
				.filter(Boolean),
		].filter(Boolean);
		if (!bindings.some((binding) => new RegExp(`\\b${binding}\\b`).test(body)))
			continue;
		const name = match.groups.module;
		const file = [".ts", ".js", ".mjs", ".tsx"]
			.map((extension) => join(pluginDir, `${name}${extension}`))
			.find((candidate) => existsSync(candidate));
		if (file === undefined)
			throw new Error(
				`check-build-env: ${configPath} imports \`${name}\` from scripts/vite-plugins/, but no such module is on disk, so the required-variable list cannot be derived. Refusing to check against a list this file could not read.`,
			);
		if (!wired.includes(file)) wired.push(file);
	}
	if (wired.length === 0)
		throw new Error(
			`check-build-env: found no plugin imported from scripts/vite-plugins/ in ${configPath}, so the required-variable list cannot be derived from the plugins the build actually loads. Refusing to check against an empty list, because an empty list passes everything: teach PLUGIN_IMPORT in scripts/check-build-env.mjs the shape the config was refactored into.`,
		);
	return wired;
}
export const DEFAULT_PACKAGE_JSON = join(repoRoot, "package.json");

/**
 * How many package.json scripts deep an invocation is followed. Two is what
 * `pnpm dist:mac` needs (`dist:mac` -> `build`), and the bound is deliberate: an
 * unbounded walk over a cyclic script table would not terminate, and a build
 * reached through three levels of indirection is not a shape this repository
 * writes.
 */
const MAX_SCRIPT_HOPS = 2;

/*
 * js-yaml through the builder that already depends on it, exactly as
 * `scripts/test-publish-workflow.mjs` does: the alternative is a second YAML
 * parser in `devDependencies` for one script, and this repository already
 * carries the argument against that.
 */
const require = createRequire(import.meta.url);
const builderRequire = createRequire(
	require.resolve("electron-builder/package.json"),
);
const appRequire = createRequire(builderRequire.resolve("app-builder-lib"));
const { load } = appRequire("js-yaml");

/**
 * The plugin's guard block, as a shape rather than as names: the `if
 * (!process.env.NAME)` tests are what a build trips over, and reading them is
 * what keeps this check bound to the plugin instead of to a copy of it.
 */
const GUARDED_NAME =
	/if\s*\(\s*!\s*process\.env\.([A-Za-z_][A-Za-z0-9_]*)\s*\)/g;

/**
 * The variables a build cannot start without, derived from the plugins' guards.
 *
 * A derivation that finds NOTHING throws rather than returning an empty list:
 * an empty list would make every workflow compliant and this gate green for the
 * reason it exists to prevent, and the failure mode of the regex is exactly a
 * plugin refactor (a loop over a table, a helper function, `=== undefined`).
 */
export function requiredBuildEnv(pluginPaths = defaultVitePlugins()) {
	const paths = Array.isArray(pluginPaths) ? pluginPaths : [pluginPaths];
	const names = [];
	for (const pluginPath of paths) {
		const source = readFileSync(pluginPath, "utf8");
		for (const match of source.matchAll(GUARDED_NAME)) {
			if (!names.includes(match[1])) names.push(match[1]);
		}
	}
	if (names.length === 0) {
		throw new Error(
			`check-build-env: found no \`if (!process.env.NAME)\` guard in ${paths.join(", ")}, so the required-variable list cannot be derived from the plugins. Refusing to check against an empty list, because an empty list passes everything: teach GUARDED_NAME in scripts/check-build-env.mjs the shape the guard was refactored into.`,
		);
	}
	return names;
}

/** Shell characters that end one command and start the next. */
const SEPARATORS = new Set([";", "&", "|", "(", ")"]);
const QUOTES = new Set(["'", '"']);

/**
 * A `run:` script split into command segments, each an array of unquoted words.
 *
 * Comments are dropped on the shell's own rule (`#` starts one only at the start
 * of a word), quotes are kept as opaque content, and control operators break
 * segments, so `a && electron-builder` and `echo '# electron-builder'` are told
 * apart. A trailing `#` comment inside a `run:` block is the ordinary way this
 * repository explains a step, and treating one as a command is the false
 * positive that would get this check deleted.
 */
export function commandSegments(script) {
	const segments = [];
	let words = [];
	let word = "";
	let quote = null;
	let comment = false;
	const endWord = () => {
		if (word) {
			words.push(word);
			word = "";
		}
	};
	const endSegment = () => {
		endWord();
		if (words.length) segments.push(words);
		words = [];
	};
	for (let i = 0; i < script.length; i++) {
		const ch = script[i];
		if (comment) {
			if (ch === "\n") {
				comment = false;
				endSegment();
			}
			continue;
		}
		// A backslash before a newline is the shell's line continuation: the two
		// lines are one command, so `run: |` + `pnpm \\` + newline + `build` has to
		// read as `pnpm build`. Outside quotes and inside double quotes the shell
		// removes the pair; inside single quotes it is a literal backslash, and a
		// comment ended at its newline already, which is why both are excluded
		// rather than quietly joined.
		if (ch === "\\" && script[i + 1] === "\n" && quote !== "'") {
			i++;
			continue;
		}
		if (quote !== null) {
			if (ch === quote) quote = null;
			else word += ch;
			continue;
		}
		if (QUOTES.has(ch)) {
			quote = ch;
			continue;
		}
		// `token === ""` is "the comment is at the start of a word", which is where
		// the shell starts one; `foo#bar` is one word and reaches no branch here.
		if (ch === "#" && word === "") {
			comment = true;
			continue;
		}
		if (ch === "\n") {
			endSegment();
			continue;
		}
		if (SEPARATORS.has(ch)) {
			endSegment();
			continue;
		}
		if (ch === " " || ch === "\t") {
			endWord();
			continue;
		}
		word += ch;
	}
	endSegment();
	return segments;
}

/** Commands that run another command, so the word after them is not the command. */
const WRAPPERS = new Set([
	"command",
	"env",
	"nice",
	"nohup",
	"npx",
	"sudo",
	"time",
	"xargs",
]);

/**
 * Flags whose FOLLOWING word is a value rather than the subcommand
 * (`pnpm -C dir build`). Only the ones whose absence would misread a build as a
 * non-build are listed; an unlisted value-taking flag yields a subcommand that
 * resolves to no package.json script and therefore reports nothing, which is a
 * false negative rather than a false positive.
 */
const VALUE_FLAGS = new Set([
	"-C",
	"--dir",
	"--filter",
	"-F",
	"--prefix",
	"--workspace-root",
]);

/** The first word of `words` that is not a flag, skipping a value-taking flag's value. */
function subcommandOf(words) {
	for (let i = 0; i < words.length; i++) {
		const word = words[i];
		if (VALUE_FLAGS.has(word)) {
			i++;
			continue;
		}
		if (word.startsWith("-")) continue;
		return { word, index: i };
	}
	return { word: null, index: -1 };
}

/**
 * The words a command actually runs, with the wrappers peeled.
 *
 * `scripts/require-report.sh` is peeled because this repository runs
 * exit-status-only gates through it: `bash scripts/require-report.sh "label"
 * pnpm build` is a build, and a check that read the `bash` would miss it.
 */
function peelWrappers(tokens) {
	let words = [...tokens];
	for (let guard = 0; guard < 12 && words.length > 0; guard++) {
		const command = basename(words[0]);
		if (command === "require-report.sh" && words.length >= 3) {
			// Drop the helper and its gate label; the rest is the command it runs.
			words = words.slice(2);
			continue;
		}
		if (
			WRAPPERS.has(command) ||
			command === "sh" ||
			command === "bash" ||
			command === "zsh"
		) {
			words = words.slice(1);
			continue;
		}
		break;
	}
	// `env VAR=value ...`, `sudo -E ...`: assignments and flags precede the command.
	while (
		words.length > 0 &&
		(words[0].includes("=") || words[0].startsWith("-"))
	) {
		words = words.slice(1);
	}
	return words;
}

/**
 * The packagers' own subcommands, which are not package.json script names.
 *
 * `pnpm install` is a step every workflow here runs and it is not a script, so a
 * bare `<packager> <word>` is only asked about when the word is neither a script
 * (resolved against package.json below) nor one of these. The list is the
 * command surface both packagers document, not a guess: without it, the
 * unresolved-invocation failure would report the seven `pnpm install` steps in
 * the repository's own workflows, and a gate that is wrong on a clean tree is
 * the one that gets deleted. `test` and `start` are deliberately NOT here: both
 * are `run <script>` aliases, so a missing `test` script is a step that cannot
 * complete and this check should say so.
 */
const PACKAGER_COMMANDS = new Set([
	"access",
	"add",
	"approve-builds",
	"audit",
	"bin",
	"cache",
	"config",
	"create",
	"dedupe",
	"deploy",
	"dist-tag",
	"doctor",
	"edit",
	"env",
	"explore",
	"fetch",
	"find-dupes",
	"fund",
	"help",
	"hook",
	"i",
	"ignored-builds",
	"import",
	"init",
	"install",
	"licenses",
	"link",
	"list",
	"login",
	"logout",
	"ls",
	"outdated",
	"owner",
	"patch",
	"patch-commit",
	"patch-remove",
	"ping",
	"pkg",
	"prefix",
	"profile",
	"prune",
	"query",
	"r",
	"rebuild",
	"remove",
	"repo",
	"restart",
	"rm",
	"root",
	"search",
	"server",
	"set-script",
	"setup",
	"shrinkwrap",
	"star",
	"stars",
	"store",
	"team",
	"token",
	"un",
	"uninstall",
	"unlink",
	"unpublish",
	"up",
	"update",
	"upgrade",
	"version",
	"view",
	"whoami",
	"why",
]);

/**
 * Record an invocation this check could not follow, so it reports instead of
 * vanishing. `context.unresolved` is optional so a caller that only wants the
 * classification (the fixtures in the suite) does not have to collect.
 */
function recordUnresolved(context, record) {
	context.unresolved?.push(record);
}

/**
 * What a command segment builds or packs, or `null` for anything else.
 *
 * The returned string is the label the verdict prints, so a reader sees the
 * command that was classified rather than having to re-derive it.
 *
 * `null` means one of three things and only the first is silent: the segment is
 * not a build, or it is an invocation this check could not follow (recorded on
 * `context.unresolved`, and failed by the caller), or it is a build reached
 * through more hops than MAX_SCRIPT_HOPS (also recorded). `chain` carries the
 * script names walked so far, for the message. `context.binaryExists` resolves
 * the second place `pnpm <word>` looks, and is optional so a fixture that only
 * drives the classification does not have to model node_modules.
 */
export function buildInvocation(tokens, context, depth = 0, chain = []) {
	const words = peelWrappers(tokens);
	if (words.length === 0) return null;
	const command = basename(words[0]);
	const args = words.slice(1);

	if (command === "electron-builder" || command === "electron-builder.js") {
		return "electron-builder";
	}

	if (command === "npm" || command === "pnpm") {
		const { word: sub, index } = subcommandOf(args);
		if (sub === null) return null;
		// Both packagers run the lifecycle scripts (`prepack`, `prepublishOnly`) that
		// build the shipped bundle, so these are build commands even though neither
		// name says "build".
		if (sub === "pack" || sub === "publish") return `npm ${sub}`;
		if (sub === "build") return `${command} build`;
		if (sub === "exec" || sub === "dlx" || sub === "runx") {
			return args
				.slice(index + 1)
				.some((word) => basename(word) === "electron-builder")
				? `${command} ${sub} electron-builder`
				: null;
		}
		let script = sub;
		if (script === "run" || script === "run-script") {
			const runWord = script;
			const next = subcommandOf(args.slice(index + 1));
			if (next.word === null) {
				recordUnresolved(context, {
					invocation: `${command} ${script}`,
					reason: "no-script-named",
					chain,
				});
				return null;
			}
			script = next.word;
			// A script named `build` is the build whatever its body does: `pnpm run build`
			// reaches `electron-vite build` one hop deeper, and following it would classify
			// the vite CLI rather than the build it produces.
			if (script === "build") return `${command} ${runWord} build`;
		} else if (PACKAGER_COMMANDS.has(script)) {
			return null;
		}
		// `pnpm <word>` resolves a word that is not a script to an installed binary
		// (`pnpm biome check` is the lint script's own body), so a name with no
		// script has one more place to resolve before it is unresolved, and only a
		// word that is in neither place is reported. `pnpm electron-builder` IS
		// `pnpm exec electron-builder`, which builds.
		if (basename(script) === "electron-builder") return "electron-builder";
		if (depth >= MAX_SCRIPT_HOPS) {
			// The cap bounds following SCRIPTS; a name that is a binary has no body to
			// follow, so a chain ending on one is resolved rather than truncated.
			if (context.binaryExists?.(script) === true) return null;
			recordUnresolved(context, {
				invocation: `${command} ${script}`,
				reason: "hop-cap",
				chain: [...chain, script],
			});
			return null;
		}
		const body = context.scriptBody(script);
		if (body === null) {
			if (context.binaryExists?.(script) === true) return null;
			recordUnresolved(context, {
				invocation: `${command} ${script}`,
				reason: "missing-script",
				chain: [...chain, script],
			});
			return null;
		}
		for (const segment of commandSegments(body)) {
			const nested = buildInvocation(segment, context, depth + 1, [
				...chain,
				script,
			]);
			if (nested) return `${command} ${script} -> ${nested}`;
		}
		return null;
	}

	return null;
}

/** A step's name, or a positional description when it has none: the verdict has to name it. */
function stepLabel(step, index) {
	return typeof step.name === "string" && step.name.length > 0
		? step.name
		: `step ${index + 1} (unnamed)`;
}

/**
 * The `secrets.*` name a value reads, or `null` when it reads none.
 *
 * Only expressions are read: `${{ secrets.NAME }}` is a secret reference, while
 * a literal that happens to contain the word `secrets` is a literal (the header
 * already discloses that a placeholder literal passes this check). A value that
 * reads two different secrets is judged on the first, because the reference is
 * what the binding is.
 */
function secretsReference(value) {
	if (typeof value !== "string") return null;
	for (const [, expression] of value.matchAll(/\$\{\{([^}]*)\}\}/g)) {
		const match = /\bsecrets\.([A-Za-z_][A-Za-z0-9_]*)\b/.exec(expression);
		if (match) return match[1];
	}
	return null;
}

/**
 * The canonical `secrets.*` name per required variable, derived from the tree's
 * own build steps.
 *
 * WHY CONSENSUS, AND WHAT IT CANNOT SEE. The repository's secret names are not
 * readable from the tree - `gh secret list` is not available to a check that
 * runs offline and in CI - so the only source for "the name this variable is
 * really fed from" is what the tree's other build steps do with it. Seven sites
 * agree today, which is what makes a single mistyped or swapped binding visible
 * as a minority. The limit is inherent and disclosed in the header: a tree that
 * mistypes the SAME name in every build step agrees with itself and passes; and
 * a variable the tree binds two ways with no majority is reported as ambiguous
 * rather than resolved by an arbitrary pick, because "which of these two is the
 * typo" is not a question this file can answer.
 */
function canonicalSecrets(entries, required) {
	const canonical = {};
	const ambiguous = {};
	for (const name of required) {
		const tally = new Map();
		for (const entry of entries) {
			const secret = secretsReference(entry.env?.[name]);
			if (secret) tally.set(secret, (tally.get(secret) ?? 0) + 1);
		}
		if (tally.size === 0) continue;
		const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
		if (ranked.length === 1 || ranked[0][1] > ranked[1][1])
			canonical[name] = ranked[0][0];
		else ambiguous[name] = ranked;
	}
	return { canonical, ambiguous };
}

/**
 * Every build step in every checked-in workflow, every missing variable, every
 * binding that disagrees with the rest of the tree, and every invocation the hop
 * walk could not follow.
 *
 * `required` is a parameter so the suite can drive a fixture plugin: the
 * binding between the two is the point of the check, and a test that could only
 * use the shipped list could not prove it.
 */
export function checkWorkflows({
	workflowsDir = DEFAULT_WORKFLOWS_DIR,
	required = requiredBuildEnv(),
	packageJsonPath = DEFAULT_PACKAGE_JSON,
	binDir = DEFAULT_BIN_DIR,
} = {}) {
	const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
	// The hop walk reports what it cannot follow through this array, because the
	// alternative - returning `null` for "not a build" AND for "could not say" -
	// is the silence this contract forbids.
	const records = [];
	const context = {
		scriptBody: (name) => {
			const body = pkg.scripts?.[name];
			return typeof body === "string" ? body : null;
		},
		binaryExists: (name) => existsSync(join(binDir, name)),
		unresolved: records,
	};

	const checked = [];
	const failures = [];
	const bindingFailures = [];
	const unresolved = [];
	const files = readdirSync(workflowsDir)
		.filter((name) => /\.ya?ml$/.test(name))
		.sort();

	for (const file of files) {
		const document = load(readFileSync(join(workflowsDir, file), "utf8"));
		// A workflow-level `env:` applies to every step in its run, so a tree that
		// hoists the four there is compliant and this has to read it; `publish.yml`
		// already keeps one for `NOTARIZE`, so the shape is one this repository uses.
		const fileEnv = document?.env ?? {};
		for (const [jobName, job] of Object.entries(document?.jobs ?? {})) {
			// A job-level env: is one of the three places the variables are actually
			// set (`publish.yml` does it per step, so all three are checked rather
			// than assumed). Step-level wins over job-level, which wins over file
			// level, the way Actions layers them.
			const jobEnv = job?.env ?? {};
			for (const [index, step] of (job?.steps ?? []).entries()) {
				if (typeof step?.run !== "string") continue;
				let command = null;
				const stepRecords = [];
				for (const segment of commandSegments(step.run)) {
					const before = records.length;
					const hit = buildInvocation(segment, context, 0, []);
					if (hit !== null && command === null) command = hit;
					for (const record of records.slice(before)) {
						stepRecords.push({ ...record, root: segment.join(" ") });
					}
				}
				if (command === null && stepRecords.length === 0) continue;

				const stepName = stepLabel(step, index);
				const entry = {
					file,
					job: jobName,
					step: stepName,
					command,
					env: { ...fileEnv, ...jobEnv, ...(step.env ?? {}) },
				};
				if (command !== null) checked.push(entry);
				for (const record of stepRecords) {
					unresolved.push({ ...record, file, job: jobName, step: stepName });
				}
			}
		}
	}

	const { canonical, ambiguous } = canonicalSecrets(checked, required);
	for (const entry of checked) {
		const missing = required.filter((name) => !(name in entry.env));
		if (missing.length > 0) failures.push({ ...entry, missing });
		for (const name of required) {
			if (!(name in entry.env)) continue;
			const value = entry.env[name];
			if (typeof value !== "string" || value.trim().length === 0) {
				bindingFailures.push({
					...entry,
					variable: name,
					reason: "empty",
					actual: null,
					expected: canonical[name] ?? null,
				});
				continue;
			}
			const actual = secretsReference(value);
			if (actual === null) continue;
			if (ambiguous[name] !== undefined) {
				bindingFailures.push({
					...entry,
					variable: name,
					reason: "ambiguous",
					actual,
					expected: null,
					seen: ambiguous[name],
				});
				continue;
			}
			if (canonical[name] !== undefined && actual !== canonical[name]) {
				bindingFailures.push({
					...entry,
					variable: name,
					reason: "wrong-secret",
					actual,
					expected: canonical[name],
				});
			}
		}
	}

	return {
		checked,
		failures,
		bindingFailures,
		unresolved: dedupe(unresolved),
		canonical,
		required,
		workflowsDir,
	};
}

/** One failure per step and invocation: a script that names the same bad script twice is one defect. */
function dedupe(records) {
	const seen = new Set();
	return records.filter((record) => {
		const key = [
			record.file,
			record.job,
			record.step,
			record.invocation,
			record.reason,
		].join("\u0000");
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** The verdict, as lines a log can be read from. */
export function formatReport(result) {
	const lines = [];
	const where = (entry) =>
		`${entry.file}, job "${entry.job}", step "${entry.step}"`;
	const unresolved = result.unresolved ?? [];
	const bindingFailures = result.bindingFailures ?? [];
	const canonical = result.canonical ?? {};

	if (result.checked.length === 0 && unresolved.length === 0) {
		return {
			ok: false,
			lines: [
				`check-build-env: no build or pack step found in any workflow under ${result.workflowsDir}, so this check proved nothing. Every workflow that builds the app matches one of: pnpm build, pnpm exec electron-builder, electron-builder, npm pack, npm publish, or a package.json script that reaches one of those. Seeing none means the scan broke, not that the tree is clean.`,
			],
		};
	}

	/*
	 * An invocation this check could not follow is a failure, not a silence.
	 * `pnpm <script>` naming something package.json does not define is a step
	 * pnpm refuses to start (`ERR_PNPM_NO_SCRIPT`), and a chain past
	 * MAX_SCRIPT_HOPS is a build this check cannot prove is not there - both are
	 * the defect class this file exists for, so both are reported with the
	 * workflow, the job, the step, the invocation and the reason.
	 */
	for (const record of unresolved) {
		const chain = record.chain.filter((name) => name !== record.root);
		if (record.reason === "missing-script") {
			lines.push(
				`check-build-env: ${where(record)} runs \`${record.root}\`, and the invocation \`${record.invocation}\` is neither a package.json script nor an installed binary (node_modules/.bin), so this check cannot tell whether that step builds or packs the app. pnpm fails the step with \`ERR_PNPM_NO_SCRIPT\` rather than running anything, so a step authored this way cannot complete: either the name is misspelled, or the script is missing from the tree, or the dependency that provides the binary is not installed.`,
			);
		} else if (record.reason === "hop-cap") {
			lines.push(
				`check-build-env: ${where(record)} runs \`${record.root}\`, whose chain ${chain.join(" -> ")} passes MAX_SCRIPT_HOPS (${MAX_SCRIPT_HOPS}) without reaching a build or pack command, so this check cannot tell whether that step builds or packs the app. Flatten the chain to ${MAX_SCRIPT_HOPS} hops or fewer, or raise the cap in scripts/check-build-env.mjs deliberately.`,
			);
		} else {
			lines.push(
				`check-build-env: ${where(record)} runs \`${record.root}\`, which names no script to run, so this check cannot tell whether that step builds or packs the app.`,
			);
		}
	}
	if (unresolved.length > 0) {
		lines.push(
			`check-build-env: ${unresolved.length} invocation${unresolved.length === 1 ? "" : "s"} could not be followed, so the steps above are neither classified nor cleared`,
		);
	}

	if (result.failures.length > 0) {
		for (const failure of result.failures) {
			lines.push(
				`check-build-env: ${where(failure)} runs \`${failure.command}\` without ${failure.missing.join(", ")}. The vite plugins this build loads throw "Error: ${failure.missing[0]} is not set" before compilation for a build without it, so this step cannot complete. Set it in that step's env:, the job's env:, or the workflow's env:, as publish.yml does in every step that builds or packs the app.`,
			);
		}
		lines.push(
			`check-build-env: ${result.failures.length} of ${result.checked.length} build steps are missing a variable the vite plugins the build loads require`,
		);
	}

	/*
	 * A binding that disagrees with the tree's own consensus. This is the other
	 * half of the defect `secrets.*` names carry: a mistyped name resolves to the
	 * empty string at build time and reproduces the missing-variable failure, and
	 * a swapped one ships a bundle wired to the wrong client without failing at
	 * all.
	 */
	for (const failure of bindingFailures) {
		if (failure.reason === "empty") {
			lines.push(
				`check-build-env: ${where(failure)} binds ${failure.variable} to an empty value, which is the runtime state the plugin refuses${failure.expected === null ? "" : ` (every other build step binds it to \`secrets.${failure.expected}\`)`}. Reference it with \`\${{ secrets.${failure.expected ?? failure.variable} }}\` or give it a non-empty value.`,
			);
		} else if (failure.reason === "ambiguous") {
			const seen = failure.seen
				.map(([secret, count]) => `${secret} (${count})`)
				.join(", ");
			lines.push(
				`check-build-env: ${where(failure)} binds ${failure.variable} to \`secrets.${failure.actual}\`, and this repository's build steps bind that variable more than one way (${seen}), so there is no canonical name to check it against and this check will not guess which spelling is the typo. Make them agree.`,
			);
		} else {
			lines.push(
				`check-build-env: ${where(failure)} binds ${failure.variable} to \`secrets.${failure.actual}\`, where the repository's build steps bind it to \`secrets.${failure.expected}\`. The secrets the runner exposes are not readable from this tree, so the tree's own agreement is the source: a mistyped name resolves to the empty string and reproduces the \`${failure.variable} is not set\` failure this check exists for, and a swapped one ships a bundle wired to the wrong client.`,
			);
		}
	}
	if (bindingFailures.length > 0) {
		lines.push(
			`check-build-env: ${bindingFailures.length} of ${result.checked.length} build steps bind a required variable to the wrong secret`,
		);
	}

	if (
		unresolved.length > 0 ||
		result.failures.length > 0 ||
		bindingFailures.length > 0
	)
		return { ok: false, lines };

	lines.push(
		`check-build-env: ${result.checked.length} build steps carry all ${result.required.length} variables the vite plugins the build loads require (${result.required.join(", ")}):`,
	);
	for (const entry of result.checked) {
		lines.push(
			`  ${entry.file} job "${entry.job}" step "${entry.step}" -> ${entry.command}`,
		);
	}
	const bindings = result.required
		.filter((name) => canonical[name] !== undefined)
		.map((name) => `${name}=secrets.${canonical[name]}`);
	if (bindings.length > 0) {
		lines.push(
			`check-build-env: bound as ${bindings.join(", ")} by the repository's own build steps; a step binding a required variable to a different secret fails`,
		);
	}
	return { ok: true, lines };
}

function main(argv) {
	const flag = (name, fallback) => {
		const index = argv.indexOf(name);
		if (index === -1) return fallback;
		const value = argv[index + 1];
		if (!value) throw new Error(`check-build-env: ${name} needs a path`);
		return value;
	};
	let result;
	try {
		result = checkWorkflows({
			workflowsDir: flag("--workflows", DEFAULT_WORKFLOWS_DIR),
			packageJsonPath: flag("--package", DEFAULT_PACKAGE_JSON),
		});
	} catch (error) {
		console.error(`check-build-env: ${error.message}`);
		return 1;
	}
	const report = formatReport(result);
	for (const line of report.lines) {
		if (report.ok) console.log(line);
		else console.error(line);
	}
	return report.ok ? 0 : 1;
}

// Only the CLI exits; importing this module for the check function must not. It
// goes through `scripts/entry-point.mjs` because `ci.yml` runs this as a gate
// and reads its exit status: the lexical spelling of this comparison loaded the
// file, ran nothing, printed nothing and exited 0 through a symlinked path,
// which is a pass to every consumer in these workflows.
if (isEntryPoint(import.meta.url)) {
	process.exit(main(process.argv.slice(2)));
}
