#!/usr/bin/env node
/**
 * Metadata tests use explicit fixtures, not live-release evidence. No network.
 * Covers the immutable-recovery contracts (validate + upload) and the
 * pre-release window that keeps an asset-less build out of /releases/latest.
 * The window tests drive the real CLI with a fixture `gh` as the only one on
 * PATH as well, so the env wiring, the exit code and the emitted argv are real
 * output rather than a restatement of what the script is assumed to send.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	finalizeRelease,
	missingAssets,
	openReleaseWindow,
	releaseNotesVerdict,
	setReleaseState,
} from "./release-state.mjs";
import {
	artifactFiles,
	checkAssetCollisions,
	uploadRelease,
} from "./upload-release.mjs";
import {
	resolveTagSha,
	validateInputs,
	validateRelease,
} from "./validate-release.mjs";

const SHA = "3becfb9c462f6adb1f47f9815767f5522755f849";
const TAG = "v0.14.1";
const ID = 383131955;
/**
 * The other spelling of the same release: `node_id` is the GraphQL global id,
 * `id` is the numeric database id. Both are the release under test, and
 * `NODE_ID_OTHER` is a different release's node id.
 */
const NODE_ID = "RE_kwDOOCmy184XNSAc";
const NODE_ID_OTHER = "RE_kwDOOCmy184XNSAd";
/**
 * The two refusals the id-spelling tests below expect, built once beside the
 * fixtures they describe rather than inside each test body -- the same shape this
 * file already uses for its patterns.
 */
const EXPECTED_NUMERIC_MISMATCH = new RegExp(
	`Release ID ${ID} does not match expected release ID ${ID + 1}`,
);
const EXPECTED_NODE_MISMATCH = new RegExp(
	`Release ID ${ID} does not match expected release ID ${NODE_ID_OTHER} \\(node id ${NODE_ID}\\)`,
);
/**
 * A hand-written body in the shape `.github/RELEASE_TEMPLATE.md` prescribes.
 *
 * The default every fixture carries: a release whose writeup is GitHub's draft
 * (or is missing) is refused by the gate these suites exist to pin, so a fixture
 * without a body would exercise the refusal instead of the thing under test.
 */
const NOTES = [
	"## What's New",
	"",
	"0.14.1 fixes the thing a user could see.",
	"",
	"- **The thing**: it is fixed now - the fix is limited to one code path.",
	"",
	"## Impact",
	"",
	"- **No breaking changes.**",
	"",
	"## PRs",
	"",
	"- #1 `fix(thing)` - merge `abc1234` - `Release: patch - the thing is fixed`",
	"",
	"**Full Changelog**: https://github.com/damianvtran/local-operator-ui/compare/v0.14.0...v0.14.1",
	"",
].join("\n");
function fixture({
	tag = TAG,
	sha = SHA,
	ref = `refs/tags/${tag}`,
	release = {},
	pkg = {},
	missing = "",
	assets = [],
	others = [],
	releases = null,
} = {}) {
	// This release as GitHub reports it. created_at is the attribute
	// /releases/latest sorts by, so every entry the recency check reads carries one.
	const published = {
		id: ID,
		node_id: NODE_ID,
		tag_name: tag,
		draft: false,
		prerelease: false,
		created_at: "2026-09-05T00:00:00Z",
		published_at: "2026-09-05T00:00:00Z",
		body: NOTES,
		...release,
	};
	return (path) => {
		if (path === missing) throw new Error("GitHub HTTP 404");
		if (path === `/git/ref/tags/${tag}`)
			return { ref, object: { type: "commit", sha } };
		if (path === `/releases/tags/${tag}`) return published;
		if (path === `/contents/package.json?ref=${sha}`)
			return {
				content: Buffer.from(
					JSON.stringify({
						name: "local-operator-ui",
						version: tag.slice(1),
						...pkg,
					}),
				).toString("base64"),
			};
		if (path.startsWith(`/releases/${ID}/assets?`)) return assets;
		// The release list: this release is always in it, and `others` stands for
		// the rest of what the repository has published.
		if (path.startsWith("/releases?"))
			return releases ? releases(path) : [published, ...others];
		throw new Error(`Unexpected API path: ${path}`);
	};
}

for (const manual of [true, false]) {
	test(`matching published release validates (manual=${manual})`, () => {
		assert.deepEqual(validateRelease(fixture(), TAG, SHA, manual, ID), {
			source_sha: SHA,
			release_id: ID,
			release_tag: TAG,
			prerelease: false,
			// The writeup travels with the pins: the notes gate reads it from here.
			body: NOTES,
		});
	});
	test(`moved source rejected (manual=${manual})`, () => {
		assert.throws(
			() => validateRelease(fixture(), TAG, "0".repeat(40), manual, ID),
			/Tag SHA.*does not match/,
		);
	});
	test(`recreated release rejected (manual=${manual})`, () => {
		assert.throws(
			() =>
				validateRelease(
					fixture({ release: { id: ID + 1 } }),
					TAG,
					SHA,
					manual,
					ID,
				),
			/Release ID.*does not match/,
		);
	});
}
// The release-ID pin has two spellings of the same value, and the tolerance for
// the second one is an identity check rather than a loosening. What it is FOR:
// v0.24.2's first automatic release was lost to `gh release view --json id`
// answering with `RE_kwDOOCmy184XNSAc` while this validator compared against
// `383131955` -- the same release, and every job after the validate skipped. The
// invariant these two tests pin, in both directions: an identifier is accepted
// exactly while it names THIS release, in either spelling, and refused when it
// names another one.
test("the node id of this release is this release: accepted, and emitted numerically", () => {
	// Only the numeric spelling is passed on, because that is the spelling both
	// consumers of this output require: upload-release.mjs and release-state.mjs
	// each match /^[1-9]\d*$/ on the pin they are handed.
	assert.deepEqual(validateRelease(fixture(), TAG, SHA, false, NODE_ID), {
		source_sha: SHA,
		release_id: ID,
		release_tag: TAG,
		prerelease: false,
		// The writeup travels with the pins, in every spelling of the pin.
		body: NOTES,
	});
});
test("another release is refused in either spelling", () => {
	// The refusal names both spellings, because the reader of that line is looking
	// at a payload whose spelling is the thing under suspicion.
	assert.throws(
		() => validateRelease(fixture(), TAG, SHA, false, ID + 1),
		EXPECTED_NUMERIC_MISMATCH,
	);
	assert.throws(
		() => validateRelease(fixture(), TAG, SHA, false, NODE_ID_OTHER),
		EXPECTED_NODE_MISMATCH,
	);
});
test("a release carrying no node id still pins on its numeric id alone", () => {
	// A hand-built or older response without `node_id` must not turn the node
	// spelling into an accepted wildcard: the numeric pin still matches, and
	// anything else is still refused.
	assert.equal(
		validateRelease(
			fixture({ release: { node_id: undefined } }),
			TAG,
			SHA,
			false,
			String(ID),
		).release_id,
		ID,
	);
	assert.throws(
		() =>
			validateRelease(
				fixture({ release: { node_id: undefined } }),
				TAG,
				SHA,
				false,
				NODE_ID,
			),
		/Release ID.*does not match/,
	);
});
for (const [name, options, error] of [
	["missing tag", { missing: `/git/ref/tags/${TAG}` }, /404/],
	["missing release", { missing: `/releases/tags/${TAG}` }, /404/],
	["wrong package", { pkg: { name: "other" } }, /name mismatch/],
	["wrong version", { pkg: { version: "0.14.2" } }, /version mismatch/],
	["draft", { release: { draft: true } }, /draft/],
	["unpublished", { release: { published_at: null } }, /not published/],
	["wrong release tag", { release: { tag_name: "v0.14.0" } }, /tag_name/],
	["missing release ID", { release: { id: undefined } }, /valid release ID/],
]) {
	test(`${name} rejected`, () =>
		assert.throws(
			() => validateRelease(fixture(options), TAG, SHA, true, ID),
			error,
		));
}
test("suffix-matching but nonexact ref rejected", () => {
	assert.throws(
		() => resolveTagSha(fixture({ ref: `refs/heads/tags/${TAG}` }), TAG),
		/Unexpected ref/,
	);
});
test("published prerelease is supported without changing its metadata", () => {
	const tag = "v0.15.0-beta.1";
	validateInputs(tag, SHA, true, "fixture-token");
	assert.equal(
		validateRelease(
			fixture({ tag, release: { prerelease: true } }),
			tag,
			SHA,
			true,
			ID,
		).prerelease,
		true,
	);
});
test("missing API token fails by name only", () => {
	assert.throws(() => validateInputs(TAG, SHA, true, ""), {
		message: "GH_TOKEN required for read-only API calls",
	});
});
test("duplicate artifact filenames fail before upload", () => {
	assert.throws(
		() =>
			checkAssetCollisions(fixture(), ID, ["mac/latest.yml", "win/latest.yml"]),
		/Duplicate/,
	);
});
test("existing filename collision rejected", () => {
	assert.throws(
		() =>
			checkAssetCollisions(fixture({ assets: [{ name: "app.dmg" }] }), ID, [
				"app.dmg",
			]),
		/collisions/,
	);
});
test("collisions on paginated assets rejected", () => {
	const api = (path) =>
		path.endsWith("page=1")
			? Array.from({ length: 100 }, (_, i) => ({ name: `old-${i}` }))
			: [{ name: "app.dmg" }];
	assert.throws(() => checkAssetCollisions(api, ID, ["app.dmg"]), /collisions/);
});
test("empty artifact set rejected", () =>
	assert.throws(() => checkAssetCollisions(fixture(), ID, []), /No artifacts/));
for (const [name, overrides, error] of [
	["missing SHA", { expectedSha: "" }, /EXPECTED_SOURCE_SHA/],
	["missing ID", { expectedReleaseId: "" }, /EXPECTED_RELEASE_ID/],
	["moved SHA", { expectedSha: "0".repeat(40) }, /Tag SHA/],
	["changed ID", { expectedReleaseId: ID + 1 }, /Release ID/],
	// Tolerance for the node spelling lives at the validator's INPUT and nowhere
	// later: this pin addresses asset writes, so it stays numeric-only, and a node
	// id handed to it is refused rather than translated.
	[
		"node id (other spelling)",
		{ expectedReleaseId: NODE_ID },
		/EXPECTED_RELEASE_ID/,
	],
	[
		"collision",
		{ api: fixture({ assets: [{ name: "app.dmg" }] }) },
		/collisions/,
	],
]) {
	test(`upload rejects ${name} without writes`, () => {
		let writes = 0;
		assert.throws(
			() =>
				uploadRelease({
					api: fixture(),
					tag: TAG,
					expectedSha: SHA,
					expectedReleaseId: ID,
					files: ["app.dmg"],
					upload: () => writes++,
					...overrides,
				}),
			error,
		);
		assert.equal(writes, 0);
	});
}
test("upload addresses validated ID and does not mutate release metadata", () => {
	const writes = [];
	uploadRelease({
		api: fixture(),
		tag: TAG,
		expectedSha: SHA,
		expectedReleaseId: ID,
		files: ["app.dmg", "app.exe"],
		upload: (...args) => writes.push(args),
	});
	assert.deepEqual(writes, [
		[ID, "app.dmg"],
		[ID, "app.exe"],
	]);
});
for (const mode of ["complete", "missing-linux", "metadata-only", "symlink"]) {
	test(`artifact collection ${mode}`, () => {
		const root = mkdtempSync(join(tmpdir(), "release-artifact-test-"));
		try {
			for (const [platform, file] of [
				["macos", "app.dmg"],
				["windows", "app.exe"],
				["linux", "app.deb"],
			]) {
				if (mode === "missing-linux" && platform === "linux") continue;
				const dir = join(root, `${platform}-artifacts`);
				mkdirSync(dir);
				writeFileSync(
					join(dir, mode === "metadata-only" ? "latest.yml" : file),
					"fixture",
				);
				if (mode === "symlink")
					symlinkSync(join(dir, file), join(dir, "linked-installer"));
			}
			if (mode === "complete") assert.equal(artifactFiles(root).length, 3);
			else
				assert.throws(
					() => artifactFiles(root),
					mode === "missing-linux"
						? /ENOENT/
						: mode === "symlink"
							? /non-file/
							: /Missing macos installer/,
				);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
}

test("a failed upload stops instead of replacing or retrying assets", () => {
	let writes = 0;
	assert.throws(
		() =>
			uploadRelease({
				api: fixture(),
				tag: TAG,
				expectedSha: SHA,
				expectedReleaseId: ID,
				files: ["app.dmg", "app.exe"],
				upload: () => {
					writes++;
					throw new Error("HTTP 422 duplicate");
				},
			}),
		/422/,
	);
	assert.equal(writes, 1);
});

// --- The pre-release window -------------------------------------------------
// The defect these cover: /releases/latest answers with the newest
// non-prerelease release whether or not it has assets, and this pipeline
// publishes the release before it builds the installers. For the whole build
// window the feed therefore pointed at a release with no latest*.yml, the
// metadata request 404'd, and every app folded that into "no updates
// available" -- users were told they were current while a newer version was
// already published (v0.17.2, v0.19.1, v0.19.2).
const INSTALLERS = [
	"app.dmg",
	"app-mac.zip",
	"app-setup.exe",
	"app-setup.msi",
	"app.deb",
	"app.AppImage",
	"app.rpm",
];
const METADATA = ["latest-mac.yml", "latest.yml", "latest-linux.yml"];
const uploaded = (names) => names.map((name) => ({ name, state: "uploaded" }));
const COMPLETE = uploaded([...INSTALLERS, ...METADATA]);
// A DMG whose upload did not finish: listed on the release, with no bytes
// behind it. The mac channel has nothing else, so it cannot be offered.
const INTERRUPTED = uploaded([
	"app-setup.exe",
	"app-setup.msi",
	"app.deb",
	"app.AppImage",
	"app.rpm",
	...METADATA,
]).concat({ name: "app.dmg", state: "open" });

function windowRun(
	mode,
	{
		assets = [],
		prerelease = false,
		isManual = false,
		tag = TAG,
		expectedSha = SHA,
		expectedReleaseId = ID,
		release = {},
		others = [],
	} = {},
) {
	const writes = [];
	const result = mode({
		api: fixture({ assets, release: { prerelease, ...release }, others }),
		tag,
		expectedSha,
		expectedReleaseId,
		isManual,
		setFlag: (id, state) => writes.push([id, state]),
	});
	return { writes, result };
}
const HOLD = [ID, { prerelease: true }];
const PROMOTE = [ID, { prerelease: false }];

for (const [label, options, writes, action] of [
	["holds an asset-less published release", {}, [HOLD], "held"],
	[
		"holds a release whose update metadata is missing",
		{ assets: uploaded(INSTALLERS) },
		[HOLD],
		"held",
	],
	[
		"holds a release with an interrupted upload",
		{ assets: INTERRUPTED },
		[HOLD],
		"held",
	],
	[
		"leaves an already-held release alone",
		{ prerelease: true },
		[],
		"already a pre-release",
	],
	[
		"leaves a complete release alone",
		{ assets: COMPLETE, prerelease: true },
		[],
		"release is already asset-complete",
	],
	[
		// A duplicate or re-run `published` event must not take a finished
		// release back out of latest: that would suppress a working offer.
		"never hides a complete release, even a promoted one",
		{ assets: COMPLETE },
		[],
		"release is already asset-complete",
	],
	[
		"never hides anything for a manual repair",
		{ isManual: true },
		[],
		"manual dispatch",
	],
]) {
	test(`open: ${label}`, () => {
		const run = windowRun(openReleaseWindow, options);
		assert.deepEqual(run.writes, writes);
		assert.equal(
			run.result.action,
			action.startsWith("held") ? "held" : "skipped",
		);
		assert.equal(run.result.reason, action === "held" ? undefined : action);
	});
}

test("open: a held release names what is still missing", () => {
	const run = windowRun(openReleaseWindow, { assets: uploaded(["app.dmg"]) });
	assert.deepEqual(run.result.missing, [
		"macos update metadata",
		"windows installer",
		"windows update metadata",
		"linux installer",
		"linux update metadata",
	]);
});

/* ---- the release writeup gate -------------------------------------------- */

/** GitHub's own draft, in the shape the Templates API writes it. */
const GENERATED_NOTES = [
	"## What's Changed",
	"* Fix the thing by @someone in https://github.com/damianvtran/local-operator-ui/pull/1",
	"",
	"**Full Changelog**: https://github.com/damianvtran/local-operator-ui/compare/v0.14.0...v0.14.1",
	"",
].join("\n");

for (const [label, body, refusal] of [
	["an empty body", "", /Release body is empty/],
	["a whitespace-only body", "  \n\t\n", /Release body is empty/],
	["a body that is not a string", null, /Release body is empty/],
	["GitHub's generated draft", GENERATED_NOTES, /generated-notes draft/],
]) {
	test(`writeup: ${label} is refused`, () => {
		assert.match(releaseNotesVerdict(body).refusal, refusal);
	});
}

test("writeup: a hand-written body is accepted, and says nothing", () => {
	assert.deepEqual(releaseNotesVerdict(NOTES), { refusal: null, warnings: [] });
});

test("writeup: neither template shape is annotated, never refused", () => {
	// Non-fatal on purpose. No wording rule can tell a legitimate writeup from an
	// off-template one, and a gate that blocks a release over a missing heading is
	// worse than the draft it was aimed at. Either shape alone is enough to stay
	// silent: this is the test that says which bodies the annotation is for.
	const neither = releaseNotesVerdict("Prose about what changed.");
	assert.equal(neither.refusal, null);
	assert.equal(neither.warnings.length, 1);
	assert.match(
		neither.warnings[0],
		/neither a `## What's New` heading nor a `Full Changelog` compare link/,
	);
	assert.deepEqual(
		releaseNotesVerdict("## What's New\n\nProse.\n").warnings,
		[],
	);
	// The same heading in the other case, which is what six of this repository's
	// own recent releases shipped (v0.23.1 through v0.24.0). The template spells it
	// `## What's New`; the annotation is about whether a section exists, and letter
	// case is not part of that shape.
	assert.deepEqual(
		releaseNotesVerdict("## What's new\n\nProse.\n").warnings,
		[],
	);
	assert.deepEqual(
		releaseNotesVerdict(
			"Prose.\n\n**Full Changelog**: https://github.com/x/y/compare/v0.14.0...v0.14.1\n",
		).warnings,
		[],
	);
});

test("writeup: a generated body on the documented path is refused before anything is built", () => {
	// The runbook's own path: the owner publishes the Release as a pre-release and
	// this pipeline starts. The refusal belongs to the window job, and EVERY job
	// that can ship something depends on it - the three installers, the promote,
	// and `npm-publish`, which is the one that does not look like shipping - so a
	// refused writeup skips the registry write as well as the builds rather than
	// running beside them. That dependency is the assertion, not this comment:
	// see the window-failure case in `test-publish-workflow.mjs`.
	assert.throws(
		() =>
			windowRun(openReleaseWindow, {
				prerelease: true,
				release: { body: GENERATED_NOTES },
			}),
		/generated-notes draft/,
	);
});

test("writeup: a full Release with a generated body is HELD first, then refused", () => {
	// ORDERING IS LOAD-BEARING, and this is the assertion for it. A full Release is
	// in `/releases/latest` with no assets at this moment; refusing before the hold
	// would leave it there, telling every running app it is up to date - the outage
	// class the whole window exists to prevent. So the hold PATCH is already out when
	// the throw unwinds, and the writer is asserted rather than assumed.
	const writes = [];
	assert.throws(
		() =>
			openReleaseWindow({
				api: fixture({
					assets: [],
					release: { prerelease: false, body: GENERATED_NOTES },
				}),
				tag: TAG,
				expectedSha: SHA,
				expectedReleaseId: ID,
				isManual: false,
				setFlag: (id, state) => writes.push([id, state]),
			}),
		/generated-notes draft/,
	);
	assert.deepEqual(writes, [HOLD]);
});

test("writeup: a repair is never blocked by an old Release's body", () => {
	// A repair exists to re-attach the assets of a Release that was published long
	// before this gate, so its body is whatever that release shipped with.
	const run = windowRun(openReleaseWindow, {
		isManual: true,
		release: { body: GENERATED_NOTES },
	});
	assert.deepEqual(run.writes, []);
	assert.equal(run.result.reason, "manual dispatch");
});

test("writeup: a re-run of a complete release is not re-judged", () => {
	// Deliberate, and the only exemption on the release path: a release that already
	// carries every installer is a repeat of a run that succeeded, nothing is being
	// published by it, and failing it over prose would break a green re-run while
	// changing nothing a user sees.
	const run = windowRun(openReleaseWindow, {
		assets: COMPLETE,
		prerelease: true,
		release: { body: GENERATED_NOTES },
	});
	assert.deepEqual(run.writes, []);
	assert.equal(run.result.reason, "release is already asset-complete");
});

test("missing assets are named, so a refusal says what was absent", () => {
	assert.deepEqual(missingAssets([]), [
		"macos installer",
		"macos update metadata",
		"windows installer",
		"windows update metadata",
		"linux installer",
		"linux update metadata",
	]);
	assert.deepEqual(missingAssets(COMPLETE), []);
});

for (const [label, options, writes, action] of [
	[
		"promotes a release once its assets are attached",
		{ assets: COMPLETE, prerelease: true },
		[PROMOTE],
		"promoted",
	],
	[
		"leaves a full release as it is",
		{ assets: COMPLETE },
		[],
		"already a full release",
	],
	[
		"never promotes anything for a manual repair",
		{ assets: COMPLETE, prerelease: true, isManual: true },
		[],
		"manual dispatch",
	],
	[
		"never promotes a pre-release tag, even complete",
		{ assets: COMPLETE, prerelease: true, tag: "v0.15.0-beta.1" },
		[],
		"pre-release tag",
	],
]) {
	test(`finalize: ${label}`, () => {
		const run = windowRun(finalizeRelease, options);
		assert.deepEqual(run.writes, writes);
		assert.equal(
			run.result.action,
			action === "promoted" ? "promoted" : "skipped",
		);
		assert.equal(run.result.reason, action === "promoted" ? undefined : action);
	});
}

for (const [label, assets, error] of [
	["no assets at all", [], /missing macos installer/],
	[
		"an installer that never finished uploading",
		INTERRUPTED,
		/missing macos installer/,
	],
	[
		"any update metadata at all",
		uploaded(INSTALLERS),
		/missing macos update metadata/,
	],
	[
		// Metadata is asserted per platform. One platform's channel file used to
		// stand in for the whole release, which would promote a release whose
		// other platforms 404 -- the failure this gate exists to prevent.
		"one platform's channel file while the others are complete",
		uploaded([...INSTALLERS, "latest-mac.yml", "latest.yml"]),
		/missing linux update metadata/,
	],
	[
		"the macOS channel file while the others are complete",
		uploaded([...INSTALLERS, "latest.yml", "latest-linux.yml"]),
		/missing macos update metadata/,
	],
]) {
	test(`finalize refuses to promote with ${label}, writing nothing`, () => {
		const writes = [];
		assert.throws(
			() =>
				finalizeRelease({
					api: fixture({ assets, release: { prerelease: true } }),
					tag: TAG,
					expectedSha: SHA,
					expectedReleaseId: ID,
					isManual: false,
					setFlag: (id, state) => writes.push([id, state]),
				}),
			error,
		);
		assert.deepEqual(writes, []);
	});
}

// A re-run of an older release event replays that run's original payload: it
// validates the old tag, attaches its assets, and would then promote it -- moving
// /releases/latest backwards and silently denying users the newer release that
// was already published. `gh run rerun <run-id>` is a documented operator action,
// so the promote has to ask whether it is still the newest.
const NEWER = {
	id: ID + 1,
	tag_name: "v0.19.2",
	draft: false,
	prerelease: false,
	created_at: "2026-09-06T00:00:00Z",
	published_at: "2026-09-06T00:00:00Z",
};
for (const [label, others, writes, reason] of [
	[
		"leaves an older release a pre-release when a newer one is published",
		[NEWER],
		[],
		"not the newest release",
	],
	[
		"ignores a newer draft, which latest cannot answer with",
		[{ ...NEWER, draft: true }],
		[PROMOTE],
		undefined,
	],
	[
		"ignores a newer pre-release, which latest cannot answer with",
		[{ ...NEWER, prerelease: true }],
		[PROMOTE],
		undefined,
	],
	[
		"promotes when every other release is older",
		[{ ...NEWER, created_at: "2026-09-04T00:00:00Z" }],
		[PROMOTE],
		undefined,
	],
]) {
	test(`finalize: ${label}`, () => {
		const run = windowRun(finalizeRelease, {
			assets: COMPLETE,
			prerelease: true,
			others,
		});
		assert.deepEqual(run.writes, writes);
		assert.equal(run.result.reason, reason);
	});
}

test("finalize reads past the first page, so a newer release cannot hide there", () => {
	const writes = [];
	const result = finalizeRelease({
		api: fixture({
			assets: COMPLETE,
			release: { prerelease: true },
			releases: (path) =>
				path.endsWith("page=1")
					? Array.from({ length: 100 }, (_, index) => ({
							...NEWER,
							id: 9000 + index,
							created_at: "2026-09-04T00:00:00Z",
						}))
					: [
							{
								id: ID,
								tag_name: TAG,
								draft: false,
								prerelease: true,
								created_at: "2026-09-05T00:00:00Z",
							},
							NEWER,
						],
		}),
		tag: TAG,
		expectedSha: SHA,
		expectedReleaseId: ID,
		isManual: false,
		setFlag: (id, state) => writes.push([id, state]),
	});
	assert.deepEqual(writes, []);
	assert.equal(result.reason, "not the newest release");
});

test("finalize refuses to promote when a release's creation time cannot be read", () => {
	// "We could not find out where this release sits" is answered as "we cannot
	// promote", the same way an interrupted upload is answered as absent.
	const writes = [];
	assert.throws(
		() =>
			finalizeRelease({
				api: fixture({
					assets: COMPLETE,
					release: { prerelease: true },
					others: [
						{ ...NEWER, created_at: undefined, published_at: undefined },
					],
				}),
				tag: TAG,
				expectedSha: SHA,
				expectedReleaseId: ID,
				isManual: false,
				setFlag: (id, state) => writes.push([id, state]),
			}),
		/has no readable creation time/,
	);
	assert.deepEqual(writes, []);
});

test("finalize refuses to promote a release the release list does not contain", () => {
	// The list is the same snapshot the recency check reads, so a release missing
	// from it is one whose position in the feed cannot be established at all.
	const writes = [];
	assert.throws(
		() =>
			finalizeRelease({
				api: fixture({
					assets: COMPLETE,
					release: { prerelease: true },
					releases: () => [],
				}),
				tag: TAG,
				expectedSha: SHA,
				expectedReleaseId: ID,
				isManual: false,
				setFlag: (id, state) => writes.push([id, state]),
			}),
		/not in the release list/,
	);
	assert.deepEqual(writes, []);
});

for (const mode of ["open", "finalize"]) {
	const run = mode === "open" ? openReleaseWindow : finalizeRelease;
	for (const [label, options, error] of [
		[
			"a release recreated since validate-release",
			{ release: { id: ID + 1 } },
			/Release ID.*does not match/,
		],
		[
			"a tag that moved since validate-release",
			{ expectedSha: "0".repeat(40) },
			/Tag SHA.*does not match/,
		],
		["a missing source SHA pin", { expectedSha: "" }, /EXPECTED_SOURCE_SHA/],
		[
			"a missing release ID pin",
			{ expectedReleaseId: "" },
			/EXPECTED_RELEASE_ID/,
		],
	]) {
		test(`${mode} rejects ${label} without writing`, () => {
			const writes = [];
			assert.throws(
				() =>
					run({
						api: fixture({
							assets: COMPLETE,
							release: { prerelease: true, ...options.release },
						}),
						tag: TAG,
						expectedSha: options.expectedSha ?? SHA,
						expectedReleaseId: options.expectedReleaseId ?? ID,
						isManual: false,
						setFlag: (id, state) => writes.push([id, state]),
					}),
				error,
			);
			assert.deepEqual(writes, []);
		});
	}
}

test("the state PATCH is a typed boolean addressed by release ID", () => {
	// Each field goes out in the form its REST schema declares: `prerelease` is a
	// boolean, so it is sent as a typed boolean (`-F`); `make_latest` is a *string*
	// enum (`true`/`false`/`legacy`), so it is sent as the documented string (`-f`)
	// -- a typed boolean is a body shape the schema does not declare, and a 422 on
	// it fails the hold before any build starts. The hold sends `prerelease` alone,
	// because a pre-release cannot be latest. The address must be the pinned ID,
	// never `/tags/<tag>`, which would resolve to whatever the tag points at now.
	// The stub is the only `gh` on the child's PATH, so a silent fallback to the
	// real CLI -- and a live PATCH against the operator's repository -- cannot
	// happen.
	const dir = mkdtempSync(join(tmpdir(), "release-state-patch-"));
	try {
		writeFileSync(
			join(dir, "gh"),
			`#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
if (process.env.FAIL_PATCH === 'true') {
  appendFileSync(process.env.ATTEMPTS_FILE, 'attempt\\n');
  process.stderr.write('token abc123 rejected\\n');
  process.exit(1);
}
appendFileSync(process.env.CALLS_FILE, JSON.stringify(process.argv.slice(2)) + '\\n');
`,
			{ mode: 0o755 },
		);
		const calls = join(dir, "calls");
		const attempts = join(dir, "attempts");
		const child = `
import { setReleaseState } from ${JSON.stringify(new URL("../scripts/release-state.mjs", import.meta.url).href)};
const repo = "damianvtran/local-operator-ui";
setReleaseState(repo, "fixture-token", ${ID}, { prerelease: false, tag: "v0.14.1" });
setReleaseState(repo, "fixture-token", ${ID}, { prerelease: true, tag: "v0.14.1" });
process.env.FAIL_PATCH = "true";
try {
	setReleaseState(repo, "fixture-token", ${ID}, { prerelease: false, tag: "v0.14.1" });
	console.log("NO_ERROR_RAISED");
} catch (error) {
	console.log("CAUGHT:" + error.message);
}
`;
		const result = spawnSync(process.execPath, ["-e", child], {
			encoding: "utf8",
			cwd: dir,
			env: {
				PATH: `${dir}:${dirname(process.execPath)}:/usr/bin:/bin`,
				CALLS_FILE: calls,
				ATTEMPTS_FILE: attempts,
				FAIL_PATCH: "false",
			},
		});
		assert.equal(result.status, 0, result.stderr);
		// A window that cannot be flipped is closed by hand, and this line is the
		// only place the run can say so: it names the state that was asked for, and
		// the `--latest` a close needs, because `gh release edit` only sends
		// make_latest when that flag is passed.
		assert.match(
			result.stdout,
			/CAUGHT:Release state PATCH failed for release \d+ \(v0\.14\.1\) after 3 attempts; close the window by hand with: gh release edit v0\.14\.1 --prerelease=false --latest/,
		);
		assert.doesNotMatch(
			result.stdout + result.stderr,
			/abc123|NO_ERROR_RAISED/,
		);
		// The retry is bounded: a persistent failure is attempted three times and
		// then fails the run, rather than hammering the API or hanging.
		assert.equal(readFileSync(attempts, "utf8").trim().split("\n").length, 3);
		assert.deepEqual(
			readFileSync(calls, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line)),
			[PROMOTE_ARGV, HOLD_ARGV],
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// The wire form of each direction, built once so the schema-in-the-comment claims
// are the same values the assertions use.
const CLI_REPO = "damianvtran/local-operator-ui";
const PATCH = (...fields) => [
	"api",
	"--method",
	"PATCH",
	`repos/${CLI_REPO}/releases/${ID}`,
	...fields,
];
// The hold sends `prerelease` alone: a pre-release cannot be latest, so
// `make_latest=false` would only record a value the server already derives.
const HOLD_ARGV = PATCH("-F", "prerelease=true");
const PROMOTE_ARGV = PATCH("-F", "prerelease=false", "-f", "make_latest=true");

// The CLI is where the workflow's environment meets the mutation, and
// IS_MANUAL_DISPATCH is rendered by Actions as the literal string "false"; the
// default has to be fail-closed where the mutation is decided, so anything unset
// or misspelled may only ever hold a mutation back. Driven as a subprocess with a
// fixture `gh` as the only one on PATH, so the exit code and the argv are real.
const STATE_SCRIPT = fileURLToPath(
	new URL("../scripts/release-state.mjs", import.meta.url),
);

function withCliFixture(run) {
	const dir = mkdtempSync(join(tmpdir(), "release-state-cli-"));
	try {
		return run(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function runStateCli(
	dir,
	{
		mode = "finalize",
		isManual,
		others = [],
		assets = COMPLETE,
		release = {},
	} = {},
) {
	writeFileSync(
		join(dir, "gh"),
		`#!/usr/bin/env node
const { appendFileSync, readFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(process.env.CALLS_FILE, JSON.stringify(args) + '\\n');
if (args.includes('--method')) process.exit(0);
const fixtures = JSON.parse(readFileSync(process.env.FIXTURES_FILE, 'utf8'));
const key = args[1].slice(('repos/' + process.env.GITHUB_REPOSITORY).length);
if (!(key in fixtures)) {
  process.stderr.write('unexpected path ' + key + '\\n');
  process.exit(1);
}
process.stdout.write(JSON.stringify(fixtures[key]));
`,
		{ mode: 0o755 },
	);
	const fixtures = {
		[`/git/ref/tags/${TAG}`]: {
			ref: `refs/tags/${TAG}`,
			object: { type: "commit", sha: SHA },
		},
		[`/releases/tags/${TAG}`]: {
			id: ID,
			tag_name: TAG,
			draft: false,
			prerelease: true,
			created_at: "2026-09-05T00:00:00Z",
			published_at: "2026-09-05T00:00:00Z",
			body: NOTES,
			...release,
		},
		[`/contents/package.json?ref=${SHA}`]: {
			content: Buffer.from(
				JSON.stringify({ name: "local-operator-ui", version: TAG.slice(1) }),
			).toString("base64"),
		},
		[`/releases/${ID}/assets?per_page=100&page=1`]: assets,
		"/releases?per_page=100&page=1": [
			{
				id: ID,
				tag_name: TAG,
				draft: false,
				prerelease: true,
				created_at: "2026-09-05T00:00:00Z",
			},
			...others,
		],
	};
	const fixturesFile = join(dir, "fixtures.json");
	const calls = join(dir, "calls");
	writeFileSync(fixturesFile, JSON.stringify(fixtures));
	const result = spawnSync(process.execPath, [STATE_SCRIPT, mode], {
		encoding: "utf8",
		cwd: dir,
		env: {
			PATH: `${dir}:${dirname(process.execPath)}:/usr/bin:/bin`,
			CALLS_FILE: calls,
			FIXTURES_FILE: fixturesFile,
			RELEASE_TAG: TAG,
			EXPECTED_SOURCE_SHA: SHA,
			EXPECTED_RELEASE_ID: String(ID),
			GITHUB_REPOSITORY: CLI_REPO,
			GH_TOKEN: "fixture-token",
			...(isManual === undefined ? {} : { IS_MANUAL_DISPATCH: isManual }),
		},
	});
	const patch = existsSync(calls)
		? readFileSync(calls, "utf8")
				.trim()
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line))
				.filter((argv) => argv.includes("--method"))
		: [];
	return { result, patch };
}

for (const [label, isManual, expected] of [
	["unset", undefined, 0],
	["true", "true", 0],
	["False (wrong case)", "False", 0],
	["0 (wrong value)", "0", 0],
	["false", "false", 1],
]) {
	test(`CLI: IS_MANUAL_DISPATCH ${label} ${expected ? "authorizes" : "refuses"} the flip`, () =>
		withCliFixture((dir) => {
			const { result, patch } = runStateCli(dir, { isManual });
			assert.equal(result.status, 0, result.stderr);
			assert.equal(patch.length, expected);
			if (expected) assert.deepEqual(patch[0], PROMOTE_ARGV);
			else
				assert.match(
					result.stdout,
					/Manual dispatch: release state is not mutated by a repair/,
				);
		}));
}

test("CLI: the hold PATCH is sent before a refused writeup is thrown", () =>
	withCliFixture((dir) => {
		// The ordering rule at the wire, with the real CLI, the real env wiring and a
		// fixture `gh` as the only one on PATH: the refused body fails the run AND the
		// hold has already gone out, so the Release is out of `/releases/latest` while
		// the run is red. Reversing the two in `openReleaseWindow` fails this test on
		// the assertion below, not on a comment.
		const { result, patch } = runStateCli(dir, {
			mode: "open",
			isManual: "false",
			assets: [],
			release: { prerelease: false, body: GENERATED_NOTES },
		});
		assert.equal(result.status, 1, result.stdout);
		assert.deepEqual(patch, [HOLD_ARGV]);
		assert.match(result.stderr, /generated-notes draft/);
	}));

test("CLI: an off-template writeup is annotated, not refused", () =>
	withCliFixture((dir) => {
		const { result, patch } = runStateCli(dir, {
			mode: "open",
			isManual: "false",
			assets: [],
			release: { prerelease: true, body: "Prose about what changed.\n" },
		});
		assert.equal(result.status, 0, result.stderr);
		assert.deepEqual(patch, []);
		assert.match(
			result.stdout,
			/::warning title=Release notes look incomplete::v0\.14\.1: the Release body has neither/,
		);
	}));

test("CLI: an older release's re-run attaches assets but does not promote", () =>
	withCliFixture((dir) => {
		const { result, patch } = runStateCli(dir, {
			isManual: "false",
			others: [NEWER],
		});
		assert.equal(result.status, 0, result.stderr);
		assert.deepEqual(patch, []);
		assert.match(
			result.stdout,
			/is not the newest release eligible for \/releases\/latest; v0\.19\.2 \(id \d+\) is\. Leaving v0\.14\.1 a pre-release\./,
		);
	}));

test("CLI: a release list larger than the default buffer is read, not called a failed lookup", () => {
	// 40 releases with release-note-sized bodies is ~1.7 MB, over Node's 1 MiB
	// execFileSync default. The real repository already returns 1.75 MB for a page
	// of its 92 releases, and exceeding the buffer surfaces as ENOBUFS -- which the
	// reader would report as a failed lookup, failing the promote on a read that
	// actually succeeded.
	const bulky = Array.from({ length: 40 }, (_, index) => ({
		...NEWER,
		id: 7000 + index,
		tag_name: `v0.9.${index}`,
		created_at: "2026-09-04T00:00:00Z",
		body: "release notes ".repeat(3000),
	}));
	withCliFixture((dir) => {
		const { result, patch } = runStateCli(dir, {
			isManual: "false",
			others: [...bulky, NEWER],
		});
		assert.equal(result.status, 0, result.stderr);
		assert.deepEqual(patch, []);
		assert.match(
			result.stdout,
			/is not the newest release eligible for \/releases\/latest; v0\.19\.2/,
		);
	});
});
