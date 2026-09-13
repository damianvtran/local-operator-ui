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
 * Usage: node scripts/check-runtime-deps.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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
const RUNTIME_DEPENDENCIES = [
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
		why: "src/main/update-service.ts and src/preload/index.ts",
	},
	{
		name: "posthog-node",
		why: "src/main/index.ts (main-process telemetry)",
	},
	{
		name: "zod",
		why: "src/main/backend/config.ts, src/main/desktop-media.ts, src/shared/desktop-contract.ts",
	},
];

const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
const declared = Object.keys(pkg.dependencies ?? {});
const allowed = new Set(RUNTIME_DEPENDENCIES.map((entry) => entry.name));

// Both directions matter. An unvetted dependency ships bytes to every user; a
// allowlist entry with no matching dependency is dead policy that would let a
// later re-add slip past unexamined.
const unexpected = declared.filter((name) => !allowed.has(name));
const stale = RUNTIME_DEPENDENCIES.map((entry) => entry.name).filter(
	(name) => !declared.includes(name),
);

const problems = [];
for (const name of unexpected) {
	problems.push(
		`unvetted production dependency: ${name}
    electron-builder copies every \`dependencies\` entry into app.asar, so this
    one ships to every user. If the Electron main or preload process loads it at
    runtime, add it to RUNTIME_DEPENDENCIES in scripts/check-runtime-deps.mjs
    with the import site; otherwise move it to devDependencies (Vite bundles the
    renderer, and it will still be installed for the build).`,
	);
}
for (const name of stale) {
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

if (problems.length > 0) {
	console.error(
		`check-runtime-deps: FAILED (${problems.length} problem${problems.length === 1 ? "" : "s"})\n`,
	);
	for (const problem of problems) console.error(`  - ${problem}\n`);
	process.exit(1);
}

console.log(
	`check-runtime-deps: ${declared.length} production dependencies, all on the runtime allowlist:`,
);
for (const entry of RUNTIME_DEPENDENCIES) {
	console.log(`  ${entry.name} <- ${entry.why}`);
}
