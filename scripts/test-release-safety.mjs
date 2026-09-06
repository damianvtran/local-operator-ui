#!/usr/bin/env node
/** Metadata tests use explicit fixtures, not live-release evidence. No network. */
import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
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
