#!/usr/bin/env node
/**
 * The bundled interpreter's layout, read from the app's own definition of it.
 *
 * Why this module exists: the names this change moved - `python` and
 * `python_aarch64` became `python-runtime-seed/<arch>` - were spelled in six
 * places (the app's `managed-python.ts` and `update-install.ts`, `package.json`'s
 * `extraResources`, and three scripts). Five were updated with the move; the
 * heal's predicate in `update-install.ts` was not, so on a bundle this branch
 * builds every `.pyc` violation was unhealable by construction while the gate
 * that shares its job was green (review R10 / QA Q2).
 *
 * `src/shared/bundled-python-layout.json` is now the single definition, and this
 * is the one reader of it on the scripts side. The app imports the same file, so
 * a name can only be wrong in one place at a time.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const LAYOUT = JSON.parse(
	readFileSync(
		fileURLToPath(
			new URL("../src/shared/bundled-python-layout.json", import.meta.url),
		),
		"utf8",
	),
);

/** The seed directory this architecture ships under, relative to `Resources`. */
export const seedResourceDir = (arch) => `${LAYOUT.seedNamespace}/${arch}`;

/** Every architecture's seed directory, in the layout's own order. */
export const SEED_RESOURCE_DIRS = LAYOUT.architectures.map(seedResourceDir);

/** The resource names a shipped bundle must never carry again, for a reason. */
export const LEGACY_RESOURCE_NAMES = LAYOUT.legacyResourceNames;

/**
 * Every resource directory that may hold bundled-interpreter bytecode.
 *
 * Both halves, deliberately: a bundle being *replaced* is the old layout, a
 * bundle being *healed* is either, and a predicate that lists only one of them
 * is how R10 happened.
 */
export const BYTECODE_TREE_NAMES = [
	...LEGACY_RESOURCE_NAMES,
	...SEED_RESOURCE_DIRS,
];
