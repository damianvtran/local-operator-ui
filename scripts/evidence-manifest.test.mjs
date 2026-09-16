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

/** A throwaway evidence tree; the bytes never matter, only the paths. */
function tree(layout) {
	const root = mkdtempSync(join(tmpdir(), "lo-evidence-manifest-"));
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
	({ resolvable = [], reachable = [], src, scripts }) =>
	(args) => {
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
