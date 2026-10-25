#!/usr/bin/env node
/**
 * The writer (and `--check` gate) for
 * `src/main/browser/actions/geometry-sources.gen.ts`.
 *
 * WHY THIS EXISTS — the measurement, not a preference. The host injects the
 * shared page functions into the isolated world as SOURCE, and the original
 * shape was `({fn}.toString())(...)` at runtime. That works in dev and in the
 * test bundle, and it CANNOT work in `pnpm build`'s output: the main bundle is
 * V8-bytecode compiled (`out/main/index.jsc`), and the bytecode loader executes
 * it against a DUMMY source string (zero-width spaces, length-matched to the
 * original). `Function.prototype.toString()` on a function from that script
 * returns the dummy text — measured in the built app's first proof run: the
 * `styles` call answered `Script failed to execute`, and a bare probe of the
 * loader's pattern shows `fn.toString()` returning `'"\u200b...\u200b"'`.
 *
 * So the source text is captured HERE, at generation time, from the one
 * implementation (`vendor/driver/geometry-read.ts`), and committed as string
 * constants. The app injects those constants; the extension keeps injecting the
 * functions themselves. Same file, same arithmetic, two transports.
 *
 * WHY GENERATED RATHER THAN HAND-WRITTEN: a second, hand-kept copy of the page
 * functions is how the two hosts start disagreeing about a cap. This script
 * transpiles the vendored file with the same esbuild the test bundle uses,
 * evaluates it, and records each function's own source; `check-geometry-
 * sources.test.mjs` re-derives this file and fails when it is stale, so the
 * vendored file changing without a regenerate is a red gate, not a silent skew.
 *
 * Usage:
 *   node scripts/generate-geometry-sources.mjs           # write the file
 *   node scripts/generate-geometry-sources.mjs --check   # fail if stale
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";
import { isEntryPoint } from "./entry-point.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The vendored (and PROVENANCE-pinned) driver the page functions come from. */
export const DRIVER_DIR = join(
	ROOT,
	"src",
	"main",
	"browser",
	"vendor",
	"driver",
);

export const DRIVER_PATH = join(DRIVER_DIR, "geometry-read.ts");

/** Where the generated constants live. Deliberately NOT under `vendor/`: that
 * directory's manifest gate admits exactly the files `sync-vendored.mjs` writes
 * from the pin, and this file is derived here, from that pin's output. */
export const OUTPUT_PATH = join(
	ROOT,
	"src",
	"main",
	"browser",
	"actions",
	"geometry-sources.gen.ts",
);

/** The functions that cross into a page, the driver file each lives in, and the
 *  constant each becomes.
 *
 *  `file` is explicit per export: the bundle now carries more than one driver
 *  module, and a single hardcoded path is how a new page function silently
 *  keeps being generated from the old file. */
const EXPORTS = [
	{
		file: "geometry-read.ts",
		fn: "readStyles",
		constant: "READ_STYLES_SOURCE",
	},
	{ file: "geometry-read.ts", fn: "hitTest", constant: "HIT_TEST_SOURCE" },
	{ file: "geometry-read.ts", fn: "ancestors", constant: "ANCESTORS_SOURCE" },
	{ file: "element-query.ts", fn: "queryElements", constant: "QUERY_SOURCE" },
];

/**
 * Re-derive the generated file's exact text, plus the hash of the driver it
 * came from. Pure over the driver file: the caller decides whether to write it
 * or compare it.
 */
export async function renderSources(options = {}) {
	const driverPath = options.driver ?? DRIVER_PATH;
	const driverDir = options.driverDir ?? DRIVER_DIR;
	// Load each distinct driver file once, then pick each export out of its own
	// module: the hash covers ALL of them, so a change to either file is stale.
	const modules = new Map();
	const sources = new Map();
	for (const { file } of EXPORTS) {
		if (modules.has(file)) continue;
		const source = readFileSync(join(driverDir, file), "utf8");
		sources.set(file, source);
		// The same transpiler the test bundle runs, configured the same way
		// (`format: "esm"`, TS loader); the target is left at its default so the
		// emitted text is what a modern Node would execute unchanged.
		const compiled = await transform(source, { loader: "ts", format: "esm" });
		modules.set(
			file,
			await import(
				`data:text/javascript;base64,${Buffer.from(compiled.code).toString("base64")}`
			),
		);
	}
	const values = EXPORTS.map(({ file, fn, constant }) => {
		const value = String(modules.get(file)[fn]);
		if (!value.includes("=>")) {
			throw new Error(
				`${fn} did not transpile to a function expression (got ${value.slice(0, 40)}...)`,
			);
		}
		return { constant, value };
	});
	const hash = createHash("sha256")
		.update(
			[...sources.entries()]
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([file, source]) => `${file}\u0000${source}`)
				.join("\u0000"),
		)
		.digest("hex");
	const header = [
		"// GENERATED by scripts/generate-geometry-sources.mjs — do not edit by hand.",
		`// Source of truth: src/main/browser/vendor/driver/{geometry-read,element-query}.ts (sha256 ${hash}).`,
		"// Regenerate with that script; check-geometry-sources.test.mjs fails when this",
		"// file and the driver disagree.",
		"//",
		"// WHY THE SOURCE IS COMMITTED AS STRINGS: the packaged main bundle is V8",
		"// bytecode, and its loader runs the script against a dummy source string, so",
		"// `Function.prototype.toString()` returns that dummy text — measured, and the",
		"// reason the first built-app proof run answered `Script failed to execute`.",
		"// These constants carry the same functions' own source for the isolated world;",
		"// the extension host injects the functions themselves. Same driver, one",
		"// implementation, both transports.",
	].join("\n");
	const body = values
		.map(
			({ constant, value }) =>
				`export const ${constant} = ${JSON.stringify(value)};`,
		)
		.join("\n\n");
	return { text: `${header}\n\n${body}\n`, hash };
}

async function main() {
	const check = process.argv.includes("--check");
	const { text } = await renderSources();
	let onDisk = "";
	try {
		onDisk = readFileSync(OUTPUT_PATH, "utf8");
	} catch {
		/* missing is stale */
	}
	if (check) {
		if (onDisk !== text) {
			console.error(
				"geometry-sources: STALE — src/main/browser/actions/geometry-sources.gen.ts " +
					"does not match what the generator derives from the vendored driver.",
			);
			console.error("  fix: node scripts/generate-geometry-sources.mjs");
			process.exitCode = 1;
			return;
		}
		console.log(
			"geometry-sources: the generated sources match the vendored driver.",
		);
		return;
	}
	if (onDisk === text) {
		console.log("geometry-sources: already fresh; nothing written.");
		return;
	}
	writeFileSync(OUTPUT_PATH, text);
	console.log(
		`geometry-sources: wrote ${OUTPUT_PATH} (${text.length} bytes) from ${DRIVER_DIR}`,
	);
}

if (isEntryPoint(import.meta.url)) {
	main().catch((error) => {
		console.error(`geometry-sources: FAILED to run: ${error.message}`);
		process.exitCode = 1;
	});
}
