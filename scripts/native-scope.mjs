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
 * Usage::
 *
 *   git diff --name-only "$base" "$head" > "$RUNNER_TEMP/changed.txt"
 *   node scripts/native-scope.mjs --changed-file "$RUNNER_TEMP/changed.txt" \
 *     --github-output "$GITHUB_OUTPUT" --summary "$GITHUB_STEP_SUMMARY"
 *
 *   node scripts/native-scope.mjs --force true      # non-PR event: lane runs
 *   node scripts/native-scope.mjs --changed-file -   # read stdin
 */

import { appendFileSync, readFileSync } from "node:fs";
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
 * dependencies that ship inside it; `scripts/` contains the pack, launch and
 * native-scene drivers the lane itself executes.
 */
export const NATIVE_PREFIXES = [
	"src/main/",
	"src/preload/",
	"build/",
	"resources/",
	"bin/",
	"patches/",
	"scripts/",
	".github/workflows/",
];

/** Exact files whose change can repackage or re-sign the app. */
export const NATIVE_EXACT = new Set([
	"package.json",
	"pnpm-lock.yaml",
	"pnpm-workspace.yaml",
	"electron.vite.config.js",
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

/**
 * True when `path` is a surface the native lane must prove.
 *
 * Kept as its own exported predicate rather than folded into the loop below so
 * the tests can assert one path at a time and name the rule that matched.
 */
export function isNativeSurface(path) {
	if (!path) return false;
	const normalized = path.replace(LEADING_DOT_SLASH, "").trim();
	if (!normalized) return false;
	if (NATIVE_EXACT.has(normalized)) return true;
	if (NATIVE_PREFIXES.some((prefix) => normalized.startsWith(prefix)))
		return true;
	const lower = normalized.toLowerCase();
	return NATIVE_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

/**
 * The decision, from a list of changed paths.
 *
 * An EMPTY list is "unknown", not "nothing native": a diff that could not be
 * computed and a diff with no files are indistinguishable at this layer, and
 * only one of those is safe to treat as a skip. Both run the lane.
 */
export function requiresNativeProof(paths) {
	if (!Array.isArray(paths) || paths.length === 0) return true;
	return paths.some((path) => isNativeSurface(path));
}

/** The paths that decided it, for the summary line. */
export function nativeSurfacePaths(paths) {
	if (!Array.isArray(paths)) return [];
	return paths.filter((path) => isNativeSurface(path));
}

function parseArguments(argv) {
	const options = {
		changedFile: "",
		githubOutput: "",
		summary: "",
		force: "",
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
				"  --summary <f>        append the human-readable report here.\n",
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
			native = requiresNativeProof(paths);
			surfaces = nativeSurfacePaths(paths);
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
