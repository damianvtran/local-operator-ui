#!/usr/bin/env node
/**
 * Assert that a declared evidence set holds EXACTLY the palettes its record
 * documents, state by state.
 *
 * WHY THIS EXISTS, against the record. Rounds 1-4 of the transcript-line pass
 * each re-captured frames with `--only=`, and round 5's pass reached for the
 * same flag without `--themes=`: `--only` alone leaves the rig's DEFAULT twelve
 * palettes in place, so four touched states silently went from six palettes to
 * thirteen, one of them (`focus-copy/`, which the run never finished) stopped at
 * eleven, and the same slip re-took a whole forty-six-frame set as two hundred
 * and seventy-six. Nothing failed: the frames were real, the manifest's counts
 * were re-derived from the tree, and both READMEs kept documenting commands that
 * no longer reproduced what was committed. Design round 5 (D7) and QA round 5
 * (Q-r5-1/Q-r5-2) found it by counting files by hand - which is the instrument
 * this file replaces.
 *
 * WHY A DECLARED TABLE RATHER THAN "ALL STATES AGREE". Twenty-nine of this
 * repository's two hundred and thirty-four sets legitimately carry different
 * palettes in different states (a wide set beside a two-palette pair, a
 * single-palette state beside a sweep), so a uniformity rule would be red on
 * `main` and would be switched off within a week. The budget that CAN be checked
 * mechanically is the one a set's own README already states, so the table below
 * names the sets whose record pins a palette list and compares each of their
 * state directories against it: an EXTRA palette is the default-sweep slip, a
 * MISSING one is a run that died mid-set, and both are what a reader cannot see
 * from the manifest's counts.
 *
 * Add a set here when its README documents `--themes=`, and keep the two in step
 * - this table is a transcription of that command, not a second opinion about it.
 *
 * Usage:
 *   node scripts/check-evidence-palettes.mjs            # every declared set
 *   node scripts/check-evidence-palettes.mjs <set-path> # one, under docs/evidence
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isEntryPoint } from "./entry-point.mjs";

/** Set path under `docs/evidence` -> the palettes its `--themes=` command names. */
export const SET_BUDGETS = {
	"chat-canonical-message-actions": [
		"localOperatorLight",
		"localOperatorDark",
		"sage",
		"catppuccinMacchiato",
		"obsidian",
		"radient",
	],
	/*
	 * `chat-media-slot-fill` is deliberately NOT here any more (round 1's design
	 * remediation): its states legitimately carry different palettes now - `rest`
	 * five, `letterbox-hover` `catppuccinLatte`, `mixed-row` `catppuccinLatte` +
	 * `localOperatorDark` - and this table's one-list-per-set, per-state-exact
	 * shape cannot express that. That is the mixed-set class its own header names
	 * (a single-palette state beside a sweep), and the set README documents each
	 * state's own `--themes=` command; adding it back would be wrong until this
	 * shape grows a per-state form.
	 */
	"chat-trace-fold": ["localOperatorDark", "localOperatorLight"],
};

const palettesOf = (dir) => {
	if (!existsSync(dir)) return null;
	return new Set(
		readdirSync(dir)
			.filter((f) => f.endsWith(".webp"))
			.map((f) => f.slice(0, -".webp".length)),
	);
};

/**
 * Compare one declared set against its budget. Returns an array of problem
 * strings, one per state directory that is not exactly the budget, plus one if
 * the set itself is missing. Empty means the set matches its record.
 */
export function checkSetBudget(setPath, budget, root = "docs/evidence") {
	const setDir = join(root, setPath);
	if (!existsSync(setDir))
		return [`${setPath}: the set directory does not exist`];
	const want = new Set(budget);
	const problems = [];
	const states = readdirSync(setDir, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.sort();
	if (states.length === 0) problems.push(`${setPath}: no state directories`);
	for (const state of states) {
		const have = palettesOf(join(setDir, state));
		if (have === null || have.size === 0) {
			problems.push(`${setPath}/${state}: no frames`);
			continue;
		}
		const extra = [...have].filter((p) => !want.has(p)).sort();
		const missing = [...want].filter((p) => !have.has(p)).sort();
		if (extra.length || missing.length) {
			const parts = [];
			if (missing.length)
				parts.push(`missing ${missing.length} (${missing.join(", ")})`);
			if (extra.length)
				parts.push(`extra ${extra.length} (${extra.join(", ")})`);
			problems.push(
				`${setPath}/${state}: ${have.size} palettes against a ${budget.length}-palette budget - ${parts.join("; ")}`,
			);
		}
	}
	return problems;
}

/** Every declared set. Returns `{ sets, frames, problems }`. */
export function checkPaletteBudgets(root = "docs/evidence", only = null) {
	const names = only ? [only] : Object.keys(SET_BUDGETS);
	const problems = [];
	let frames = 0;
	for (const name of names) {
		const budget = SET_BUDGETS[name];
		if (!budget) {
			problems.push(
				`${name}: not a declared set (see SET_BUDGETS in this file)`,
			);
			continue;
		}
		problems.push(...checkSetBudget(name, budget, root));
		const setDir = join(root, name);
		if (existsSync(setDir))
			for (const entry of readdirSync(setDir, { withFileTypes: true })) {
				if (!entry.isDirectory()) continue;
				const have = palettesOf(join(setDir, entry.name));
				if (have) frames += have.size;
			}
	}
	return { sets: names, frames, problems };
}

/*
 * The entry-point test is the SHARED one rather than a comparison of this file's
 * own URL against `argv[1]`: that spelling is silent through a symlinked
 * directory (macOS's `/tmp`), where the script loads, prints nothing and exits 0 -
 * and an evidence check that says nothing and passes is the failure this whole
 * file exists to remove. `scripts/entry-point.test.mjs` binds it, and CI's release
 * contracts step is what caught this file resolving its own path (round 6).
 */
if (isEntryPoint(import.meta.url)) {
	const only = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? null;
	const { sets, frames, problems } = checkPaletteBudgets(undefined, only);
	for (const line of problems) process.stdout.write(`  ${line}\n`);
	if (problems.length === 0) {
		process.stdout.write(
			`palette budgets hold: ${sets.length} declared set(s), ${frames} frames, every state exactly its documented palettes\n`,
		);
	} else {
		process.stdout.write(
			`${problems.length} problem(s) across ${sets.length} declared set(s) at ${frames} frames - a \`--only=\` run without \`--themes=\` leaves the rig's DEFAULT palettes in place, so pass the list the set's README documents\n`,
		);
		process.exitCode = 1;
	}
}
