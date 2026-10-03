#!/usr/bin/env node
/**
 * Delete every frame in a declared evidence set whose palette is outside that
 * set's documented budget.
 *
 * WHY THIS IS A SEPARATE, EXPLICIT STEP. `scripts/capture-evidence.mjs` runs
 * `--only=` in append mode: it leaves the existing set in place and writes the
 * frames it is asked for, which is what makes a narrowed re-shoot cheap. That
 * also means a run cannot REMOVE a frame - a stray palette a previous pass
 * committed (the transcript-line pass's round-5 pass left the rig's default
 * twelve palettes inside four states of a six-palette set) survives every later
 * run and keeps the set's README documenting a command that does not reproduce
 * it. So the strays are removed here, by name, against the same `SET_BUDGETS`
 * table `scripts/check-evidence-palettes.mjs` asserts against - one declaration,
 * two verbs: check reads it, this deletes to it.
 *
 * It prints every path it removes, and refuses to touch anything that is not a
 * `.webp` directly inside a state directory of a declared set, so a wrong path
 * cannot turn a budget into a wipe.
 *
 * Usage:
 *   node scripts/trim-evidence-palettes.mjs            # dry run, every set
 *   node scripts/trim-evidence-palettes.mjs --write    # delete
 *   node scripts/trim-evidence-palettes.mjs --write chat-trace-fold
 */

import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SET_BUDGETS } from "./check-evidence-palettes.mjs";
import { isEntryPoint } from "./entry-point.mjs";

/**
 * Its own entry point, through the shared helper: the body below DELETES files, so a
 * module resolved by a caller's spelling rather than by file identity would not merely
 * do nothing seen through a symlinked directory - it would run on IMPORT, which is why
 * this is a function and not top-level code (`scripts/entry-point.test.mjs` binds the
 * entry-point half; the import half is why nothing may import this file for its
 * behaviour).
 */
function main() {
	const WRITE = process.argv.includes("--write");
	const ONLY = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? null;
	let removed = 0;
	let kept = 0;
	for (const [setPath, budget] of Object.entries(SET_BUDGETS)) {
		if (ONLY && setPath !== ONLY) continue;
		const setDir = join("docs/evidence", setPath);
		if (!existsSync(setDir)) continue;
		const want = new Set(budget);
		for (const state of readdirSync(setDir, { withFileTypes: true })) {
			if (!state.isDirectory()) continue;
			const stateDir = join(setDir, state.name);
			for (const file of readdirSync(stateDir, { withFileTypes: true })) {
				if (!file.isFile() || !file.name.endsWith(".webp")) continue;
				const palette = file.name.slice(0, -".webp".length);
				if (want.has(palette)) {
					kept += 1;
					continue;
				}
				const path = join(stateDir, file.name);
				process.stdout.write(`${WRITE ? "rm" : "would rm"} ${path}\n`);
				if (WRITE) rmSync(path);
				removed += 1;
			}
		}
	}
	process.stdout.write(
		`${WRITE ? "removed" : "would remove"} ${removed} frame(s) outside the declared budgets; ${kept} inside them\n`,
	);
}

if (isEntryPoint(import.meta.url)) main();
