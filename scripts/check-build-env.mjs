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
 * names are therefore parsed out of `replace-backend-config.ts` itself, and
 * `check-build-env.test.mjs` asserts the derived list is exactly these four, so
 * a change to the plugin either keeps the check honest or fails the suite.
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
 * WHAT THIS DOES NOT COVER, stated rather than implied. It reads `run:` steps
 * only: a `uses:` step or a composite action that builds the app is not seen,
 * nor is a build reached through `node some-script.mjs`, nor a `pnpm` script
 * more than MAX_SCRIPT_HOPS hops deep. It asserts the variables are SET, not
 * that they are valid - a placeholder satisfies it, and only a real build does
 * not. And it says nothing about whether a workflow runs at all: the defect this
 * closes is a step that could never complete, not a job nobody dispatched.
 *
 * Usage: node scripts/check-build-env.mjs [--workflows <dir>] [--package <path>]
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntryPoint } from "./entry-point.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Where the checked-in workflows live. */
export const DEFAULT_WORKFLOWS_DIR = join(repoRoot, ".github", "workflows");

/** The plugin whose guard block DEFINES the required variables. */
export const DEFAULT_VITE_PLUGIN = join(
	repoRoot,
	"scripts",
	"vite-plugins",
	"replace-backend-config.ts",
);

/** The script table a `pnpm <script>` / `npm run <script>` invocation resolves through. */
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
 * The variables a build cannot start without, derived from the plugin.
 *
 * A derivation that finds NOTHING throws rather than returning an empty list:
 * an empty list would make every workflow compliant and this gate green for the
 * reason it exists to prevent, and the failure mode of the regex is exactly a
 * plugin refactor (a loop over a table, a helper function, `=== undefined`).
 */
export function requiredBuildEnv(pluginPath = DEFAULT_VITE_PLUGIN) {
	const source = readFileSync(pluginPath, "utf8");
	const names = [
		...new Set([...source.matchAll(GUARDED_NAME)].map((m) => m[1])),
	];
	if (names.length === 0) {
		throw new Error(
			`check-build-env: found no \`if (!process.env.NAME)\` guard in ${pluginPath}, so the required-variable list cannot be derived from the plugin. Refusing to check against an empty list, because an empty list passes everything: teach GUARDED_NAME in scripts/check-build-env.mjs the shape the guard was refactored into.`,
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
	for (const ch of script) {
		if (comment) {
			if (ch === "\n") {
				comment = false;
				endSegment();
			}
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
 * What a command segment builds or packs, or `null` for anything else.
 *
 * The returned string is the label the verdict prints, so a reader sees the
 * command that was classified rather than having to re-derive it.
 */
export function buildInvocation(tokens, context, depth = 0) {
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
		if (script === "run") {
			const next = subcommandOf(args.slice(index + 1));
			if (next.word === null) return null;
			script = next.word;
			// A script named `build` is the build whatever its body does: `pnpm run build`
			// reaches `electron-vite build` one hop deeper, and following it would classify
			// the vite CLI rather than the build it produces.
			if (script === "build") return `${command} run build`;
		}
		if (depth >= MAX_SCRIPT_HOPS) return null;
		const body = context.scriptBody(script);
		if (body === null) return null;
		for (const segment of commandSegments(body)) {
			const nested = buildInvocation(segment, context, depth + 1);
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
 * Every build step in every checked-in workflow, and every missing variable.
 *
 * `required` is a parameter so the suite can drive a fixture plugin: the
 * binding between the two is the point of the check, and a test that could only
 * use the shipped list could not prove it.
 */
export function checkWorkflows({
	workflowsDir = DEFAULT_WORKFLOWS_DIR,
	required = requiredBuildEnv(),
	packageJsonPath = DEFAULT_PACKAGE_JSON,
} = {}) {
	const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
	const context = {
		scriptBody: (name) => {
			const body = pkg.scripts?.[name];
			return typeof body === "string" ? body : null;
		},
	};

	const checked = [];
	const failures = [];
	const files = readdirSync(workflowsDir)
		.filter((name) => /\.ya?ml$/.test(name))
		.sort();

	for (const file of files) {
		const document = load(readFileSync(join(workflowsDir, file), "utf8"));
		for (const [jobName, job] of Object.entries(document?.jobs ?? {})) {
			// A job-level env: is one of the two places the variables are actually set
			// (`publish.yml` does it per step, so both are checked rather than assumed).
			const jobEnv = Object.keys(job?.env ?? {});
			for (const [index, step] of (job?.steps ?? []).entries()) {
				if (typeof step?.run !== "string") continue;
				const command = commandSegments(step.run)
					.map((segment) => buildInvocation(segment, context))
					.find((hit) => hit !== null);
				if (!command) continue;

				const stepEnv = Object.keys(step.env ?? {});
				const available = new Set([...jobEnv, ...stepEnv]);
				const missing = required.filter((name) => !available.has(name));
				const entry = {
					file,
					job: jobName,
					step: stepLabel(step, index),
					command,
				};
				checked.push(entry);
				if (missing.length > 0) failures.push({ ...entry, missing });
			}
		}
	}

	return { checked, failures, required, workflowsDir };
}

/** The verdict, as lines a log can be read from. */
export function formatReport(result) {
	const lines = [];
	const where = (entry) =>
		`${entry.file}, job "${entry.job}", step "${entry.step}"`;

	if (result.checked.length === 0) {
		return {
			ok: false,
			lines: [
				`check-build-env: no build or pack step found in any workflow under ${result.workflowsDir}, so this check proved nothing. Every workflow that builds the app matches one of: pnpm build, pnpm exec electron-builder, electron-builder, npm pack, npm publish, or a package.json script that reaches one of those. Seeing none means the scan broke, not that the tree is clean.`,
			],
		};
	}

	if (result.failures.length > 0) {
		for (const failure of result.failures) {
			lines.push(
				`check-build-env: ${where(failure)} runs \`${failure.command}\` without ${failure.missing.join(", ")}. scripts/vite-plugins/replace-backend-config.ts throws "Error: ${failure.missing[0]} is not set" before compilation for a build without it, so this step cannot complete. Set it in that step's env: (or in the job's env:), as publish.yml does in every step that builds or packs the app.`,
			);
		}
		lines.push(
			`check-build-env: ${result.failures.length} of ${result.checked.length} build steps are missing a variable the vite plugin requires`,
		);
		return { ok: false, lines };
	}

	lines.push(
		`check-build-env: ${result.checked.length} build steps carry all ${result.required.length} variables scripts/vite-plugins/replace-backend-config.ts requires (${result.required.join(", ")}):`,
	);
	for (const entry of result.checked) {
		lines.push(
			`  ${entry.file} job "${entry.job}" step "${entry.step}" -> ${entry.command}`,
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
