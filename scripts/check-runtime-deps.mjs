#!/usr/bin/env node
/**
 * Fail when `dependencies` contains a package nobody vetted as a runtime
 * dependency of the shipped app.
 *
 * Why this exists: electron-vite's `externalizeDepsPlugin()` externalises
 * exactly what package.json `dependencies` lists, and electron-builder then
 * copies that whole tree into `Contents/Resources/app.asar`. The renderer needs
 * none of it - Vite bundles the renderer graph into `out/renderer` at build
 * time - so a renderer-only or build-only package that drifts into
 * `dependencies` silently ships to every user. That is not hypothetical: at
 * v0.19.6 the 65 production dependencies put ~470 MB of node_modules nobody
 * loads into a 1.0 GB install (mermaid, lucide-react, date-fns, posthog-js,
 * typescript, ag-grid, @mui, xlsx, tailwindcss, and the build tooling
 * dmg-builder/electron-builder-squirrel-windows with app-builder-bin).
 *
 * The check is a manifest allowlist rather than a scan of `src/main` and
 * `src/preload`. A scan cannot see a dependency reached only through a computed
 * `require` and it would pass vacuously if the scan itself broke; an allowlist
 * fails on everything a human did not write down, so adding an entry is a
 * reviewable decision rather than an accident.
 *
 * The check itself is a plain function over a manifest path so that
 * `check-runtime-deps.test.mjs` can drive its pass and fail cases with fixture
 * manifests; the default path is the repository's own package.json, and the CLI
 * below is the only thing that exits.
 *
 * Usage: node scripts/check-runtime-deps.mjs [--manifest <path>]
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntryPoint } from "./entry-point.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_MANIFEST = resolve(repoRoot, "package.json");

/**
 * The only packages allowed in `dependencies`. Each one is a package an
 * Electron main or preload process loads at runtime, i.e. it is imported by
 * `src/main/**` or `src/preload/**` and is deliberately shipped as node_modules
 * rather than bundled.
 *
 * Note the asymmetry this encodes: an import from main/preload is *bundled* by
 * Vite whenever its package is not in `dependencies` (that is how
 * `@electron-toolkit/preload` ships today, a preload-process import that lives
 * in devDependencies). Listing a package here is therefore a choice to keep the
 * unbundled copy inside app.asar, not a statement that main imports it.
 */
export const RUNTIME_DEPENDENCIES = [
	{
		name: "@electron-toolkit/utils",
		why: "src/main/index.ts, src/main/backend/backend-installer.ts (is.dev, optimizer)",
	},
	{
		name: "dotenv",
		why: "src/main/backend/config.ts loads the backend env before any other main-module config",
	},
	{
		name: "electron-log",
		why: "src/main/backend/logger.ts",
	},
	{
		name: "electron-updater",
		why: "src/main/update-service.ts:23 imports `autoUpdater` at runtime; src/preload/index.ts imports only its types",
	},
	{
		name: "posthog-node",
		why: "src/main/index.ts (main-process telemetry)",
	},
	{
		name: "zod",
		why: "src/main/backend/config.ts, src/main/desktop-media.ts, src/shared/desktop-contract.ts",
	},
	{
		name: "@xterm/headless",
		why: "src/main/console/emulator.ts — the terminal of record (design 5.4): read from main with no view present, which is R7",
	},
	{
		name: "node-pty",
		why: "src/main/console/pty.ts — the pty itself (design 5.3). A native module, so it must NOT be bundled: it is externalised and shipped under app.asar.unpacked, with the prebuilds and the exec bit handled by scripts/console-pack.mjs",
	},
];

/**
 * Read `manifestPath` and return every way it disagrees with the allowlist.
 *
 * Both directions matter. An unvetted dependency ships bytes to every user; an
 * allowlist entry with no matching dependency is dead policy that would let a
 * later re-add slip past unexamined.
 *
 * @param {{ manifestPath?: string }} [options]
 * @returns {{ declared: string[], problems: string[] }}
 */
export function checkRuntimeDependencies({
	manifestPath = DEFAULT_MANIFEST,
} = {}) {
	const pkg = JSON.parse(readFileSync(manifestPath, "utf8"));
	const declared = Object.keys(pkg.dependencies ?? {});
	const allowed = new Set(RUNTIME_DEPENDENCIES.map((entry) => entry.name));

	const problems = [];
	for (const name of declared) {
		if (allowed.has(name)) continue;
		problems.push(
			`unvetted production dependency: ${name}
    electron-builder copies every \`dependencies\` entry into app.asar, so this
    one ships to every user. If the Electron main or preload process loads it at
    runtime, add it to RUNTIME_DEPENDENCIES in scripts/check-runtime-deps.mjs
    with the import site; otherwise move it to devDependencies (Vite bundles the
    renderer, and it will still be installed for the build).`,
		);
	}
	for (const name of RUNTIME_DEPENDENCIES.map((entry) => entry.name)) {
		if (declared.includes(name)) continue;
		problems.push(
			`stale allowlist entry: ${name}
    Listed in RUNTIME_DEPENDENCIES but absent from \`dependencies\`. Remove the
    entry, or restore the dependency if its removal was the mistake.`,
		);
	}
	if (declared.length === 0) {
		problems.push(
			"package.json declares no production dependencies\n" +
				"    A guard that passes over an empty list proves nothing. Either the manifest\n" +
				"    is wrong or this script is reading the wrong file.",
		);
	}

	return { declared, problems };
}

/** The lines the CLI prints for a finished check, stdout and stderr together. */
export function formatReport({ declared, problems }) {
	if (problems.length > 0) {
		const lines = [
			`check-runtime-deps: FAILED (${problems.length} problem${problems.length === 1 ? "" : "s"})`,
			"",
		];
		for (const problem of problems) lines.push(`  - ${problem}`, "");
		return { ok: false, lines };
	}
	const lines = [
		`check-runtime-deps: ${declared.length} production dependencies, all on the runtime allowlist:`,
		...RUNTIME_DEPENDENCIES.map((entry) => `  ${entry.name} <- ${entry.why}`),
	];
	return { ok: true, lines };
}

function main(argv) {
	const flagIndex = argv.indexOf("--manifest");
	const manifestPath =
		flagIndex === -1 ? DEFAULT_MANIFEST : argv[flagIndex + 1];
	if (!manifestPath) {
		console.error("check-runtime-deps: --manifest needs a path");
		return 2;
	}
	const report = formatReport(checkRuntimeDependencies({ manifestPath }));
	if (report.ok) {
		for (const line of report.lines) console.log(line);
		return 0;
	}
	for (const line of report.lines) console.error(line);
	return 1;
}

// Only the CLI exits; importing this module for the allowlist or for the check
// function must not. Through `scripts/entry-point.mjs` because the lexical form of
// this comparison loaded the file, ran nothing and exited 0 under a symlinked
// spelling — and `ci.yml`'s Runtime Dependencies job reads that status as a pass.
if (isEntryPoint(import.meta.url)) {
	process.exit(main(process.argv.slice(2)));
}
