import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { partialAddedFields, partialFrameCount } from "./capture-evidence.mjs";
import {
	citationAncestryFailures,
	countsMeanFailures,
	frames as frameFiles,
	partialCaptureFailures,
	provenanceFailures,
	stampFailures,
} from "./check-evidence.mjs";

/*
 * The evidence manifest's falsifiability, on a synthetic tree.
 *
 * `check-evidence.mjs` states the property it exists for in its own words:
 * "The sweep's count answers for everything no supplementary set claimed, so
 * an undeclared directory appearing on disk still fails - the property this
 * check exists for." It enforces that by comparing the manifest's declared
 * `frames` against the frames on disk outside every declared set.
 *
 * A repair to `capture-evidence.mjs` once computed the declared count from the
 * SAME walker and the SAME exclusion list the guard compares it against. The
 * two expressions became identical by construction, so on a partial run the
 * comparison could no longer fail and a stray undeclared directory that the
 * old behaviour caught was silently absorbed (review round 1, R2).
 *
 * That is a property of the two scripts TOGETHER, and neither one's own tests
 * could see it — which is why this file exists and why it models the guard's
 * comparison rather than importing it: `check-evidence.mjs` shells out to
 * ImageMagick per frame and only ever reads the real `docs/evidence`, so the
 * arithmetic is reproduced here over a tree built for the purpose.
 */

const scratch = [];
after(() => {
	for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/**
 * A throwaway evidence tree; the bytes never matter, only the paths.
 *
 * Deliberately NOT named under `lo-evidence-`, which is
 * `capture-evidence.mjs`'s Chrome-profile namespace: that script reaps
 * abandoned profiles by NAME out of this same shared temp directory (see
 * `sweepStaleProfiles`), so a fixture that borrows the prefix is a deletion
 * target for every capture running on the box. It was called
 * `lo-evidence-manifest-` until a capture deleted a live tree under one of
 * these cells, which is the defect this name closes rather than papers over
 * (review round 1, F1). `lop-` is what the rigs here name their own scratch
 * roots (`lop-submit-latency-`), so a leaked tree is still
 * identifiable without being sweepable - and the sweep's rule is pinned
 * against both spellings in `capture-evidence.test.mjs`, so a later edit
 * cannot quietly widen the prefix back over this name.
 */
function tree(layout) {
	const root = mkdtempSync(join(tmpdir(), "lop-evidence-manifest-"));
	scratch.push(root);
	for (const [dir, count] of Object.entries(layout)) {
		const full = join(root, dir);
		mkdirSync(full, { recursive: true });
		for (let i = 0; i < count; i++)
			writeFileSync(join(full, `theme-${i}.webp`), "not-a-real-webp");
	}
	return root;
}

/**
 * `check-evidence.mjs:313-323`, reproduced: frames outside every declared set,
 * compared against what the manifest declares.
 */
function guardAccepts(root, manifest) {
	const declared = (manifest.supplementary ?? []).map((set) =>
		join(root, set.path),
	);
	const swept = frameFiles(root).filter(
		(file) => !declared.some((dir) => file.startsWith(`${dir}/`)),
	).length;
	return manifest.frames === swept;
}

/**
 * `capture-evidence.mjs`'s partial branch, CALLED rather than copied.
 *
 * Round 2, R7: this file previously reimplemented the arithmetic, so reverting
 * `capture-evidence.mjs` to the absorbing tree-derived version left all five
 * tests green - the suite pinned the reasoning and not the code. The shipped
 * expression is now exported as `partialFrameCount` and invoked here, so an
 * edit to it fails in this file.
 */
function partialManifest(previous, root, newDirs) {
	/*
	 * `added` is the per-FRAME list the capture loop records in `writtenFrames`,
	 * which is what the shipped signature takes. #110 landed that tighter form
	 * while this branch was in review - it keys on whether each FRAME existed
	 * before the run rather than on whether its directory did - so the branch
	 * adopted it instead of shipping a second rule beside it, and this helper
	 * expands the test's directory fixtures into the frames inside them.
	 */
	const added = newDirs.flatMap((dir) => frameFiles(join(root, dir)));
	return {
		...previous,
		frames: partialFrameCount(previous, added),
	};
}

/** The rejected implementation, kept so the regression it caused stays pinned. */
function partialManifestFromTree(previous, root) {
	const declared = (previous.supplementary ?? []).map((set) =>
		join(root, set.path),
	);
	return {
		...previous,
		frames: frameFiles(root).filter(
			(file) => !declared.some((dir) => file.startsWith(`${dir}/`)),
		).length,
	};
}

test("a partial run that adds a surface satisfies the guard", () => {
	// The defect the repair was for: capturing a NEW story narrowly left the
	// declared count behind the tree forever, and the only ways out were a full
	// sweep or hand-editing the manifest.
	const root = tree({ "chat-trace/conversation": 2, "chat-new/states": 2 });
	const previous = { frames: 2, supplementary: [] };
	const manifest = partialManifest(previous, root, ["chat-new/states"]);
	assert.equal(manifest.frames, 4);
	assert.ok(guardAccepts(root, manifest), "an added surface must be accounted");
});

test("counts a fold hand-wrote as JSON strings still add, instead of concatenating", () => {
	/*
	 * Measured on the trace-label pass (2026-09-27): `frames` and
	 * `partialCapture.refreshedFrames` had been hand-resolved by folds as JSON
	 * STRINGS (`"9718"`, `"7929"`), so one narrowed run's `previous + added`
	 * produced `"97184"` and `"79294"` - and the string form then flipped
	 * `check-evidence.mjs`'s `typeof === "number"` gate to skipped, so the drift
	 * was silent in both directions. A legacy string is COERCED, never
	 * concatenated: what this function returns is a count.
	 */
	const root = tree({ "chat-trace/conversation": 2, "chat-new/states": 2 });
	const manifest = partialManifest({ frames: "2", supplementary: [] }, root, [
		"chat-new/states",
	]);
	assert.equal(manifest.frames, 4);
	assert.equal(typeof manifest.frames, "number");
});

test("a partial run that only refreshes does not move the count", () => {
	// Frames overwritten in a pre-existing directory are ones the manifest
	// already covers; counting them again would fail the guard from the other
	// side.
	const root = tree({ "chat-trace/conversation": 2, "chat-new/states": 2 });
	const manifest = partialManifest({ frames: 4, supplementary: [] }, root, []);
	assert.equal(manifest.frames, 4);
	assert.ok(guardAccepts(root, manifest));
});

test("a stray undeclared directory still fails the guard", () => {
	/*
	 * The reviewer's reproduction, and the whole reason this file exists: a
	 * declared set plus one undeclared `STRAY-UNDECLARED/` the run never wrote.
	 *
	 *   old partial behaviour -> frames stays 2 => guard compares 2 vs 4  FAIL
	 *   tree-derived repair   -> frames = 4     => guard compares 4 vs 4  PASS
	 *
	 * The second is the regression. A stray is in neither term of the correct
	 * arithmetic, so it must still fail.
	 */
	const root = tree({
		"chat-trace/conversation": 2,
		"STRAY-UNDECLARED": 2,
	});
	const previous = { frames: 2, supplementary: [] };

	const honest = partialManifest(previous, root, []);
	assert.equal(honest.frames, 2, "the run wrote nothing, so nothing is added");
	assert.equal(
		guardAccepts(root, honest),
		false,
		"a stray directory must still fail the guard",
	);

	// And the rejected implementation, pinned as the thing not to go back to.
	const absorbed = partialManifestFromTree(previous, root);
	assert.equal(absorbed.frames, 4);
	assert.equal(
		guardAccepts(root, absorbed),
		true,
		"pins the defect: a tree-derived count self-certifies the stray",
	);
});

test("a stray beside a genuinely added surface is still caught", () => {
	// The case that matters in practice, because it is the one a real
	// remediation round produces: the run legitimately adds a directory AND
	// something unrelated is left behind. Absorbing the first must not absorb
	// the second.
	const root = tree({
		"chat-trace/conversation": 2,
		"chat-new/states": 2,
		"STRAY-UNDECLARED": 2,
	});
	const manifest = partialManifest({ frames: 2, supplementary: [] }, root, [
		"chat-new/states",
	]);
	assert.equal(manifest.frames, 4, "only the added surface raises the count");
	assert.equal(guardAccepts(root, manifest), false, "the stray still fails");
});

test("declared supplementary sets are excluded from the swept count", () => {
	// A live-app set the sweep cannot re-derive is declared separately and must
	// not be double-counted against the sweep's own total.
	const root = tree({
		"chat-trace/conversation": 2,
		"sidebar-new-chat/rest": 2,
	});
	const manifest = {
		frames: 2,
		supplementary: [{ path: "sidebar-new-chat", frames: 2 }],
	};
	assert.ok(guardAccepts(root, manifest));
	// And an undeclared directory is still not covered by someone else's claim.
	const withStray = tree({
		"chat-trace/conversation": 2,
		"sidebar-new-chat/rest": 2,
		"STRAY-UNDECLARED": 1,
	});
	assert.equal(guardAccepts(withStray, manifest), false);
});

/* ---- the manifest's own provenance -------------------------------------- */

/**
 * A fake `git` so these run without touching the repository's real history.
 *
 * The shipped `provenanceFailures` takes its git reader as an argument for
 * exactly this reason: the property under test is what the function CONCLUDES
 * from git's answers, and pinning that against real history would make the test
 * pass or fail on which commits happen to exist today.
 */
const fakeGit =
	({ resolvable = [], reachable = [], src, scripts, show }) =>
	(args) => {
		// `show` is the capture script both count checks read their literals from.
		if (args[0] === "show") return show ?? null;
		if (args[0] === "rev-parse" && args[1] === "--quiet")
			return resolvable.includes(args[3].replace("^{commit}", ""))
				? args[3]
				: null;
		if (args[0] === "rev-parse" && args[1] === "HEAD:src") return src ?? null;
		if (args[0] === "rev-parse" && args[1] === "HEAD:scripts")
			return scripts ?? null;
		if (args[0] === "merge-base")
			return reachable.includes(args[2]) ? "" : null;
		if (args[0] === "for-each-ref")
			return reachable.includes(args[2]) ? "refs/heads/x" : "";
		if (args[0] === "log") return "wip: a commit that was amended away";
		return null;
	};

const GOOD = {
	head: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	srcTree: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
	scriptsTree: "cccccccccccccccccccccccccccccccccccccccc",
	supplementary: [
		{
			path: "live",
			capturedAtHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		},
	],
};
const git = fakeGit({
	resolvable: [GOOD.head, "6e0d41580e24cacc3de08d659b8f6058d78ead53"],
	reachable: [GOOD.head],
	src: GOOD.srcTree,
	scripts: GOOD.scriptsTree,
});

test("a manifest stamped at the tree under review passes", () => {
	assert.deepEqual(provenanceFailures(GOOD, git), []);
});

test("a head that is merely RESOLVABLE is not good enough", () => {
	/*
	 * The defect this check exists for (round 4, R1/D13): the manifest named a
	 * pre-amend `wip:` commit. It still resolved in the clone that created it,
	 * so a resolvability check passes it - and it was reachable from no ref, so
	 * it would have died at the next gc and left the citation dead-ended. The
	 * durable property is REACHABILITY.
	 */
	const dangling = {
		...GOOD,
		head: "6e0d41580e24cacc3de08d659b8f6058d78ead53",
	};
	const out = provenanceFailures(dangling, git);
	assert.equal(out.length, 1);
	assert.match(out[0], /reachable from no ref/);
	assert.match(out[0], /dies at the next gc/);
	// It must name the commit, so the reader knows WHICH stamp is wrong.
	assert.match(out[0], /wip: a commit that was amended away/);
});

test("a head that resolves to nothing at all fails", () => {
	const out = provenanceFailures({ ...GOOD, head: "d".repeat(40) }, git);
	assert.equal(out.length, 1);
	assert.match(out[0], /resolves to no commit/);
});

test("a stale tree hash fails, per tree, naming both sides", () => {
	/*
	 * Trees rather than commits are the real staleness question: a docs-only
	 * commit moves `head` and leaves the frames valid, which is why `head` is
	 * only required to be reachable while the TREES must match exactly.
	 */
	const src = provenanceFailures({ ...GOOD, srcTree: "e".repeat(40) }, git);
	assert.equal(src.length, 1);
	assert.match(src[0], /`srcTree` is eeeeeeeee but HEAD:src is bbbbbbbbb/);
	const scripts = provenanceFailures(
		{ ...GOOD, scriptsTree: "f".repeat(40) },
		git,
	);
	assert.equal(scripts.length, 1);
	assert.match(
		scripts[0],
		/`scriptsTree` is fffffffff but HEAD:scripts is ccccccccc/,
	);
});

test("a supplementary set's capturedAtHead is held to the same bar", () => {
	const out = provenanceFailures(
		{
			...GOOD,
			supplementary: [
				{
					path: "live",
					capturedAtHead: "6e0d41580e24cacc3de08d659b8f6058d78ead53",
				},
			],
		},
		git,
	);
	assert.equal(out.length, 1);
	assert.match(out[0], /supplementary\[live\]/);
	assert.match(out[0], /reachable from no ref/);
});

test("a missing head is a failure, not a pass by omission", () => {
	// The absence of a claim must not be quieter than a wrong one.
	assert.match(
		provenanceFailures({ ...GOOD, head: undefined }, git)[0],
		/missing or not a sha/,
	);
	assert.match(
		provenanceFailures({ ...GOOD, head: "abc" }, git)[0],
		/missing or not a sha/,
	);
});

test("partialCapture's own head citations are checked too", () => {
	/*
	 * Round 4, R4-1. `addedAtHead` and `refreshedAtHead` name the commits a
	 * narrowed pass took frames at, and a reader checks a frame against them
	 * exactly as against `head` - but this function read neither, so a
	 * pre-force-push sha could sit there while the gate called the manifest
	 * clean. And it did: the field carried `45b6dd635`, reachable from no ref,
	 * in the very commit that claimed every citation was reachable.
	 */
	const partial = {
		...GOOD,
		partialCapture: {
			addedAtHead: "6e0d41580e24cacc3de08d659b8f6058d78ead53",
		},
	};
	const out = provenanceFailures(partial, git);
	assert.equal(out.length, 1);
	assert.match(out[0], /partialCapture\.addedAtHead/);
	assert.match(out[0], /reachable from no ref/);
	// The other one, the same way: this is the class, not the instance.
	const refreshed = provenanceFailures(
		{
			...GOOD,
			partialCapture: {
				refreshedAtHead: "6e0d41580e24cacc3de08d659b8f6058d78ead53",
			},
		},
		git,
	);
	assert.equal(refreshed.length, 1);
	assert.match(refreshed[0], /partialCapture\.refreshedAtHead/);
	// A reachable one passes, and an absent one is not a failure to report.
	assert.deepEqual(
		provenanceFailures(
			{
				...GOOD,
				partialCapture: { addedAtHead: GOOD.head, refreshedAtHead: undefined },
			},
			git,
		),
		[],
	);
	assert.deepEqual(
		provenanceFailures({ ...GOOD, partialCapture: {} }, git),
		[],
	);
});

test("a pass that added no frames does not claim to have added them", () => {
	/*
	 * The writer half of R4-1. `addedAt`/`addedAtHead` answer "which commit do I
	 * fetch to see the frames this story was added by"; the writer stamped its
	 * OWN head there on every partial run, so a refresh that added nothing
	 * rewrote the citation to name a pass that had added nothing - and then the
	 * next rebase orphaned that sha. A zero-add pass must leave the field alone,
	 * which the caller gets by spreading the previous `partialCapture` under an
	 * empty overlay.
	 */
	// The property the caller depends on: an empty overlay, so the spread of the
	// previous `partialCapture` leaves those four fields exactly as they were.
	assert.deepEqual(Object.keys(partialAddedFields(0, [], GOOD.head)), []);
	const added = partialAddedFields(
		3,
		["live"],
		GOOD.head,
		"2026-09-13T00:00:00.000Z",
	);
	assert.deepEqual(added, {
		addedFrames: 3,
		addedSurfaces: ["live"],
		addedAt: "2026-09-13T00:00:00.000Z",
		addedAtHead: GOOD.head,
	});
});

/*
 * ---- the pass's own tally, from the diff its commits wrote ------------------
 */

/**
 * A fake `git` for `partialCaptureFailures`, which asks two questions.
 *
 * `lsTree` feeds the term asked of `HEAD`'s tree, `diff` the one asked of the
 * pass's own commits. Either can be left unanswerable - `null` - which is what
 * a one-commit-deep checkout does to `diff`: `actions/checkout`'s default clone
 * has no ancestor of `HEAD`, and the Desktop Tests job is that clone, so the
 * term that answers the field there is the one `lsTree` feeds.
 */
const fakeGitFor =
	({ lsTree = null, diff = null } = {}) =>
	(args) => {
		if (args[0] === "ls-tree")
			return lsTree === null ? null : lsTree.join("\n");
		if (args[0] === "diff" && args[1] === "--name-only")
			return diff === null ? null : diff.join("\n");
		return null;
	};

const fakeDiff = (paths) => fakeGitFor({ diff: paths });

const MOVED_FRAMES = [
	"docs/evidence/chat-run-panel/mcp-key-saving/dracula.webp",
	"docs/evidence/chat-run-panel/mcp-key-saving/dune.webp",
	"docs/evidence/chat-run-panel/mcp-key-error/dune.webp",
];

const HONEST_PASS = {
	refreshedAtHead: GOOD.head,
	refreshedFrames: 4,
	refreshedStories: [
		"chat-run-panel--mcp-key-saving",
		"chat-run-panel--mcp-key-error",
	],
};

/**
 * Frames `HEAD`'s tree holds, as `ls-tree` reports them.
 *
 * A tree holds more than the pass moved, which is why this is not
 * `MOVED_FRAMES`: it carries an untouched frame in a directory the block DOES
 * name (counted - the field is a tally for that directory), a frame inside the
 * declared `live` set (excluded), and a frame in a directory the block does not
 * name at all (ignored, because the field is a claim about a run and not about
 * the swept tree). `refreshedFrames` is 4 above for the same reason.
 */
const COMMITTED_FRAMES = [
	...MOVED_FRAMES,
	"docs/evidence/chat-run-panel/mcp-key-saving/obsidian.webp",
	"docs/evidence/live/one/dracula.webp",
	"docs/evidence/chat-trace/conversation/dracula.webp",
];

test("a tally that accounts for the pass's own diff passes", () => {
	assert.deepEqual(
		partialCaptureFailures(
			{ ...GOOD, partialCapture: HONEST_PASS },
			fakeDiff(MOVED_FRAMES),
		),
		[],
	);
});

test("a tally below the pass's own diff fails, and says by how much", () => {
	// The round-4 incident exactly: `refreshedFrames` carried a previous run's
	// total, so the block claimed fewer frames than the pass's commit rewrote.
	const out = partialCaptureFailures(
		{ ...GOOD, partialCapture: { ...HONEST_PASS, refreshedFrames: 2 } },
		fakeDiff(MOVED_FRAMES),
	);
	assert.equal(out.length, 1);
	assert.match(
		out[0],
		/claims 2 refreshed frames, but 3 committed frames differ/,
	);
});

test("a story list that lost a directory the pass rewrote fails", () => {
	/*
	 * The other half of R5-2, and the round-4 incident's own shape: the field
	 * named 17 of the 21 directories the pass rewrote. `refreshedStories` is what
	 * a reader follows to the frames, so a list that lost one describes a run that
	 * did not happen - and until this check, nothing anywhere asked.
	 */
	const out = partialCaptureFailures(
		{
			...GOOD,
			partialCapture: {
				...HONEST_PASS,
				refreshedStories: ["chat-run-panel--mcp-key-saving"],
			},
		},
		fakeDiff(MOVED_FRAMES),
	);
	assert.equal(out.length, 1);
	assert.match(out[0], /refreshedStories misses 1 story directory/);
	assert.match(out[0], /chat-run-panel--mcp-key-error/);
});

test("a width-suffixed directory is the story it belongs to", () => {
	// A story swept at several widths writes `<leaf>@<width>`, one directory per
	// width, under the story's own id - so the claim is the story, not the width.
	const out = partialCaptureFailures(
		{
			...GOOD,
			partialCapture: {
				...HONEST_PASS,
				refreshedStories: ["chat-older-history-slot--app-minimum-width"],
			},
		},
		fakeDiff([
			"docs/evidence/chat-older-history-slot/app-minimum-width@900/dracula.webp",
		]),
	);
	assert.deepEqual(out, []);
});

test("frames inside a declared set are not demanded of the pass's tally", () => {
	// A set is declared precisely because a sweep CANNOT produce its frames, so
	// the denominator excludes every declared directory - the same exclusion
	// `frames` is measured with, and the reason the shipped field passes on the
	// over-claim side rather than on a coincidence.
	const out = partialCaptureFailures(
		{
			...GOOD,
			partialCapture: {
				...HONEST_PASS,
				refreshedFrames: 0,
				refreshedStories: [],
			},
		},
		fakeDiff(["docs/evidence/live/one/dracula.webp"]),
	);
	assert.deepEqual(out, []);
});

test("a repository git cannot read is not a failure", () => {
	// Nothing to question is not the same as a defect found: a tree with no `.git`
	// and a checkout that cannot answer either read reports nothing.
	assert.deepEqual(
		partialCaptureFailures(
			{ ...GOOD, partialCapture: HONEST_PASS },
			() => null,
		),
		[],
	);
});

/*
 * ---- term 1: the field answered from `HEAD`'s tree, with no history --------
 */

test("a tally below the frames HEAD holds in the directories it names fails", () => {
	/*
	 * The round-6 finding (R6-1), in the clone CI actually runs. `diff` is
	 * unanswerable here - `actions/checkout`'s default is one commit deep, so the
	 * pass's parent does not exist - and the field has to be caught anyway.
	 */
	const out = partialCaptureFailures(
		{ ...GOOD, partialCapture: { ...HONEST_PASS, refreshedFrames: 3 } },
		fakeGitFor({ lsTree: COMMITTED_FRAMES }),
	);
	assert.equal(out.length, 1);
	assert.match(
		out[0],
		/claims 3 refreshed frames, but 4 committed frames stand in the directories refreshedStories names at HEAD/,
	);
});

test("an honest tally passes on HEAD's tree alone", () => {
	// The positive control for the case above: a term that fired on any tree
	// would report a defect on every run of this suite.
	assert.deepEqual(
		partialCaptureFailures(
			{ ...GOOD, partialCapture: HONEST_PASS },
			fakeGitFor({ lsTree: COMMITTED_FRAMES }),
		),
		[],
	);
});

test("frames HEAD holds outside the named directories are not this field's", () => {
	/*
	 * The denominator is scoped to the directories the block NAMES, not to the
	 * swept tree: `COMMITTED_FRAMES` carries a frame under `chat-trace/`, which no
	 * entry names. Counting the swept set instead would demand the field claim
	 * every frame in the repository and fire on every honest tally.
	 */
	const out = partialCaptureFailures(
		{
			...GOOD,
			partialCapture: {
				...HONEST_PASS,
				refreshedFrames: 4,
				refreshedStories: ["chat-run-panel--mcp-key-saving"],
			},
		},
		fakeGitFor({
			lsTree: [
				"docs/evidence/chat-trace/conversation/dracula.webp",
				"docs/evidence/chat-trace/conversation/dune.webp",
			],
		}),
	);
	assert.deepEqual(out, []);
});

test("frames inside a declared set are not demanded of the tally on HEAD's tree either", () => {
	// The same exclusion term 2 makes, on the same reason: a set is declared
	// because a sweep cannot produce its frames.
	assert.deepEqual(
		partialCaptureFailures(
			{
				...GOOD,
				partialCapture: {
					...HONEST_PASS,
					refreshedFrames: 0,
					refreshedStories: [],
				},
			},
			fakeGitFor({ lsTree: ["docs/evidence/live/one/dracula.webp"] }),
		),
		[],
	);
});

test("an entry that only prefixes a directory does not name it", () => {
	/*
	 * Round 6's R6-2 and Q5 in miniature: `claimedStory` used to accept any
	 * extension of the entry's own name, so `chat-run-panel--mcp-key` claimed the
	 * frames of `mcp-key-saving` and `mcp-key-error` - an entry satisfied without
	 * naming a directory, which is how a shortened entry kept the guard green over
	 * a directory the list had dropped.
	 */
	const out = partialCaptureFailures(
		{
			...GOOD,
			partialCapture: {
				...HONEST_PASS,
				refreshedStories: ["chat-run-panel--mcp-key"],
			},
		},
		fakeDiff(MOVED_FRAMES),
	);
	assert.equal(out.length, 1);
	assert.match(out[0], /refreshedStories misses 2 story directories/);
	assert.match(out[0], /chat-run-panel--mcp-key-saving/);
	assert.match(out[0], /chat-run-panel--mcp-key-error/);
});

test("the capturer's own dir override still names the directory it writes", () => {
	/*
	 * The other direction, and the reason the rule above is not simply an exact
	 * match: one STORIES entry writes a SECOND state of its story into a directory
	 * the story id only prefixes (`chat-tool-rows--expanded-overflow-narrow` writes
	 * `expanded-overflow-narrow-end`, a scroll position). This case can only pass
	 * through the capturer's own table - no exact name matches - so it fails if
	 * that lookup breaks or if the override stops being declared where it is
	 * written.
	 */
	const override = [
		"docs/evidence/chat-tool-rows/expanded-overflow-narrow-end/dracula.webp",
	];
	assert.deepEqual(
		partialCaptureFailures(
			{
				...GOOD,
				partialCapture: {
					...HONEST_PASS,
					refreshedFrames: 1,
					refreshedStories: ["chat-tool-rows--expanded-overflow-narrow"],
				},
			},
			fakeGitFor({ lsTree: override, diff: override }),
		),
		[],
	);
});

test("a clone with history asks both questions, and a mutated tally answers both", () => {
	// The full-clone shape: term 1 counts the tree, term 2 the pass's commits.
	const out = partialCaptureFailures(
		{ ...GOOD, partialCapture: { ...HONEST_PASS, refreshedFrames: 2 } },
		fakeGitFor({ lsTree: COMMITTED_FRAMES, diff: MOVED_FRAMES }),
	);
	assert.equal(out.length, 2);
	assert.match(out[0], /committed frames stand in the directories/);
	assert.match(out[1], /committed frames differ at/);
});

/* ---- the shipped manifest, against the tree it ships in ------------------ */

/**
 * The one case here that reads the REAL manifest rather than a synthetic tree.
 *
 * Every other test in this file pins what `check-evidence.mjs` CONCLUDES, on a
 * fixture built for the purpose. This one exists because of what none of them
 * could see: at the round-3 head `docs/evidence/manifest.json` carried
 * `origin/main`'s `srcTree`, `scriptsTree` and `surfaces`, because a rebase kept
 * upstream's top-level stamp block while the branch's delta rewrote the
 * neighbouring `partialCapture`. The file therefore certified the committed
 * frames against a tree they were not taken from, git reported no conflict, and
 * only `pnpm check-evidence` could see it - a gate whose image loop runs over
 * every committed frame and outran that round's whole review budget, so the
 * defect survived a full review round (round 3, M1).
 *
 * `stampFailures` is the half of that verdict which needs nothing but `HEAD`'s
 * trees and the capturer's own lists, so binding it here costs about a second
 * and fails the moment a rebase re-stamps the file against somebody else's tree.
 * Citation reachability is deliberately NOT asserted here: it needs the cited
 * commits to be present, and a shallow CI checkout has no such guarantee.
 */
test("the SHIPPED manifest's stamps describe the tree it ships in", () => {
	const manifest = JSON.parse(
		readFileSync("docs/evidence/manifest.json", "utf8"),
	);
	assert.deepEqual(
		stampFailures(manifest),
		[],
		"docs/evidence/manifest.json must describe HEAD's trees: re-derive srcTree/scriptsTree from `git rev-parse HEAD:src` / `HEAD:scripts`, and frames/surfaces from the tree, the way capture-evidence.mjs writes them",
	);
});

/**
 * The notes whose backticked stamp tokens are claims about THIS file, held to the
 * values it ships.
 *
 * WHY THIS EXISTS. A prose restatement of a value cannot check itself, and the
 * round-4 review found this exact failure: `settingsGateRestampNote` named
 * `da3045b32`/`56c63c486` - a sentence describing a TRANSITION - while
 * `srcTree`/`scriptsTree` had moved on and the file shipped `2a0c52d50`/
 * `9982fa27b`. Read on its own, the sentence looked like a claim about the
 * shipped value and was the opposite of one.
 *
 * THE CONVENTION THIS PINS: inside a note in this list, a backticked `srcTree`/
 * `scriptsTree` token is ALWAYS the value this file ships, and the round's
 * history is written as bare SHAs.
 *
 * WHY THE LIST IS A LIST (widened for the fold convergence round's C-1, which is
 * the same defect one note over). `headNote`, `installerNetworkRestampNote`, the
 * console notes and `reloadReanchorRestampNote` quote pairs belonging to the folds
 * they record - a historical identity by design, not a stamp claim - so they are
 * deliberately not here. `shellPathRestampNote` is: the fold onto `d7397b055`
 * substituted ONE token of each pair in it and left the other, so under a sentence
 * beginning "It moves BOTH trees this file binds" the note named main's trees as
 * this file's - wrong in both directions, and green everywhere because this test
 * named a single note. Two notes claim this file's binding; both are asked.
 * `candidateMacArchRestampNote` is the third: it states the transition it made
 * AND quotes both stamps as this file's own values, so it is held to them rather
 * than being read as history - the distinction the paragraph above draws.
 */
/*
 * THE FOLD RULE FOR THIS LIST: the union of both sides, taken by KEY.
 *
 * MEMBERSHIP IS CURATION, NOT A PREDICATE, and the paragraph above states the
 * criterion: a note belongs here when THIS FILE'S BINDING is its subject, not when
 * it records the fold, pass or review it came from. It cannot be re-derived by
 * testing the text - the re-stamp below re-points THE NOTES THIS LIST CARRIES, and
 * nothing else in the file: curation decides the rewrite's scope, a note outside
 * the list keeps the pair its own pass derived (history by subject, the exception
 * the paragraph above names), so a predicate over the file matches more notes than
 * this list curates - at their own passes' pairs, not at the shipped one. (SCOPE,
 * pinned after agent review round 2's R2-1, which found this sentence claiming a
 * file-wide rewrite the re-stamps do not in fact apply; re-pointing the file's
 * other notes would also garble the transition records among them - `headNote`'s
 * `X -> Y` spellings state where a pass moved the pair from, and re-pointing X
 * breaks them - which is why the exception stays and this list is the rewrite's
 * scope.) (Run the predicate
 * this test applies over `docs/evidence/manifest.json` rather than trusting a count
 * written here: it matches dozens, and the number moves with every fold.)
 * `headNote`, `installerNetworkRestampNote`, the console notes and
 * `reloadReanchorRestampNote` are the ones the paragraph above names as not here for
 * exactly that reason. Widening the list to everything the predicate matches would
 * add notes that CANNOT fail, which is the wrong kind of guard and not what this
 * list is for.
 *
 * WHAT A FOLD MUST DO, and what makes this rule falsifiable against the list: union
 * the two sides' keys, KEEP EVERY KEY THAT WAS THERE BEFORE, and state the result.
 * AN OMITTED KEY IS A CHECK SILENTLY NOT RUN - this test iterates the list, so a key
 * dropped by a hand-resolved merge stops being verified while the suite still goes
 * green (round 8, M1: four live keys, every one of them still quoting both stamps,
 * were lost by a resolution that compared added LINES rather than keys). A fold whose
 * base moved this file therefore diffs the KEY SETS of both sides and of the merged
 * result, and says in the commit what the union is.
 *
 * THE UNION THIS FOLD TOOK (`origin/main` `a7df70995`, over this branch's `b3a2cabe0`),
 * stated here because the rule above asks for it: this branch's side named
 * `usageInFlightConvergenceNote`, `macNativeComponentsRestampNote`,
 * `telemetrySwitchRestampNote`, `readReceiptRestampNote`,
 * `chatSidebarSectionsRestampNote` and `windowChromeRestampNote`; main's side named
 * `occupiedAddressRestampNote`, `shellPathRestampNote`, `settingsGateRestampNote`,
 * `candidateMacArchRestampNote`, `notarizeGateRestampNote`,
 * `modelCatalogueFocusRestampNote` and `round1LabelGapRestampNote`. THIRTEEN entries,
 * deduplicated by name - the four notes both sides held are listed once, at this
 * branch's position. No key was dropped. The same union was applied to
 * `docs/evidence/manifest.json`, which took main's eight fold and label-gap notes and
 * kept every key this branch already carried; that file's own key count is
 * unchanged by the resolution except for those additions, and its union is checked by
 * the records test below rather than by prose.
 *
 * THE UNION THIS FOLD TOOK (`origin/main` `9d3e68ddf6`, #467 the goal done-state,
 * over this branch's `78c4e6a529`), stated here because the rule above asks for
 * it: this branch's side named `actionFoldEvidenceNote` and
 * `foldOnto093a329a4dNote`; main's side named `goalDesignRoundTwoNote`. FORTY-ONE
 * entries, deduplicated by name - no key from either side was dropped, checked by
 * evaluating both sides' arrays and diffing the key sets rather than by reading
 * the conflict. The same union was applied to `docs/evidence/manifest.json`,
 * which took main's four goal notes and kept every key this branch already
 * carried (178 + 2 + 1 = 181 keys, the records test's own check).
 *
 * THE UNION THIS FOLD TOOK (`origin/main` `827f45f4fd`, #540 the message block's
 * own surface, over this branch's `2d5c01ca03`), stated here because the rule
 * above asks for it: this branch's side named `actionFoldEvidenceNote` and
 * `foldOnto093a329a4dNote`, plus - registered by this fold, having quoted the
 * pair while outside the list - `foldOnto9d3e68ddf6Note`, `foldOnto4ae3dbff0dNote`
 * and `foldOnto22c0fcd4fdNote`; main's side named `messageSurfaceRestampNote`.
 * FORTY-FOUR entries, diffed as key sets on both sides rather than read off the
 * conflict. No key from either side was dropped.
 *
 * THE UNION THIS FOLD TOOK (`origin/main` `44c7f8fd76`, #541's no-hardlink write
 * refusal and #542's chat header identity, over this branch's `3886526a3c`),
 * stated here because the rule above asks for it: this branch's side named
 * `actionFoldEvidenceNote`, `foldOnto4ae3dbff0dNote` and four `...ActionGroupNote`
 * renames; main's side named `headerIdentityRestampNote`,
 * `headerIdentityRoundOneRestampNote` and `foldOntoFdff0d84d6Note`. The four
 * `foldOnto*` names BOTH sides carried were not the same records: the two lanes
 * had each folded onto `9d3e68ddf6`, `093a329a4d`, `22c0fcd4fd` and
 * `827f45f4fd`, and had coined the same SHA-named keys for their own fold
 * narratives, so the union keeps main's copies under the plain names and this
 * branch's under the `ActionGroup` suffix. No key from either side was dropped.
 *
 * THE UNION THIS FOLD TOOK (`origin/main` `eddfae750b`, #537 the condensed action
 * groups and the running call, over this branch's `c8e231859d`), stated here
 * because the rule above asks for it: this branch's side named
 * `streamRedeliveryRestampNote`; main's side named seventeen entries - the
 * action-fold set (`actionFoldEvidenceNote` and its six `ActionGroup` fold
 * records), `overlayDragZonesRestampNote`, `subviewInsetRestampNote`,
 * `messageSurfaceRestampNote`, `goalDesignRoundTwoNote`,
 * `headerIdentityRestampNote`, `headerIdentityRoundOneRestampNote`,
 * `childReaderScrollControlRestampNote`, and its own `foldOnto093a329a4dNote`,
 * `foldOnto9d3e68ddf6Note` and `foldOnto22c0fcd4fdNote`. THE UNION IS 54 + 1 =
 * 55 ENTRIES, no duplicates, both sides' arrays evaluated and set-diffed
 * against the merged array rather than read off the conflict; no key from
 * either side was dropped, and this fold's own `foldOntoEddfae750bNote` is
 * registered beside them. The same union was applied to
 * `docs/evidence/manifest.json`, which took main's 198 top-level records whole
 * and appended this branch's one - and the fold's re-stamp commit re-points
 * every backticked claim in this list to the pair the merged tree produces.
 *
 * THE UNION THIS FOLD TOOK (`origin/main` `2e12a54d56`, #543 the conversation's
 * solid first paint and the held header identity, over this branch's
 * `5ff02d58a4`), stated here because the rule above asks for it: the two sides'
 * appends collided at one anchor - this branch's side named
 * `streamRedeliveryRestampNote` and `foldOntoEddfae750bNote`, main's side named
 * `heldFirstPaintRestampNote` - so all three are kept, by key. THE UNION IS
 * 55 + 2 = 57 ENTRIES, no duplicates, both sides' arrays set-diffed against the
 * merged array rather than read off the conflict; no key from either side was
 * dropped, and this fold's own `foldOnto2e12a54d56Note` is registered beside
 * them. The same union was applied to `docs/evidence/manifest.json`, which took
 * main's 199 top-level records whole and added this branch's two keys AS MAIN'S
 * EXACT BYTES PLUS TWO INSERTED LINES - main's last passes re-spelled the file
 * pure ASCII, so the resolution preserves its escaping style rather than
 * re-serializing it away - and the fold's re-stamp commit re-points the claims
 * of every note in THIS list (the scope pinned above) to the pair the merged
 * tree produces.
 */
const STAMP_BINDING_NOTES = [
	/*
	 * EIGHT NOTES LEFT THIS LIST when `fix(backend): never lose the app to an
	 * address it does not own` re-derived both stamps: `shellPathRestampNote`,
	 * `settingsGateRestampNote`, `candidateMacArchRestampNote`,
	 * `notarizeGateRestampNote`, `usageInFlightConvergenceNote`,
	 * `macNativeComponentsRestampNote`, `telemetrySwitchRestampNote` and
	 * `readReceiptRestampNote` all quoted the pair that change supersedes, and a
	 * pair that is history must not be held to this file as if it were its own -
	 * the defect this list exists for. Their quoted pairs are written as bare
	 * SHAs in the notes themselves, the same rewrite
	 * `usageAutoCheckRestampNote` and `usageInFlightRemediationNote` got when
	 * earlier rounds re-derived the stamps under them.
	 */
	/*
	 * NINE NOTES LEFT THIS LIST when this branch folded onto the `origin/main` that
	 * moved under it and re-derived both stamps: `shellPathRestampNote`,
	 * `settingsGateRestampNote`, `candidateMacArchRestampNote`,
	 * `notarizeGateRestampNote`, `usageInFlightConvergenceNote`,
	 * `macNativeComponentsRestampNote`, `telemetrySwitchRestampNote`,
	 * `readReceiptRestampNote` and - arriving in the same fold, written by the
	 * picker's catalogue-focus change - `modelCatalogueFocusRestampNote`. Every one
	 * of them quoted the pair the fold supersedes, and a pair that is history must
	 * not be held to this file as if it were its own: that is the defect this list
	 * exists for. Each note's pair is written as bare SHAs in the note itself, the
	 * same rewrite `usageAutoCheckRestampNote` and `usageInFlightRemediationNote`
	 * got when earlier rounds re-derived the stamps under them.
	 */
	/*
	 * ALL TEN ENTRIES BELOW CARRY THIS FILE'S BINDING AT THE FOLD, and the
	 * paragraphs above are the history of how the list grew. A fold that re-derives
	 * both stamps re-stamps every note that quotes the pair as a pointer to this
	 * file's own values - that is what "re-stamp" means, and the ninth entry's own
	 * wording says as much ("states this file's own pair ... held to that pair
	 * rather than read as history").
	 *
	 * THE STATE THIS FOLD FOUND: at the head it was cut from, nine of the ten names
	 * below quoted be8bbbd9 and 2b89b922 - the pair the seamless-chrome pass
	 * superseded when it re-derived both stamps and wrote the tenth entry - so this
	 * list was failing its own test on the pre-fold head. Substituting the
	 * superseded pair in the notes is the fix, not widening the list: the test's
	 * message for that state is the one it already prints, and a name removed from
	 * the list to silence it would be the defect the list exists to catch.
	 *
	 * `occupiedAddressRestampNote` arrives with the fold: main wrote it for the
	 * change that re-derived the pair on main's side, and the same re-stamp applies
	 * to it here, so it is held to this file's pair like the rest.
	 */
	"usageInFlightConvergenceNote",
	"macNativeComponentsRestampNote",
	"telemetrySwitchRestampNote",
	/*
	 * ROUND 1 OF THIS FIX'S OWN (#534's shell-regressions remediation), and it
	 * belongs here for the list's own reason: the round moves BOTH trees this file
	 * binds - `src/` for the merged sidebar's own `scroller` marker and `chats`
	 * moved onto the list region it names, plus the measure and stop-control
	 * call-site corrections, and `scripts/` for the two retired scenes, the walk's
	 * recast from the unreachable `chats-only` mode and the rewritten suites - and
	 * re-shoots no frame (six stories and their twelve frames leave instead), so a
	 * reader is owed the two values it binds and the reason the stills did not
	 * move.
	 */
	"shellRegressionsRestampNote",
	/*
	 * THE WALK'S FIRST FULL RUN'S OWN: the run found one stale pin in the driver (the
	 * offer-frame count), so `scripts/` moved on its own and this note re-derives the pair
	 * that fix ships - the same criterion the fold note above meets.
	 */
	"walkFirstRunRestampNote",
	"scratchDriverRemovalRestampNote",
	"foldSpliceLintRestampNote",
	"foldOntoFdff0d84dNote",
	// The seventh: `readReceiptRestampNote` states this file's own pair for the
	// read-receipt branch, so it is held to that pair rather than read as history -
	// the distinction `candidateMacArchRestampNote` above is in the list for.
	"readReceiptRestampNote",
	/*
	 * The eighth: `chatSidebarSectionsRestampNote` states this file's own pair for
	 * the operator-feedback round on the sidebar's sections and the brand mark, so
	 * it is held to them rather than read as history.
	 */
	"chatSidebarSectionsRestampNote",
	/*
	 * The ninth: `windowChromeRestampNote` states this file's own pair for the
	 * seamless-chrome pass, so it is held to that pair rather than read as history -
	 * the same distinction `candidateMacArchRestampNote` is in the list for. The
	 * pass is the first on this branch to move `src/` AND `scripts/` without taking a
	 * frame (its evidence is a unit suite and a headless launch), which is exactly the
	 * case a re-stamp note exists to record.
	 */
	"windowChromeRestampNote",
	"occupiedAddressRestampNote",
	"shellPathRestampNote",
	"settingsGateRestampNote",
	"candidateMacArchRestampNote",
	"notarizeGateRestampNote",
	/*
	 * This one exists BECAUSE the list is not optional reading: the change it
	 * re-stamps for rewrote no frame, so a reader is owed the two values it binds
	 * and the reason no still was owed.
	 */
	"modelCatalogueFocusRestampNote",
	/*
	 * And `childReaderScrollControlRestampNote`, on the same terms as the two
	 * above: it states this file's own pair for the child reader's
	 * scroll-to-bottom control. The change it records re-stamped both trees and
	 * re-pointed every note in this list, because a re-stamp moves the pair they
	 * all bind, and it rewrote no frame of the sweep - so a reader is owed the
	 * two values it does bind and the reason no still was owed.
	 */
	"childReaderScrollControlRestampNote",
	/*
	 * This branch's own: it states the pair an earlier fold re-derived, and is held
	 * to the pair this file ships rather than read as history.
	 */
	"round1LabelGapRestampNote",
	/*
	 * The chip cap's own: it re-derives `srcTree` for a change that moves `src/`
	 * without touching a frame, so a reader is owed the pair AND the reason no
	 * still was owed - and a new frame is the wrong answer to a question nobody
	 * asked.
	 */
	"cwdChipCapRestampNote",
	/*
	 * The fourteenth, and this branch's own: it states the pair the fold onto
	 * `origin/main` `c44d29c34` re-derived, so it is held to the pair this file
	 * ships rather than read as history - the same distinction
	 * `candidateMacArchRestampNote` is in this list for. The fold moved no frame
	 * (no `.webp` on either side of it), which is the case a re-stamp note exists
	 * to record.
	 */
	"chatRedesignChipFoldRestampNote",
	/*
	 * And this branch's own, carried through every fold: it states the pair THIS
	 * commit ships for UI PR B's Integrations redesign, so it is held to that pair
	 * rather than read as history.
	 */
	"integrationsRedesignRestampNote",
	/*
	 * This pass's own, laid back on top of the fold: it re-stamps a
	 * change that moves `src/` without touching a frame, so the reader is
	 * owed the pair and the reason no still was owed.
	 */
	"liveSettleLabelRestampNote",
	/*
	 * This remediation round's own: it re-stamps the change that rounds 1's two MAJORs moved inside, so
	 * the reader is owed the pair and the reason no still was owed.
	 */
	"liveSettleLabelRemediationNote",
	/*
	 * This pass's own: it re-stamps a change that moves BOTH trees - the session
	 * hook's held-frontend field and the readings strip that marks what it holds,
	 * plus the two harnesses that pin both - without touching a frame, so the
	 * reader is owed the pair AND the reason no still was owed.
	 *
	 * UNIONED WITH MAIN'S OWN, which is the rule this list states for itself: a
	 * fold keeps every key that was there before. Main's records are carried
	 * whole above and below this entry.
	 */
	"streamGapHeldReadingsRestampNote",
	/*
	 * This branch's own: it re-stamps a change that moves both trees this file
	 * binds — the rule/slot/story under `src/`, the trailing-statement pins under
	 * `scripts/` — without touching a swept frame, so the reader is owed the pair
	 * and the reason no still was owed.
	 */
	"rowTeamTrailingRestampNote",
	/*
	 * The offer card's own: the server-release-notes pass re-derived both
	 * trees for a change that moves `src/` and `scripts/` and adds twenty-four
	 * frames in two stories, so the reader is owed the pair AND the reason no
	 * other still was owed.
	 */
	"serverReleaseNotesPassNote",
	/*
	 * And the mention-remedy re-stamp's: THIS FILE'S BINDING IS ITS SUBJECT, which
	 * is the criterion above - it exists to say which two trees the copy change
	 * moved and which single frame set was re-captured with them - so it is held
	 * to the pair the file ships rather than read as history. Its replaced pair is
	 * written as bare SHAs for exactly that reason.
	 */

	"mentionsRemedyRestampNote",
	/*
	 * THIS BRANCH'S OWN, and it belongs here for the list's own reason: the
	 * first-paint hold's round-1 remediation moves BOTH trees (the hook and the
	 * paint cache under `src/`, this file and the recorder under `scripts/`) and
	 * re-shoots no frame, so a reader is owed the two values it binds and the reason
	 * the stills did not move. It was briefly present without being listed, which is
	 * the check silently not run - the guard iterates this list (review round 1,
	 * m3).
	 */
	"firstPaintHoldRestampNote",
	"firstPaintHoldFoldRestampNote",
	/*
	 * THIS BRANCH'S OWN, for round 4, and it belongs here for the list's own reason:
	 * the late-hold mark's arming, the turn-liveness read, the in-flight set's lifetime
	 * and the backstop's deferral move BOTH trees this file binds and re-shoot no frame,
	 * so a reader is owed the two values it binds and the reason the stills did not move.
	 */
	"firstPaintHoldRound4RestampNote",
	/*
	 * AND THIS BRANCH'S OWN, for round 4's refusal-release mark, and it belongs here
	 * for the list's own reason: the refused stand-down hands the hold to the mark,
	 * which moves the hook, the paint cache and the row's own condition under `src/`
	 * and the cases that pin it under `scripts/` - both trees this file binds - while
	 * re-shooting no frame, so a reader is owed the two values it binds and the reason
	 * the stills did not move.
	 */
	"refusalMarkRestampNote",
	/*
	 * This pass's own: it re-stamps the U15 fix (both trees move - the reducer and
	 * its suite, the corrected menu docblock, the new story file and the sweep
	 * rows) AND records the frames that moved with them: 156 new up the view-menu
	 * set, the interrupt set re-taken whole. A reader is owed the pair and the
	 * reason it was re-derived in a commit rather than by the capture run (that
	 * run was dirty; its own head and flag stay as its records).
	 */
	"u15D28RestampNote",
	/*
	 * The fold's own: ITS SUBJECT IS THIS FILE'S BINDING (the re-derived pair),
	 * so it is held to the pair the file ships rather than read as history - and
	 * it is the note that records the union of this list itself, which is the
	 * rule the paragraph above states.
	 */
	"foldOntoDfd93f7e9Note",
	/*
	 * This branch's own: it re-stamps the change that added the approval card's
	 * options, so the reader is owed the pair the file ships - and the two moved
	 * trees are each that change's own files plus this note's registration here.
	 */
	"approvalOptionsRestampNote",
	/*
	 * This branch's own, and the first one that adds a declared set in the same
	 * commit it re-stamps: it re-stamps `fix(chat): spend history reveals at rest,
	 * one fetch per gesture`, which moves both trees AND adds
	 * `[redacted]`, so the reader is owed the pair, the frame
	 * arithmetic, and the reason the swept count does not move.
	 */
	"transcriptRevealAtRestRestampNote",
	/*
	 * AND THIS BRANCH'S OWN, for round 4's gap-liveness repair, and it belongs here for
	 * the list's own reason: reading the turn's liveness across a stream gap moves the
	 * hook under `src/` and the harness case that pins the route under `scripts/` - both
	 * trees this file binds - while re-shooting no frame, so a reader is owed the two
	 * values it binds and the reason the stills did not move.
	 */
	"gapLivenessRestampNote",
	/*
	 * AND THIS BRANCH'S OWN, for the word the marked cell now spells out (UX round 4,
	 * U7), and it belongs here for the list's own reason: the word lives under `src/`,
	 * the two cases that pin it live under `scripts/`, and neither re-shoots a frame,
	 * so a reader is owed the two values it binds and the reason the stills did not
	 * move.
	 */
	"markSpokenRestampNote",
	/*
	 * THIS BRANCH'S OWN, and the ONE entry the seventh fold adds: it states the pair
	 * THIS FILE SHIPS as its opening claim - the fold onto `fac2e11ec7` (#493), whose
	 * pair it re-derives in the fold commit itself - so a reader is owed the check
	 * rather than the prose. WHY IT WAS NOT HERE BEFORE AND IS NOW: the six folds
	 * before it wrote their binding as prose with no backticked stamp token and said
	 * so in as many words, which the earlier version of that note still records. The
	 * moment the note states the pair as the claim it is, the list's own criterion
	 * ("THIS FILE'S BINDING is its subject") is met, and leaving it out would be a
	 * check silently not run for the one note a fold's reader reaches for first.
	 */
	"focusHoldOperationRestampNote",
	/*
	 * The draft-warm pass's own: it re-stamps a change that moves BOTH trees -
	 * the contract, store, hooks and panel on one side, the two suites that pin
	 * them on the other - without touching a frame, so the reader is owed the
	 * pair AND the reason no still was owed.
	 */
	"newchatDraftWarmRestampNote",
	/*
	 * THE ROUND-4 REMEDIATION'S EVIDENCE PASS. It re-stamps the change that
	 * answers rounds 4 (the fold debris, the restored §F3 fate, the widened
	 * stop classification, the popover width) and re-shoots the three popover
	 * states after D31, so the reader is owed the pair the file ships.
	 */
	"remediationRound4EvidenceNote",
	/*
	 * The fold's own: ITS SUBJECT IS THIS FILE'S BINDING (the re-derived pair),
	 * and it is the note that records the union of this list itself - main's
	 * approval-options and reveal-at-rest records beside this branch's, the rule
	 * the paragraph above states.
	 */
	"foldOnto601a9d5032Note",
	/*
	 * AND THIS FOLD'S OWN - the fold onto `origin/main` = `fd19adc9d9` (#531,
	 * the draft pre-engage). ITS SUBJECT IS THIS FILE'S BINDING (the re-derived
	 * pair), so it is held to the pair the file ships rather than read as
	 * history - and it is the note that records the union of this list itself:
	 * main's `newchatDraftWarmRestampNote` joined beside this branch's entries,
	 * the rule the paragraph above states.
	 */
	"foldOntoFd19adc9d9Note",
	/*
	 * The overlay hit-zones fix's own: it states this file's pair for the change
	 * that gives every portalled surface the no-drag opt-out, so it is held to
	 * that pair rather than read as history. The change moves BOTH trees (the
	 * rule and the five primitives under `src/`, the `hit-zones` scene and its
	 * source-contract test under `scripts/`) and takes NO swept frame - its
	 * evidence is a new set of PNGs and run logs that no supplementary set
	 * declares - so the reader is owed the pair AND the reason no still was.
	 */
	"overlayDragZonesRestampNote",
	/*
	 * AND THIS LANE'S OWN, for the sub-view top inset (the operator's report of
	 * 2026-09-26, "for sub-views like the settings page, the sidebar and view
	 * doesn't go all the way to the top"): it states the pair THIS FILE SHIPS as
	 * its opening claim - the re-stamp of a change that moves BOTH trees this
	 * file binds (the shell's `app.tsx` and the route band's rules under `src/`,
	 * the new `route-tops` scene and three pins under `scripts/`) while
	 * re-shooting no committed frame, so a reader is owed the pair and the reason
	 * no still was owed. The list's own criterion is met the same way
	 * `focusHoldOperationRestampNote`'s was: the note states this file's binding
	 * as a backticked claim, so leaving it out would be one more check silently
	 * not run.
	 */
	"subviewInsetRestampNote",
	/*
	 * THIS LANE'S OWN, and the criterion is the list's own: its subject is the
	 * condensed action group, and its opening claim IS this file's binding - the
	 * pair the first fold re-derived, now carried to the folded tip - so leaving
	 * it out would be one more check silently not run. It states the captured
	 * head and every count the pass moved, which is why a reader reaches for it
	 * first.
	 */
	"actionFoldEvidenceNote",
	/*
	 * AND THIS FOLD'S OWN - the fold onto `origin/main` = `093a329a4d` (#535, the
	 * sub-view top inset). ITS SUBJECT IS THIS FILE'S BINDING (the re-derived
	 * pair), so it is held to the pair the file ships rather than read as
	 * history. Its key carries the `ActionGroup` suffix from the fold onto
	 * `44c7f8fd76`: the header-identity lane coined the same SHA-named key for its
	 * own fold onto the same tip, main merged that lane first, and the two records
	 * had to coexist - main's kept the name, this branch's took the suffix.
	 */
	"foldOnto093a329a4dActionGroupNote",
	/*
	 * THE THREE FOLDS BETWEEN THAT ONE AND THIS (`9d3e68ddf6` #467, `4ae3dbff0d`
	 * #504, `22c0fcd4fd` #539), registered by the fold onto `827f45f4fd` and
	 * renamed by the fold onto `44c7f8fd76` for the same reason as the entry
	 * above: each states the pair its fold re-derived as this file's binding - the
	 * same claim the list's criterion asks about - and each had been sitting
	 * outside the list while quoting it, which is a check silently not run (the
	 * defect the round-8 paragraph above names).
	 */
	"foldOnto9d3e68ddf6ActionGroupNote",
	"foldOnto4ae3dbff0dActionGroupNote",
	"foldOnto22c0fcd4fdActionGroupNote",
	/*
	 * And this fold's own: the fold onto `origin/main` = `827f45f4fd` (#540),
	 * whose pair this file then shipped - renamed like its siblings above.
	 */
	"foldOnto827f45f4fdActionGroupNote",
	/*
	 * And the fold onto `44c7f8fd76` (#541 + #542), the one that resolved the
	 * name collision and whose pair this file ships.
	 */
	"foldOnto44c7f8fd76ActionGroupNote",
	/*
	 * AND THIS LANE'S OWN, for the user message block's surface (the operator's
	 * report of 2026-09-26, "the contrast between the user message background and
	 * the chat background is quite poor on some themes"): it states the pair THIS
	 * FILE SHIPS as its opening claim - the re-stamp of a change that moves BOTH
	 * trees this file binds while committing its own evidence set, so a reader is
	 * owed the pair, the reason the frames exist, and the arithmetic they move.
	 * The list's own criterion is met the same way `subviewInsetRestampNote`'s
	 * was: the note states this file's binding as a backticked claim, so leaving
	 * it out would be one more check silently not run. It joins this list under
	 * the union rule rather than replacing it.
	 */
	"messageSurfaceRestampNote",
	/*
	 * And `goalDesignRoundTwoNote`, this branch's own record: it carries the pair the
	 * judged-goals design-round-2 pass re-derived, so it is the entry later re-stamps
	 * have to re-point. It joins this list under the union rule rather than replacing
	 * it: the eight main-side notes it superseded in this branch's narrow spellings
	 * keep their membership and are held to the shipped pair by the same sweep.
	 */
	"goalDesignRoundTwoNote",
	/*
	 * THIS BRANCH'S OWN, and it arrives under the union rule the list states: the
	 * pair below is the MERGED tree's - re-derived on THIS fold (onto `origin/main`
	 * = `eddfae750b`, #537/#540/#541/#542) with `git write-tree` on the resolved
	 * index and `<tree>:src` / `<tree>:scripts`, so it rides the tree it describes
	 * rather than either side of the merge - and every note that quotes the pair
	 * as a pointer to this file's own values is substituted with it, main's own
	 * list carried whole.
	 */
	"conversationStartEvidenceNote",

	/*
	 * THIS CHANGE'S OWN: it re-stamps the pass that made the chat header's
	 * identity slot the controls it describes (the team and the agent menus,
	 * the rename pencil) and re-captured its own eleven states - so ITS
	 * SUBJECT IS THIS FILE'S BINDING (the pair the file ships), and a reader
	 * is owed the check rather than the prose.
	 */
	"headerIdentityRestampNote",

	/*
	 * AND THIS FOLD'S OWN: its subject IS this file's binding (the pair the
	 * folded tree produces), so a reader is owed the check rather than the
	 * prose - the same case foldOntoFd19adc9d9Note is in the list for.
	 */
	"foldOnto093a329a4dNote",

	/*
	 * AND THIS FOLD'S OWN: its subject IS this file's binding (the pair the
	 * folded tree produces), so a reader is owed the check rather than the
	 * prose - the same case foldOnto093a329a4dNote is in the list for.
	 */
	"foldOnto9d3e68ddf6Note",
	/*
	 * AND THIS FOLD'S OWN: its subject IS this file's binding (the pair the
	 * folded tree produces), so a reader is owed the check rather than the
	 * prose - the same case foldOnto093a329a4dNote is in the list for.
	 */
	"foldOnto22c0fcd4fdNote",
	/*
	 * AND THIS ROUND'S OWN: UX round 1's U1/U4 and design D2 changed what the
	 * identity surfaces RENDER, and the remediation re-shot the frames that
	 * moved plus six new states - so its subject is this file's binding (the
	 * pair the committed tree produces), and it is held to the check rather
	 * than read as history.
	 */
	"headerIdentityRoundOneRestampNote",
	/*
	 * AND THIS PASS'S OWN: the notice-band change
	 * (`fix/banner-warn-error-consistency-7e4c`) moves BOTH trees this file binds
	 * - `src/` on the strip, the compatibility banner, `chat-status.ts` and the
	 * new shared band grammar; `scripts/` on the three suites and the sweep's
	 * fourteen new rows - so its record states the pair THIS FILE SHIPS as its
	 * opening claim, which is the case this list wants checked rather than read
	 * as prose.
	 */
	"bannerBandsRestampNote",
	/*
	 * AND THIS PASS'S OWN, for the held-first-paint work on the conversation-loading
	 * report ("everything should load in one solid paint instead of incrementally"):
	 * it states the pair THIS FILE SHIPS as its opening claim, holds both tokens,
	 * and - uniquely among the notes here - it also records the one supplementary
	 * set whose FRAMES were re-derived rather than re-counted (all twelve
	 * click-state frames of `session-switch`, one pair deleted with the state it
	 * photographed, one pair added), so leaving it out would be one more check
	 * silently not run.
	 */
	"heldFirstPaintRestampNote",
	/*
	 * THIS LANE'S OWN: the streaming re-delivery fix, which moves `src/` AND
	 * `scripts/` without taking a frame — the change is a reducer/transport
	 * correctness fix whose evidence is the pinned repro in
	 * `scripts/transcript-reducer.test.mjs` and the desktop suite, so the reader
	 * is owed the pair AND the reason no still was owed.
	 */
	"streamRedeliveryRestampNote",
	/*
	 * AND THIS FOLD'S OWN: its subject IS this file's binding (the pair the
	 * merged, remediated tree produces - re-derived in the re-stamp commit that
	 * follows the round-1 fixes), so a reader is owed the check rather than the
	 * prose - the same case `foldOntoFd19adc9d9Note` is in the list for.
	 */
	"foldOntoEddfae750bNote",
	/*
	 * AND THIS FOLD'S OWN: its subject IS this file's binding too - the second
	 * fold onto a moved `origin/main`, and the one whose resolution was taken as
	 * main's exact bytes plus two inserted lines - so a reader is owed the check
	 * rather than the prose, the same case `foldOntoFd19adc9d9Note` is in the
	 * list for.
	 */
	"foldOnto2e12a54d56Note",
	/*
	 * THIS REMOVAL'S OWN: it re-stamps the change that deletes the legacy History
	 * settings section - `src/` for the settings page and the tour copy, `scripts/`
	 * for this note's registration - and re-shoots no frame, so a reader is owed
	 * the pair and the reason no still was owed.
	 */
	"historySettingsRemovalRestampNote",
	/*
	 * AND THIS FOLD'S OWN: its subject IS this file's binding (the pair the
	 * folded tree produces, re-derived in the fold commit itself and read back
	 * from its staged index), so a reader is owed the check rather than the
	 * prose - the same case `foldOntoFd19adc9d9Note` is in the list for.
	 */
	"historySettingsRemovalSecondFoldNote",
	/*
	 * AND THIS ROUND'S OWN, the newest top-level record on the branch: it states the pair
	 * this remediation re-derives (`src/` for the pressed-row resolution and the outside-the-
	 * list order, `scripts/` for the successor clause and the pressed-id reading) and the
	 * walk's reading at the tip, so a later fold that started from main's copy would drop it
	 * first.
	 */
	"uxRoundThreeSuccessorRestampNote",
	/*
	 * AND THIS ROUND'S OWN, the newest top-level record on the branch: it states the pair
	 * this remediation re-derives (`src/` for the caret hand-off and the field's entry into
	 * the list, `scripts/` for the walk's two new clauses and the two pins) and the walk's
	 * reading at the tip, so a later fold that started from main's copy would drop it first.
	 */
	"uxRoundTwoCaretScopeRestampNote",
	/*
	 * AND THE ROUND-2 ARCHIVE-RECAST REMEDIATION'S OWN: it states the pair this
	 * round re-derives (`src/` for the sidebar's focus hand-off, `scripts/` for
	 * the driver's arrival rig and the pin on that call) and the walk's reading
	 * at the tip, so a reader is owed the check rather than the prose.
	 */
	"qaRoundTwoRecastRestampNote",
	/*
	 * AND THIS LANE'S OWN: the Windows stager's digest fix. Its subject IS this
	 * file's binding - the change moves `scripts/` only, the CI job that caught
	 * the failure is outside both trees this file binds, and a build script
	 * paints no pixel - so a reader is owed the pair and the reason no still is
	 * owed, the case `streamRedeliveryRestampNote` states one entry over.
	 */
	"windowsUvStagerRestampNote",
	/*
	 * AND THIS FOLD'S OWN: its subject IS this file's binding too (the pair the
	 * folded tree produces, re-derived in the fold commit itself and read back
	 * from its staged index), so a reader is owed the check rather than the
	 * prose - the same case `historySettingsRemovalSecondFoldNote` is in the
	 * list for.
	 */
	"windowsUvStagerFoldNote",
	/*
	 * AND TASK-17'S OWN: its subject IS this file's binding too - it moves BOTH
	 * trees without taking a frame (the change's evidence is the isolated
	 * headless rig runs and the desktop suite), so the reader is owed the pair
	 * AND the reason no still was owed - the same case
	 * `streamRedeliveryRestampNote` is in the list for.
	 */
	"task17RestampNote",
	/*
	 * AND THIS CHANGE'S OWN: the inline-rename fix's re-stamp. Its subject IS
	 * this file's binding - it moves BOTH trees and re-captures one set's
	 * states - so a reader is owed the pair and the twelve frames it added.
	 */
	"headerRenameInlineRestampNote",
	/*
	 * AND THE ROUND-1 REMEDIATION'S OWN, on the same lane: its subject is this
	 * file's binding too - the save-lifecycle pass moves BOTH trees again (the
	 * header's committed-save state and its story; the capture row and these
	 * two lists) and re-captures one state - so a reader is owed the pair and
	 * the two frames it added.
	 */
	"headerRenameInlineRoundOneNote",
	/*
	 * AND THE DESKTOP-SUITE TICK WAIT'S OWN: its subject is this file's binding
	 * too - it moves BOTH trees without taking a frame (nothing in it is
	 * user-visible; the evidence is the isolated rig runs and the three
	 * mutations its note names), so the reader is owed the pair AND the reason no
	 * still was owed, for the same reason task-17's entry is here.
	 */
	"daemonObservationTickWaitRestampNote",
	/*
	 * AND THE SEARCH-AND-QUOTA UX PASS'S OWN: its subject IS this file's binding
	 * too - the pass moves BOTH trees and re-took four sets' frames (two states
	 * re-shot, one state and two sets added) - so a reader is owed the pair and
	 * the five sets it names.
	 */
	"searchQuotaUxRestampNote",
	/*
	 * AND THE CREDENTIAL-INPUT CHANGE'S OWN (`fix/secret-ask-credential-input`):
	 * its subject is this file's binding too - it moves BOTH trees (the dock's
	 * masked secret field and its answer path in `src/`, the suite's cases and
	 * the sweep's two new rows in `scripts/`) without committing a frame, so a
	 * reader is owed the pair AND the reason no still was owed - the same case
	 * `task17RestampNote` and `daemonObservationTickWaitRestampNote` are in the
	 * list for. The new rows' frames are the PR's to carry (referenced from the
	 * pull request), and `countsMean.surfaces` carries the re-derivation.
	 */
	"secretAskCredentialRestampNote",
	/*
	 * AND THE TWO-FLAKE LANE'S OWN: its subject IS this file's binding too - it
	 * moves BOTH trees without taking a frame (a dev-mode caret fix and two
	 * readers, none of which draws anything), so a reader is owed the pair AND
	 * the reason no still was owed, the same case task-17's entry states.
	 */
	"twoFlakesRestampNote",
	/*
	 * AND THE SAME LANE'S SECOND FOLD, WHOSE SUBJECT IS THIS BINDING ITSELF: the
	 * fold carried main's four merges under the branch's own change, so it moved
	 * BOTH trees and the pair was re-derived at the folded tip - the case a reader
	 * is owed the pair for, and the one this list is what holds them to.
	 */
	"foldOntoE885227046Note",
	/*
	 * AND THIS BRANCH'S OWN: the pending-echo placement fix moves BOTH trees this
	 * file binds - `src/` for `withTimeOrder`'s load-window case and the
	 * `provisional` field it reads, `scripts/` for the reducer cases that pin the
	 * page and seed doors plus the `localEcho` reading the open rig carries - and
	 * rewrites no frame of the sweep, so a reader is owed the two values it binds
	 * and the reason no still was owed.
	 */
	"pendingEchoRestampNote",
	"pendingEchoRemediationNote",
	"pendingEchoRemediationFoldNote",
	"pendingEchoRemediationSecondFoldNote",
	"pendingEchoRemediationThirdFoldNote",
	"pendingEchoRemediationFourthFoldNote",
	"pendingEchoRemediationFifthFoldNote",
	/*
	 * AND THE TWO-FLAKE LANE'S SECOND FOLD: its subject IS this file's binding -
	 * the fold onto the moved `origin/main` after #562 and #577 re-derives the
	 * pair at the folded tip and reads it back from the staged index, so a
	 * reader is owed the pair rather than the prose.
	 */
	"foldOntoA9f4b1d7f4Note",
	/*
	 * AND THE STALL BOUND'S OWN: it bounds the update feed fetch, the update
	 * download and the PyPI version read so a stalled network cannot hold the
	 * checking frame. It moves BOTH trees - `src/` for the deadline, the latch
	 * epoch, the abandoned-fetch attribution and the download watchdog;
	 * `scripts/` for the four suites that drive them and the fixtures'
	 * `CancellationToken` - and takes NO frame: the checking frame and the
	 * alert's pixels are the same before and after (what changed is WHEN the
	 * frame leaves), so the discriminating evidence is the simulation under
	 * `docs/evidence/update-stall-bound/`, on both sides of the IPC boundary.
	 * The reader is owed the pair and that reason.
	 */
	"updateStallBoundRestampNote",
	/*
	 * AND THE FOLD ONTO `1e88f7fc16`'s OWN: the fold wrote one record, and the
	 * registration here is the same completeness reason as every note above - a
	 * fold that started from main's copy would drop this branch's records first,
	 * and this list is the check that notices.
	 */
	"foldOnto1e88f7fc16Note",
	/*
	 * AND THE SECOND FOLD'S OWN: main moved again before this branch's push, the
	 * fold onto `9589bd8fec` re-derived the pair at the folded tip, and a reader
	 * is owed the check rather than the prose.
	 */
	"foldOnto9589bd8fecNote",
	/*
	 * AND THE REMEDIATION ROUND 2'S OWN: it registers the two U1 frames the
	 * download panel and the checking card now ship, rewrites the download line's
	 * subject, and moves both trees - so a reader is owed the pair.
	 */
	"updateStallBoundRoundTwoNote",
	/*
	 * AND THE FIFTH FOLD'S OWN: the fold onto `678f6c5c69` moved both trees and
	 * wrote one record, and a reader is owed the pair it binds.
	 */
	"foldOnto678f6c5c69Note",
	/*
	 * AND THE SIXTH FOLD'S OWN: main moved once more inside round 2 and the fold
	 * onto `3428f5f475` re-derived the pair again - same reason, same check.
	 */
	"foldOnto3428f5f475Note",
	/*
	 * AND REMEDIATION ROUND 3'S OWN: it moves both trees again (the gate-coverage
	 * registration, the retrying story presses, the unified switch rule), so a
	 * reader is owed the pair.
	 */
	"updateStallBoundRoundThreeNote",
	/*
	 * AND THE SEVENTH FOLD'S OWN: the fold onto `8b082c33d8` moved both trees and wrote one
	 * record, and a reader is owed the pair it binds.
	 */
	"foldOnto8b082c33d8Note",
	/*
	 * AND THE EIGHTH FOLD'S OWN: the fold onto `a72909b1f4` resolved TWO conflicted paths (this list
	 * and the manifest) and wrote one record, and a reader is owed the pair it binds.
	 */
	"foldOntoA72909b1f4Note",
	/*
	 * AND THE NINTH FOLD'S OWN: the fold onto `cc5a329040` re-derived the pair once more minutes later
	 * and wrote one record - same reason, same check.
	 */
	"foldOntoCc5a329040Note",
	/*
	 * AND THE CI-REDS FIX'S OWN: the notice cases' kill-switch scrub and the decision-wait moved
	 * `scripts/` only, and this is the restamp that re-points the file's claims at the tree it ships in.
	 */
	"updateStallBoundCiFixRestampNote",
	/*
	 * AND THE TENTH FOLD'S OWN: the fold onto `7bd3803598` re-derived the pair once more and wrote
	 * one record - same reason, same check.
	 */
	"foldOnto7bd3803598Note",
	/*
	 * AND THIS LANE'S OWN: the board/timeline pass. Its subject IS this file's
	 * binding - the change moves BOTH trees (the projects feature's board,
	 * timeline, switcher and their pins; the capture rows and this list) and
	 * re-shoots the whole projects-tab set (144 frames re-taken, 72 added) - so
	 * a reader is owed the pair and what the capture moved with it, the same
	 * case `headerRenameInlineRestampNote` is in the list for.
	 */
	"projectsBoardTimelineNote",
	/*
	 * AND THIS LANE'S OWN: the project-detail pass (slice S6d-i). Its subject is
	 * this file's binding too - the change moves BOTH trees (the detail sheet,
	 * the updates feed, the quick-send strip, the start-session picker, the
	 * model and the six new story states; the capture rows, the new live scene
	 * and this registration) and re-shoots the whole projects-tab set at this
	 * head (324 frames: six states added at twelve themes) - so a reader is owed
	 * the pair and what the capture moved with it.
	 */
	"projectDetailFeedNote",
	/*
	 * AND THE REMEDIATION ROUND'S OWN: round 1's fix moves BOTH trees again -
	 * `src/` for the one commission entry point (clear, cancel, invalidate)
	 * with its generation guard and the account row's `min-w-0`, `scripts/`
	 * for the two suites that pin and measure them plus this file's own
	 * registrations - and rewrites no frame of the sweep (the re-shot design
	 * frames are PNG walks under the `account-foot-refresh` set), so a reader
	 * is owed the two values it binds and the reason no still was owed.
	 */
	"accountFootRemediationRestampNote",
	/*
	 * AND THIS BRANCH'S OWN (folded in beside it): the account-foot refresh moves
	 * BOTH trees this file binds - `src/` for the two completion call sites that
	 * commission the account read on a Radient credential write and the clear
	 * that lets the re-read be disclosed as "checking", `scripts/` for the three
	 * suites that pin and measure them - and rewrites no frame of the sweep (its
	 * evidence is a pair of PNG walks, declared as `account-foot-refresh`), so a
	 * reader is owed the two values it binds and the reason no still was owed.
	 */
	"accountFootRefreshRestampNote",
	/*
	 * AND THIS BRANCH'S OWN, the mesh tab's slice 1: its subject IS this file's
	 * binding - the set is new, both trees moved under it, and the tab ships dark
	 * behind a capability gate - so a reader is owed the check rather than the prose,
	 * and a later fold that started from main's copy would drop it first.
	 */
	"meshTabRestampNote",
	"meshTabRound2RestampNote",
	/*
	 * AND THIS LANE'S OWN, the newest top-level record on the branch: its subject
	 * is this file's binding too - the trace-label mapping moves BOTH trees (the
	 * op tier and its wiring in `src/`; the suites, the two capture rows and this
	 * registration in `scripts/`) AND adds two states to two sets whose frames it
	 * re-captured - so a reader is owed the pair and the four frames it added.
	 */
	"traceToolLabelsRestampNote",
	/*
	 * AND THIS BRANCH'S OWN, the stopped-row measure fix: it moves BOTH trees this
	 * file binds - `src/` for §G3's stopped line taking the conversation's shared
	 * measure (its wrapper now declares the chatcol container the dock and the
	 * composer band already declare) plus the rig's handle on the composer box
	 * (`data-lo-composer-measure`), `scripts/` for the geometry claims added to
	 * `scripts/interrupt-esc-proof.mjs`, the discriminator that pins the property
	 * (`scripts/stopped-row-measure.test.mjs`), its registration in
	 * `package.json`'s `test:desktop` and this note's own registration - and it
	 * rewrites no frame of the sweep (its evidence is a set of live-app PNGs,
	 * `stopped-row-measure`, which the sweep's WebP predicate does not admit), so
	 * a reader is owed the two values it binds and the reason no still was owed.
	 */
	"stoppedRowRestampNote",
	/*
	 * AND THIS LANE'S OWN, the newest top-level record on the branch: the sidebar
	 * bottom zone moves BOTH trees (the destinations boundary and the entity
	 * sections' conditional in `src/`; the `sidebar-bottom` scene and this
	 * registration in `scripts/`) and adds a PNG set outside the sweep, so a
	 * reader is owed the pair it binds and the readings it ships.
	 */
	"sidebarBottomZoneRestampNote",
	/*
	 * AND THIS LANE'S OWN: the card-surfaces restyle. Its subject IS this file's
	 * binding - the change moves BOTH trees (`src/` for the card, column, frame
	 * and hub-card treatment across projects, schedules and agent hub,
	 * `scripts/` for this registration and the note) and re-shoots the three
	 * sets' frames (a narrowed run per set, recorded in `partialCapture`) - so a
	 * reader is owed the pair and what the capture moved with it, the same case
	 * `projectsBoardTimelineNote` is in the list for.
	 */
	"cardSurfacesRestyleNote",
	/*
	 * This branch's own: `aidaSidebarRestampNote` states THIS FILE's own pair for Aida's sidebar
	 * slice (see its BRANCH_RECORDS entry for what moved), so it is held to that
	 * pair rather than read as history - the same distinction
	 * `candidateMacArchRestampNote` is in the list for.
	 */
	"aidaSidebarRestampNote",
	/*
	 * And AIDA'S SECOND UI SLICE's own: `aidaBadgeRestampNote` states THIS FILE's
	 * own pair for her rail row's marks - the missed-messages badge, the working
	 * mark, the display-name fallback, and the strip's feed keeper (why the
	 * collapsed rail paints both marks at all) - so it is held to that pair
	 * rather than read as history, the same case `aidaSidebarRestampNote` is in
	 * the list for.
	 */
	"aidaBadgeRestampNote",
	/*
	 * AND THE POINTER-AFFORDANCE SWEEP'S OWN - it belongs here for the list's own
	 * reason: ITS SUBJECT IS THIS FILE'S BINDING. The sweep moves BOTH trees (the
	 * base-layer rule and the five click sites under `src/`; the audit that
	 * measures them under `scripts/`) and re-shoots no frame - a cursor is not a
	 * pixel, so the committed set renders identically and the audit's measured
	 * report is the PR's evidence - so a reader is owed the two values it binds
	 * and the reason the stills did not move.
	 */
	"mouseCursorRestampNote",
	/*
	 * AND THE PROJECTS CARD'S WHOLE-SURFACE TARGET - it belongs here for the
	 * list's own reason: ITS SUBJECT IS THIS FILE'S BINDING. The card's root
	 * role, click and keyboard activation move both trees (the component
	 * under `src/`; the interaction pin and its lane entry under
	 * `scripts/`), and no frame was re-taken - the pointer is not a pixel, so
	 * the committed set renders identically and the PR's stills carry the
	 * before/after a reader would want - so a reader is owed the two values
	 * it binds and the reason the stills did not move.
	 */
	"projectsCardClickRestampNote",
	/*
	 * AND THE REGENERATED SCHEDULES BEFORE HALVES' OWN - it belongs here for the
	 * list's own reason: THE NOTE STATES THIS FILE'S BINDING. The regeneration
	 * moves `scripts/` (this note's registration) and no file under `src/` - the
	 * frames it adds are re-captures of the merge-base's source, which is this
	 * branch's base rather than a tree it moves - so a reader is owed the pair
	 * the re-stamp derives and the reason no source file moved.
	 */
	"cardSurfacesBeforeHalvesNote",
	/*
	 * AND THE CHAT-MEASURE LANE'S FOLD: `foldOntoAc83ec7d92Note` states the pair
	 * the folded tip binds AND the retarget the fold carries (the measure moves
	 * to 810px - 900 minus exactly 10% - and the set's 12 frames were re-taken
	 * at the folded tip), so it is held to the pair this file ships rather than
	 * read as history.
	 */
	"foldOntoAc83ec7d92Note",
	/*
	 * AND THE SECOND FOLD'S: `foldOnto8367cbfaeeNote` states the pair the second
	 * folded tip binds and that no frame moved for it, so it is held to the pair
	 * this file ships rather than read as history.
	 */
	"foldOnto8367cbfaeeNote",
	/*
	 * AND THE THIRD FOLD'S: `foldOnto8320e52366Note` states the pair the third
	 * folded tip binds and that no frame moved for it, so it is held to the pair
	 * this file ships rather than read as history.
	 */
	"foldOnto8320e52366Note",
	/*
	 * AND THIS FOLD'S: `foldOnto55d7b0a19bNote` states the pair the fourth
	 * folded tip binds, so it is held to the pair this file ships rather
	 * than read as history.
	 */
	"foldOnto55d7b0a19bNote",
	/*
	 * AND THIS FOLD'S OWN - the fifth: `foldOntoA8ac7f673cNote` states the pair the
	 * folded tip binds, the two conflicts it resolved (this file's and its
	 * manifest's) as unions with no key dropped either side, and that no frame was
	 * re-taken for the fold, so it is held to the pair this file ships rather than
	 * read as history - beside `cardSurfacesBeforeHalvesNote` above, whose own
	 * re-stamp rides the same re-derivation.
	 */
	"foldOntoA8ac7f673cNote",
	/*
	 * AND THIS BRANCH'S OWN, the agents offer's dismissal: its subject IS this
	 * file's binding - the change moves BOTH trees (the offer module, the store
	 * field, the sidebar control and its story fixture under `src/`; the capture
	 * row, the new behavioural suite and this registration under `scripts/`)
	 * AND adds one story's twelve frames while re-shooting the set - so a reader
	 * is owed the pair and what the capture moved with it.
	 */
	"agentsOfferDismissNote",
	/*
	 * AND THIS FOLD'S OWN - `foldOnto55dbaf6118Note` states the pair the folded
	 * tip binds, the single conflicted path it resolved (this branch's manifest
	 * against main's), the union decisions the file's own `citationConvention`
	 * group numbers name, and that no frame was re-taken because main's delta
	 * touches none of the files this branch draws - so it is held to the pair
	 * this file ships rather than read as history.
	 */
	"foldOnto55dbaf6118Note",
	/*
	 * AND THIS FOLD'S OWN - `foldOnto1b1a52d5cfNote` states the pair the folded
	 * tip binds, the single conflicted path it resolved (this branch's manifest
	 * against main's, plus package.json's test list) and the union decisions
	 * behind it; no frame was re-taken (main's delta is the projects card's
	 * pointer behaviour, not a pixel), so it is held to the pair this file
	 * ships rather than read as history.
	 */
	"foldOnto1b1a52d5cfNote",
	/*
	 * AND THE COMMENT FIX'S OWN - `agentsOfferDismissCommentRestampNote` states
	 * the pair after round 1's nit (reviewer) and Q1 (QA) reworded the offer's
	 * count-vs-names sentence: a comment-only move under `src/` with no frame
	 * repainted, so a reader is owed the pair and the reason the set did not
	 * move.
	 */
	"agentsOfferDismissCommentRestampNote",
	/*
	 * Moved by the dead-tab and popout pass (2026-09-28): this note states the pair
	 * it ships and the set the pass moves, so it is held to the same bar as every
	 * other member - it quotes both stamps and the file it sits in ships them.
	 */
	"browserTabLifecycleNote",
	/*
	 * AND THE SAME PASS'S ROUND-1 REMEDIATION: `browserTabCleanupRoundOnePass`
	 * states the pair it ships, the frames it re-shot (the two strip stories and
	 * the load-failure trio), the runs as they ran and the one frame set it NAMES
	 * as owed, so it is held to the pair this file ships rather than read as
	 * history - the same bar as the note above it, which this fold re-points too.
	 */
	"browserTabCleanupRoundOnePass",
	/*
	 * AND ITS ROUND-2 ANSWERS: `browserTabCleanupRoundTwoPass` states the pair it
	 * ships, the two owed photographs it pays (composition `20` re-encoded and `22`
	 * re-encoded with the clearance the same run measured), the D3 re-capture with
	 * its measured slack, and the run's own verdict — so it is held to the pair this
	 * file ships rather than read as history, on the same bar as its two neighbours.
	 */
	"browserTabCleanupRoundTwoPass",
];

test("the notes that claim this file's binding quote the stamp values it ships", () => {
	const manifest = JSON.parse(
		readFileSync("docs/evidence/manifest.json", "utf8"),
	);
	for (const note of STAMP_BINDING_NOTES) {
		const quoted = [
			...String(manifest[note]).matchAll(
				/`(srcTree|scriptsTree)`\s*`([0-9a-f]{7,40})`/g,
			),
		];
		assert.ok(
			new Set(quoted.map(([, key]) => key)).size === 2,
			`${note} must quote both stamps it ships, so a reader can compare them without leaving the note`,
		);
		for (const [, key, value] of quoted) {
			assert.ok(
				manifest[key].startsWith(value),
				`${note} quotes ${key} ${value} while the file ships ${manifest[key]}`,
			);
		}
	}
});

/**
 * Whether the checkout has history to ask the ancestry question against.
 *
 * A one-commit-deep clone - every CI checkout, `actions/checkout`'s default -
 * has no ancestor of `HEAD` at all, so the citation test below would fail on
 * every run for a reason that is about the clone and not about the manifest.
 * A repository that cannot answer is not a repository that has found a defect,
 * so the test says which it is and stands down.
 */
const SHALLOW = (() => {
	try {
		return (
			execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
				stdio: ["ignore", "pipe", "ignore"],
			})
				.toString()
				.trim() === "true"
		);
	} catch {
		return false;
	}
})();

/**
 * The citation half of the same question, bound to the same shipped file.
 *
 * `stampFailures` above catches a rebase that re-stamps the file against
 * somebody else's tree. Nothing caught the other half. A rebase replays this
 * branch's commits onto a new base, which changes their SHAs, and the manifest
 * keeps citing the old ones - and those old spellings still resolve in the clone
 * that did the rebase, because the rebase left a backup ref beside the branch.
 * `citationFailures` only asks whether SOME ref reaches a sha, so it stayed
 * silent while the file shipped certifying its frames against commits no
 * reviewer can fetch. Three rebases running broke it that way (round 3's stamp
 * block, round 5's force-push orphans, and both at once on the v0.22.1 rebase),
 * and in every case a reviewer found it by eye rather than a gate.
 *
 * Bound here rather than in `check-evidence.mjs`'s own sweep for the same reason
 * the stamp test is: the question needs nothing but `HEAD`'s history, it costs
 * about a second, and it has to be in the suite the author already runs.
 */
test(
	"the SHIPPED manifest's head citations lie in the history it ships in",
	{ skip: SHALLOW && "a shallow clone has no ancestor of HEAD to check" },
	() => {
		const manifest = JSON.parse(
			readFileSync("docs/evidence/manifest.json", "utf8"),
		);
		assert.deepEqual(
			citationAncestryFailures(manifest),
			[],
			"docs/evidence/manifest.json must cite commits THIS branch carries: `head`, `partialCapture.addedAtHead` and `partialCapture.refreshedAtHead` are the three a rebase re-spells, and each has to name the commit of this lineage that carries its work rather than the pre-rebase one",
		);
	},
);

/* ---- the prose beside the counts ---------------------------------------- */

/*
 * `countsMean` explains `frames`, `surfaces` and `themes`, and it is what a
 * reader checks a fold against - while the fields beside it are guarded and the
 * prose was not. It went stale at three consecutive folds (round 1 R5, round 2
 * R2-1, round 3 R3-1), the third time in the commit that moved the stamps, so the
 * guard below derives the same numbers from the same walk and reads the
 * paragraph.
 *
 * These cells are what makes THAT guard falsifiable rather than decorative: a
 * paragraph the check cannot read has to be a failure, not a pass by omission,
 * because "no numbers found" is exactly the state a fold leaves behind when it
 * re-writes the field and forgets the sentence around it.
 */

/** A capture script with a known STORIES/THEMES literal, as `show` returns it. */
const capture = (stories) =>
	`const STORIES = [\n${[...Array(stories)]
		.map((_, i) => `\t["story-${i}"],`)
		.join("\n")}\n];\nconst THEMES = [\n\t"localOperatorDark",\n];\n`;

/** The layout every `countsMean` cell walks: 3 outside a set, 2 inside one. */
const COUNTS_LAYOUT = { "outside-a": 3, "declared-b": 2 };
const countsGit = fakeGit({ show: capture(2) });

/*
 * A scratch tree whose life is bounded to the case that asks for it.
 *
 * WHY PER CASE, AND NOT ONE TREE FOR THE FILE. These cells used to share a
 * `COUNTS_TREE` built at MODULE scope, so the tree sat in the shared system
 * temp directory from the moment this file loaded until the last cell ran -
 * seconds of an idle directory that any process on the box may delete, with
 * the cells that walk it at the END of the file. Measured on this machine, the
 * gap from module scope to the first `countsMean` walk is 1.6s of a 1.9s run,
 * and a deleter in that window takes the file to `29 pass / 5 fail` with
 * `ENOENT` raised on the fixture at `check-evidence.mjs:129`.
 *
 * Bound to the case, the same delete has to land inside one synchronous
 * assertion instead - and it is the second half of the repair, not a substitute
 * for the name above: a deleter that reaches this namespace by name has
 * milliseconds where it used to have seconds. `tree()`'s own `scratch` list
 * still covers the cells that do not bound their tree, and `rmSync` with
 * `force` is idempotent, so the second removal is not one too many.
 */
function caseTree(t, layout) {
	const root = tree(layout);
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
}

/** A manifest whose `countsMean` reads the numbers of the case's tree. */
const countsManifest = ({ framesProse = "", surfacesProse = "" } = {}) => ({
	frames: 3,
	surfaces: 2,
	themes: 1,
	supplementary: [{ path: "declared-b" }],
	countsMean: {
		frames: framesProse,
		surfaces: surfacesProse,
		themes:
			"RE-DERIVED FOR THIS FOLD: 1 theme names in the `THEMES` literal, counted the same way.",
	},
});

const FRAMES_LEADING =
	"RE-DERIVED FOR THIS FOLD (this branch folded onto `origin/main` = `<base>`): 3 committed WebP files outside the 1 declared supplementary sets below, of 5 on disk (2 of them inside the sets).";

test("a countsMean paragraph leading with the walk's numbers passes", (t) => {
	const countsTree = caseTree(t, COUNTS_LAYOUT);
	const manifest = countsManifest({
		framesProse: FRAMES_LEADING,
		surfacesProse:
			"RE-DERIVED FOR THIS FOLD: 2 rows in `HEAD:scripts/capture-evidence.mjs`'s STORIES literal, counted the way `check-evidence.mjs` counts them.",
	});
	assert.deepEqual(countsMeanFailures(manifest, countsGit, countsTree), []);
});

test("a paragraph left behind by a fold fails, and carries the sentence to paste", (t) => {
	const countsTree = caseTree(t, COUNTS_LAYOUT);
	const manifest = countsManifest({
		framesProse: FRAMES_LEADING.replace("3 committed", "2 committed").replace(
			"of 5 on disk (2 of them",
			"of 4 on disk (2 of them",
		),
	});
	const [failure] = countsMeanFailures(manifest, countsGit, countsTree);
	assert.match(failure, /countsMean\.frames/);
	assert.match(failure, /the walk finds 3/);
	assert.match(
		failure,
		/Lead the field with: "RE-DERIVED FOR THIS FOLD \(this branch folded onto `origin\/main` = `<base>`\): 3 committed WebP files outside the 1 declared supplementary sets below, of 5 on disk \(2 of them inside the sets\)\."/,
		"the message has to carry the reading the fold author pastes, or the next fold solves it by hand again",
	);
});

test("a paragraph with no reading in it fails rather than passing by omission", (t) => {
	// The state a fold leaves behind when it re-writes the field and forgets the
	// sentence around it: nothing to compare, and silence would be a pass.
	const countsTree = caseTree(t, COUNTS_LAYOUT);
	const manifest = countsManifest({
		framesProse:
			"RE-DERIVED FOR THIS FOLD: the counts beside this note describe the tree that ships.",
	});
	const [failure] = countsMeanFailures(manifest, countsGit, countsTree);
	assert.match(failure, /countsMean\.frames/);
	assert.match(failure, /nothing this check can read/);
});

test("the older paragraphs under the leading one are not this tree's to answer for", (t) => {
	const countsTree = caseTree(t, COUNTS_LAYOUT);
	/*
	 * Every paragraph below the first says in its own words that it describes an
	 * older tree. Demanding this tree's numbers of them would force the history to
	 * be deleted rather than kept, which is the practice `citationConvention` group
	 * (4) protects - so only the leading paragraph is checked.
	 */
	const manifest = countsManifest({
		framesProse: `${FRAMES_LEADING}\n\nRE-DERIVED FOR THE SECOND FOLD: 2 committed WebP files outside the 1 declared supplementary sets below, of 4 on disk (2 of them inside the sets).`,
		surfacesProse:
			"RE-DERIVED FOR THIS FOLD: 2 rows in `HEAD:scripts/capture-evidence.mjs`'s STORIES literal, counted the way `check-evidence.mjs` counts them.",
	});
	assert.deepEqual(countsMeanFailures(manifest, countsGit, countsTree), []);
});

test("a stale surfaces paragraph fails on the literal the field names", (t) => {
	const countsTree = caseTree(t, COUNTS_LAYOUT);
	const manifest = countsManifest({
		framesProse: FRAMES_LEADING,
		surfacesProse:
			"RE-DERIVED FOR THE FIFTH FOLD: 1 rows in `HEAD:scripts/capture-evidence.mjs`'s STORIES literal, counted the way `check-evidence.mjs` counts them.",
	});
	const [failure] = countsMeanFailures(manifest, countsGit, countsTree);
	assert.match(failure, /countsMean\.surfaces/);
	assert.match(failure, /the walk finds 2/);
});

test("a manifest with no countsMean is not this guard's failure", (t) => {
	// The fixture manifests other cells build carry no prose at all; a missing
	// field is `stampFailures`' business, not a stale paragraph. This case builds
	// the same tree as the five above it and never walks it - the guard returns
	// before the walk when there is no prose - so the cells differ only in the
	// paragraph they assert about.
	const countsTree = caseTree(t, COUNTS_LAYOUT);
	assert.deepEqual(
		countsMeanFailures({ frames: 3, supplementary: [] }, countsGit, countsTree),
		[],
	);
});

/*
 * A countsMean CELL IS A HISTORY: the leading paragraph describes the tree this file ships
 * and the ones under it describe older ones, which is why `countsMeanFailures` reads the
 * leading paragraph only. That leaves the space below it unguarded against the one mistake a
 * re-stamp makes - inserting the SAME paragraph twice - and both mistakes of that shape are
 * real: the eighth fold inserted a copy of the seventh fold's sentence into `frames` and
 * `surfaces`, and `themes` carries an identical pair inherited from `2d0734b0f8`.
 *
 * WHY THIS EXISTS AT ALL, which is the finding that produced it (review round 4, R4-1). The
 * ninth fold's record claimed the writer "asserts zero consecutive duplicate paragraphs ...
 * before it writes. The assertion existed in the authoring session's scratch script and NOT
 * here, so the sentence could not fail - a claim about a guard, made in the one place a reader
 * would trust it, that stops the next reader from looking. This is that assertion committed,
 * and the first case below is what makes it falsifiable rather than merely present.
 */
/*
 * Top-level, not inline: `lint/performance/useTopLevelRegex` (and `scripts/check-scripts-lint.mjs`,
 * which treats that warning as not-lint-clean) requires a literal used in a function to be a
 * module constant. The first version of this guard put three of them inline and failed the gate
 * - the file's pre-existing literals pass because they were written that way, and a new one does
 * not get to opt out.
 */
const PARAGRAPH_BREAK = /\n\s*\n/;
const REPEATED_PARAGRAPH = /countsMean\.themes repeats its paragraph 1/;
const DELETE_THE_COPY = /delete the copy/;

const duplicateParagraphFailures = (manifest) => {
	const failures = [];
	const mean = manifest?.countsMean;
	if (!mean || typeof mean !== "object") return failures;
	for (const [field, value] of Object.entries(mean)) {
		if (typeof value !== "string") continue;
		const paragraphs = value.trim().split(PARAGRAPH_BREAK);
		for (let i = 1; i < paragraphs.length; i += 1) {
			if (paragraphs[i] !== paragraphs[i - 1]) continue;
			/*
			 * One template literal rather than a concatenation: `lint/style/useTemplate` is an
			 * ERROR under this project's config, and the gate above treats an error-severity
			 * diagnostic in a changed file as a failure - which is how this message was caught.
			 */
			failures.push(
				`manifest.json: countsMean.${field} repeats its paragraph ${i} verbatim (${paragraphs[i].slice(0, 60)}...) - a fold inserted the same sentence twice instead of deriving one for its own tree; delete the copy rather than editing it in place`,
			);
		}
	}
	return failures;
};

test("a countsMean cell that repeats a paragraph verbatim fails", () => {
	const sentence =
		"RE-DERIVED FOR THIS FOLD: 12 theme names in the `THEMES` literal, counted the same way.";
	const failed = duplicateParagraphFailures({
		countsMean: { themes: `${sentence}\n\n${sentence}` },
	});
	assert.equal(
		failed.length,
		1,
		"the copy has to be flagged, or the guard is decoration",
	);
	assert.match(failed[0], REPEATED_PARAGRAPH);
	assert.match(failed[0], DELETE_THE_COPY);
	// And a cell whose paragraphs differ - the normal case, history included - is not a failure.
	assert.deepEqual(
		duplicateParagraphFailures({
			countsMean: {
				themes: `${sentence}\n\nRE-DERIVED FOR AN OLDER FOLD: 12 theme names.`,
			},
		}),
		[],
	);
});

test("the SHIPPED manifest repeats no paragraph in any countsMean cell", () => {
	/*
	 * The shipped half, in the same shape as `stampFailures` above: a guard that only had a
	 * fixture case would pass while the file it guards carried the copy. `themes`' duplicate
	 * at the head is exactly what this catches - and it is why the duplicate was removed in
	 * the same commit rather than after it, since introducing a guard on a file that fails it
	 * is how a red suite gets excused.
	 */
	const manifest = JSON.parse(
		readFileSync("docs/evidence/manifest.json", "utf8"),
	);
	assert.deepEqual(duplicateParagraphFailures(manifest), []);
});

/*
 * AND A FOLD MUST NOT DROP THIS BRANCH'S OWN TOP-LEVEL RECORDS (design review round 5,
 * D14). The rule that says so lives in two homes - the rig's fold block in
 * `scripts/capture-evidence.mjs` and `citationConvention` in the manifest itself - and
 * both are read by a RESOLVER, i.e. at the one moment nobody has time to read a rule
 * carefully. This is the same clause as a failure: the twelfth fold onto `c69f78b92`
 * kept main's schema, honoured every other group in the rule, and lost seven of this
 * branch's records without a word, because nothing said they had to survive.
 *
 * The list is this branch's records, not a schema: it grows when a pass writes a new
 * top-level field, and a field that is being retired deliberately belongs here only with
 * a sentence saying which pass retired it (none has). A fold that starts from main's
 * manifest fails on the first name it dropped, which is far earlier than the round that
 * next reads the note.
 */
const BRANCH_RECORDS = [
	"browserMarkRemovalPass",
	"roundOneRemediationNote",
	"roundTwoCaptureNote",
	"roundThreeCaptureNote",
	"roundFourRePortNote",
	"chatSlashHighlightEvidence",
	"themeLegibilityCapture",
	/*
	 * Grown by the provider-setup pass, which wrote this branch's newest top-level
	 * record. It is the entry that makes the list's own promise true for it: the
	 * fold onto `d7397b055` merged the manifest key-by-key and kept this record
	 * because nothing had to drop it, but nothing would have caught it if it had -
	 * and the pair of fields the same fold had to re-read (see
	 * `refreshedThemesUnionNote`) is the case where a KEY-GRANULAR merge is exactly
	 * the wrong instrument (fold convergence round, C-4).
	 */
	"providerSetupUxNote",
	"renameRefreshArgumentListPass",
	/*
	 * Grown by the `/usage` pass, whose re-stamp is this branch's newest top-level
	 * record. It is listed for the reason the list exists: a fold that starts from
	 * main's manifest would drop it (and with it the note that says which two tree
	 * hashes this branch's delta moved) without a word, and the re-derived tokens
	 * the token-binding test holds would then read as a claim about main's trees.
	 */
	"usageAutoCheckRestampNote",
	/*
	 * Grown by the `/usage` in-flight remediation, this branch's newest top-level
	 * record and the one that re-derived both stamps and moved four frames. It is
	 * listed for the reason the list exists: a fold that started from main's
	 * manifest would drop it, and with it the only statement of which four frames
	 * moved, why two of them were re-taken, and what the two trees are now.
	 */
	"usageInFlightRemediationNote",
	/*
	 * Grown by this branch's fold onto `origin/main` = `e48d64b81` (the #475
	 * telemetry-off merge), which wrote this branch's newest top-level record. It is
	 * listed for the reason the list exists, and this one is the case the list was
	 * written for: the fold is the only commit in this lineage that resolves
	 * `docs/evidence/manifest.json` against a main that has moved, and a resolver who
	 * took main's copy would drop this record and with it the only statement of which
	 * two trees the fold moved, which of main's fields the per-field rule refuses, and
	 * that no frame moved. (Note for a later reader, not an action: the `/usage`
	 * convergence round's own record, `usageInFlightConvergenceNote`, is absent from
	 * this list - the list's promise is therefore already one record short of true, and
	 * this fold reports that rather than widening its own diff to fix it.)
	 */
	"foldOntoTelemetryOffNote",
	/*
	 * Grown by the read-receipt remediation (agent review round 2, MINOR 1), which
	 * wrote this branch's newest top-level record. It is listed for exactly the
	 * reason the entry above records: this pass's own fold onto a moved `origin/main`
	 * had to lay this record back by hand, and the record is the only statement of
	 * which two trees the receipt's bytes moved - so a resolver who took main's copy
	 * would drop the claim the token-binding test then reads as main's.
	 */
	"readReceiptRestampNote",
	/*
	 * The record the entry above's own note reported as MISSING from this list, and
	 * it is filled in here because the same pass is editing this list anyway: the
	 * `/usage` convergence round wrote `usageInFlightConvergenceNote`, and until now
	 * the list's promise was one record short of true - a fold that resolved the
	 * manifest against a moved main could drop that record with nothing to catch it,
	 * which is the failure this whole list exists to make loud. Naming it is a
	 * one-line widening of the guard and changes nothing about any captured frame;
	 * it is disclosed on the round's remediation comment rather than smuggled in.
	 */
	"usageInFlightConvergenceNote",
	/*
	 * Grown by the pass that made the desktop picker list the providers by
	 * itself, which wrote this branch's newest top-level record. It is listed for
	 * the reason the list exists: a fold that starts from main's manifest drops
	 * it, and with it the only statement of which two trees this pass moved, which
	 * six frames it added, and which of this surface's frames were re-captured and
	 * came back byte-identical.
	 */
	"modelPickerLiveListingNote",
	/*
	 * And by round 1's remediation of that pass — the pass this fold carries: it re-captured four of
	 * this surface's frames, withdrew its cross-tree `before-` row for a declared supplementary set
	 * (so a later sweep cannot rewrite a base-tree claim from this tree), and re-derived the stamps
	 * the round moved.
	 */
	"modelPickerRemediationRestampNote",
	/*
	 * Grown by the `/btw` aside panel pass, whose re-stamp is this branch's newest
	 * top-level record. It is listed for the reason the list exists, and this
	 * branch is a second instance of the case the entry above names: the fold onto
	 * `origin/main` = `1020b48a9` resolved `docs/evidence/manifest.json` by taking
	 * main's copy as the base and re-laying this branch's own records on top, and
	 * THIS record survived only because the resolver put it back by hand - a
	 * resolver who had not would have dropped the only statement of which two trees
	 * the remediation moved and that no frame moved, with the gate staying green.
	 * It is also the branch's record that names where its rendered frames live: the
	 * evidence-only branch `evidence/btw-aside-frames`, since the sweep's frame
	 * predicate does not admit driver-taken PNGs.
	 */
	"asidePanelRestampNote",
	"streamGapHeldReadingsRestampNote",
	"mentionsRemedyRestampNote",
	/*
	 * Grown by the U15 + D28 pass, which wrote this branch's newest top-level
	 * record. It is listed for the reason the list exists: the pass moved BOTH
	 * trees and added a frame set, and the record is the only statement of what
	 * moved, why the pair was re-derived in a commit rather than by the capture
	 * run, and the one flake it did not fix.
	 */
	"u15D28RestampNote",
	/*
	 * And the fold onto `dfd93f7e9`, this branch's newest top-level record. It is
	 * listed for the reason the list exists: the fold is the commit that resolves
	 * this file against a main that had moved (five conflicted paths), and the
	 * record is the only statement of what the two trees carry now, what frames
	 * were NOT re-taken, and how each conflict was resolved.
	 */
	"foldOntoDfd93f7e9Note",
	/*
	 * And by the reveal-at-rest pass - the pass this fold carries. It is the case
	 * the entry above names, one fold over: the manifest resolution kept this
	 * branch's set, note and counts by hand against a moved main, and this record
	 * is the only statement of which two trees the scroll-reveal change moved and
	 * that the 16 frames it added came from this tree with the `before` arm's two
	 * modules swapped for `origin/main`'s.
	 */
	"transcriptRevealAtRestRestampNote",
	/*
	 * And the round-4 remediation's record, this branch's newest. Listed for the
	 * reason the list exists: a fold that started from main's manifest would drop
	 * it, and with it the only statement of what this pass re-shot, what it
	 * carried into the tree, and the two readings the Q5 falsification produced.
	 */
	"remediationRound4EvidenceNote",
	/*
	 * The records MAIN's #520 carried in, added here by this fold for the reason the
	 * list exists: the fold that brought them to this lineage had to splice them into
	 * the manifest by hand, and main's own copy of this list never grew them - so a
	 * later fold that started from main's manifest would drop them silently and with
	 * them the statements of which two trees the hold's rounds moved and why no still
	 * moved.
	 */
	"firstPaintHoldRestampNote",
	"firstPaintHoldFoldRestampNote",
	"firstPaintHoldRound4RestampNote",
	"refusalMarkRestampNote",
	"gapLivenessRestampNote",
	"markSpokenRestampNote",
	/*
	 * And the round-5 evidence pass, this branch's newest: the re-shot approval
	 * stories on the dock, the three carried connection logs, and the re-stamps the
	 * two instrument fixes moved. Listed for the reason the list exists - a fold that
	 * started from main's manifest would drop it and with it the only statement of
	 * which frames moved and why.
	 */
	"chatRedesignRound5EvidenceNote",
	/*
	 * And the fold onto `a6a04f2f` (#520), this branch's newest: it is the commit
	 * that resolves this file against a main that had moved AND the one that records
	 * main's six records being spliced in - the manifest entry a later fold that
	 * started from main's copy would drop first.
	 */
	"foldOntoA6a04f2fNote",
	/*
	 * And by the draft-warm pass, whose note this fold carries in: it is the only
	 * statement of which two trees the new-chat pre-engage moved and of why no
	 * still was owed, and this fold's manifest resolution keeps it by hand
	 * against main's copy - so it joins the list for the same reason every entry
	 * above it did.
	 */
	"newchatDraftWarmRestampNote",
	/*
	 * And the fold onto `fd19adc9d9` (#531), this branch's newest: it is the
	 * commit that resolves this file against a main that had moved AND the one
	 * that records main's draft-warm record being carried in - the manifest
	 * entry a later fold that started from main's copy would drop first.
	 */
	"foldOntoFd19adc9d9Note",
	/*
	/*
	 * Grown by the judged-goals (`feat/goal-done-history`) pass, which wrote four
	 * top-level records - `goalDoneRestampNote` and `goalDoneFoldRestampNote` from
	 * its rebases and folds, `goalDoneFramePassNote` from the frame pass, and
	 * `goalDesignRoundTwoNote` from the batched design-round-2 remediation. A fold
	 * that starts from main's manifest drops them without a word, which is this
	 * list's whole subject.
	 */
	"goalDoneRestampNote",
	"goalDoneFoldRestampNote",
	"goalDoneFramePassNote",
	"goalDesignRoundTwoNote",
	/*
	 * And the child-reader scroll-control pass's four records, this branch's own:
	 * `childReaderScrollControlFoldNote` and `childReaderScrollControlRestampNote`
	 * from its fold and its re-stamps, `childReaderScrollControlRoundOneNote` and
	 * `childReaderScrollControlRoundTwoNote` from its review rounds. A fold that
	 * starts from main's copy drops them without a word, which is this list's
	 * whole subject - and the records test is what fails first (agent review
	 * round 5, R5-1: the list had not been extended for this pass).
	 */
	"childReaderScrollControlFoldNote",
	"childReaderScrollControlRestampNote",
	"childReaderScrollControlRoundOneNote",
	"childReaderScrollControlRoundTwoNote",
	/*
	 * And this fold's own, beside the lane's sub-view record: the union the
	 * merge resolved, so a later fold that resolved this file from either side
	 * alone would drop the statement of what was carried from the other.
	 */
	"subviewInsetRestampNote",

	"foldOnto093a329a4dNote",

	/*
	 * And THIS CHANGE'S: the record of the pass that made the chat header's
	 * identity slot its own controls and captured their eleven states. It is
	 * listed for the reason the list exists - a fold that resolved this file
	 * from main's copy would drop the only statement of which two trees moved
	 * and which frames are the change's own.
	 */
	"headerIdentityRestampNote",

	/*
	 * And this fold's own: the union the merge resolved, registered beside the
	 * lane's judged-goals records for the reason the list exists.
	 */
	"foldOnto9d3e68ddf6Note",
	/*
	 * And this fold's own: the union the merge resolved, registered beside the
	 * child-reader records for the reason the list exists.
	 */
	"foldOnto22c0fcd4fdNote",
	/*
	 * And this round's own, beside the rest of the header identity's records:
	 * the remediation that answered review round 1. Registered here for the
	 * list's usual reason - a fold resolved from main's copy would drop it.
	 */
	"headerIdentityRoundOneRestampNote",
	/*
	 * And THIS CHANGE'S: the notice-band pass
	 * (`fix/banner-warn-error-consistency-7e4c`), whose record is the only
	 * statement of which two trees it moved, which frames it added (168 under
	 * fourteen new story ids, plus the 56-still pair it declares below), and why
	 * `head` stays the base the frames were taken at. A fold resolved from main's
	 * copy would drop it, which is this list's whole subject.
	 */
	"bannerBandsRestampNote",
	/*
	 * And by this branch's folds onto the action-group lane's own tips - the
	 * records the header-identity lane's arrival forced a rename of. Main's
	 * `foldOnto9d3e68ddf6Note`, `foldOnto093a329a4dNote`, `foldOnto22c0fcd4fdNote`
	 * and `foldOnto827f45f4fdNote` were coined by that lane for ITS folds onto the
	 * same tips, so this branch's records took the `ActionGroup` suffix and are
	 * listed here for the reason this array exists: a fold resolved from main's
	 * copy would otherwise drop the only statements of what each of this lane's
	 * folds moved. The plain-name entries above stay - they are the header lane's
	 * records, and they were never this branch's to drop.
	 */
	"actionFoldEvidenceNote",
	"foldOnto9d3e68ddf6ActionGroupNote",
	"foldOnto4ae3dbff0dActionGroupNote",
	"foldOnto22c0fcd4fdActionGroupNote",
	"foldOnto093a329a4dActionGroupNote",
	"foldOnto827f45f4fdActionGroupNote",
	"foldOnto44c7f8fd76ActionGroupNote",
	/*
	 * And by this lane, whose note is the newest top-level record on the
	 * branch: it states the pair the streaming re-delivery fix ships, and a
	 * later fold that started from main's copy would drop it first.
	 */
	"streamRedeliveryRestampNote",
	/*
	 * And this FOLD's own, beside the lane's re-stamp record: it states the
	 * union the merge resolved against `origin/main` = `eddfae750b` and the
	 * pair the re-stamp after the round-1 fixes re-derives, for the reason
	 * this list exists - a fold resolved from main's copy would drop it.
	 */
	"foldOntoEddfae750bNote",
	/*
	 * And the NEXT fold's own, beside it: it states the union resolved against
	 * `origin/main` = `2e12a54d56` and the pair its re-stamp re-derives - a fold
	 * that started from main's copy would drop it first, the same reason the
	 * list exists.
	 */
	"foldOnto2e12a54d56Note",
	/*
	 * And this FOLD's own, beside the removal's records: it states the union
	 * the merge resolved against `origin/main` = `fb89e6e374` and the pair its
	 * re-stamp re-derives, for the reason this list exists - a fold resolved
	 * from main's copy would drop it.
	 */
	"historySettingsRemovalSecondFoldNote",
	/*
	 * AND THIS ROUND'S OWN, the newest top-level record on the branch: it states the pair
	 * this remediation re-derives (`src/` for the pressed-row resolution and the outside-the-
	 * list order, `scripts/` for the successor clause and the pressed-id reading) and the
	 * walk's reading at the tip, so a later fold that started from main's copy would drop it
	 * first.
	 */
	"uxRoundThreeSuccessorRestampNote",
	/*
	 * AND THIS ROUND'S OWN, the newest top-level record on the branch: it states the pair
	 * this remediation re-derives (`src/` for the caret hand-off and the field's entry into
	 * the list, `scripts/` for the walk's two new clauses and the two pins) and the walk's
	 * reading at the tip, so a later fold that started from main's copy would drop it first.
	 */
	"uxRoundTwoCaretScopeRestampNote",
	/*
	 * And the round-2 archive-recast remediation's own, the newest top-level
	 * record on the branch: it states the pair the recast re-derives and the
	 * walk's reading at the tip, so a later fold that started from main's copy
	 * would drop it first - the same reason this list exists.
	 */
	"qaRoundTwoRecastRestampNote",
	/*
	 * And by this lane, whose notes are this branch's newest: the stager fix's
	 * re-stamp and the fold that carries it state the pair this branch ships
	 * and the runs that pin the failure it removes, so a later fold that
	 * started from main's copy would drop them first.
	 */
	"windowsUvStagerRestampNote",
	/*
	 * And this FOLD's own, beside the lane's re-stamp record: it states the
	 * union the merge resolved against `origin/main` = `d62caa6751` and the
	 * pair its re-stamp re-derives, for the reason this list exists - a fold
	 * resolved from main's copy would drop it.
	 */
	"windowsUvStagerFoldNote",
	/*
	 * And by this lane, whose note is the newest top-level record on the
	 * branch: it states the pair task-17 ships, moves both trees, and takes no
	 * frame - a fold that started from main's copy would drop it first, the
	 * same reason this list exists.
	 */
	"task17RestampNote",
	/*
	 * And by this lane, whose note is now the newest top-level record on the
	 * branch: it states the pair the inline-rename fix ships - both trees
	 * moved, one set's states re-captured - so a fold that started from main's
	 * copy would drop it first, the same reason this list exists.
	 */
	"headerRenameInlineRestampNote",
	/*
	 * And by the same lane once more, whose round-1 remediation note is now
	 * the newest top-level record on the branch: it states the pair the
	 * save-lifecycle pass ships - both trees moved, one set's state
	 * re-captured - so a fold that started from main's copy would drop it
	 * first, the same reason this list exists.
	 */
	"headerRenameInlineRoundOneNote",
	/*
	 * And by THIS lane, whose note is the newest top-level record on the branch:
	 * it states the pair this tip ships, moves both trees, and takes no frame -
	 * a fold that started from main's copy would drop it first, the same reason
	 * this list exists.
	 */
	"daemonObservationTickWaitRestampNote",
	/*
	 * And by the search-and-quota UX pass, whose note is this branch's newest
	 * top-level record: it states the pair this tip ships, moves both trees,
	 * and names the five sets its capture moved.
	 */
	"searchQuotaUxRestampNote",
	/*
	 * And by the credential-input change, whose note is the newest top-level
	 * record on the branch: it states the pair this tip ships, moves both trees
	 * (the dock's masked secret field and its answer path in `src/`, the suite's
	 * cases and the sweep's two new rows in `scripts/`), and takes no committed
	 * frame - a fold that started from main's copy would drop it first, and with
	 * it the only statement of what moved and why no still was committed, which
	 * is the failure this whole list exists to make loud.
	 */
	"secretAskCredentialRestampNote",
	/*
	 * And by the TWO-FLAKE lane, whose note is now the newest top-level record on
	 * the branch: it states the pair this tip ships, moves both trees, and takes
	 * no frame - a fold that started from main's copy would drop it first, the
	 * same reason this list exists.
	 */
	"twoFlakesRestampNote",
	/*
	 * And by the TWO-FLAKE lane's second fold, whose record is now the newest
	 * top-level note on the branch: it states the pair the folded tip ships, moves
	 * both trees, and takes no frame - a fold that started from main's copy would
	 * drop it first, the same reason this list exists.
	 */
	"foldOntoE885227046Note",
	/*
	 * Grown by the pending-echo lane: its fix, its round-1 remediation and its
	 * two folds each wrote a top-level record. The first fold registered them
	 * with the stamp-binding list only, so a fold that resolved this file from
	 * main's copy could have dropped them with nothing failing; this
	 * registration closes that hole for the records the branch is carrying.
	 */
	"pendingEchoRestampNote",
	"pendingEchoRemediationNote",
	"pendingEchoRemediationFoldNote",
	"pendingEchoRemediationSecondFoldNote",
	/*
	 * And the third fold's record rides beside the two above - each fold writes
	 * one, and the same completeness reason stands.
	 */
	"pendingEchoRemediationThirdFoldNote",
	/*
	 * And the fourth fold's record rides beside them - each fold writes one, and
	 * the same completeness reason stands.
	 */
	"pendingEchoRemediationFourthFoldNote",
	/*
	 * And the fifth fold's record rides beside them - each fold writes one, and
	 * the same completeness reason stands.
	 */
	"pendingEchoRemediationFifthFoldNote",
	/*
	 * And the TWO-FLAKE lane's second fold's record rides beside them - each
	 * fold writes one, and the same completeness reason stands.
	 */
	"foldOntoA9f4b1d7f4Note",
	/*
	 * And this pass's own, the newest top-level record on the branch: it states
	 * the pair this re-stamp derives and records the simulation the pass ships
	 * in place of frames, so a later fold that started from main's copy would
	 * drop it first - the same reason this list exists.
	 */
	"updateStallBoundRestampNote",
	/*
	 * And the fold's own record rides beside them, for the same completeness
	 * reason.
	 */
	"foldOnto1e88f7fc16Note",
	/*
	 * And the second fold's record rides beside them, for the same completeness
	 * reason.
	 */
	"foldOnto9589bd8fecNote",
	/*
	 * And the remediation round 2's record rides beside it, for the same
	 * completeness reason.
	 */
	"updateStallBoundRoundTwoNote",
	/*
	 * And the two later folds' records ride beside them, for the same
	 * completeness reason - review round 3 found the guard skipping the newest
	 * records while they lived only in the STAMP_BINDING_NOTES list.
	 */
	"foldOnto678f6c5c69Note",
	"foldOnto3428f5f475Note",
	/*
	 * And remediation round 3's record closes the set, for the same reason.
	 */
	"updateStallBoundRoundThreeNote",
	/*
	 * And the seventh fold's record rides beside them - same reason, same check.
	 */
	"foldOnto8b082c33d8Note",
	/*
	 * And the eighth fold's record rides beside them - same reason, same check.
	 */
	"foldOntoA72909b1f4Note",
	/*
	 * And the ninth fold's record rides beside them - same reason, same check.
	 */
	"foldOntoCc5a329040Note",
	/*
	 * And the CI-reds fix's restamp rides beside them - same reason, same check.
	 */
	"updateStallBoundCiFixRestampNote",
	/*
	 * And the tenth fold's record rides beside them - same reason, same check.
	 */
	"foldOnto7bd3803598Note",
	/*
	 * And this branch's own record, folded in beside it: the account-foot
	 * refresh writes one top-level note, registered here for the same
	 * completeness reason.
	 */
	"accountFootRefreshRestampNote",
	/*
	 * And the remediation round's record rides beside it - a restamp after the
	 * round's own changes writes one, and the same completeness reason stands.
	 */
	"accountFootRemediationRestampNote",
	/*
	 * And by THIS lane, whose note is the newest top-level record on the branch:
	 * it states the pair this change ships - both trees moved (the op tier and
	 * its wiring, the suites and the capture rows) and two states added to two
	 * sets - so a fold that started from main's copy would drop it first, the
	 * same reason this list exists.
	 */
	"traceToolLabelsRestampNote",
	/*
	 * And by the stopped-row measure fix, whose note is the newest top-level
	 * record on the branch: it states the pair this tip ships, moves both trees
	 * (the stopped line's container in `src/`, the rig, its discriminator and
	 * the two registrations in `scripts/`) and commits no swept frame - so a
	 * fold that started from main's copy would drop it first, the same reason
	 * this list exists.
	 */
	"stoppedRowRestampNote",
	/*
	 * And this branch's own record rides beside it: the sidebar bottom zone
	 * writes one top-level note, registered here for the same completeness
	 * reason - a fold that started from main's copy would drop it first.
	 */
	"sidebarBottomZoneRestampNote",
	/*
	 * And this lane's own record rides beside it, registered for the same
	 * completeness reason: a fold that started from main's copy would drop the
	 * card-surfaces restyle's note first.
	 */
	"cardSurfacesRestyleNote",
	/*
	 * And AIDA'S SIDEBAR SLICE rides beside them: the change moves both trees this
	 * file binds (the rail's row and its two gates, the composer's `/aida`, the two
	 * desktop ops; the new desktop test and the updated pins) and takes no frame of
	 * the sweep, so a reader is owed the two values it binds and the reason no
	 * still was owed to `docs/evidence`.
	 */
	"aidaSidebarRestampNote",
	/*
	 * And AIDA'S MISSED-MESSAGES BADGE, WORKING MARK, DISPLAY-NAME FALLBACK AND
	 * STRIP FEED KEEPER ride beside it: the change moves both trees this file
	 * binds (the two selectors, the marks' per-row fields, the contract's
	 * optional `name`, the keeper; the test and this note's registrations) and
	 * takes no frame of the sweep, so a reader is owed the pair it binds and the
	 * reason no still was owed to `docs/evidence`.
	 */
	"aidaBadgeRestampNote",
	/*
	 * And this branch's own record rides beside it - the pointer-affordance sweep
	 * writes one top-level note, registered here for the same completeness reason.
	 */
	"mouseCursorRestampNote",
	/*
	 * AND THE PROJECTS CARD'S WHOLE-SURFACE TARGET - it belongs here for the
	 * list's own reason: ITS SUBJECT IS THIS FILE'S BINDING. The card's root
	 * role, click and keyboard activation move both trees (the component
	 * under `src/`; the interaction pin and its lane entry under
	 * `scripts/`), and no frame was re-taken - the pointer is not a pixel, so
	 * the committed set renders identically and the PR's stills carry the
	 * before/after a reader would want - so a reader is owed the two values
	 * it binds and the reason the stills did not move.
	 */
	"projectsCardClickRestampNote",
	/*
	 * And this lane's own D1 fix rides beside them: the regenerated schedules
	 * before halves write one top-level note, registered here for the same
	 * completeness reason - a fold that started from main's copy would drop it
	 * first.
	 */
	"cardSurfacesBeforeHalvesNote",

	/*
	 * AND THIS LANE'S OWN, the math-currency pass's record - written by
	 * `fix/currency-math` beside `captureOrigin.mathCurrencyPass`: the note is
	 * this branch's newest top-level record and the one a fold that started
	 * from main's copy would drop first, which is exactly what this list is
	 * for.
	 */
	"mathCurrencyCaptureNote",
	/*
	 * And the chat-measure lane's fold record rides beside it - registered here
	 * for the same completeness reason: a fold that started from main's copy
	 * would drop it first.
	 */
	"foldOntoAc83ec7d92Note",
	/*
	 * And the second fold's record rides beside them - registered here for the
	 * same completeness reason.
	 */
	"foldOnto8367cbfaeeNote",
	/*
	 * And the third fold's record rides beside them - registered here for the
	 * same completeness reason.
	 */
	"foldOnto8320e52366Note",
	/*
	 * And this fold's record rides beside them - registered here for the same
	 * completeness reason.
	 */
	"foldOnto55d7b0a19bNote",
	/*
	 * And by THIS lane, whose five folded records report review round 1 (R5): the
	 * drawer's-rung pass wrote them, their manifest entries survived the folds, and
	 * this list - whose promise is that a fold resolved from main's copy would not
	 * drop them - had not grown them, so a resolver could have dropped all five
	 * without a word. Registered here rather than only noted, because naming them is
	 * the one-line widening the precedent above set. The second fold, the
	 * remediation round and its own stamp write join beside them for the same
	 * reason; the remediation's registration is this commit and its stamp
	 * re-derivation the docs-only commit that follows.
	 */
	"canvasElevatedPassNote",
	"canvasElevatedStaleFramesNote",
	"canvasElevatedBeforeNote",
	"canvasElevatedFoldNote",
	"canvasElevatedRestampNote",
	"canvasElevatedSecondFoldNote",
	"canvasElevatedRemediationPassNote",
	"canvasElevatedRemediationRestampNote",
	/*
	 * And the THIRD fold's own, added with it: a fold that resolved this file by
	 * key against a main that had moved 81 commits, and the record of what that
	 * resolution kept from each side.
	 */
	"canvasElevatedThirdFoldNote",
	/*
	 * And the FOURTH fold's own, added with it: the fold onto `0f23c76de5`'s
	 * successor `76ce9a7aac` (the 0.31.10 train), resolved the same by-key way
	 * as its predecessor.
	 */
	"canvasElevatedFourthFoldNote",
	/*
	 * And the FIFTH fold's own, added with it: the fold onto `76ce9a7aac`'s
	 * successor `ac83ec7d92`, resolved the same by-key way.
	 */
	"canvasElevatedFifthFoldNote",
	/*
	 * And the SIXTH fold's own, added with it: the fold onto `ac83ec7d92`'s
	 * successor `8367cbfaee` (#591's agent-hub org-empty-state fix), resolved
	 * the same by-key way.
	 */
	"canvasElevatedSixthFoldNote",
	/*
	 * And the SEVENTH fold's own, added with it: the fold onto `8367cbfaee`'s
	 * successors through `55d7b0a19b` (#595's Aida rail row and composer door,
	 * #607's 0.31.11 window, #596's pointer-cursor restore, #604's currency-math
	 * pass), resolved the same by-key way. Main's three records above rode in
	 * beside this lane's at the same point, kept whole.
	 */
	"canvasElevatedSeventhFoldNote",
	/*
	 * And the EIGHTH fold's own, added with it: the fold onto `55d7b0a19b`'s
	 * successor `e2394f9ff1` (the measure-narrow lane's merge and its own
	 * three folds), resolved the same by-key way. Main's four records above
	 * rode in beside this lane's at the same point, kept whole.
	 */
	"canvasElevatedEighthFoldNote",
	/*
	 * And THIS fold's record rides beside them - the fifth fold writes one
	 * top-level note, registered here for the same completeness reason: a fold
	 * that started from main's copy would drop it first.
	 */
	"foldOntoA8ac7f673cNote",
	/*
	 * And THIS lane's own, added with it: the agents offer's dismissal writes
	 * one top-level note - it states the pair this change ships, moves both
	 * trees (the offer module, the store field, the sidebar control and its
	 * story fixture; the capture row, the new behavioural suite and both
	 * registrations) and adds one story's twelve frames while re-shooting the
	 * set - and it is registered here for the same completeness reason: a fold
	 * that started from main's copy would drop it first.
	 */
	"agentsOfferDismissNote",
	/*
	 * And MAIN'S OWN records ride beside it, kept whole by the same fold: the
	 * interrupted-rows change's capture note (its `captureOrigin.interruptedRowsPass`
	 * record is not a top-level key, so it cannot be listed here) and this
	 * fold's own note, both registered for the completeness reason this list
	 * exists for - a fold that started from a copy without them would drop
	 * records this branch's tree carries.
	 */
	"interruptedRowsCaptureNote",
	"foldOnto55dbaf6118Note",
	/*
	 * And this round's own records, registered with them: the second fold's
	 * note (`foldOnto1b1a52d5cfNote`) and the comment fix's re-stamp note
	 * (`agentsOfferDismissCommentRestampNote`); their texts are written by the
	 * docs-only re-stamp commit this registration rides beside.
	 */
	"foldOnto1b1a52d5cfNote",
	"agentsOfferDismissCommentRestampNote",
];

test("the manifest carries every top-level record this branch wrote", () => {
	const manifest = JSON.parse(
		readFileSync("docs/evidence/manifest.json", "utf8"),
	);
	const missing = BRANCH_RECORDS.filter((key) => !(key in manifest));
	assert.deepEqual(
		missing,
		[],
		"a fold dropped this branch's own top-level records - union the manifest at the TOP level as well as inside it (the rig's fold block, group 2b, and the manifest's `citationConvention`)",
	);
});
