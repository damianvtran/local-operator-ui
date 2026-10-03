#!/usr/bin/env node
/**
 * Retire `srcTree`/`scriptsTree` from `docs/evidence/manifest.json`, once.
 *
 * WHY THIS RUNS INSTEAD OF A HAND EDIT. The manifest is a 3 MB, 556-key JSON
 * document, and the change is "delete two keys". A hand edit at that size is
 * unreviewable - a serializer that reordered a key, re-escaped a character or
 * re-indented a nested object would ship a 500-key diff in which the two real
 * deletions hide. So the deletion is done by the SAME serializer the fold tool
 * writes with (`evidence-fold.mjs`'s `serialize`), and the result is asserted
 * against the pre-edit bytes line by line: the ONLY difference permitted is the
 * two removed lines, and anything else throws before a byte is written.
 *
 * WHY THE KEYS GO. A stored `git rev-parse HEAD:src` is false for every branch
 * the moment any commit anywhere moves `src/`, so the fields were re-derived on
 * every fold and made every fold's manifest conflict - the churn this change
 * removes (30 replayed folds: 84 conflict hunks with the pair, 56 without).
 * The guard's teeth are the counts (`frames`, `surfaces`, `themes`,
 * `partialCapture.refreshedFrames`, the `countsMean` leads), which stay stored
 * and guarded; what goes is the one claim a file cannot keep about a tree it
 * does not own. `AGENTS.md`'s evidence section states what the file certifies
 * afterwards.
 *
 * It is committed with the change as the record of how the bytes moved, and it
 * is a NO-OP on a manifest that has already been migrated - so re-running it is
 * safe, and running it on a branch whose own old fold tool re-added the pair
 * (the resurrection trap the fold doctrine describes) is the remedy.
 */

import { readFileSync, writeFileSync } from "node:fs";

const PATH = "docs/evidence/manifest.json";
/** The retired pair, kept identical to `RETIRED_TOP_LEVEL_FIELDS`. */
const RETIRED = ["srcTree", "scriptsTree"];

const serialise = (manifest) => `${JSON.stringify(manifest, null, 2)}\n`;

const before = readFileSync(PATH, "utf8");
const manifest = JSON.parse(before);
const removed = RETIRED.filter((key) => key in manifest);

if (removed.length === 0) {
	console.log(`${PATH} carries neither stamp - nothing to remove.`);
	process.exit(0);
}
if (removed.length !== RETIRED.length) {
	throw new Error(
		`${PATH} carries only ${JSON.stringify(removed)} of the retired pair - the file is half-migrated, so stop and inspect it rather than deleting the one key that is there`,
	);
}

for (const key of removed) delete manifest[key];
const after = serialise(manifest);

/*
 * The two removed lines are matched at the TOP-LEVEL indent only. Nested
 * records (`previousTopLevel` snapshots) legitimately carry a `"srcTree"` key of
 * their own, and a filter written without the indent would report those as part
 * of the diff this run is asserting - which is how the assertion was wrong
 * before it was run.
 */
const dropped = (line) => /^ {2}"(srcTree|scriptsTree)":/.test(line);
const beforeLines = before.split("\n");
const kept = beforeLines.filter((line) => !dropped(line));
const removedLines = beforeLines.filter(dropped);

if (removedLines.length !== 2) {
	throw new Error(
		`expected exactly two top-level stamp lines, found ${removedLines.length} - the file's shape moved, so re-read it before deleting anything`,
	);
}
if (kept.join("\n") !== after) {
	throw new Error(
		"the serializer would move more than the retired pair - stop and inspect: the only permitted diff is the two removed lines",
	);
}

writeFileSync(PATH, after);
console.log(
	`removed ${removed.join(", ")}; ${before.length - after.length} bytes`,
);
