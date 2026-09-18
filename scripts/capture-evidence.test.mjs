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
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
	clearSweptFrames,
	profileOwnerPid,
	storyDrew,
} from "./capture-evidence.mjs";

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

/*
 * The readiness floor, at both of its edges.
 *
 * Why this is a test rather than a paragraph in the capture script: the floor
 * read 8, the smallest story in the set draws 7 of its own elements, and
 * `chat-slash-completion--argument-phase-no-match` therefore timed out of the
 * sweep as "Storybook never finished preparing the story (60s)" while it was
 * rendering its sentence, its label and its row region the whole time. A
 * threshold that no longer admits what the app draws looks exactly like a
 * broken story from the outside, so the number has to be pinned where the next
 * person to move it can see the measurement it came from.
 */
test("the drawn-story floor rejects the decorator's own furniture", () => {
	assert.equal(storyDrew(0), false);
	assert.equal(storyDrew(1), false);
	// The preview decorator's theme wrapper and toast container, and nothing a
	// story rendered: the failure the floor exists to catch.
	assert.equal(storyDrew(2), false);
});

test("the drawn-story floor admits the smallest story in the set", () => {
	// `chat-slash-completion--argument-phase-no-match`, measured from the
	// rendered document: 7 content elements in a 9-element story root.
	assert.equal(storyDrew(9), true);
	// One element fewer than that story - a shape no story in the list has.
	assert.equal(storyDrew(8), false);
});

/*
 * The predicate is injected into the page through its own source text, so a
 * body that named a module-level constant would throw inside the browser rather
 * than here. Evaluating it in a bare scope is the same evaluation the page does.
 */
test("the predicate the page runs is the predicate this suite pins", () => {
	const inPage = new Function(`return ${storyDrew}`)();
	for (const counted of [0, 2, 8, 9, 40]) {
		assert.equal(inPage(counted), storyDrew(counted));
	}
});

/* ---- the stale-profile sweep, over a synthetic temp root ----------------- */

/*
 * The sweep's candidate rule, which used to be a loose prefix.
 *
 * `sweepStaleProfiles` reaps abandoned Chrome profiles out of the SHARED system
 * temp directory, so the only thing between it and another process's directory
 * is its own name test. That test used to be `startsWith("lo-evidence-")`, and
 * `evidence-manifest.test.mjs` builds its synthetic evidence tree in that same
 * directory as `mkdtempSync(join(tmpdir(), "lo-evidence-manifest-"))` - so a
 * capture running at the same time deleted a LIVE tree out from under a test
 * that was walking it. The mechanism is worth stating, because no reading of
 * either file shows it: `Number("manifest-XXXXXX")` is `NaN`,
 * `process.kill(NaN, 0)` throws a `TypeError`, and the sweep's bare `catch` read
 * a throw that was never about a process as "no such process, so the profile is
 * abandoned".
 *
 * Why this is a test rather than a paragraph: it surfaced as flakiness - that
 * file's six `countsMean` cells share one module-scope scratch root and the
 * five that walk it fail together with an `ENOENT` on it - on a machine running
 * several lanes at once, which is the shape
 * that costs a re-run rather than a bug report. Two properties are pinned, and
 * a fix that holds only the first is a sweep that silently stopped sweeping: an
 * abandoned profile is still reaped, and a directory whose name is not a profile
 * is not deleted.
 */

/** A pid that is certainly not running: a child that exited and was reaped. */
const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid;

/*
 * The scratch roots the test below makes, reclaimed when the file finishes.
 * They are real temp directories with a child's HOME in one of them, so leaving
 * them behind would outlive the run rather than tidy itself up.
 */
const cleaned = [];
after(() => {
	for (const dir of cleaned) rmSync(dir, { recursive: true, force: true });
});

test("the profile-name rule answers for the profile shape and nothing else", () => {
	assert.equal(profileOwnerPid("lo-evidence-4242"), 4242);
	assert.equal(profileOwnerPid("lo-evidence-1"), 1);
	// The name that made this a defect: a sibling test's live scratch tree.
	assert.equal(profileOwnerPid("lo-evidence-manifest-uexKDI"), null);
	/*
	 * Suffix shapes that are not a pid. Every one of these reached `process.kill`
	 * before this rule existed, and every throw it produced was read as
	 * "abandoned". The last is the one `\d+` alone would still admit: all digits,
	 * and far above any pid the kernel hands out.
	 */
	assert.equal(profileOwnerPid("lo-evidence-"), null);
	assert.equal(profileOwnerPid("lo-evidence-abc"), null);
	assert.equal(profileOwnerPid("lo-evidence-12x"), null);
	assert.equal(profileOwnerPid("lo-evidence-0"), null);
	assert.equal(profileOwnerPid("lo-evidence-99999999999999999999"), null);
	// Not this script's directories at all.
	assert.equal(profileOwnerPid("lo-evidence"), null);
	assert.equal(profileOwnerPid("lo-sweep-4242"), null);
});

test("the sweep takes the abandoned profile and leaves the rest of the temp directory", () => {
	const root = mkdtempSync(join(tmpdir(), "lo-sweep-profiles-"));
	// A scratch home for the child, so nothing it does derives from the
	// operator's, and deliberately OUTSIDE the swept root.
	const home = mkdtempSync(join(tmpdir(), "lo-sweep-home-"));
	cleaned.push(root, home);

	// What a SIGKILL under `timeout` leaves behind: the profile, uncollected.
	const abandoned = join(root, `lo-evidence-${deadPid()}`);
	mkdirSync(join(abandoned, "Default"), { recursive: true });
	writeFileSync(join(abandoned, "Default", "Cookies"), "a leaked profile");

	/*
	 * A sibling test's scratch tree, under the name that collided with the loose
	 * prefix. Its frame is the thing the ENOENT was raised on, so it is asserted
	 * by path and not by the directory alone.
	 */
	const sibling = join(root, "lo-evidence-manifest-uexKDI");
	const siblingFrame = join(sibling, "swept-story", "localOperatorDark.webp");
	mkdirSync(join(sibling, "swept-story"), { recursive: true });
	writeFileSync(siblingFrame, "a live tree");

	/*
	 * A third name that is not a profile, so the rule is pinned as a shape rather
	 * than as "the manifest one is special".
	 */
	const other = join(root, "lo-evidence-not-a-pid");
	mkdirSync(other, { recursive: true });

	/*
	 * The sweep is module-scope and reads `tmpdir()`, so the only way to exercise
	 * it against a synthetic root without a capture and without Chrome is a child
	 * whose TMPDIR is that root. The environment is built rather than inherited:
	 * `CMUX_*`/`LOP_*` belong to whatever session is running this suite, and a test
	 * that spawns anything must not hand them on.
	 */
	const script = `import { sweepStaleProfiles } from ${JSON.stringify(
		new URL("./capture-evidence.mjs", import.meta.url).href,
	)};
sweepStaleProfiles();`;
	const run = spawnSync(
		process.execPath,
		["--input-type=module", "-e", script],
		{
			env: { PATH: process.env.PATH, HOME: home, TMPDIR: root },
			encoding: "utf8",
		},
	);
	assert.equal(
		run.status,
		0,
		`the sweep child exited ${run.status}: ${run.stderr}`,
	);

	// (1) the abandoned profile is still reaped, whole
	assert.ok(!existsSync(abandoned), "an abandoned profile is the sweep's job");
	// (2) the sibling's tree is not, and neither is a name that is not a profile
	assert.ok(
		existsSync(siblingFrame),
		"a directory that is not a profile is not the sweep's to delete",
	);
	assert.ok(existsSync(other));
	assert.ok(existsSync(root));
});
