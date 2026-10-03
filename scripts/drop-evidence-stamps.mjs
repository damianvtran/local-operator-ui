#!/usr/bin/env node
/**
 * Clean the retired `srcTree`/`scriptsTree` pair and the retired fold label out
 * of `docs/evidence/manifest.json`, in one command.
 *
 * WHY THIS RUNS INSTEAD OF A HAND EDIT. The manifest is a 3 MB, 556-key JSON
 * document, and the change is "delete two keys and un-label the three derived
 * leads". A hand edit at that size is unreviewable - a serializer that reordered
 * a key, re-escaped a character or re-indented a nested object would ship a
 * 500-key diff in which the two real deletions hide. So the work is done by the
 * SAME serializer the fold tool writes with (`evidence-fold.mjs`'s `serialize`),
 * and the result is asserted against the pre-edit bytes line by line: the only
 * differences permitted are the removed pair lines and the rewritten
 * `countsMean` lead lines (four-space indent, inside `countsMean`). Anything
 * else throws before a byte is written.
 *
 * WHY THE PAIR GOES. A stored `git rev-parse HEAD:src` is false for every branch
 * the moment any commit anywhere moves `src/`, so the fields were re-derived on
 * every fold and made every fold's manifest conflict - the churn this change
 * removes (30 replayed folds: 87 conflict hunks with the pair, 59 without). The
 * guard's teeth are the counts, which stay stored and guarded; what goes is the
 * one claim a file cannot keep about a tree it does not own.
 *
 * WHY THE LEAD LABEL GOES TOO. `evidence-fold.mjs` wrote each derived lead as
 * `RE-DERIVED FOR THIS FOLD (this branch folded onto \`origin/main\` = \`<sha>\`)`,
 * which puts a fresh commit name into the file on every fold even when the walk
 * found nothing new - 11 of those 30 folds' conflict regions were the label
 * alone. The writer no longer emits it, but a lead already in the file is never
 * rewritten by itself: `leadParagraph` returns a lead whose READINGS match
 * unchanged (`statesSameReadings` compares numbers), so the residue is inert and
 * permanent. This command is what removes it, and it is the remedy a branch needs
 * in the two states the fold tool cannot repair on its own: a lead written by the
 * old tool, and a pair its own old tool re-added.
 *
 * It is a NO-OP on a file that carries neither, so re-running it is safe.
 */

import { readFileSync, writeFileSync } from "node:fs";

const PATH = "docs/evidence/manifest.json";
/** The retired pair, kept identical to `RETIRED_TOP_LEVEL_FIELDS`. */
const RETIRED = ["srcTree", "scriptsTree"];
/** The label the fold tool used to lead a derived paragraph with. */
const FOLD_LABEL =
	/ \(this branch folded onto `origin\/main` = `[0-9a-f]{7,40}`\)/;

const serialise = (manifest) => `${JSON.stringify(manifest, null, 2)}\n`;

/**
 * The leading paragraph of a derived cell, with the fold label removed.
 *
 * Only the LEAD is touched. The paragraphs under it are history by construction
 * (each is a former lead, and each says in its own words which tree it described),
 * so a label inside one of them is a record, not a residue.
 */
const unlabelLead = (text) => {
	if (typeof text !== "string") return text;
	const [lead, ...rest] = text.split("\n\n");
	const stripped = lead.replace(FOLD_LABEL, "");
	return stripped === lead ? text : [stripped, ...rest].join("\n\n");
};

const before = readFileSync(PATH, "utf8");
const manifest = JSON.parse(before);

const removed = RETIRED.filter((key) => key in manifest);
if (removed.length === 1) {
	throw new Error(
		`${PATH} carries only ${JSON.stringify(removed)} of the retired pair - the file is half-migrated, so stop and inspect it rather than deleting the one key that is there`,
	);
}
for (const key of removed) delete manifest[key];

let relabelled = 0;
for (const [field, text] of Object.entries(manifest.countsMean ?? {})) {
	const cleaned = unlabelLead(text);
	if (cleaned !== text) {
		manifest.countsMean[field] = cleaned;
		relabelled += 1;
	}
}

if (removed.length === 0 && relabelled === 0) {
	console.log(
		`${PATH} carries no retired stamp and no fold label - nothing to do.`,
	);
	process.exit(0);
}

const after = serialise(manifest);

/*
 * THE DIFF IS ASSERTED, NOT EYEBALLED. Two shapes are permitted:
 *
 *   - a top-level `"srcTree":`/`"scriptsTree":` line leaving the file (matched at
 *     the TOP-LEVEL indent only: nested records - the `previousTopLevel`
 *     snapshots - legitimately carry a key of the same name, and a filter
 *     written without the indent reports those as part of the diff this run is
 *     asserting), and
 *   - a `countsMean` cell's line changing, which is the lead rewrite.
 *
 * Everything else must be byte-identical, and `removedLines.length !== 2` is a
 * hard stop on the "delete the one key that is there" failure mode.
 */
const droppedPairLine = (line) => /^ {2}"(srcTree|scriptsTree)":/.test(line);
const countsCellLine = (line) => /^ {4}"(frames|surfaces|themes)":/.test(line);
const beforeLines = before.split("\n");
const removedLines = beforeLines.filter(droppedPairLine);
if (removedLines.length !== removed.length) {
	// One top-level line per retired key: two keys, two lines - unless the file
	// was already half-migrated, which the branch above refuses.
	throw new Error(
		`expected ${removed.length} top-level stamp line(s), found ${removedLines.length} - the file's shape moved, so re-read it before deleting anything`,
	);
}

const tally = (lines, keep) => {
	const counts = new Map();
	for (const line of lines)
		if (keep(line)) counts.set(line, (counts.get(line) ?? 0) + 1);
	return counts;
};
const accounted = (line) => !droppedPairLine(line) && !countsCellLine(line);
const beforeOther = tally(beforeLines, accounted);
const afterOther = tally(after.split("\n"), accounted);
if (
	beforeOther.size !== afterOther.size ||
	[...beforeOther].some(([line, n]) => afterOther.get(line) !== n)
) {
	throw new Error(
		"the serializer would move more than the retired pair and the countsMean leads - stop and inspect: those are the only permitted diffs",
	);
}

writeFileSync(PATH, after);
console.log(
	`removed ${removed.length ? removed.join(", ") : "nothing"}; unlabelled ${relabelled} countsMean lead(s); ${before.length - after.length} bytes`,
);
