#!/usr/bin/env node
/**
 * The sweep's own output is the FRAMES, not the directories holding them.
 *
 * Why this is a test rather than a paragraph: `clearSweptFrames` runs once, at
 * the head of a forty-minute sweep nobody watches, and everything it gets wrong
 * is unrecoverable from the tree afterwards. Two properties it has to hold, and
 * both have already been broken once in this repository's history:
 *
 *   1. a declared set survives, whole (the frames this script cannot retake -
 *      a pointer hover, a live backend, a different source tree);
 *   2. a file the sweep did not write survives even in a directory it DID
 *      sweep. The gate counts frames, so anything else that disappears -
 *      a README explaining how a surface was captured, or the reference the
 *      tool rows were ported from - goes silently.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { clearSweptFrames } from "./capture-evidence.mjs";

const build = () => {
	const out = mkdtempSync(join(tmpdir(), "lo-sweep-"));
	const write = (rel, body = "x") => {
		const path = join(out, rel);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, body);
	};
	write(
		"manifest.json",
		JSON.stringify({
			frames: 3,
			supplementary: [{ path: "kept-set", frames: 1 }],
		}),
	);
	// The sweep's own output: regenerated on every run, so it goes.
	write("swept-story/localOperatorDark.webp");
	write("swept-story/localOperatorLight.webp");
	// Written by a hand or another tool, in a directory the sweep owns.
	write("swept-story/README.md", "# how these frames were taken");
	write("swept-story/png-pair/after-1380.png");
	// Declared: this script cannot re-derive it.
	write("kept-set/localOperatorDark.webp");
	return out;
};

test("a sweep takes its frames and nothing else", () => {
	const out = build();
	const supplementary = clearSweptFrames(out);

	assert.deepEqual(supplementary, [{ path: "kept-set", frames: 1 }]);
	// (1) the declared set survives, frame and all
	assert.ok(existsSync(join(out, "kept-set/localOperatorDark.webp")));
	// (2) the stale frames go
	assert.ok(!existsSync(join(out, "swept-story/localOperatorDark.webp")));
	assert.ok(!existsSync(join(out, "swept-story/localOperatorLight.webp")));
	// ... and the prose and the hand-taken PNGs beside them do not
	assert.ok(
		existsSync(join(out, "swept-story/README.md")),
		"a README in a swept directory is not the sweep's to delete",
	);
	assert.ok(
		existsSync(join(out, "swept-story/png-pair/after-1380.png")),
		"a frame this script does not write is not part of its output",
	);
	// The manifest stays until the run replaces it, so a crash inside the sweep
	// leaves a stale-but-honest declaration rather than none.
	assert.ok(existsSync(join(out, "manifest.json")));
	assert.equal(
		JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")).frames,
		3,
	);
});

test("a directory the sweep empties is removed, one that still holds prose is not", () => {
	const out = build();
	clearSweptFrames(out);
	// `swept-story` keeps its README, so it stays; `png-pair` holds a PNG, so it
	// stays too. Nothing here asserts the reverse - a directory left holding only
	// frames must go, which is the stale-surface case.
	assert.ok(existsSync(join(out, "swept-story")));
	assert.ok(existsSync(join(out, "swept-story/png-pair")));

	const bare = mkdtempSync(join(tmpdir(), "lo-sweep-bare-"));
	mkdirSync(join(bare, "gone-story"), { recursive: true });
	writeFileSync(join(bare, "gone-story", "localOperatorDark.webp"), "x");
	writeFileSync(join(bare, "manifest.json"), JSON.stringify({ frames: 1 }));
	clearSweptFrames(bare);
	assert.ok(
		!existsSync(join(bare, "gone-story")),
		"a surface whose frames all went does not stay behind empty",
	);
});
