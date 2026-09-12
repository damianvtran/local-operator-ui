import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { partialFrameCount } from "./capture-evidence.mjs";
import { frames as frameFiles } from "./check-evidence.mjs";

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
	return {
		...previous,
		frames: partialFrameCount(
			previous,
			newDirs.map((dir) => join(root, dir)),
		),
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
