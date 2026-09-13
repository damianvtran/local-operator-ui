#!/usr/bin/env node
/**
 * Metadata tests use explicit fixtures, not live-release evidence. No network.
 * Covers the immutable-recovery contracts (validate + upload) and the
 * pre-release window that keeps an asset-less build out of /releases/latest.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
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
import {
	finalizeRelease,
	missingAssets,
	openReleaseWindow,
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
function fixture({
	tag = TAG,
	sha = SHA,
	ref = `refs/tags/${tag}`,
	release = {},
	pkg = {},
	missing = "",
	assets = [],
} = {}) {
	return (path) => {
		if (path === missing) throw new Error("GitHub HTTP 404");
		if (path === `/git/ref/tags/${tag}`)
			return { ref, object: { type: "commit", sha } };
		if (path === `/releases/tags/${tag}`)
			return {
				id: ID,
				tag_name: tag,
				draft: false,
				prerelease: false,
				published_at: "2026-09-05T00:00:00Z",
				...release,
			};
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
	} = {},
) {
	const writes = [];
	const result = mode({
		api: fixture({ assets, release: { prerelease, ...release } }),
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
		"windows installer",
		"linux installer",
		"latest*.yml update metadata",
	]);
});

test("missing assets are named, so a refusal says what was absent", () => {
	assert.deepEqual(missingAssets([]), [
		"macos installer",
		"windows installer",
		"linux installer",
		"latest*.yml update metadata",
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
		"the metadata the updater fetches",
		uploaded(INSTALLERS),
		/missing latest\*\.yml update metadata/,
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
	// `gh api -f` would serialize the string "false", which the API does not
	// read as a boolean; the address must be the pinned ID, never `/tags/<tag>`,
	// which would resolve to whatever the tag points at now. The stub is the
	// only `gh` on the child's PATH, so a silent fallback to the real CLI -- and
	// a live PATCH against the operator's repository -- cannot happen.
	const dir = mkdtempSync(join(tmpdir(), "release-state-patch-"));
	try {
		writeFileSync(
			join(dir, "gh"),
			`#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
if (process.env.FAIL_PATCH === 'true') {
  process.stderr.write('token abc123 rejected\\n');
  process.exit(1);
}
appendFileSync(process.env.CALLS_FILE, JSON.stringify(process.argv.slice(2)) + '\\n');
`,
			{ mode: 0o755 },
		);
		const calls = join(dir, "calls");
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
				FAIL_PATCH: "false",
			},
		});
		assert.equal(result.status, 0, result.stderr);
		// A window that cannot be flipped is closed by hand, and this line is the
		// only place the run can say so.
		assert.match(
			result.stdout,
			/CAUGHT:Release state PATCH failed for release \d+ \(v0\.14\.1\); close the window by hand with: gh release edit v0\.14\.1 --prerelease=false/,
		);
		assert.doesNotMatch(
			result.stdout + result.stderr,
			/abc123|NO_ERROR_RAISED/,
		);
		assert.deepEqual(
			readFileSync(calls, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line)),
			[
				[
					"api",
					"--method",
					"PATCH",
					`repos/damianvtran/local-operator-ui/releases/${ID}`,
					"-F",
					"prerelease=false",
					"-F",
					"make_latest=true",
				],
				[
					"api",
					"--method",
					"PATCH",
					`repos/damianvtran/local-operator-ui/releases/${ID}`,
					"-F",
					"prerelease=true",
					"-F",
					"make_latest=false",
				],
			],
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
