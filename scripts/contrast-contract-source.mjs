/**
 * The contrast contract's SOURCE TEXT, for tests that pin it.
 *
 * Several suites assert on the contract's text - that a `CONTROLS` row for their
 * component exists with the right roles, that a call-site pin is present, that
 * the loop honours an exemption - because importing `contrast-contract.mjs` would
 * run the whole gate. Since the theme composition engine, that text lives in three
 * files: the run in `scripts/contrast-contract.mjs`, the tables in
 * `src/shared/theme-engine/contract-tables.mjs` and the per-palette loop in
 * `src/shared/theme-engine/evaluate.mjs`. This returns them concatenated, so a
 * test asks "does the contract say X" without knowing which file X moved to.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const CONTRACT_SOURCE_FILES = [
	"scripts/contrast-contract.mjs",
	"src/shared/theme-engine/contract-tables.mjs",
	"src/shared/theme-engine/evaluate.mjs",
];

export const contractSource = () =>
	CONTRACT_SOURCE_FILES.map((f) => readFileSync(join(ROOT, f), "utf8")).join(
		"\n",
	);
