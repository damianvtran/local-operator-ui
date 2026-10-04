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
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { partialAddedFields, partialFrameCount } from "./capture-evidence.mjs";
import { checkPaletteBudgets } from "./check-evidence-palettes.mjs";
import {
	citationAncestryFailures,
	citationFailures,
	countsMeanFailures,
	frames as frameFiles,
	partialCaptureFailures,
	provenanceFailures,
	stampFailures,
	storyDriftReadings,
	unjudgedFrameFailures,
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
	/*
	 * `HEAD:src`/`HEAD:scripts` still answer - the fake models git, not this
	 * module's reader - but nothing in the manifest reads them any more: the
	 * retired `srcTree`/`scriptsTree` pair is gone, and the test below is the one
	 * that pins the indifference.
	 */
	src: "b".repeat(40),
	scripts: "c".repeat(40),
});

test("a manifest whose counts describe the tree under review passes", () => {
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
	assert.match(out[0], RE_EVIDENCE_1);
	assert.match(out[0], RE_EVIDENCE_2);
	// It must name the commit, so the reader knows WHICH stamp is wrong.
	assert.match(out[0], RE_EVIDENCE_3);
});

test("a head that resolves to nothing at all fails", () => {
	const out = provenanceFailures({ ...GOOD, head: "d".repeat(40) }, git);
	assert.equal(out.length, 1);
	assert.match(out[0], RE_EVIDENCE_4);
});

test("a tree-stamp pair is IGNORED, stored in the file or absent (T2)", () => {
	/*
	 * The retired `srcTree`/`scriptsTree` pair used to be compared against
	 * `HEAD:src`/`HEAD:scripts` here, and a wrong value was a failure. That is the
	 * storage this change removed: a hash of a tree the file does not own goes
	 * false for every open branch the moment a sibling lands, so it forced a
	 * re-derive per fold and proved nothing about the frames. The guard must now
	 * be INDIFFERENT to the pair - a stray copy may not start gating again by
	 * accident - and the shipped file must not carry it at all (asserted next to
	 * the shipped-manifest test below).
	 */
	const withPair = {
		...GOOD,
		srcTree: "e".repeat(40),
		scriptsTree: "f".repeat(40),
	};
	assert.deepEqual(provenanceFailures(withPair, git), []);
	assert.deepEqual(provenanceFailures({ ...GOOD }, git), []);
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
	assert.match(out[0], RE_EVIDENCE_7);
	assert.match(out[0], RE_EVIDENCE_1);
});

test("a missing head is a failure, not a pass by omission", () => {
	// The absence of a claim must not be quieter than a wrong one.
	assert.match(
		provenanceFailures({ ...GOOD, head: undefined }, git)[0],
		RE_EVIDENCE_8,
	);
	assert.match(
		provenanceFailures({ ...GOOD, head: "abc" }, git)[0],
		RE_EVIDENCE_8,
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
	assert.match(out[0], RE_EVIDENCE_9);
	assert.match(out[0], RE_EVIDENCE_1);
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
	assert.match(refreshed[0], RE_EVIDENCE_10);
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
 * ---- the F3 advisory: capturedAtHead against the named story --------------
 */

/**
 * A fake `git` for the advisory, answering the three questions it asks - is a
 * stamp resolvable, what last touched a path, is one commit an ancestor of
 * another - and recording each ask so a test can pin WHICH file was resolved to
 * and how far a comparison got.
 *
 * Same reason as `fakeGit` above: the property under test is what the function
 * CONCLUDES from git's answers, and pinning that against real history would
 * make these pass or fail on which commits happen to exist in the clone. The
 * `""`/`null` distinction (`evidence-fold.test.mjs` documents it) is kept: `""`
 * is a command that succeeded with nothing to say, `null` one that could not
 * answer - the advisory is silent for both, and the case that matters is the
 * one where an ancestor question comes back REFUSED.
 */
const fakeDriftGit = ({
	lastTouch = {},
	resolvable = [],
	ancestors = [],
	calls = [],
} = {}) => {
	return (args) => {
		calls.push(args);
		if (args[0] === "rev-parse" && args[1] === "--quiet") {
			const sha = args[3].replace("^{commit}", "");
			return resolvable.includes(sha) ? sha : null;
		}
		if (args[0] === "log" && args[1] === "-1")
			return lastTouch[args.at(-1)] ?? null;
		if (args[0] === "merge-base" && args[1] === "--is-ancestor")
			return ancestors.some(([a, b]) => a === args[2] && b === args[3])
				? ""
				: null;
		return null;
	};
};

/**
 * A throwaway tree carrying `*.stories.tsx` files at real paths, so the walk
 * and the resolution steps have a tree to answer against.
 *
 * Only the paths matter - the bytes are never read - and the name is
 * `lop-`-prefixed for the reason `tree()` above is: `lo-evidence-` is
 * `capture-evidence.mjs`'s Chrome-profile reap-by-name namespace, so a fixture
 * under it is a deletion target for every capture on the box.
 */
function storyTree(files) {
	const root = mkdtempSync(join(tmpdir(), "lop-evidence-stories-"));
	scratch.push(root);
	for (const file of files) {
		const full = join(root, file);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, "// the bytes never matter, only the path\n");
	}
	return root;
}

test("a set whose story file moved outside its capturedAtHead reads as an advisory", () => {
	/*
	 * The class §4.2 records, in its cheap form: the frames were captured at
	 * `head`, and the story file the set names was touched by a commit that is
	 * not an ancestor of it - the pixels may picture an older cut than the story
	 * draws today. What comes back is a READING: the line never enters
	 * `failures`, so `main()` prints it and the exit code never sees it
	 * (`evidence-run-guard.test.mjs` pins that end to end).
	 */
	const head = "1".repeat(40);
	const moved = "2".repeat(40);
	const file = "src/renderer/src/features/chat/trace-row.stories.tsx";
	const root = storyTree([file]);
	const calls = [];
	const out = storyDriftReadings(
		{
			supplementary: [
				{
					path: "chat-trace-before",
					source: "the sweep against `trace-row.stories.tsx`",
					capturedAtHead: head,
				},
			],
		},
		fakeDriftGit({ lastTouch: { [file]: moved }, resolvable: [head], calls }),
		root,
	);
	assert.equal(out.length, 1);
	assert.match(out[0], /chat-trace-before/);
	assert.match(out[0], /may not picture the story's current cut/);
	// It checked the stamp is answerable, compared the file the mention resolves
	// to, and compared it against the set's own stamp.
	assert.deepEqual(calls, [
		["rev-parse", "--quiet", "--verify", `${head}^{commit}`],
		["log", "-1", "--format=%H", "--", file],
		["merge-base", "--is-ancestor", moved, head],
	]);
});

test("an agreeing stamp is silent, and a harness name resolves beside its frames", () => {
	/*
	 * Agreement: the last commit to touch the file IS an ancestor of the stamp,
	 * so the pixels postdate the file's last move and there is nothing to read.
	 * The mention is the `harness/...` shape, and its basename exists elsewhere
	 * in the tree as well - an ambiguous basename must not pin the comparison to
	 * a neighbour's file, so the set's own directory gets it.
	 */
	const head = "1".repeat(40);
	const touch = "3".repeat(40);
	const harness =
		"docs/evidence/goal-arming-pick/harness/ev209-goal-arming.stories.tsx";
	const root = storyTree([harness, "src/other/ev209-goal-arming.stories.tsx"]);
	const calls = [];
	const out = storyDriftReadings(
		{
			supplementary: [
				{
					path: "goal-arming-pick",
					source:
						"the rig beside these frames: `harness/ev209-goal-arming.stories.tsx`",
					capturedAtHead: head,
				},
			],
		},
		fakeDriftGit({
			lastTouch: { [harness]: touch },
			resolvable: [head],
			ancestors: [[touch, head]],
			calls,
		}),
		root,
	);
	assert.deepEqual(out, []);
	assert.deepEqual(calls, [
		["rev-parse", "--quiet", "--verify", `${head}^{commit}`],
		["log", "-1", "--format=%H", "--", harness],
		["merge-base", "--is-ancestor", touch, head],
	]);
});

test("a set that names no story file stays silent, and a glob is not a name", () => {
	/*
	 * Best-effort by design: 148 of the shipped 169 sets name no story file, and
	 * inventing a resolution for them would be the advisory guessing. A bare
	 * `*.stories.tsx` inside a note is a CLASS ("two `*.stories.tsx` files were
	 * edited after that capture" - `update-report-accuracy`), not a name this
	 * can walk, so a set whose only mention is the glob stays silent. The third
	 * set names a real file and last-touched it, but carries no stamp - there is
	 * no `capturedAtHead` to compare, so the comparison is skipped.
	 */
	const file =
		"src/renderer/src/features/chat/canonical/turn-collapse.stories.tsx";
	const root = storyTree([file]);
	const out = storyDriftReadings(
		{
			supplementary: [
				{
					path: "chat-trace",
					source: "captured by the sweep",
					capturedAtHead: "1".repeat(40),
				},
				{
					path: "update-report-accuracy",
					capturedAtHead: "9".repeat(40),
					capturedAtNote:
						"two `*.stories.tsx` files were edited after that capture",
				},
				{
					path: "chat-turn-collapse-before",
					source: "the story `turn-collapse.stories.tsx`, same fixtures",
				},
			],
		},
		fakeDriftGit({ lastTouch: { [file]: "3".repeat(40) } }),
		root,
	);
	assert.deepEqual(out, []);
});

test("a set naming a story file this tree cannot resolve reads as an advisory", () => {
	/*
	 * The shipped manifest's one unresolvable name: `common-connectivity-banner-baseline`
	 * names a connectivity-banner story that is not in this tree, and the set has
	 * NO `capturedAtHead`. The comparison is skipped - but the name reading is
	 * not, because "the record names a story this tree does not carry" is a
	 * disagreement with the tree that needs no stamp, and this is the only miss
	 * the shipped manifest has. If review prefers skipping stamp-less sets
	 * outright, this case and the doc block are where that decision lives.
	 */
	const root = storyTree([
		"src/renderer/src/features/chat/canonical/reconnect-gap.stories.tsx",
	]);
	const out = storyDriftReadings(
		{
			supplementary: [
				{
					path: "common-connectivity-banner-baseline",
					source:
						"the story `src/renderer/src/shared/components/common/connectivity-banner-baseline.stories.tsx`",
				},
			],
		},
		fakeDriftGit({}),
		root,
	);
	assert.equal(out.length, 1);
	assert.match(out[0], /common-connectivity-banner-baseline/);
	assert.match(out[0], /does not resolve to one file in this tree/);
	// The same reading, on a set that DOES carry a stamp: the miss is about the
	// name, not about the comparison that could not run.
	const stamped = storyDriftReadings(
		{
			supplementary: [
				{
					path: "stamped-miss",
					source: "the story `missing-from-tree.stories.tsx`",
					capturedAtHead: "1".repeat(40),
				},
			],
		},
		fakeDriftGit({}),
		root,
	);
	assert.equal(stamped.length, 1);
	assert.match(stamped[0], /does not resolve to one file in this tree/);
});

test("a stamp this history cannot answer does not read as drift", () => {
	/*
	 * The distinction the git reader folds together: `merge-base --is-ancestor`
	 * exits 1 for "not an ancestor" and 128 for "cannot answer", and BOTH
	 * arrive as null. A stamp the history has never heard of must stay silent -
	 * the shipped instance a reviewer meets is `provider-setup-ux-before`, whose
	 * stamp is contained by no remote ref or tag (a fetch-only clone answers 128
	 * for it), while `citationFailures` is the half that reports the citation
	 * itself; the advisory must not manufacture drift out of a question this
	 * history cannot answer. The stop is pinned at the resolvability question:
	 * the ancestry ask never happens, and the file's own last touch (which DOES
	 * exist here) is never turned into a verdict.
	 */
	const file =
		"src/renderer/src/features/onboarding/components/provider-setup.stories.tsx";
	const stamp = "f".repeat(40);
	const root = storyTree([file]);
	const calls = [];
	const out = storyDriftReadings(
		{
			supplementary: [
				{
					path: "provider-setup-ux-before",
					source: `the story \`${file}\``,
					capturedAtHead: stamp,
				},
			],
		},
		fakeDriftGit({
			lastTouch: { [file]: "3".repeat(40) },
			resolvable: [],
			calls,
		}),
		root,
	);
	assert.deepEqual(out, []);
	assert.deepEqual(calls, [
		["rev-parse", "--quiet", "--verify", `${stamp}^{commit}`],
	]);
});

test("an exact repository-relative mention resolves as written", () => {
	/*
	 * The first resolution step, pinned: a mention that spells its whole path
	 * (how the settings and onboarding sets write it) resolves to THAT file. The
	 * fixture also carries a same-basename story elsewhere, so a resolver that
	 * lost the exact step would fall through to the basename net, find two
	 * candidates, miss under the set's own directory, and report the name
	 * unresolved - which is what makes this case fail if the step is gutted or
	 * reordered.
	 */
	const head = "1".repeat(40);
	const touch = "3".repeat(40);
	const file =
		"src/renderer/src/features/onboarding/components/provider-setup.stories.tsx";
	const root = storyTree([file, "src/other/provider-setup.stories.tsx"]);
	const calls = [];
	const out = storyDriftReadings(
		{
			supplementary: [
				{
					path: "provider-setup-ux-before",
					source: `the story \`${file}\`, same fixtures`,
					capturedAtHead: head,
				},
			],
		},
		fakeDriftGit({
			lastTouch: { [file]: touch },
			resolvable: [head],
			ancestors: [[touch, head]],
			calls,
		}),
		root,
	);
	assert.deepEqual(out, []);
	assert.deepEqual(calls, [
		["rev-parse", "--quiet", "--verify", `${head}^{commit}`],
		["log", "-1", "--format=%H", "--", file],
		["merge-base", "--is-ancestor", touch, head],
	]);
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
	assert.match(out[0], RE_EVIDENCE_11);
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
	assert.match(out[0], RE_EVIDENCE_12);
	assert.match(out[0], RE_EVIDENCE_13);
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
	assert.match(out[0], RE_EVIDENCE_14);
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
	assert.match(out[0], RE_EVIDENCE_15);
	assert.match(out[0], RE_EVIDENCE_16);
	assert.match(out[0], RE_EVIDENCE_13);
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
	assert.match(out[0], RE_EVIDENCE_17);
	assert.match(out[1], RE_EVIDENCE_18);
});

/* ---- the shipped manifest, against the tree it ships in ------------------ */

/**
 * The one case here that reads the REAL manifest rather than a synthetic tree.
 *
 * Every other test in this file pins what `check-evidence.mjs` CONCLUDES, on a
 * fixture built for the purpose. This one exists because of what none of them
 * could see: at the round-3 head `docs/evidence/manifest.json` carried
 * `origin/main`'s tree hashes and `surfaces`, because a rebase kept upstream's
 * top-level stamp block while the branch's delta rewrote the neighbouring
 * `partialCapture`. The file therefore certified the committed frames against a
 * tree they were not taken from, git reported no conflict, and only
 * `pnpm check-evidence` could see it - a gate whose image loop runs over every
 * committed frame and outran that round's whole review budget, so the defect
 * survived a full review round (round 3, M1).
 *
 * The tree hashes are gone now (a stored hash of a tree the file does not own
 * cannot stay true, which is what made every fold rewrite this file); what
 * remains bound here is the COUNTS half of that verdict - the frame count on
 * disk outside the declared sets, the story and theme counts parsed out of
 * `HEAD:scripts/capture-evidence.mjs`, and the pass tallies - which still fails
 * the moment a rebase leaves those describing somebody else's tree. Citation
 * reachability is deliberately NOT asserted here: it needs the cited commits to
 * be present, and a shallow CI checkout has no such guarantee.
 */
test("the SHIPPED manifest's counts describe the tree it ships in", () => {
	const manifest = JSON.parse(
		readFileSync("docs/evidence/manifest.json", "utf8"),
	);
	assert.deepEqual(
		stampFailures(manifest),
		[],
		"docs/evidence/manifest.json must describe the tree it ships in: re-derive frames/surfaces/themes from the tree, the way capture-evidence.mjs writes them",
	);
});

/**
 * T3 - THE FILE CARRIES NO TREE STAMP, and this is what makes a resurrection
 * loud rather than silent. After the retirement lands, a branch whose own old
 * fold tool runs re-derives `srcTree`/`scriptsTree` back into its copy; without
 * this assertion the file would drift back to the old regime with every gate
 * green. The remedy is a run of `node scripts/evidence-fold.mjs`, which drops the
 * pair from whichever side carries it (`dropped srcTree - retired by this
 * change`) - and which must be the TREE'S OWN tool (fold the branch onto `main`
 * first: an older tree's `evidence-fold.mjs` is what re-adds the pair), with
 * `node scripts/drop-evidence-stamps.mjs` as the file-only form.
 */
test("the SHIPPED manifest carries no tree stamp", () => {
	const manifest = JSON.parse(
		readFileSync("docs/evidence/manifest.json", "utf8"),
	);
	assert.ok(
		!("srcTree" in manifest) && !("scriptsTree" in manifest),
		"docs/evidence/manifest.json must not store a hash of `src/` or `scripts/`. Those two fields were retired because a stored tree hash goes false for every open branch the moment any sibling commit moves that tree - which is what forced a re-derive on every fold. What the file certifies instead is stated in `check-evidence.mjs`'s header under \"What this file certifies\": the counts and the citations, with the frames-vs-src staleness class left as a review question. The remedy is a run of `node scripts/evidence-fold.mjs` (fold the branch onto `main` first, so the tree's own tool is the one that runs - an older tree's `evidence-fold.mjs` is what re-adds the pair), which drops the pair from whichever side carries it and prints `dropped srcTree - retired by this change`; `node scripts/drop-evidence-stamps.mjs` clears the file alone.",
	);
});

/**
 * The fold LABEL must not survive in a lead either, and this is the assertion
 * that makes a re-introduction red rather than silent (review round 1, MINOR 3).
 *
 * The writer stopped emitting `(this branch folded onto `origin/main` = `sha`)`,
 * but a lead ALREADY in the file is never rewritten by itself: `leadParagraph`
 * returns a lead whose READINGS match unchanged (`statesSameReadings` compares
 * numbers), so the residue is inert and permanent. The shipped file was rewritten
 * once by `scripts/drop-evidence-stamps.mjs`; this pins it, so a fold tool that
 * starts writing the label again - or a merge that takes an older copy's lead -
 * fails here instead of quietly restoring a second churn source.
 *
 * Only the LEADING paragraph is checked. The paragraphs under it are history by
 * construction (each is a former lead, and each says in its own words which tree
 * it described), so a label inside one of them is a record, not a residue.
 */
test("the SHIPPED manifest's countsMean leads carry no fold label", () => {
	const manifest = JSON.parse(
		readFileSync("docs/evidence/manifest.json", "utf8"),
	);
	for (const [field, text] of Object.entries(manifest.countsMean)) {
		const lead = String(text).split("\n\n")[0];
		assert.doesNotMatch(
			lead,
			/folded onto/i,
			`countsMean.${field}'s leading paragraph names the fold it was derived at, and that label is a commit name that changes on every fold - half the churn this change removes. \`node scripts/drop-evidence-stamps.mjs\` clears the writer's exact form, \`(this branch folded onto origin/main = <sha>)\`, and the shipped file carries none; a spelling it does not recognise has to be rewritten in the lead by hand, because mechanically normalising a sentence the tool does not recognise is how a record gets silently reworded.`,
		);
	}
});

/**
 * The manifest's parse DISCARDS duplicated keys, and every gate here reads the
 * file through a parser that does the same. So a SPLICED entry - two entries'
 * fields merged into one object, the second one's opening brace eaten by a
 * fold's conflict resolution - ships a false field silently while every
 * comparison through `JSON.parse` stays green.
 *
 * Measured on this branch (review round 2, F3): a fold merged the neighbouring
 * `chat-aside-panel-before` fields into `console-surface-close`'s object, and
 * under last-wins the shipped entry inherited the neighbour's `capturedAtHead`
 * citation - the provenance of a DIFFERENT set's frames - with this whole suite
 * and `pnpm check-evidence` in front of it all green, because both read the
 * file the same way. The walker below reads the SAME text the parser does and
 * exists only because `JSON.parse` has no duplicate-key hook; it is
 * deliberately small, and the fixture test beside the shipped one keeps it
 * falsifiable.
 */
const duplicateKeys = (text) => {
	const duplicates = [];
	const objects = [];
	let i = 0;
	while (i < text.length) {
		const ch = text[i];
		if (ch === "{") {
			objects.push(new Set());
			i += 1;
			continue;
		}
		if (ch === "}") {
			objects.pop();
			i += 1;
			continue;
		}
		if (ch === '"') {
			let j = i + 1;
			let value = "";
			while (j < text.length) {
				if (text[j] === "\\") {
					value += text[j + 1];
					j += 2;
					continue;
				}
				if (text[j] === '"') break;
				value += text[j];
				j += 1;
			}
			let k = j + 1;
			while (k < text.length && /\s/.test(text[k])) k += 1;
			if (text[k] === ":") {
				const keys = objects[objects.length - 1];
				if (keys) {
					if (keys.has(value)) duplicates.push(value);
					keys.add(value);
				}
			}
			i = j + 1;
			continue;
		}
		i += 1;
	}
	return duplicates;
};

test("a spliced entry's duplicated keys are caught by the walker", () => {
	/* The F3 shape in miniature: two entries merged into one object, no closing
	 * brace between them - exactly what a fold's union produced. */
	const spliced =
		'{\n  "path": "a",\n  "frames": 1,\n  "path": "b",\n  "frames": 2\n}';
	assert.deepEqual(duplicateKeys(spliced), ["path", "frames"]);
	/* And the shape each side legitimately produces - two proper siblings - is
	 * clean, so the guard cannot pass by flagging honest text. */
	assert.deepEqual(
		duplicateKeys('{\n  "path": "a"\n},\n{\n  "path": "b"\n}'),
		[],
	);
});

test("the SHIPPED manifest carries no duplicated key in any object", () => {
	const duplicates = duplicateKeys(
		readFileSync("docs/evidence/manifest.json", "utf8"),
	);
	assert.deepEqual(
		duplicates,
		[],
		"docs/evidence/manifest.json has an object with duplicated keys - a spliced entry (two objects merged without their closing brace) ships a false field under JSON.parse's last-wins, and every comparison reads the file the same way it did before this guard existed. Re-split the element into proper siblings, keep BOTH sides' entries, and re-run this suite.",
	);
});

/**
 * The notes that may still quote a `srcTree`/`scriptsTree` token: a FROZEN
 * ledger, and the residue of a convention this file no longer holds.
 *
 * WHY THE CONVENTION IS GONE. A note that names `srcTree`/`scriptsTree` binds
 * itself to a hash that every content commit moves, so every re-stamp had to
 * rewrite each note that named the pair. Measured 2026-09-27: 128 values in
 * `docs/evidence/manifest.json` quote a token - `srcTree` occurs 145 times in the
 * file, `scriptsTree` 147 - and that is what turns a two-line re-stamp into a
 * resolution over nineteen merge regions of a 2.5 MB file. A prose restatement
 * also cannot check itself: `settingsGateRestampNote` named a TRANSITION's pair
 * and read as a claim about the shipped one (round 4). The list this replaces,
 * `STAMP_BINDING_NOTES`, held its members to the pair the file SHIPS, which is
 * exactly what kept those bindings alive across every fold. The rule that
 * replaces it is stated in `AGENTS.md`: a note must not quote the pair at all -
 * a pass's identity is written as the bare commit SHAs it read, which do not move
 * when a sibling branch lands.
 *
 * WHY A LEDGER AND NOT A PREDICATE OVER THE TEXT. The already-written prose is
 * CARRIED, not repaired: re-pointing 128 values here would invalidate every open
 * branch at once, so the repair is its own job. This ledger is the boundary - the
 * notes below may still quote the pair, the set may SHRINK freely as each is
 * rewritten (drop a name once its note is clean; that is the repair path), and a
 * note not named here may never quote one. It is keyed by MANIFEST PATH, because
 * leaf names are not unique: `headNote`'s name is also carried by two bare
 * `previousTopLevel` snapshots, and a name-keyed exemption covers them silently.
 * Seven carried values live below the top level - six under `partialCapture`,
 * one under a `supplementary` set - so their paths are spelled out; the
 * `supplementary` set's index is not stable across folds (it moved 13 -> 14 in
 * one window), so that entry's key elides it: `supplementary/closePassNote`.
 * A fold that RENAMES one of these notes carries the new key into the ledger in
 * the same commit, since a rename that dropped the key would make the note a
 * fresh violation.
 */
const LEGACY_STAMP_QUOTING_NOTES = new Set(
	`
		actionFoldEvidenceNote
		agentOpenedRestampNote
		approvalOptionsRestampNote
		asidePanelRestampNote
		bannerBandsRestampNote
		candidateMacArchRestampNote
		chatRedesignChipFoldRestampNote
		chatRedesignFoldRestampNote
		chatSidebarSectionsRestampNote
		childReaderScrollControlRestampNote
		childWorkingLineFoldRestampNote
		supplementary/closePassNote
		composerNoticeRemediationNote
		consolePaneFitFoldRestampNote
		consoleWiringRestampNote
		cwdChipCapRestampNote
		daemonObservationTickWaitRestampNote
		delegatingSidebarRestampNote
		partialCapture/deliveryGateRestampNote
		firstPaintHoldFoldRestampNote
		firstPaintHoldRestampNote
		firstPaintHoldRound4RestampNote
		focusHoldOperationRestampNote
		foldOnto093a329a4dActionGroupNote
		foldOnto093a329a4dNote
		foldOnto22c0fcd4fdActionGroupNote
		foldOnto22c0fcd4fdNote
		foldOnto2e12a54d56Note
		foldOnto44c7f8fd76ActionGroupNote
		foldOnto4ae3dbff0dActionGroupNote
		foldOnto601a9d5032Note
		foldOnto827f45f4fdActionGroupNote
		foldOnto827f45f4fdNote
		foldOnto9d3e68ddf6ActionGroupNote
		foldOnto9d3e68ddf6Note
		foldOntoAnalyticsTokensNote
		foldOntoComposerNoticeNote
		foldOntoCwdChipAndIntegrationsNote
		foldOntoDfd93f7e9Note
		foldOntoEddfae750bNote
		foldOntoFd19adc9d9Note
		foldOntoFdff0d84d6Note
		foldOntoFdff0d84dNote
		foldOntoLiveSettleLabelNote
		foldOntoPagedChatsNote
		foldOntoStreamGapNote
		foldSpliceLintRestampNote
		gapLivenessRestampNote
		goalDesignRoundTwoNote
		goalDoneFoldRestampNote
		goalDoneRestampNote
		headNote
		headerIdentityRestampNote
		headerIdentityRoundOneRestampNote
		headerRenameInlineRestampNote
		headerRenameInlineRoundOneNote
		heldDraftRefusalRestampNote
		heldFirstPaintRestampNote
		historySettingsRemovalRestampNote
		historySettingsRemovalSecondFoldNote
		installerNetworkRestampNote
		integrationsRedesignRestampNote
		liveSettleLabelRemediationNote
		liveSettleLabelRestampNote
		macArchSplitRestampNote
		macNativeComponentsRestampNote
		markSpokenRestampNote
		mcpUnavailableRestampNote
		mentionsRemedyRestampNote
		messageSurfaceRestampNote
		modelCatalogueFocusRestampNote
		modelPickerRemediationRestampNote
		modelPickerSetFoldRestampNote
		newchatDraftWarmRestampNote
		notarizeGateRestampNote
		occupiedAddressRestampNote
		openPaintFirstRestampNote
		overlayDragZonesRestampNote
		pairingRediscoversRestampNote
		partialCapture/pendingSendRestampNote
		partialCapture/pendingSendRoundTwoRestampNote
		pipxShimArmRestampNote
		pipxShimMergeRestampNote
		qaRoundTwoRecastRestampNote
		readReceiptRestampNote
		partialCapture/rebaseRestampNote14
		refusalMarkRestampNote
		reloadReanchorRestampNote
		remediationRound4EvidenceNote
		removeCredentialsRestampNote
		partialCapture/rigLogDirRestampNote
		rigScanReceiversRestampNote
		round1LabelGapRestampNote
		round2LabelGapRestampNote
		round2SecondFoldNote
		round3FoldRestampNote
		round3RestampNote
		round6FoldRestampNote
		round7FoldRestampNote
		round8FoldRestampNote
		roundOneRemediationRestampNote
		roundThreeNoticeRestampNote
		rowSpaceQ9WriterNote
		rowSpaceRemediationRestampNote
		rowTeamTrailingRestampNote
		scratchDriverRemovalRestampNote
		seedLabelGapRestampNote
		serverReleaseNotesPassNote
		settingsGateRestampNote
		shellPathRestampNote
		shellRegressionsRestampNote
		partialCapture/socketPlaneFoldRestampNote
		streamGapHeldReadingsRestampNote
		streamRedeliveryRestampNote
		subagentResultInlineRestampNote
		subviewInsetRestampNote
		task17RestampNote
		telemetrySwitchRestampNote
		trackedSourceCensusRestampNote
		transcriptRevealAtRestRestampNote
		u15D28RestampNote
		usageInFlightConvergenceNote
		uxRoundThreeSuccessorRestampNote
		uxRoundTwoCaretScopeRestampNote
		walkFirstRunRestampNote
		windowChromeRestampNote
		windowsUvStagerFoldNote
		windowsUvStagerRestampNote
`
		.trim()
		.split("\n")
		.map((name) => name.trim()),
);

/**
 * Every string the manifest holds, as `[path, leafName, value]`.
 *
 * The walk is the point: the notes a fold writes are not all top-level. Six
 * live under `partialCapture` and a `supplementary` set carries the seventh - so a
 * predicate that read only the manifest's own keys would let the next fold
 * rebind a nested note in a file whose top level stayed clean.
 */
const stringLeaves = (value, path = "", out = []) => {
	if (typeof value === "string") {
		out.push([path, path.split("/").at(-1), value]);
	} else if (value && typeof value === "object") {
		for (const [key, child] of Object.entries(value)) {
			stringLeaves(child, path ? `${path}/${key}` : key, out);
		}
	}
	return out;
};

/** The form a note uses when it names a stamp: a backticked key, a SHA. */
const STAMP_QUOTE = /`(srcTree|scriptsTree)`\s*`[0-9a-f]{7,40}`/;

/**
 * The key a leaf is exempted under: its manifest path, with the
 * `supplementary` set's unstable index elided (see the ledger's preamble - the
 * set's index moved 13 to 14 in one window). Every other key is the path as
 * written; a top-level note's key is its name, so only a TOP-LEVEL `headNote`
 * matches it and the two `previousTopLevel` copies do not.
 */
const ledgerKey = (path) => path.replace(RE_EVIDENCE_19, "supplementary/");

test("a note must not bind itself to a tree stamp", () => {
	const manifest = JSON.parse(
		readFileSync("docs/evidence/manifest.json", "utf8"),
	);
	const binding = stringLeaves(manifest)
		.filter(([, , value]) => STAMP_QUOTE.test(value))
		.filter(([path]) => !LEGACY_STAMP_QUOTING_NOTES.has(ledgerKey(path)))
		.map(([path]) => path);
	assert.deepEqual(
		binding,
		[],
		"docs/evidence/manifest.json holds values that quote `srcTree`/`scriptsTree`. A note must not bind itself to a tree stamp: name the commit SHAs the pass read (`git rev-parse HEAD:src`) instead, which do not move when a sibling branch lands. The notes that already do are carried in LEGACY_STAMP_QUOTING_NOTES and repaired in their own change - a NEW name here is the defect this test exists for.",
	);
});

/**
 * The reason the ledger is keyed by path: the pass records' `previousTopLevel`
 * snapshots copy top-level fields, and `headNote` occurs at two of them - a
 * name-keyed exemption covered those copies silently. They are bare today;
 * this pins that, so a fold cannot ship a stale pair inside a snapshot under a
 * name the ledger knows.
 */
test("the `previousTopLevel` snapshots carry no stamp token", () => {
	const manifest = JSON.parse(
		readFileSync("docs/evidence/manifest.json", "utf8"),
	);
	const quoting = stringLeaves(manifest)
		.filter(([path]) => path.includes("/previousTopLevel/"))
		.filter(([, , value]) => STAMP_QUOTE.test(value))
		.map(([path]) => path);
	assert.deepEqual(
		quoting,
		[],
		"a `previousTopLevel` snapshot carries a value that quotes `srcTree`/`scriptsTree`. These snapshots copy top-level fields - `headNote` occurs at two of them - and a stale copy must not read as a binding of the tree this file ships.",
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

/*
 * The citation half, and why a missing object is a question about the CLONE
 * rather than about the manifest.
 *
 * This is the defect the wiring found. `pnpm check-evidence` was added to CI as
 * `ci.yml`'s `evidence` job and came back with 111 findings on a tree that is
 * clean locally - every citation the manifest makes, reported as "resolves to no
 * commit in this repository" - because `actions/checkout`'s default clone is ONE
 * COMMIT DEEP. A missing object in a TRUNCATED clone is not evidence that the
 * commit is gone, and judging it as a failure reds the gate on a manifest that
 * is fine, for a reason no reader can act on: a repository that cannot answer
 * has not found a defect, the same sentence the `SHALLOW` guard above is built
 * on, and the same stand-down `evidence-fold.mjs`'s `runGuards` already makes for
 * the ancestry half.
 *
 * SO THE HALF IS LOCAL-ONLY, and this test pins what that means in code: a
 * truncated clone has NO verdict on a citation it cannot resolve - those are not
 * failures, and there is nothing to print for them either, because a stand-down
 * notice appearing on 100% of runs is a standing excuse that reads as a covered
 * check (the same green-by-absence the sweep's wiring was added to remove, one
 * level up), and the scope is declared once in `ci.yml`'s own step name and
 * comment instead. Everything the clone CAN judge it still judges and fails
 * closed on - including in a truncated clone, where an object that is present
 * but reached by no ref is the dangling case and the presence IS the clone
 * answering.
 *
 * Bound here rather than by a sweep test, because a test of the sweep cannot see
 * it: reproducing the shipped behaviour needs a real truncated clone, and a fake
 * reader is what the other synthetic-manifest cases use for exactly that reason.
 *
 * Mutations: put the truncation branch back on the failure pile (the shipped
 * defect - 111 findings on every CI run); read "is this clone truncated" as
 * FALSE when git cannot answer, which excuses a repository that cannot be read
 * rather than failing closed on it; or stand the REACHABILITY arms down with the
 * truncation, which would make a dangling citation invisible in every clone.
 */
test("a truncated clone has no verdict on the citations it cannot resolve", () => {
	const manifest = {
		head: "c70e8b36dc2ad86bfff81f85f05d08b248f82ccc",
		supplementary: [
			{
				path: "a-set",
				capturedAtHead: "e3ac03549d9bcb43f1abd2fff1f1ca803e83fbc9",
			},
		],
		partialCapture: {
			addedAtHead: "779b3f4341f",
			refreshedAtHead: "b19c8fded4b",
		},
	};
	/*
	 * A reader that answers only the four questions `shaReaders` asks, from three
	 * switches: is the clone truncated, do the cited objects RESOLVE, and does
	 * some ref REACH them. An unreadable repository is the fourth case below, and
	 * it is the one that has to fail closed.
	 */
	const answers =
		({ shallow, resolve, reach }) =>
		(args) => {
			if (args.includes("--is-shallow-repository")) return shallow;
			// `rev-parse --quiet --verify <sha>^{commit}`, the shape `shaReaders` uses.
			if (args.some((argument) => String(argument).endsWith("^{commit}")))
				return resolve ? "a commit" : null;
			if (args[0] === "merge-base") return reach ? "" : null;
			if (args[0] === "for-each-ref")
				return reach ? "refs/remotes/origin/main" : "";
			if (args[0] === "log") return "a subject";
			return null;
		};

	const truncated = answers({ shallow: "true", resolve: false, reach: false });
	assert.deepEqual(
		citationFailures(manifest, truncated),
		[],
		"a truncated clone resolved nothing, so it has found nothing: judging these as failures is how 111 findings appeared on a clean tree in CI",
	);
	/*
	 * AND THERE IS NOTHING TO PRINT FOR THEM. There is deliberately no
	 * "unanswered" view to assert any more: the stand-down is scope, declared in
	 * `ci.yml`'s step name and in `citationWalk`'s paragraph, and a per-run notice
	 * on 100% of runs was the shape the wiring's own round rejected.
	 */

	const full = answers({ shallow: "false", resolve: false, reach: false });
	assert.equal(
		citationFailures(manifest, full).length,
		4,
		"a clone that is NOT truncated has found a defect when the object is gone - gone is gone, and it must not be excused",
	);

	/*
	 * A citation that RESOLVES is judged by reachability even in a truncated
	 * clone: the object being present is the clone answering after all, so the
	 * dangling case (`resolves` but no ref contains it) still fails there.
	 */
	assert.equal(
		citationFailures(
			manifest,
			answers({ shallow: "true", resolve: true, reach: false }),
		).length,
		4,
		"a citation whose object IS present and which no ref reaches is the dangling case that dies at the next gc, in any clone",
	);

	/*
	 * Fail closed on the truncation question itself: an unreadable repository
	 * answers `null`, and only the explicit `true` may stand a citation down.
	 */
	assert.equal(
		citationFailures(manifest, () => null).length,
		4,
		"a repository git cannot answer for must be judged, not excused",
	);
});

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
	"RE-DERIVED FOR THIS FOLD: 3 committed frames outside the 1 declared supplementary sets below, of 5 on disk (2 of them inside the sets).";

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
	assert.match(failure, RE_EVIDENCE_20);
	assert.match(failure, RE_EVIDENCE_21);
	assert.match(
		failure,
		RE_EVIDENCE_22,
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
	assert.match(failure, RE_EVIDENCE_20);
	assert.match(failure, RE_EVIDENCE_23);
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
		framesProse: `${FRAMES_LEADING}\n\nRE-DERIVED FOR THE SECOND FOLD: 2 committed frames outside the 1 declared supplementary sets below, of 4 on disk (2 of them inside the sets).`,
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
	assert.match(failure, RE_EVIDENCE_24);
	assert.match(failure, RE_EVIDENCE_25);
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
		/*
		 * A SEEN SET, not the adjacent pair this guard first read: the copies
		 * review round 1 found were NON-adjacent (a paragraph repeated four
		 * entries later in `surfaces`, and `frames` carrying the same
		 * "MAIN'S OWN RECORD..." sentence twice), which an adjacent comparison
		 * passes while looking like it guards the whole cell. One pass, with the
		 * first-seen index kept so the message can say which entry it duplicates.
		 */
		const seen = new Map();
		for (let i = 0; i < paragraphs.length; i += 1) {
			const first = seen.get(paragraphs[i]);
			if (first !== undefined) {
				/*
				 * One template literal rather than a concatenation: `lint/style/useTemplate` is an
				 * ERROR under this project's config, and the gate above treats an error-severity
				 * diagnostic in a changed file as a failure - which is how this message was caught.
				 */
				failures.push(
					`manifest.json: countsMean.${field} repeats its paragraph ${i} verbatim (first seen at ${first}: ${paragraphs[i].slice(0, 60)}...) - a fold inserted the same sentence twice instead of deriving one for its own tree; delete the copy rather than editing it in place`,
				);
				continue;
			}
			seen.set(paragraphs[i], i);
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
	/*
	 * AND THE NON-ADJACENT SHAPE, which is the one the adjacent comparison
	 * missed: a paragraph repeated with a different one between its copies is
	 * still the same sentence twice, and review round 1 found the shipped file
	 * carrying exactly that shape (frames: `MAIN'S OWN RECORD...` twice, four
	 * entries apart; surfaces: a pair repeated at 12/16 and 13/17).
	 */
	const spaced = duplicateParagraphFailures({
		countsMean: {
			surfaces: `${sentence}\n\nRE-DERIVED FOR AN OLDER FOLD: 12 rows.\n\n${sentence}`,
		},
	});
	assert.equal(
		spaced.length,
		1,
		"a repeat with a different paragraph between its copies is still a repeat",
	);
	assert.match(spaced[0], RE_EVIDENCE_26);
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
	 * And by the answer-press copy pass - the pass this branch carries. It is the
	 * case the entries above name: the note is the only statement of which two
	 * trees the change moved (`src/` for the two coded refusals' own sentences and
	 * the app's bounded repeat for the busy arm, `scripts/` for the two arms' rig
	 * rows and their assertions), of the twelve frames added to a set that is not
	 * swept, and of the six of them that are `origin/main`'s own rendering. A fold
	 * resolved from main's copy would drop it, and the re-derived tokens would then
	 * read as a claim about main's trees. It quotes no tree-hash pair, so
	 * `BRANCH_RECORDS` is where it belongs.
	 */
	"answerNoticeArmsRestampNote",
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
	 * AND THE DESKTOP-STEP DIAGNOSTICS' OWN (2026-09-29): `desktopStepDiagnosticsRestampNote`
	 * is the record for the CI step that makes a red desktop suite name the failing
	 * test - the errexit-independent capture, the TAP summary, the `::error::`
	 * annotations and the A17b/A17c driven pins. It moves `scripts/` only and takes
	 * no frame (nothing in it is user-visible; the evidence is the step body
	 * extracted and driven under `bash -e` with a stub `pnpm` against five
	 * synthetic logs, plus the mutation table). The fold onto the stamp-discipline
	 * train (#566) spells the note's pair bare: the convention that held new notes
	 * to the pair is retired. A fold that started from main's copy would drop it
	 * first, the same reason this list exists.
	 */
	"desktopStepDiagnosticsRestampNote",
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
	/*
	 * AND THE TURN-COLLAPSE PASS'S OWN (`feat/collapsed-turn-summary`): the
	 * single record of the pass that added `chat-turn-collapse/` (16 swept
	 * frames) and its declared before half `chat-turn-collapse-before/` (16
	 * frames, supplementary), re-derived both stamps and led both `countsMean`
	 * cells. It is listed for the list's usual reason: a fold resolved from
	 * main's copy would drop the only statement of which half is counted by
	 * `frames` and which is declared, and of the `press` caveat a re-capturer
	 * of the before half needs. It quotes no tree-hash pair (commit SHAs only),
	 * so it joins `BRANCH_RECORDS` and not `STAMP_BINDING_NOTES`.
	 */
	"turnCollapseEvidenceNote",
	/*
	 * And the pass's `dirtyWorkingTreeNote`, added by the agent review's round-3
	 * F-r3-2: the second fold had taken main's `false` wholesale for
	 * `dirtyWorkingTree`, and the note records the restore to the capture's own
	 * `true` (both re-shoots ran with `src`/`scripts` edits uncommitted). It is
	 * registered here for the same reason as everything above - a fold resolved
	 * from main's copy would drop the note and leave the field's `true`
	 * unexplained - and, since the key is top-level and quotes no tree-hash
	 * pair, `BRANCH_RECORDS` is where it belongs.
	 */
	"dirtyWorkingTreeNote",
	/*
	 * And the sessionless-slash pass's own newest top-level record, which
	 * re-derived both stamps for this branch's change (issue #625) and quotes
	 * the pair it ships. Listed here for the reason the list exists: a fold
	 * that started from main's manifest would drop it.
	 */
	"sessionlessSlashRestampNote",
	/*
	 * And the quick-send pass's own record (`quickSendRestampNote`), listed for
	 * the list's usual reason: the note is this branch's statement of what moved
	 * and what did not (no frame was committed by it), and a fold resolved from
	 * main's copy would drop it.
	 */
	"quickSendRestampNote",
	/*
	 * And the chat device control's own (`feat/chat-move-control`), the record the
	 * device-control pass wrote when it added `chat-device/` (36 frames over 18
	 * stories, swept in this branch). It is listed for the list's own reason: a fold
	 * resolved from main's copy would drop the only statement of which frames this
	 * branch added, of what was deliberately NOT photographed, and of the local
	 * uncommitted `.storybook/main.ts` line the sweep ran under - the same class the
	 * twelfth fold committed against seven other records. It quotes no tree-hash
	 * pair (the re-derived pair lives in `STAMP_BINDING_NOTES`' members), so it
	 * belongs here and not there.
	 */
	"chatDeviceControlNote",
	/*
	 * And the fold's own (`sessionlessSlashFoldNote`), listed for the list's
	 * usual reason: the note states what the fold moved and what it did not, and
	 * a fold that started from main's copy would drop it.
	 */
	"sessionlessSlashFoldNote",
	/*
	 * And the second fold's own (`sessionlessSlashSecondFoldNote`), listed for
	 * the list's usual reason: the note states what the fold moved and what it
	 * did not, and a fold that started from main's copy would drop it.
	 */
	"sessionlessSlashSecondFoldNote",
	/*
	 * And the third fold's own (`sessionlessSlashThirdFoldNote`), listed for the
	 * list's usual reason: the note states what the fold moved, what it did not,
	 * and audits the composer's slash-adjacent paths across #633's rewrite; a
	 * fold that started from main's copy would drop it.
	 */
	"sessionlessSlashThirdFoldNote",
	/*
	 * And the fourth fold's own (`sessionlessSlashFourthFoldNote`), listed for
	 * the list's usual reason: the note states what the fold moved and what it
	 * did not; a fold that started from main's copy would drop it.
	 */
	"sessionlessSlashFourthFoldNote",
	/*
	 * And the mini dictation swap's own record (`miniDictRestampNote`), listed
	 * for the list's usual reason: the note is this branch's statement of what
	 * moved and what did not (no frame was committed by it), and a fold resolved
	 * from main's copy would drop it.
	 */
	"miniDictRestampNote",
	/*
	 * AND THIS FIX'S OWN (2026-09-29): `relaunchDuringQuitRestampNote` is the
	 * re-stamp for the quit-in-progress gate (issue #636 - a relaunch inside the
	 * teardown was answered by the dying instance with a window that died with it,
	 * "the relaunched app opens onto the app still shutting down"), folded late
	 * onto main's quick-send and projects lineages. Both trees move - `src/` for
	 * the state, its two answer sites and the new refusal reporter, `scripts/` for
	 * the proof rig, the suites that pin the gate and this list's own registration
	 * - and no swept frame was taken: the change's evidence is a new set of a PNG
	 * frame and run transcripts that no supplementary set declares, so the reader
	 * is owed the pair this file ships and the reason no still was.
	 */
	"relaunchDuringQuitRestampNote",
	/*
	 * Grown by the README-visuals remediation, this branch's newest top-level
	 * record and the one that re-derived both stamps: the story under `src/` and
	 * the two rigs under `scripts/` moved both trees, and no sweep frame moved.
	 * It is listed for the reason the list exists: a fold that started from
	 * main's manifest would drop it (and with it the note that says which two
	 * tree hashes this branch's delta moved) without a word.
	 */
	"readmeVisualsRestampNote",
	/*
	 * Grown by the README-visuals fold, this branch's newest top-level record:
	 * the merge onto `origin/main` `8dc87ea84c` resolved both evidence files as
	 * unions and re-derived the pair from the merged tree, and the note it wrote
	 * is listed for the reason the list exists - a fold that started from main's
	 * copy would drop it first.
	 */
	"readmeVisualsFoldNote",
	/*
	 * Grown by the round-2 fix, this branch's newest top-level record: its
	 * `notRunKind` and width-reset edits moved the src tree, and the note is
	 * listed for the reason the list exists - a fold that started from main's
	 * copy would drop it first.
	 */
	"readmeVisualsRoundTwoRestampNote",
	/*
	 * Grown by the second fold, this branch's newest top-level record: the
	 * merge onto `origin/main` `b23f789c10` re-derived the pair from the merged
	 * tree, and the note it wrote is listed for the reason the list exists - a
	 * fold that started from main's copy would drop it first.
	 */
	"readmeVisualsFoldTwoNote",
	/*
	 * Grown by the third fold, this branch's newest top-level record: the merge
	 * onto `origin/main` `bc09a6d698` re-derived the pair from the merged tree,
	 * and the note it wrote is listed for the reason the list exists - a fold
	 * that started from main's copy would drop it first.
	 */
	"readmeVisualsFoldThreeNote",
	/*
	 * Grown by the fourth fold, this branch's newest top-level record: the
	 * merge onto `origin/main` `dd51156839` re-derived the pair from the merged
	 * tree, and the note it wrote is listed for the reason the list exists - a
	 * fold that started from main's copy would drop it first.
	 */
	"readmeVisualsFoldFourNote",
	/*
	 * Grown by the fifth fold, this branch's newest top-level record: the
	 * merge onto `origin/main` `0a2c8e7a30` re-derived the pair from the merged
	 * tree, and the note it wrote is listed for the reason the list exists - a
	 * fold that started from main's copy would drop it first.
	 */
	"readmeVisualsFoldFiveNote",
	/*
	 * Grown by the sixth fold, this branch's newest top-level record: the
	 * merge onto `origin/main` `654c58f5f672` re-derived the pair from the
	 * merged tree, and the note it wrote is listed for the reason the list
	 * exists - a fold that started from main's copy would drop it first.
	 */
	"readmeVisualsFoldSixNote",
	/*
	 * Grown by the seventh fold, this branch's newest top-level record: the
	 * merge onto `origin/main` `a0cdaa759f5a` re-derived the pair from the
	 * merged tree, and the note it wrote is listed for the reason the list
	 * exists - a fold that started from main's copy would drop it first.
	 */
	"readmeVisualsFoldSevenNote",
	/*
	 * And the cross-session visibility filter's own record
	 * (`crossSessionVisibilityRestampNote`), the same reason one note over: it is
	 * this side's statement of what moved and what did not - both trees, no frame
	 * - and a fold resolved from main's copy would drop it. Registered here with
	 * the fold that carried quick-send's entry in, so the next one cannot drop
	 * either silently.
	 */
	"crossSessionVisibilityRestampNote",
	/*
	 * AND THE HEAD-CUT CONDENSATION PASS'S OWN (2026-09-29):
	 * `headCutCondensationRestampNote` is the re-stamp for the operator report
	 * that a completed turn whose opening message is a few fetched pages up
	 * renders raw instead of condensing, kept through its round-1
	 * remediation (the announcement scoped to settles, the focus comment
	 * corrected). Both trees move (the end-loaded rule,
	 * the head-independent run key, the focus hold and the settle announcement
	 * in `src/`; the two suites and this registration in `scripts/`), no swept
	 * frame was taken (the stills are the PR's own evidence branch), and the
	 * reader is owed the reason no still was.
	 */
	"headCutCondensationRestampNote",
	/*
	 * AND THE UPDATE DRAIN'S OWN (2026-09-29): `updateDrainIdleSwitchRestampNote`
	 * is the record for the update drain → idle-switch change - the operator's
	 * directive removed the fleet-drain gate from the two RESTART legs, the
	 * rebuild route's install leg keeps it, and the completion now carries the
	 * count of sessions still on the old build. It moves BOTH trees and re-shoots
	 * nothing (the frames this state is owed are the design round's), so the pair
	 * is re-derived from the tree the re-stamp commit ships and every list member
	 * above is re-pointed with it. The fold onto the stamp-discipline train (#566) spells the note's pair bare: the
	 * convention that held new notes to the pair is retired.
	 */
	"updateDrainIdleSwitchRestampNote",
	/*
	 * AND THE SAME PASS'S ROUND-1 REMEDIATION (2026-09-29): the round fixed the
	 * evidence pipeline rather than the pixels - the S6 claim's capital (design
	 * D1), the count's docblock and its refresh from the final read (agent review
	 * m2), the refusal fixture's command (UX U1) and the app-owned managed offer's
	 * own story (UX U2) - so both trees move once more and the pair is re-derived
	 * from the tree this commit ships, every member above re-pointed with it. The fold onto the stamp-discipline train (#566) spells the note's pair bare: the
	 * convention that held new notes to the pair is retired.
	 */
	"updateDrainRemediationRestampNote",
	/*
	 * AND THIS FOLD'S OWN (2026-09-29): `updateDrainFoldNote` is the fold onto the
	 * moved `origin/main` `036e501fdf` (#638's hide-cross-session-transcript merge
	 * over the release train) - both evidence files conflicted, both were resolved
	 * as unions with no key dropped from either side, and both stamps re-derived
	 * from the MERGED tree by the docs-only amendment under the merge. The fold onto the stamp-discipline train (#566) spells the note's pair bare: the
	 * convention that held new notes to the pair is retired.
	 */
	"updateDrainFoldNote",
	/*
	 * AND THE DESIGN ROUND'S FRAMES, COMMITTED (2026-09-29): `updateDrainFramesNote` is
	 * the record for the frames the pass was owed - the four completion states, the two
	 * re-shoots, the app-owned managed offer, the two refusal fixtures' frames and the
	 * two before halves at `a0cdaa759f`. This commit also moves the scripts tree with
	 * this registration itself, so both stamps are re-derived from this commit's tree
	 * by the docs-only amendment that follows, and the note's pair is spelled bare by the fold onto the stamp-discipline train
	 * (#566), which retires the convention that held new notes to the pair.
	 */
	"updateDrainFramesNote",
	/*
	 * AND THE SECOND FOLD'S OWN (2026-09-29): `updateDrainFoldTwoNote` is the fold onto
	 * the moved `origin/main` `7461d814ae` (#651's condense-unloaded merge, over this
	 * branch's fold base `036e501fdf`) - both evidence files conflicted, both resolved as
	 * unions with no key dropped, and both stamps re-derived from the MERGED tree by the
	 * docs-only amendment under the merge. The fold onto the stamp-discipline train (#566) spells the note's pair bare: the
	 * convention that held new notes to the pair is retired.
	 */
	"updateDrainFoldTwoNote",
	/*
	 * Grown by the monitors read-out pass (2026-09-29), this branch's newest
	 * top-level record: it states what the pass ADDED (sixteen frames over two
	 * surfaces - six `Chat/Run panel` monitor states and two `Chat/Composer
	 * status row` chip states) and what it did not (no live-app set yet, and
	 * why), and it is the record that makes the new frames' provenance
	 * readable without walking the manifest's partialCapture block. It spells
	 * its identity as bare SHAs, so it adds no name to the quoting ledger.
	 */
	"monitorsPass",
	/*
	 * AND THE SIDEBAR BOUND'S OWN (2026-09-29): `sidebarLoadMoreFoldNote`, `sidebarLoadMoreFoldTwoNote`,
	 * `sidebarLoadMoreFoldThreeNote`, `sidebarLoadMoreFoldFourNote`,
	 * `sidebarLoadMoreFoldFiveNote`, `sidebarLoadMoreFoldSixNote`,
	 * `sidebarLoadMoreFoldSevenNote`, `sidebarLoadMoreFoldEightNote`,
	 * `sidebarLoadMoreFoldNineNote` and `sidebarLoadMoreFoldTenNote` are the
	 * folds `feat/sidebar-load-more` made while open - the second folded a #557
	 * that had already folded itself onto the same base as the first, the third
	 * folded #655's closed-dispose train, the fourth the 0.31.22 release over
	 * #554's condensed-group images, the fifth #560's install-provisioning
	 * resilience over the settings-rail fold train, the sixth the landing
	 * fold (#699's board time window over the #698/#695/#662/#700 trains, this
	 * branch's fold to mergeable), the seventh #697's pinned-order drag,
	 * which landed minutes later, the eighth #702's loader walk, the ninth
	 * #701's row context menu, and the tenth #594's scroll anchor. The notes name each manifest resolution and
	 * re-derivation, including the one semantic conflict (both lanes fixing the
	 * collapsed-section gap in parallel, resolved to one tested mechanism).
	 * Registered here because a fold resolved by a resolver starting from main's
	 * copy is where they would drop uncaught.
	 */
	"sidebarLoadMoreFoldNote",
	"sidebarLoadMoreFoldTwoNote",
	"sidebarLoadMoreFoldThreeNote",
	"sidebarLoadMoreFoldFourNote",
	"sidebarLoadMoreFoldFiveNote",
	"sidebarLoadMoreFoldSixNote",
	"sidebarLoadMoreFoldSevenNote",
	"sidebarLoadMoreFoldEightNote",
	"sidebarLoadMoreFoldNineNote",
	"sidebarLoadMoreFoldTenNote",
	/*
	 * Grown by the monitors CONTROLS pass (2026-09-29, slice 4b-ui B), this
	 * branch's newest top-level record and the sibling of the entry above: it
	 * states what the pass ADDED (four cancel-affordance surfaces, eight
	 * frames) and RE-SHOT (the six at-rest states, twelve frames - the footer
	 * sentence's retirement and the reserved action column move every one of
	 * them), the two narrowed commands, the before half (the base commit's own
	 * frames), and the one cost the frames carry rather than hide (the first
	 * line's earlier truncation). It spells its identity as bare SHAs, so it
	 * adds no name to the quoting ledger - the rule the two entries beside it
	 * follow.
	 */
	"monitorsControlsPass",
	/*
	 * And the fold record of that pass's rebase onto `origin/main` = `0738fa7eb3`,
	 * listed for the list's own reason: a fold resolved from main's manifest copy
	 * would drop the only statement of how the two conflicting paths (this
	 * manifest and `package.json`'s test list) were resolved key by key, and of
	 * which capture's head/capturedAt the merged block keeps. It quotes no
	 * tree-hash pair, so `BRANCH_RECORDS` is where it belongs.
	 *
	 * RE-KEYED in the fold onto `a7b4f88a18`: main's copy already ships a note
	 * under the plain name (the settings-rail lane's fold onto the same tip),
	 * so this branch's record moved to `foldOnto0738fa7eb3MonitorControlsNote` -
	 * the name this entry now carries.
	 */
	"foldOnto0738fa7eb3MonitorControlsNote",
	/*
	 * And the round-1 remediation's own record (agent review round 1's F1;
	 * UX review round 1's U2-U8): the confirmation's busy window, the
	 * interaction moved into the pane body so a refusal survives the
	 * re-read's list churn, the narrowed retry boundary, the two row records
	 * (`Cancelled`, `Cancel refused`), the at-rest 24px control and the
	 * `Stop monitor` confirm. It is listed for the list's own reason: a fold
	 * resolved from main's manifest copy would drop the only statement of
	 * the two runs that re-took twenty-four frames, of the two new surfaces
	 * and the ten re-shot states, and of why the marks exist at all. It
	 * quotes no tree-hash pair - the re-stamp is written in the `docs/`-only
	 * amendment after the content commit (the `roundOneRemediationRestampNote`
	 * convention) - so `BRANCH_RECORDS` is where it belongs.
	 */
	"monitorsControlsRound1Remediation",
	/*
	 * And the DESIGN round's own record (design review round 1's D1-D5): the facts
	 * line rebuilt as yieldable boxes so the 320px floor cannot run text under the
	 * action column, the `ink-dim` receipt, the `Stopping…` busy label, the pinned
	 * confirmation width, and the corrected comment. It is listed for the list's
	 * own reason: a fold resolved from main's manifest copy would drop the only
	 * statement of the two narrowed runs, of the one new surface and the twelve
	 * re-shot states, and of why the yield order exists at all. It quotes no
	 * tree-hash pair, so `BRANCH_RECORDS` is where it belongs.
	 */
	"monitorsControlsDesignRound1",
	/*
	 * AND THE CONDENSED GROUP'S PICTURES PASS'S OWN (`feat/condensed-group-images`,
	 * the operator report that a collapsed action group must still show what its
	 * run produced): the two records of the pass that drew the strip under a
	 * condensed group's header and of its round-1 remediation, and this branch's
	 * fold record from the fold onto `origin/main` `0ab50df2a8` (the transcript
	 * rail rework over #645's monitor renders). Their notes spell their identity
	 * as bare tree SHAs, so none of them adds a name to the quoting ledger, and
	 * they are listed for the list's usual reason - a fold resolved from main's
	 * copy would drop the only statements of what each pass and fold moved. (The
	 * retired `STAMP_BINDING_NOTES` registrations that carried the first two on
	 * this branch's pre-#566 copies are gone with that list; these are what
	 * `BRANCH_RECORDS` holds instead.)
	 */
	"condensedGroupMediaNote",
	"condensedGroupMediaRoundOneNote",
	"condensedGroupMediaFoldNote",
	/*
	 * And the SAME LANE'S SECOND LEVEL (`condensedTurnMediaNote`): the pass
	 * that keeps a folded span's pictures under the condensed BAR, with its
	 * three new `chat-turn-collapse--images*` cells and its declared
	 * `chat-turn-collapse-images-before` half. Registered for the list's usual
	 * reason - a fold resolved from main's copy would drop the only statement
	 * of what the pass moved and of the two trees' difference the pair
	 * measures - and its note spells its identity as bare SHAs, so it adds no
	 * name to the quoting ledger.
	 */
	"condensedTurnMediaNote",
	/*
	 * And the re-stamp that lands the pair over the frames tip, registered with
	 * it for the same reason: a fold resolved from main's copy would drop the
	 * statement that the walk at `3723d39830` is this file's own derivation.
	 */
	"condensedTurnMediaRestampNote",
	"condensedGroupMediaFoldTwoNote",
	"condensedPicturesRoundOneRemediationNote",
	/*
	 * The round-2 mini-pass (F1/F2, U8/U9) re-shot the count control's cells and
	 * added the press cell its own note names. Registered for the list's usual
	 * reason: a fold resolved from main's copy would drop the only statement of
	 * what the pass moved and of the uncap's one-press claim the new cell
	 * photographs.
	 */
	"condensedPicturesRoundTwoRemediationNote",
	/*
	 * And the pictures lane's fold onto the 0.31.21 release window
	 * (`condensedPicturesFoldNote`): this file and the list above were the
	 * fold's only conflicts, both resolved with main's records whole and
	 * this branch's re-laid. Registered for the list's usual reason - a
	 * fold resolved from main's copy would drop the only statement of what
	 * the fold moved and what it did not - and it quotes no tree-hash pair.
	 */
	"condensedPicturesFoldNote",
	/*
	 * And the lane's SECOND fold (`condensedPicturesFoldNote`'s pair), onto the bundled-CPython runtime
	 * (#568): this file was its one conflict, resolved with main's records whole and this branch's
	 * re-laid. Registered for the list's usual reason, and it quotes no tree-hash pair.
	 */
	"condensedPicturesFoldTwoNote",
	/*
	 * And the lane's THIRD fold, onto the rail's end-tick fix (#666): this file was its one
	 * conflict, and it quotes no tree-hash pair.
	 */
	"condensedPicturesFoldThreeNote",
	/*
	 * And the lane's FOURTH fold, onto the settings-rail edge fix (#609): this file was its
	 * one conflict, and it quotes no tree-hash pair.
	 */
	"condensedPicturesFoldFourNote",
	/*
	 * And the lane's FIFTH fold, onto the closed-dispose/ben-trio train: this file was its one
	 * conflict, and it quotes no tree-hash pair.
	 */
	"condensedPicturesFoldFiveNote",
	/*
	 * And the lane's CONVERGENCE fold (`condensedPicturesFoldSixNote`), onto the condense-bar
	 * spacing sibling (#653): three paths conflicted - this record, the transcript's entry union
	 * and the behaviour suite's helpers - all resolved as unions, and it quotes no tree-hash pair.
	 */
	"condensedPicturesFoldSixNote",
	/*
	 * And this lane's own - the scroll-shift fix's record (the reserved foot row,
	 * the fold's open state and the standing reader-hold) and the note for its
	 * latest fold here (`78b9c84c8f`), registered for the same completeness
	 * reason: a fold that started from main's copy would drop them first. Both
	 * spell their identity as bare SHAs, so they add no name to the quoting
	 * ledger.
	 */
	"foldOnto78b9c84c8fNote",
	"scrollShiftRestampNote",
	/*
	 * And the fold onto `efca9e16fc` (#696's update/reload drain and #699's
	 * board time-window over the loader-continuity train): registered for the
	 * list's own reason - a fold resolved from main's manifest copy would drop
	 * the only statement of how the two conflicted paths (this file and
	 * package.json's test list) were resolved, and of the pair and lead being
	 * re-derived over the folded tree. It quotes no tree-hash pair.
	 */
	"foldOntoefca9e16fcNote",
	/*
	 * And the fold onto `e78e4395eb` (the loader-walk lane: `mayAutoWalk`,
	 * `MAX_ACT_ASKS` and its paging cases): registered for the list's own
	 * reason - a fold resolved from main's copy would drop how the two
	 * conflicted paths (this file and the paging test's four-symbol header)
	 * were resolved and the pair re-derived over the folded tree.
	 */
	"foldOntoe78e4395ebNote",
	/*
	 * And the fold onto `34ac02d33c` (#701's row-context menu): registered for
	 * the list's own reason - a fold resolved from main's copy would drop how
	 * the two conflicted paths (this file and package.json's test list) were
	 * resolved and the pair re-derived over the folded tree.
	 */
	"foldOnto34ac02d33Note",
	/*
	 * AND THIS FIX'S OWN (2026-09-29): `browserOauthPopupsRestampNote` is the
	 * re-stamp for the driven-page OAuth popups (the operator's console Microsoft
	 * sign-in repro - MSAL `loginPopup` denied by the driven views' deny-all
	 * `setWindowOpenHandler`), folded onto a seven-times-moving main as it landed
	 * (the thread-search overlay, the README-visuals remediation, the sidebar-ack
	 * fix, the hide-cross-session-transcript filter, the head-cut condensation
	 * pass, the evidence-stamp-discipline pass, then the monitor-ui-render pass),
	 * with the two tree fields re-derived over each folded tree - and, under the
	 * discipline the sixth of those passes landed, no note binding itself to them
	 * any more.
	 * Both trees move - `src/` for the popup policy, its presentation gate and the
	 * renderer/preload deletions, `scripts/` for the proof rewrite, the policy
	 * matrix and the trigger/guard cases - and no swept frame was taken by the
	 * change itself: its evidence is a new set of PNG frames and run transcripts
	 * that no supplementary set declares (`docs/evidence/browser-oauth-popups/`),
	 * plus one app-chrome WebP added in round 1's D2
	 * (`band-without-notice/localOperatorDark.webp`, which is why the counts are
	 * re-derived with the folds), so the reader is owed the pair this file
	 * ships and the reason no still was. It quotes no tree-hash pair (read the
	 * pair off the two top-level fields), so it joins `BRANCH_RECORDS` and not
	 * the legacy-quoter ledger (`LEGACY_STAMP_QUOTING_NOTES`).
	 */
	"browserOauthPopupsRestampNote",
	/*
	 * And the fold onto `origin/main` = `7ba0ddce94` (the 0.31.21 release window: the
	 * bump itself, the browser-OAuth-popups lane and the desktop-tests diagnostics),
	 * listed for the list's own reason: the fold resolved two evidence files by hand
	 * (this file's register and the manifest), and a later fold started from main's
	 * copy would drop the record of that resolution. It quotes no tree-hash pair -
	 * the pair is re-derived over the staged tree in the fold commit itself - so
	 * `BRANCH_RECORDS` is where it belongs.
	 *
	 * RE-KEYED in the fold onto `a7b4f88a18` for the same collision as its sibling
	 * above: main's copy ships a note under the plain name, so this branch's
	 * record moved to `foldOnto7ba0ddce94MonitorControlsNote`.
	 */
	"foldOnto7ba0ddce94MonitorControlsNote",
	/*
	 * And THIS round's own (2026-09-29 recovery): the identity panel's pass
	 * record, `identityMenuPass`, and this lane's three fold notes. The pass
	 * record was never listed while the lane lived on its own branch - this
	 * list's promise was one record short of true for it - and the fold notes
	 * are the only statements of what each fold resolved; a fold resolved from
	 * main's copy would drop them without a word, which is this list's whole
	 * subject. The two notes this lane first wrote under plain fold names are
	 * re-keyed with the `Identity` suffix because main's copy already ships
	 * notes under both old names (the settings-rail lane's folds onto the same
	 * tips - the same collision that lane re-keyed its own `A8ac7f673c` record
	 * for). All four spell their identity as bare SHAs, so none adds a name to
	 * the quoting ledger.
	 */
	"identityMenuPass",
	"foldOnto7ba0ddce94IdentityNote",
	"foldOnto6f284060IdentityNote",
	"foldOnto65a3e97b8cIdentityNote",
	"foldOnto29a9aa985cIdentityNote",
	"foldOnto32c7bc34c9IdentityNote",
	/*
	 * AND THIS LANE'S OWN: the bundled-interpreter refresh. `python314RefreshRestampNote`
	 * is the pass that takes the bundled CPython from 3.12.14 to 3.14.7;
	 * `python314RefreshFoldNote` and `python314RefreshSecondFoldNote` are its folds
	 * onto the moved `origin/main` (`eca30754b7`, `865da9ce78`), and the fold onto
	 * `0738fa7eb3` re-registered all three here as the retired `STAMP_BINDING_NOTES`
	 * registrations came into this list. Listed for the reason this list exists: a
	 * fold resolved from main's copy would drop them first, and nothing else would
	 * say so. The notes spell their pair as bare SHAs, so no name is added to the
	 * quoting ledger above.
	 */
	"python314RefreshRestampNote",
	"python314RefreshFoldNote",
	"python314RefreshSecondFoldNote",
	/*
	 * And the fold onto `origin/main` = `f9dbf8b455` (the rail-bottom-active lane
	 * riding the bundled-interpreter refresh), listed for the list's own reason:
	 * the fold resolved two evidence files by hand and had to prove the merged
	 * changes paint no monitor surface (the rail is canonical-transcript-only and
	 * the stories draw `TranscriptGround`). A later fold started from main's copy
	 * would drop the only record of that resolution. It quotes no tree-hash pair -
	 * the pair is re-derived over the staged tree in the fold commit itself - so
	 * `BRANCH_RECORDS` is where it belongs.
	 */
	"foldOntof9dbf8b455Note",
	/*
	 * And by the SETTINGS-RAIL lane's folds onto `origin/main` = `0738fa7eb3`,
	 * `49491865ca`, `7ba0ddce94` and `f9dbf8b455` (2026-09-29): that pass re-laid its records
	 * onto this file - its ground restamp note and its fold records, one
	 * re-keyed to `foldOntoA8ac7f673cSettingsRailNote` because main's copy
	 * already ships notes under both of its old names - and wrote a note per
	 * fold. They are listed for the reason this list exists: a fold that
	 * started from main's copy would drop them first, and with them the only
	 * statements of which trees each pass moved.
	 */
	"settingsRailGroundRestampNote",
	"foldOnto8320e52366SettingsRailNote",
	"foldOntoE2394f9ff1Note",
	"foldOntoA8ac7f673cSettingsRailNote",
	"foldOnto0738fa7eb3Note",
	"foldOnto49491865caNote",
	"foldOnto7ba0ddce94Note",
	"foldOnto6f284060Note",
	/*
	 * AND THE CONDENSED BAR'S SPACING PASS'S OWN (operator report, 2026-09-29):
	 * `condensedBarRestampNote` is the pass that lands the row under a collapsed
	 * bar on the item step and the bar's chevron on the rule's end, over the
	 * re-shot `chat-turn-collapse` cells and the report's own before/after pair;
	 * `condensedBarFoldNote`, `condensedBarFoldTwoNote`,
	 * `condensedBarFoldThreeNote` and `condensedBarFoldFourNote` are its folds
	 * onto the moved `origin/main` (`682f531120`, `9357d37a9f`, `036e501fdf`,
	 * `f9053eaca5`), and `condensedBarHoverGroundNote` is design round 1's D1 fix
	 * (the hover ground reaching the rule's end) with its re-shot hover cells.
	 * They are listed for the list's usual reason - a fold resolved from main's
	 * copy would drop them first, and nothing else would say so. The notes'
	 * texts are written by the docs-only amendment this registration rides
	 * beside; they spell their pairs as bare SHAs, per the rule the stamp
	 * ledger above states.
	 */
	"condensedBarRestampNote",
	"condensedBarFoldNote",
	"condensedBarFoldTwoNote",
	"condensedBarFoldThreeNote",
	"condensedBarFoldFourNote",
	"condensedBarHoverGroundNote",
	/*
	 * And this fold's own record (`condensedBarFoldFiveNote`), for the same
	 * reason one entry up: its text is written by the docs-only amendment this
	 * registration rides beside.
	 */
	"condensedBarFoldFiveNote",
	/*
	 * And this fold's own record (`condensedBarFoldSixNote`), for the same reason
	 * one entry up: its text is written by the docs-only amendment this
	 * registration rides beside.
	 */
	"condensedBarFoldSixNote",
	/*
	 * And this fold's own record (`condensedBarFoldSevenNote`), for the same reason
	 * one entry up: its text is written by the docs-only amendment this
	 * registration rides beside.
	 */
	"condensedBarFoldSevenNote",
	/*
	 * And the second round's own record (`condensedBarRoundTwoNote`), the note
	 * the spacing pass wrote for the operator's follow-up report: the rule's two
	 * sides, the chevron's leading-edge datum and the incident row. Its text is
	 * written by the docs-only amendment this registration rides beside.
	 */
	"condensedBarRoundTwoNote",
	/*
	 * And this fold's own record (`condensedBarFoldEightNote`), for the same
	 * reason one entry up: its text is written by the docs-only amendment this
	 * registration rides beside.
	 */
	"condensedBarFoldEightNote",
	/*
	 * And this fold's own record (`condensedBarFoldNineNote`), for the same
	 * reason one entry up: its text is written by the docs-only amendment this
	 * registration rides beside.
	 */
	"condensedBarFoldNineNote",
	/*
	 * And this fold's own record (`condensedBarFoldTenNote`), for the same
	 * reason one entry up: its text is written by the docs-only amendment this
	 * registration rides beside.
	 */
	"condensedBarFoldTenNote",
	/*
	 * And this fold's own record (`condensedBarFoldElevenNote`), for the same
	 * reason one entry up: its text is written by the docs-only amendment this
	 * registration rides beside.
	 */
	"condensedBarFoldElevenNote",
	/*
	 * AND THIS PASS'S OWN (`installProvisioningRestampNote`), re-laid by this fold
	 * (origin/main `0738fa7eb3` over this branch's `1e4653b7ea`): its subject IS the
	 * binding this file once held - the install path is not something the evidence
	 * sweep renders, so it moved BOTH trees without
	 * taking a frame, and the reader is owed the reason no still was owed. It is REPAIRED
	 * in the same commit to name the SHAs its pass read rather than the tree pair, which
	 * is the shape this file now enforces. `src/` moved for the install decision and the
	 * scripts' environment build; `scripts/` for the suites that pin them.
	 */
	"installProvisioningRestampNote",
	/*
	 * And the agent-review remediation's own record rides beside it
	 * (`installProvisioningRemediationRestampNote`): the round moved both trees with no
	 * frame - the launcher probe and its verdict cache, the failure-cause split, the three
	 * scripts' TLS notes, and the suites that pin them - so a fold that started from
	 * main's copy would drop the only statement of that.
	 */
	"installProvisioningRemediationRestampNote",
	/*
	 * And THIS fold's own, beside them (`foldOnto0738fa7eb3InstallProvisioningNote`, re-keyed at the fifth fold - main already ships a note under the old name): the merge onto
	 * `origin/main` `0738fa7eb3` resolved both evidence files as unions and re-derived the
	 * stamps from the merged tree; it is registered for the list's usual reason - a fold
	 * that started from main's copy would drop it first.
	 */
	"foldOnto0738fa7eb3InstallProvisioningNote",
	/*
	 * And the SECOND fold's own, beside them (`foldOnto49491865caInstallProvisioningNote`, re-keyed at the fifth fold - main already ships a note under the old name): main moved six
	 * commits (the desktop-tests diagnostics train, #557) while the first fold was being
	 * verified, this file conflicted alone, and a conflicting head produces no
	 * pull-request runs - so the fold is repeated, and its record is registered for the
	 * list's usual reason.
	 */
	"foldOnto49491865caInstallProvisioningNote",
	/*
	 * And the THIRD fold's own, beside them (`foldOnto6f28406010Note`): main moved again -
	 * the v0.31.21 release, #652's driven-page OAuth popups and #568's CPython 3.14
	 * bundle - while this branch was being reviewed; the two evidence files conflicted
	 * alone, resolved as unions the same way, and the test file merged additively.
	 * Registered for the list's usual reason.
	 */
	"foldOnto6f28406010Note",
	/*
	 * And the FOURTH fold's own, beside them (`foldOntoF9dbf8b455Note`): main moved once more -
	 * the rail-bottom-active fix (#666) - while the merge was gated on this fold; the two
	 * evidence files resolved the same way, this branch's registrations standing as merged
	 * because main did not touch this list in between.
	 * Registered for the list's usual reason.
	 */
	"foldOntoF9dbf8b455Note",
	/*
	 * And the FIFTH fold's own, beside them (`foldOntoA7b4f88a18Note`): main moved once more -
	 * the settings-rail-edge fix (#609) - and this fold resolved both evidence files as
	 * unions, re-keying this lane's two collided fold records as it re-laid them. Registered
	 * for the list's usual reason: a fold that started from main's copy would drop it first.
	 */
	"foldOntoA7b4f88a18Note",
	/*
	 * And the SIXTH fold's own, beside them (`foldOnto65a3e97b8cNote`): main moved through
	 * #554's condensed group images and the #653/#655/#668 trains while the session was
	 * disposed; both evidence files conflicted, no name collided, and the resolution is the
	 * usual union. Registered for the list's usual reason: a fold that started from main's
	 * copy would drop it first.
	 */

	"foldOnto65a3e97b8cNote",
	/*
	 * And this branch's own folds' records beside them - `foldOntoa7b4f88a18Note`
	 * (the name-collision fold), `foldOnto891ad1e983Note`, and the six latest,
	 * `foldOnto65a3e97b8cMonitorControlsNote` (RE-KEYED at its fold: main's own
	 * lane folded the same tip and ships a note under the shared name),
	 * `foldOnto29a9aa985cNote`, `foldOnto32c7bc34c9Note` (registered now; it
	 * shipped unlisted and the convergence review caught it), and
	 * `foldOnto8ff4dd8a9bNote` - listed for the list's own reason: each resolved
	 * two evidence files by hand, and a fold resolved from main's copy would drop
	 * the lot. The notes quote no tree-hash pair (the pairs are re-derived over
	 * the staged tree in each fold commit), so `BRANCH_RECORDS` is where they
	 * belong.
	 */
	"foldOntoa7b4f88a18Note",
	"foldOnto891ad1e983Note",
	"foldOnto65a3e97b8cMonitorControlsNote",
	"foldOnto29a9aa985cNote",
	"foldOnto32c7bc34c9Note",
	"foldOnto8ff4dd8a9bNote",
	"foldOntocef1c9c535Note",
	"foldOnto4703067935Note",
	/*
	 * And this LANE's newest top-level record: the setup window's rail states the
	 * pair the file ships and the surface it re-shot, so a fold resolved from
	 * main's copy would drop it first - the reason this list exists.
	 */
	"installerPanelRailNote",
	/*
	 * And the pass under it: the round-1 remediation of the same rail, which
	 * re-shot the surface whole and is the record a fold resolved from main's
	 * copy would drop first, for the same reason.
	 */
	"installerPanelRailRemediationNote",
	/*
	 * And this LANE'S newest: the round-2 remediation, which fixed the working
	 * ring's token, re-shot the surface whole again, and added the motion pair
	 * the turn had no frame of. It states the trees the pass read as bare SHAs,
	 * so it adds no name to the quoting ledger.
	 */
	"installerPanelRailRoundTwoNote",
	/*
	 * And by THIS branch, whose records the merge of `origin/main` = `340cfc7f88` had to keep: its
	 * own fold records (the first fold's, kept whole; the two whose SHA-named keys main's own lanes
	 * had already coined, renamed with this branch's `MeasureDrag` suffix - main's kept the plain
	 * names, both records coexisting; and the fold this commit's own merge writes). A fold that
	 * resolved this file from main's copy would drop them first, which is the failure this list
	 * exists to make loud.
	 */
	"foldOnto29a9aa985cMeasureDragNote",
	"foldOnto340cfc7f88Note",
	"foldOnto4703067935MeasureDragNote",
	"foldOnto49491865caMeasureDragNote",
	"foldOnto5ba0d0dc8aMeasureDragNote",
	"foldOnto65a3e97b8cMeasureDragNote",
	"foldOnto6f28406010MeasureDragNote",
	"foldOnto8a03152c61MeasureDragNote",
	"foldOnto8ff4dd8a9bMeasureDragNote",
	"foldOntoa7b4f88a18MeasureDragNote",
	"foldOntocef1c9c535MeasureDragNote",
	"foldOntoe2394f9ff1Note",
	"foldOntof9dbf8b455MeasureDragNote",
	/*
	 * And THIS branch's re-keyed fold record (`foldOnto0738fa7eb3RestoreBoundaryNote`, re-keyed at the
	 * fold onto `65a3e97b8c` because main already ships a note under the bare name, and registered here
	 * per agent review round 4, F-r4-2): it states this lane's own reading of that fold, the fold that
	 * re-laid it kept it byte-exact, and a fold that started from main's copy would drop it first -
	 * the list's usual reason.
	 */
	"foldOnto0738fa7eb3RestoreBoundaryNote",
	/*
	 * And THIS branch's own product record (`browserRestoreBoundaryPass`), written by the restore-boundary
	 * pass: it carries the before/after runs' readings and the stamps' provenance, so a fold that started
	 * from main's copy would drop it first - the list's usual reason (agent review round 5, Q-3).
	 */
	"browserRestoreBoundaryPass",
	/*
	 * And this branch's first fold's own record (`foldOnto48b4b90b66Note`): the merge onto
	 * `origin/main` = `48b4b90b66` resolved this file and states what moved and what did not,
	 * registered beside the others for the list's usual reason (agent review round 5, Q-3).
	 */
	"foldOnto48b4b90b66Note",
	/*
	 * And ROUND 2'S own, beside the focus return's records: the re-stamp U8's
	 * move of `src/` (the pointer close's capture-and-restore) and the suite's
	 * pins in `scripts/` forced. Registered for the list's usual reason - a fold
	 * resolved from main's copy would drop it.
	 */
	"rowMenuRoundTwoRestampNote",
	/*
	 * And ROUND 3'S own, beside it: the re-stamp QA round 3's Q-1 fix forced by
	 * moving `src/` (the capture-phase read) and the suite's pins in `scripts/`.
	 * Registered for the list's usual reason - a fold resolved from main's copy
	 * would drop it.
	 */
	"rowMenuRoundThreeRestampNote",
	/*
	 * And the FOLD RECORDS the round-2 folds wrote but left unregistered (their
	 * passes added the records to the manifest without adding the list entries;
	 * closed here with the round-3 fold's own). Same reason as every entry - a
	 * fold resolved from main's copy would drop them.
	 */
	"foldOnto8712e8684cNote",
	"foldOnto2e866d5d49Note",
	/*
	 * And THIS round-3 fold's own, alongside them.
	 */
	"foldOntoefca9e16fcNote",
	/*
	 * And THE #697 FOLD'S, whose semantic resolution (the hold extended to the
	 * strip controls #697 adds) makes it a record worth keeping across a fold -
	 * same reason as every entry.
	 */
	"foldOnto50b9daf8feNote",
	/*
	 * And the fold's own re-shoot record, beside it (same reason).
	 */
	"pinnedStripReshootNote",
	/*
	 * And THE #702 FOLD'S - the fourth fold's record (same reason).
	 */
	"foldOnte78e4395ebNote",
	/*
	 * And the trace-sessions lane's own record: the desk half of the sessions
	 * glyph/label mapping (sibling `damianvtran/local-operator` #1825), whose
	 * two new frames and its declared `sessions-ops-baseline/` set are exactly
	 * what a fold resolved from main's copy would drop first - the list's
	 * usual reason.
	 */
	"traceSessionsGlyphRestampNote",
	/*
	 * And the lane's fold onto `742a3a1e94` (#569's sidebar load-more), the
	 * record a later fold resolved from main's copy would drop first - same
	 * reason.
	 */
	"foldOnto742a3a1e94Note",
	/*
	 * And the second fold, onto `ee0e1f01e8` (#688's drain lane), for the same
	 * reason again: main moved under the reviewed head a second time.
	 */
	"foldOntoee0e1f01e8Note",
	/*
	 * And the third fold, onto `bbffb9a8a9` (#681's agent-hub revamp) - the
	 * same reason a third time, which is exactly what this list is for.
	 */
	"foldOntobbffb9a8a9Note",
	/*
	 * And the fourth fold, onto `20ccfd4512` (#685's rail-jump anchor over
	 * #682's stt display), the R-4 fold of review round 1 - same reason again.
	 */
	"foldOnto20ccfd4512Note",
	/*
	 * And the fifth fold, onto `fb565e2b8a` (#690's composer cluster) - the
	 * merge prerequisite of round 2, and the same reason once more.
	 */
	"foldOntofb565e2b8aNote",
	/*
	 * Grown by the recording-display pass's convergence fold (2026-09-29): it states what
	 * the fold moved and what it did not, and it spells its identity as bare SHAs, so it
	 * adds no name to the quoting ledger.
	 */
	"sttRecordingDisplayFoldNote",
	/*
	 * Grown by the second convergence fold (2026-09-30): it states what the lift moved and what it did not, and it spells its identity
	 * as bare SHAs, so it adds no name to the quoting ledger.
	 */
	"sttRecordingDisplayFoldTwoNote",
	/*
	 * Grown by the recording-display pass (2026-09-29), this branch's newest
	 * top-level record: it states what the pass ADDED (four frames - the
	 * composer's two recording states, empty field and with draft, in both the
	 * before and the after half) and the two commands that produced the halves,
	 * and it spells its identity as bare SHAs, so it adds no name to the
	 * quoting ledger.
	 */
	"sttRecordingDisplayPass",
	/*
	 * Grown by the third convergence fold (2026-09-30): it states what the fold moved,
	 * what it restored and what it did not, and it spells its identity as bare SHAs, so
	 * it adds no name to the quoting ledger.
	 */
	"sttRecordingDisplayFoldThreeNote",
	"sttRecordingDisplayFoldFourNote",
	"sttRecordingDisplayFoldFiveNote",
	"sttRecordingDisplayFoldSixNote",
	"sttRecordingDisplayFoldSevenNote",
	/*
	 * And by the TEAM LABELS lane (2026-09-30): its re-stamp is the branch's
	 * newest top-level record, holding the two stamps this branch's delta moved
	 * (the whole label read path under `src/` - the new `team-display.ts` and
	 * its readers - and the three source-anchor tests plus three new cases
	 * under `scripts/`). Listed for the reason this list exists: a fold that
	 * started from main's copy would drop it first, and with it the only
	 * statement of what the re-stamp read. The note spells its pair as bare
	 * SHAs, so it adds no name to the quoting ledger.
	 */
	"teamLabelsRestampNote",
	/*
	 * AND THIS BRANCH'S OWN (feat/mesh-canvas-redesign, 2026-09-30): the two records
	 * of the mesh canvas redesign - `meshCanvasRedesignRestampNote` (the pass: the
	 * whole mesh-tab set re-captured at 42 frames through the repo's own sweep, the
	 * pair's derivation and the reason both halves moved) and
	 * `meshCanvasRedesignFoldNote` (the branch's earlier fold onto `b897ebeb93`) -
	 * plus `rebaseOntoA298bfb120Note` (this sync's own record: a rebase rather than
	 * a fold, its two conflicted paths resolved, and the way the manifest's spine
	 * was re-laid). All three spell their identity as bare SHAs, so they add no
	 * name to the quoting ledger.
	 *
	 * GROWN BY THE ROUND-1 REMEDIATION, which re-captured the set WHOLE (50 frames,
	 * 25 states, four added) and wrote this branch's newest top-level record:
	 * `meshCanvasRedesignRemediationNote` names what moved in the pixels, the four
	 * states the findings asked for by name, and why the pair is not restated in
	 * prose. It is listed for the list's usual reason: a fold resolved from main's
	 * copy of the manifest would drop it, and with it the only statement of which
	 * fixes these frames carry. It spells its identity as bare SHAs too, so it adds
	 * no name to the quoting ledger.
	 *
	 * AND EXTENDED BY THE ROUND-2 REMEDIATION, which re-captured the set whole again
	 * (58 frames, 29 states, four added - the shared-opener pair and the three-level
	 * stack), narrowed once to re-take the replaced `scopes-nested` fixture, and
	 * corrected this note's own 34-finding breakdown (24 + 3 + 7, not 29 + 5). Same
	 * key, same list entry: the record grows where it stands rather than growing a
	 * second key a later fold would have to be told about.
	 */
	"meshCanvasRedesignRestampNote",
	"meshCanvasRedesignFoldNote",
	"rebaseOntoA298bfb120Note",
	"meshCanvasRedesignRemediationNote",
	/*
	 * AND THE PROJECTS SEARCH/FILTERS LANE'S OWN FOLD RECORD, added by that
	 * branch's sync onto `origin/main` = `4ea1635904` (#621, the mesh-canvas
	 * redesign). It is listed for the list's usual reason: this fold's
	 * resolution took main's records at the top level and kept this branch's,
	 * and a LATER fold resolved from main's copy of the manifest would drop
	 * this key unless the list names it - the twelfth-fold incident this list
	 * exists for, caught here at the list's own edge rather than by the round
	 * that next reads the note. It spells its identity as bare SHAs, so it
	 * adds no name to the quoting ledger.
	 */
	"foldOnto4ea1635904Note",
	/*
	 * And the lane's second fold record, added the same evening: the sync onto
	 * `origin/main` = `f95910d7bc80` (#722, the fold-media train), which moved main
	 * past `4ea1635904` within the hour and went CONFLICTING while the remediation
	 * round was mid-flight. Registered for the same reason as its sibling above: a
	 * fold resolved from main's copy of the manifest would drop the only statement
	 * of what this branch's second sync did and which tree its counts describe.
	 */
	"foldOntoF95910d7bcNote",
	/*
	 * And the lane's THIRD fold record, written the same evening: the sync onto
	 * `origin/main` = `6154018fdc` (#723 the evidence-record clearing, #721 the
	 * sidebar-badge restyle), which moved main twice more while the remediation
	 * round was in flight. Registered for the same completeness reason as its two
	 * siblings: a fold resolved from main's copy would drop the statement of what
	 * this sync carried - including the clearing pass's revisions of its own
	 * sets' records, which this tree now needs because it carries those sets.
	 */
	"foldOnto6154018fdcNote",
	/*
	 * And the lane's FOURTH fold record, the same evening: the sync onto
	 * `origin/main` = `689efa1eb4` (#667 the hub-update indicators, #730 the
	 * settings-rail colour fix, #713 the scrollbar fade), which moved main twice
	 * more while the round was in flight. Registered for the same completeness
	 * reason as its siblings: a fold resolved from main's copy would drop the
	 * statement of what this sync carried - main's five revised supplementary
	 * records and its re-stamped notes, resolved per `citationConvention`.
	 */
	"foldOnto689efa1eb4Note",
	/*
	 * Grown by the device-chip pass, whose top-level record is the set it ships
	 * (`chatDevicePersistNote`): registered so a later fold unions it back by
	 * name rather than dropping it.
	 */
	"chatDevicePersistNote",
	/*
	 * And by THIS lane too - the pass record's lineage gate: this branch's own
	 * fix, whose note is the branch's newest top-level record. It is listed for
	 * the reason the list exists: it moves `scripts/` only and takes no frame, so a
	 * fold resolved from main's copy would drop it first, and the loss would be
	 * silent - the same class of loss the fix itself is about, one file along. Its
	 * pair is spelled as bare SHAs rather than backticked tokens, so it adds no
	 * name to the quoting ledger.
	 */
	"partialCaptureContinuityRestampNote",
	/*
	 * And the lane's FIFTH fold record, the same evening: the sync onto
	 * `origin/main` = `7b984851a0` (#733 the bounded desktop tests, #725 the
	 * AGENTS in-place/composer note, #719 the send row's delivery states), which
	 * moved main again while CI was still queued on the last head. Registered for
	 * the same completeness reason as its siblings: a fold resolved from main's
	 * copy would drop the statement of what this sync carried - main's three new
	 * records and the package.json union - resolved per `citationConvention`.
	 */
	"foldOnto7b984851a0Note",
	/*
	 * And the lane's SIXTH fold record, the same evening: the sync onto
	 * `origin/main` = `d10b50764d` (#738 the 0.31.27 release window, #732 the
	 * agents-roster navigation), taken while CI was still queued on the previous
	 * head. Registered for the same completeness reason as its siblings: a fold
	 * resolved from main's copy would drop the statement of what this sync
	 * carried - the refreshedStories union and the package.json union - resolved
	 * per `citationConvention`.
	 */
	"foldOntod10b50764dNote",
	/*
	 * And the lane's SEVENTH fold record, the same evening: the sync onto
	 * `origin/main` = `8e73cb8721` (#728 the hub-org-sharing teardown). Its delta
	 * is three files: the manifest resolution, the agent-hub suite's `gcTime` pin
	 * (`22bd23fd9b`, which arrived at that fold and moved `scripts/`), and the
	 * BRANCH_RECORDS registration. (The `15 insertions, 1 deletion` this entry's
	 * first revision attributed to the manifest is that TEST FILE's stat - agent
	 * review R9.) Registered for the same completeness reason as its siblings: a
	 * fold resolved from main's copy would drop the statement of what this sync
	 * carried.
	 */
	"foldOnto8e73cb8721Note",
	/*
	 * And the lane's EIGHTH fold record, the next morning: the sync onto
	 * `origin/main` = `eda575325e` (#736 the turn-partition predicate), taken so a
	 * clean head can run CI. Registered for the same completeness reason as its
	 * siblings: a fold resolved from main's copy would drop the statement of what
	 * this sync carried - main's `runClosureVocabularyRestampNote` and the
	 * package.json union, resolved per `citationConvention`.
	 */
	"foldOntoeda575325eNote",
	/*
	 * AND BY THE FOLD ITSELF, once - which is the list earning its keep. The
	 * vocabulary round's note moves `scripts/` only and takes no frame, and the
	 * fold onto `origin/main` (443ad13c70) took main's manifest whole exactly as
	 * the entry above predicts: the note was gone from the tree and nothing else
	 * noticed. Re-adding it is not enough on its own - the point of naming it here
	 * is that the NEXT fold cannot drop it in silence - so the registration lands
	 * as its own `scripts/` commit, and the docs-only re-stamp that follows derives
	 * the pair from the tree that includes it.
	 */
	"runClosureVocabularyRestampNote",
	/*
	 * And the lane's NINTH fold record: the sync onto `origin/main` =
	 * `e1eb22cd58` (#737 the turn's visible completion), taken so the head is
	 * clean and CI can run. Registered for the same completeness reason as its
	 * siblings: a fold resolved from main's copy would drop the statement of
	 * what this sync carried - main's `turnVisibleRestampNote` and its new
	 * STORIES row, resolved per `citationConvention`.
	 */
	"foldOntoe1eb22cd58Note",
	/*
	 * And the lane's TWELFTH fold record, its first source fold: the sync onto
	 * `origin/main` = `69d088ec52` (#716 the team-labels lane) conflicted in
	 * `project-list.tsx` and `projects-page.tsx`, so the resolution is a union
	 * of BEHAVIOUR (search/sort/filters props AND `teamLabelFor`), recorded in
	 * the note. Registered for the same completeness reason as its siblings: a
	 * fold resolved from main's copy would drop the statement of what this sync
	 * carried - main's `teamLabelsRestampNote` and its two team-identity rows.
	 */
	"foldOnto69d088ec52Note",
	/*
	 * And the lane's THIRTEENTH fold record: the sync onto `origin/main` =
	 * `44e4812b31` (#686 the STT mic gate, #735 the chat device selection),
	 * taken while the UX round's fixes were mid-flight so a clean head can run
	 * CI. Registered for the same completeness reason as its siblings: a fold
	 * resolved from main's copy would drop the statement of what this sync
	 * carried - main's `chatDevicePersistNote` and its `chat-device-persist`
	 * supplementary set, resolved per `citationConvention`.
	 */
	"foldOnto44e4812b31Note",
	/*
	 * And the lane's FOURTEENTH fold record: the sync onto `origin/main` =
	 * `53c5cfec6b` (#714 the speak-aloud pass, over #538's stream-smooth train),
	 * taken when QA found the branch's `test:desktop` back in the pre-#733
	 * `node --test` form. THE RESOLUTION KEEPS MAIN'S FORM: main's harness
	 * prefix and arming, this branch's four test files appended to its list -
	 * the union of a LIST is not the union of its SHAPE. Registered for the
	 * usual reason: a fold from main's copy would drop the eight speak-aloud /
	 * stream-smooth records this sync carried.
	 */
	"foldOnto53c5cfec6bNote",
	/*
	 * And the lane's FIFTEENTH fold record: the sync onto `origin/main` =
	 * `44249a6796` (#726 the provider-suggestions lane), taken before the
	 * final push so the head is clean. Registered for the same reason as its
	 * siblings: a fold resolved from main's copy would drop the statement of
	 * what this sync carried and the `package.json` union shape it resolved -
	 * and, since agent review round 8 (R11), the record's own account of the
	 * key that union read missed (`check-themes`, dropped by this fold and
	 * restored by the remediation commit) so main's copy cannot lose the
	 * correction either.
	 */
	"foldOnto44249a6796Note",
	/*
	 * And the lane's SIXTEENTH fold record: the sync onto `origin/main` =
	 * `26a814c2c2` (#705 the mini-view restyle), taken because the first fold's
	 * push left the PR dirty again when main advanced once more. Registered
	 * for the same reason as its siblings: a fold resolved from main's copy
	 * would drop the statement of what this sync carried and the countsMean
	 * union it resolved.
	 */
	"foldOnto26a814c2c2Note",
	/*
	 * And the lane's SEVENTEENTH fold record: the sync onto `origin/main` =
	 * `b909366d94` (#710 the team-header register). Registered for the same
	 * reason as its siblings, and this one's statement is the load-bearing
	 * kind: the fold is a COMPOSITION - both lanes' source changes on the
	 * projects surface - so a fold resolved from main's copy would drop the
	 * statement of what this sync carried and how the two sides' behaviour
	 * was composed.
	 */
	"foldOntoB909366d94Note",
	/*
	 * And the lane's EIGHTEENTH fold record: the sync onto `origin/main` =
	 * `396fd472f3` (#743 the sidebar archive confirm lane, #751's release-notes
	 * scan over it). The same reason as its siblings again, one level sharper:
	 * this fold's conflict was this file alone and the union it resolved needed
	 * no growth - a fold resolved from main's copy would still drop the record
	 * that says so, and with it the check that the branch's listings were
	 * recomputed against main's rather than assumed to be the superset.
	 */
	"foldOnto396fd472f3Note",
	/*
	 * And the lane's NINETEENTH fold record: the sync onto `origin/main` =
	 * `6f2e9b7838` (#731 the agent-class toggle). The second fold of one push
	 * cycle - main moved while the `396fd472f3` fold was being pushed - and the
	 * one whose `package.json` resolution the round-8 gate exists for: main
	 * lacks this branch's `check-themes` and `check-fold-keys` keys, so a fold
	 * laid from main's copy would drop one again. Registered so the statement
	 * of the union that kept them survives any fold resolved from main.
	 */
	"foldOnto6f2e9b7838Note",
	/*
	 * And the lane's TWENTIETH fold record: the sync onto `origin/main` =
	 * `af6fffa899` (#752 the delta-scoped pre-push gate). Its `package.json`
	 * resolution closes the same class from both directions - main lacks this
	 * branch's `check-themes` (the R11 repair) and `check-fold-keys`, and this
	 * branch lacks main's five new `prepare`/`hooks:*` keys - so a fold laid
	 * from either side's copy alone drops keys the merged tree must carry.
	 * Registered so the statement of the union survives any fold resolved
	 * from main.
	 */
	"foldOntoaf6fffa899Note",
	/*
	 * And the lane's TWENTY-FIRST fold record: the sync onto `origin/main` =
	 * `bc642ccd49` (#757 the row menu's Fork item) - the second fold of one
	 * push cycle, forced when main moved while the previous fold's capture and
	 * gates were still running. Its resolution carries the deep-union class:
	 * `countsMean` chains unioned (main's unique leads appended), the
	 * `refreshedStories` union grown by main's two `fork-*` directories, and
	 * main's `rowForkMenuNote` spliced whole - so a fold resolved from main's
	 * copy would drop this branch's chains, and one resolved from this
	 * branch's alone would drop main's.
	 */
	"foldOntobc642ccd49Note",
	/*
	 * And the lane's TWENTY-SECOND fold record: the sync onto `origin/main` =
	 * `0d4db85a5e` (#745 the live-cycle lane's rendered-evidence re-stamp) -
	 * the second fold of one push cycle again, forced when main moved while the
	 * round-10 review and the D12/D13 corrections were landing. Registered for
	 * its siblings' reason and one of its own: it carries the `countsMean`
	 * union (main's unique leads appended), the `refreshedStories` growth, and
	 * the statement of the fold's ONE REPAIR - the byte-identical duplicate
	 * `rowForkMenuNote` the previous fold's splice left behind, which no
	 * key-SET gate can see - so a fold resolved from either side's copy alone
	 * would drop the record that says what happened to it.
	 */
	"foldOnto0d4db85a5eNote",
	/*
	 * And the lane's TWENTY-THIRD fold record: the sync onto `origin/main` =
	 * `756fb7b190` (#753 the browser read actions) - the THIRD fold of one push
	 * cycle, taken because main moved twice while the earlier folds were being
	 * pushed and a conflicting head starts no checks. Registered for its
	 * siblings' reason: it carries the `test:desktop` list union (main's form,
	 * this branch's four suites appended - 351 entries) and the `check-themes`
	 * key main still lacks, so a fold laid from main's copy alone would drop
	 * one, and from this branch's alone would drop main's
	 * `check-geometry-sources.test.mjs` row.
	 */
	"foldOnto756fb7b190Note",
	/*
	 * And the lane's TWENTY-FOURTH fold record: the sync onto `origin/main` =
	 * `a7a108e972` (#746 the answer-press copy pass) - taken pre-merge because
	 * main moved to that tip while the round-11 remediation was landing, and a
	 * conflicting head starts no checks. Registered for its siblings' reason and
	 * one of its own: it carries main's new `answerNoticeArmsRestampNote` spliced
	 * WHOLE and the `srcTree`/`scriptsTree` pair re-derived from the merged tree,
	 * so a fold laid from main's copy alone would drop this branch's record and
	 * one laid from this branch's alone would drop main's - and its text is also
	 * where the fold states that the three duplicate records round 11 filed
	 * (R11-1) cannot recur here, both sides being single after the de-dup. It
	 * quotes no tree-hash pair (base SHAs only), so it joins this list and not
	 * `STAMP_BINDING_NOTES`.
	 */
	"foldOntoa7a108e972Note",
	/*
	 * And the lane's TWENTY-FIFTH fold record: the sync onto `origin/main` =
	 * `5737a884d5` (#734 the queued-ask lane) - the SECOND fold of one push
	 * cycle, taken because main moved while the first fold was being pushed and
	 * a conflicting head starts no checks. Registered for its siblings' reason:
	 * it carries the `test:desktop` list union (main's form, this branch's four
	 * suites appended - 353 entries) together with this branch's `check-themes`
	 * key main still lacks, so a fold laid from main's copy alone would drop one,
	 * and from this branch's alone would drop main's two ask-rig rows.
	 */
	"foldOnto5737a884d5Note",
	/*
	 * And the lane's TWENTY-SIXTH fold record: the sync onto `origin/main` =
	 * `ed72ef0da4` (#729 the update-rollover lane) - the THIRD fold of one push
	 * cycle, taken because main moved again while the second fold was being
	 * pushed. Registered for its siblings' reason and one of its own: it is the
	 * first fold where main's lane moved the COUNTERS, so its resolution carries
	 * three regions rather than the usual one - the re-derived stamp pair, the
	 * re-derived `frames`/`surfaces`/`countsMean` (with main's unique paragraphs
	 * appended, not substituted), and `refreshedFrames` re-derived to the guard's
	 * floor the `refreshedStories` union raised - plus the `test:desktop` list
	 * union (354 entries) and this branch's `check-themes` key main still lacks.
	 */
	"foldOntoed72ef0da4Note",
	/*
	 * And by the streaming-smoothness change, this branch's newest top-level
	 * record: the note that states which commits moved which trees, that the
	 * in-flight fidelity delta is ACCEPTED on the record (design round 1, D1),
	 * and where the design round's captured pair is carried (D3). It is listed
	 * for the reason the list exists - a fold that started from main's manifest
	 * would drop it without a word.
	 */
	"streamSmoothRestampNote",
	/*
	 * And by the row menu's Fork item (#739), this branch's own newest top-level
	 * record: the note that states the set was re-taken whole (24 frames, the ten
	 * #694 states with the third row drawn plus `fork-withheld` and `fork-pressed`),
	 * that the design record moved with it, and the two facts a re-capturer needs -
	 * the pointer states' story now waits for the rig's pointer before opening the
	 * menu (the modal body's `pointer-events: none` made the old timer a race the
	 * fold lost), and why `dirtyWorkingTree` reads `true`. It quotes no tree-hash
	 * pair (commit SHAs only), so it joins this list and not
	 * `STAMP_BINDING_NOTES`.
	 */
	"rowForkMenuNote",
	/*
	 * And by the transcript display mode's round-1 remediation (PR #775), this
	 * branch's newest top-level record: the note that answers design round 1's
	 * D1-D4 - the cell whose pair CANNOT be identical and the pixel reading that
	 * says so, the live-app set behind the Settings row and the isolation the run
	 * printed, the checked row's new mark, and the layout reading the round
	 * recorded without fixing. It is listed for the reason the list exists: a fold
	 * that started from main's manifest would drop it, and with it the only
	 * statement of which two trees this round moved and which frames it does NOT
	 * claim (the stale `chat-header-cluster/no-approval` siblings among them).
	 */
	"transcriptDisplayModesRoundOneRemediationNote",
	/*
	 * And by this branch's first fold onto a moved `origin/main`, which is the
	 * case the list exists for and the one that just happened: the fold resolved
	 * this file by hand (main's copy whole, this branch's deltas re-laid), and
	 * the record it adds is the only statement of what the fold moved, what it
	 * deliberately did NOT re-take, and why the two refusals of main's arrival - a
	 * renderer file and a re-shot frame - both hold. IT WEARS THE BRANCH'S NAME
	 * BECAUSE THE KEY COLLIDED: the fold onto `7cb678f29bf` arrived with main's
	 * own `foldOnto9d9cd4be63fNote` - another branch's record of the same fold
	 * target - so this branch's record yields the plain name and keeps its text,
	 * which is the rename the list's own doctrine spells out.
	 */
	"[redacted]",
	/*
	 * And by the fold onto `origin/main` = `7cb678f29bf` (#767's session-load
	 * paint with the four lanes under it), this branch's newest record: the note
	 * that states what the arriving diff carried (frames and rigs of its own, and
	 * `canonical-transcript.tsx`'s turn-foot caption), what the resolution did to
	 * the three conflicted files, and why the terminal design and UX rounds'
	 * freshness is a decision rather than a claim.
	 */
	"[redacted]",
	/*
	 * And by the transcript-line pass (#695 / §E3), this branch's six newest
	 * top-level records - the original pass note and the five fold rounds that
	 * followed it. They are listed for the reason the list exists and this branch
	 * is the case that proves it twice over: the fold onto `origin/main` =
	 * `9d9cd4be63` resolved the manifest by taking main's copy as the base and
	 * re-laying these on top, and the NEXT fold onto `237733141d6` then lost
	 * `partialCapture.addedSurfacesNote` from this branch's side - `pnpm
	 * check-fold-keys` named it (agent review round 5, R5-1), which is the same
	 * class these six entries are listed to keep visible. Each rounds note also
	 * states what its own round moved and what it did not re-shoot, which is the
	 * fact a fold that started from main's manifest would take with it. They quote
	 * commit SHAs and never the `srcTree`/`scriptsTree` pair, so they join this
	 * list and not `STAMP_BINDING_NOTES`.
	 */
	"footArrangementAndFoldCapPass",
	"turnFootCaptionFoldRoundOnePass",
	"turnFootCaptionFoldRoundTwoPass",
	"turnFootCaptionFoldRoundThreePass",
	"turnFootCaptionFoldRoundFourPass",
	"turnFootCaptionFoldRoundFiveFoldPass",
	/*
	 * And by the palette's Ctrl+N/P walk and its Unread pin (issues #761/#760,
	 * PR #778), this branch's newest top-level record: the note that states which
	 * two trees the pass moved, the set it added (`palette-keys-unread-761-760`),
	 * and the D1 remediation that re-took one frame of it. It is listed for the
	 * reason the list exists, and this branch supplies a live instance of the
	 * failure: the fold onto `origin/main` = `237733141d6` resolved the manifest
	 * house-way and kept this record by hand ("the supplementary entry, the pass
	 * note and the countsMean paragraph stay this branch's") - a resolver who
	 * took main's copy would have dropped it, and with it the only statement of
	 * the set's existence and the re-taken frame, with this very test staying
	 * green (agent review round 2, MINOR).
	 */
	"paletteKeysUnreadPass",
	/*
	 * And by the composer ArrowDown lane (#764, PR #776), this branch's seven
	 * newest top-level records - the capture pass's fold note and the six fold
	 * rounds that followed it. They are listed for the reason the list exists:
	 * six of the seven folds resolved the manifest by taking main's copy as the
	 * base and re-laying these on top, so a fold that started from main's copy
	 * would drop them first - and with them the only statements of which windows
	 * moved against this set's surfaces and which frame bytes did not. They quote
	 * commit SHAs and never the `srcTree`/`scriptsTree` pair, so they join this
	 * list and not `STAMP_BINDING_NOTES`.
	 */
	"foldOnto9b4822de10Note",
	"foldOnto9d9cd4be63fNote",
	"foldOnto237733141d6Note",
	"foldOntoFef3d5443f1Note",
	"foldOnto83d7d937953Note",
	"foldOnto211d84d668aNote",
	"foldOntoA81de40dd84Note",
	/*
	 * And by the transcript display mode's round-1 DESIGN round (PR #775) - the
	 * record the fold round flagged as unprotected. It is the only statement of
	 * what that round shot (eighteen frames in the two `localOperator` palettes,
	 * the header submenu in both modes and the six `chat-turn-collapse` cells),
	 * of the rig option the mode's pairs need (a per-entry `prefs` seed, because a
	 * display mode is a preference the rendered frame is a function of rather
	 * than a story arg), and of the reading that decided the round - the settled
	 * pairs are byte-identical and only `substance-then-addendum` can differ. It
	 * quotes commit SHAs and never the `srcTree`/`scriptsTree` pair, so it joins
	 * this list and not `STAMP_BINDING_NOTES`.
	 */
	"transcriptDisplayModesDesignRoundOneNote",
	/*
	 * And by this branch's convergence round after the fold onto `7cb678f29bf`:
	 * the re-shoot of the `chat-turn-collapse` set at the folded tip, which
	 * replaces six frames - the three cells whose foot caption #770 moved to the
	 * prose's own rail - and leaves the set's other fifty files at their
	 * committed bytes with the reason measured rather than assumed. It is listed
	 * for the reason the list exists: a fold that started from main's manifest
	 * would drop it, and with it the only statement of which cells the fold's
	 * arrival actually moved, and of the two facts a re-capturer needs (the bar's
	 * `Took` clause changed semantics on 2026-09-30 without those frames being
	 * re-taken, and every stamp prints the capture host's own zone). It quotes
	 * commit SHAs and never the `srcTree`/`scriptsTree` pair, so it joins this
	 * list too.
	 */
	"transcriptDisplayModesFoldReshootNote",
	/*
	 * And by the scroll-paging machine's remediation pass (PR #811,
	 * `fix/scroll-paging-machine`), this branch's newest top-level record: the
	 * note that states the ONE thing the pass moved (a STORIES row and the
	 * `surfaces` count that follows it, and no frame at all), the lane whose
	 * module digests it re-stamped rather than re-shot, and why the retired
	 * `src`/`scripts` tree pair is correctly ABSENT here. It is listed for the
	 * reason the list exists: a fold that started from main's manifest would take
	 * the `surfaces` field back to 1443 and drop the only statement of why it
	 * moved, with this very test staying green.
	 */
	"scrollPagingMachineRestampNote",
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

/*
 * The palette budgets, per DIRECTORY rather than per set.
 *
 * `set` count is not the property a reader needs: the transcript-line pass's
 * round-5 re-capture ran `--only=` without `--themes=`, which left the rig's
 * default twelve palettes inside four touched states of a six-palette set while
 * the set's other sixteen stayed at six, and re-took a forty-six-frame set as two
 * hundred and seventy-six. The manifest's counts were re-derived from the tree
 * and stayed green throughout, and both sets' READMEs kept documenting commands
 * that no longer reproduced what was committed - design round 5 (D7) and QA round
 * 5 (Q-r5-1) found it by counting files by hand. This test is that count, taken
 * from `SET_BUDGETS` in `scripts/check-evidence-palettes.mjs` - which is also
 * runnable on its own (`node scripts/check-evidence-palettes.mjs`) before a
 * commit, because a failure here is five minutes into a `test:desktop` run
 * otherwise. Adding a set to that table is what opts it in; the table is a
 * transcription of each set README's own `--themes=` command.
 */
test("every declared evidence set holds exactly the palettes its record documents", () => {
	const { sets, frames, problems } = checkPaletteBudgets();
	assert.deepEqual(
		problems,
		[],
		`${sets.length} declared set(s) at ${frames} frames: a state whose palettes are not its set's documented list is either a \`--only=\` run that left the rig's default palettes in place (extra) or a run that died mid-set (missing); re-shoot with the \`--themes=\` list the set's README documents, or update \`SET_BUDGETS\` and that README together`,
	);
});

/*
 * Q1 (round 1 of the wiring's review, found by QA): a frame the walk does not
 * judge has to be COUNTED, and a container must not be a hiding place.
 *
 * The defect: the walk was `.webp`-only, so a frame whose pixels would fail the
 * gate escaped it by being committed as a PNG - and this change created five of
 * them. Two halves close it, and this test pins both: `frames()` judges by NAME
 * (a theme-named `.png` is judged - 174 such frames sat unjudged across six
 * surfaces before this), and a frame the walk does not judge at all (no theme in
 * its name, whatever container it is packed in) is recorded by `unjudgedFrames`,
 * whose guard fails when the tree disagrees with the file.
 *
 * Mutations: judge by container again (`frames()` back to `.webp`), which is how
 * those 174 PNGs stayed invisible; or drop the counts guard, so a non-theme
 * frame can be added anywhere without the manifest noticing.
 */
test("a frame the walk does not judge is accounted for, and moving one fails", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "evidence-unjudged-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	mkdirSync(join(dir, "a-set", "row"), { recursive: true });
	/*
	 * Four frames, one per case: judged in the canonical container, judged
	 * BECAUSE ITS NAME CLAIMS A THEME in the other one, and one naming no theme
	 * inside the declared set, one outside it.
	 */
	writeFileSync(join(dir, "a-set", "row", "localOperatorDark.webp"), "");
	writeFileSync(join(dir, "a-set", "row", "localOperatorDark.png"), "");
	writeFileSync(join(dir, "a-set", "row-00-t96ms-blank.png"), "");
	writeFileSync(join(dir, "outside-00-t00ms-blank.png"), "");
	const manifest = { countsMean: {}, supplementary: [{ path: "a-set" }] };
	const why = "x".repeat(60);

	assert.deepEqual(
		frameFiles(dir)
			.map((file) => file.split("/").pop())
			.sort(),
		["localOperatorDark.png", "localOperatorDark.webp"],
		"a theme-named frame is JUDGED in whatever container it is packed: the name is the claim, and the container is only how the pixels are packed",
	);
	assert.match(
		unjudgedFrameFailures(manifest, dir).join("\n"),
		RE_EVIDENCE_27,
		"the field is REQUIRED: a manifest that carries counts and no accounting for the unjudged class is exactly the silence this guard closes",
	);
	assert.deepEqual(
		unjudgedFrameFailures(
			{
				...manifest,
				unjudgedFrames: {
					insideDeclaredSets: 1,
					outsideDeclaredSets: 1,
					why,
				},
			},
			dir,
		),
		[],
		"and with the walk's own counts and a stated reason it passes, so the guard is a scope statement rather than a wall",
	);
	assert.match(
		unjudgedFrameFailures(
			{
				...manifest,
				unjudgedFrames: {
					insideDeclaredSets: 2,
					outsideDeclaredSets: 0,
					why,
				},
			},
			dir,
		).join("\n"),
		RE_EVIDENCE_28,
		"a frame that moved between the set and the pool - or was re-containered - has to fail: that is the move this accounting exists to make visible",
	);
	assert.match(
		unjudgedFrameFailures(
			{
				...manifest,
				unjudgedFrames: {
					insideDeclaredSets: 1,
					outsideDeclaredSets: 1,
					why: "too short",
				},
			},
			dir,
		).join("\n"),
		RE_EVIDENCE_29,
		"a count a reader cannot read the MEANING of is the skip the field replaces",
	);
});

/*
 * Hoisted out of the test bodies above for `lint/performance/useTopLevelRegex` - the only
 * warnings this file carries, and the reason a change that touches it owes the whole-file
 * cleanup `scripts/check-scripts-lint.mjs` charges (`scripts/` sits outside `pnpm lint`'s
 * path list, so nothing else would say so). None of these literals is global or sticky and
 * `assert.match` does not mutate a pattern's state, so one shared constant is the same
 * expression evaluated once per run rather than once per assertion.
 */
const RE_EVIDENCE_1 = /reachable from no ref/;
const RE_EVIDENCE_2 = /dies at the next gc/;
const RE_EVIDENCE_3 = /wip: a commit that was amended away/;
const RE_EVIDENCE_4 = /resolves to no commit/;
const RE_EVIDENCE_7 = /supplementary\[live\]/;
const RE_EVIDENCE_8 = /missing or not a sha/;
const RE_EVIDENCE_9 = /partialCapture\.addedAtHead/;
const RE_EVIDENCE_10 = /partialCapture\.refreshedAtHead/;
const RE_EVIDENCE_11 =
	/claims 2 refreshed frames, but 3 committed frames differ/;
const RE_EVIDENCE_12 = /refreshedStories misses 1 story directory/;
const RE_EVIDENCE_13 = /chat-run-panel--mcp-key-error/;
const RE_EVIDENCE_14 =
	/claims 3 refreshed frames, but 4 committed frames stand in the directories refreshedStories names at HEAD/;
const RE_EVIDENCE_15 = /refreshedStories misses 2 story directories/;
const RE_EVIDENCE_16 = /chat-run-panel--mcp-key-saving/;
const RE_EVIDENCE_17 = /committed frames stand in the directories/;
const RE_EVIDENCE_18 = /committed frames differ at/;
const RE_EVIDENCE_19 = /^supplementary\/\d+\//;
const RE_EVIDENCE_20 = /countsMean\.frames/;
const RE_EVIDENCE_21 = /the walk finds 3/;
const RE_EVIDENCE_22 =
	/Lead the field with: "RE-DERIVED FOR THIS FOLD: 3 committed frames outside the 1 declared supplementary sets below, of 5 on disk \(2 of them inside the sets\)\."/;
const RE_EVIDENCE_23 = /nothing this check can read/;
const RE_EVIDENCE_24 = /countsMean\.surfaces/;
const RE_EVIDENCE_25 = /the walk finds 2/;
const RE_EVIDENCE_26 = /first seen at 0/;
const RE_EVIDENCE_27 = /`unjudgedFrames` is missing/;
const RE_EVIDENCE_28 = /a frame was added, moved or re-containered/;
const RE_EVIDENCE_29 = /does not say what the unjudged class is/;
