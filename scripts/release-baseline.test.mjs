#!/usr/bin/env node
/**
 * The anchors a release is derived from, and the one-line bump it applies.
 *
 * These two share a file because they share a failure: a version that is
 * published under a number some other number has already claimed, or a release
 * window described from the wrong tag. The fixtures below are shaped like this
 * repository's real release list on 2026-09-15 — `v0.23.2` tagged and held out of
 * `latest` with no assets, `v0.23.3`-`v0.23.5` complete, `v0.24.0` the newest and
 * the one at the head of the feed — because the case that matters is the one
 * where the newest *tag* and the newest *release a user could be running* are
 * different tags.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	BumpError,
	bumpVersionText,
	changedLines,
	isVersionOnlyChange,
} from "./apply-release-bump.mjs";
import {
	BaselineError,
	compareVersions,
	normaliseReleases,
	selectVersionAnchor,
	selectWindowAnchor,
	tagVersion,
} from "./release-baseline.mjs";

const archZip = (version) => [
	{ name: `local-operator-ui-${version}-arm64.zip` },
	{ name: `local-operator-ui-${version}-x64.zip` },
	{ name: "latest-mac.yml" },
];
const release = (
	version,
	{ prerelease = false, assets = null, draft = false } = {},
) => ({
	tag_name: `v${version}`,
	prerelease,
	draft,
	published_at: "2026-09-15T10:00:00Z",
	assets: assets ?? archZip(version),
});
/** The repository's real state, reduced to the parts the selectors read. */
const RELEASES = [
	release("0.24.0"),
	release("0.23.5"),
	release("0.23.4"),
	release("0.23.3"),
	release("0.23.2", { prerelease: true, assets: [] }),
	release("0.23.1"),
];

test("only a plain vX.Y.Z tag names a version", () => {
	assert.equal(tagVersion("v0.24.0"), "0.24.0");
	assert.equal(tagVersion("v1.2.3"), "1.2.3");
	assert.equal(tagVersion("v1.2.3-rc.1"), null);
	assert.equal(tagVersion("v1.2.3+build"), null);
	assert.equal(tagVersion("1.2.3"), null);
	assert.equal(tagVersion("release-1"), null);
	assert.equal(tagVersion(undefined), null);
});

test("versions compare numerically, not as strings", () => {
	assert.ok(compareVersions("0.9.10", "0.9.2") > 0);
	assert.ok(compareVersions("0.24.0", "0.23.5") > 0);
	assert.equal(compareVersions("0.24.0", "0.24.0"), 0);
	assert.ok(compareVersions("1.0.0", "0.99.99") > 0);
});

test("drafts and unpublished releases are not releases", () => {
	const normalised = normaliseReleases([
		release("9.9.9", { draft: true }),
		{ ...release("9.9.8"), published_at: null },
		release("9.9.7"),
	]);
	assert.deepEqual(
		normalised.map((entry) => entry.tag),
		["v9.9.7"],
	);
});

test("the window anchor is the newest release a user could be running", () => {
	// As published: v0.24.0 is the newest complete release.
	assert.equal(selectWindowAnchor(RELEASES).tag, "v0.24.0");
	// At publish time the candidate is excluded, which is the normal case.
	assert.equal(
		selectWindowAnchor(RELEASES, { exclude: "v0.24.0" }).tag,
		"v0.23.5",
	);
	// A repair of an old release derives the incumbent ITS users upgrade from.
	assert.equal(
		selectWindowAnchor(RELEASES, { below: "0.23.4" }).tag,
		"v0.23.3",
	);
});

test("a tag no user could reach is not a window anchor", () => {
	// v0.23.2 is the trap: it is the second newest tag in the list and no user
	// ever had it, so a window derived from it would describe a release that
	// shipped nothing, and the incumbent for the update exercise would not exist.
	assert.equal(
		selectWindowAnchor(RELEASES, { exclude: "v0.24.0", below: "0.23.4" }).tag,
		"v0.23.3",
	);
	const withPrereleaseNewest = [
		release("0.24.1", { prerelease: true }),
		...RELEASES,
	];
	assert.equal(selectWindowAnchor(withPrereleaseNewest).tag, "v0.24.0");
});

test("a Release with no architecture-matched archive is not a window anchor", () => {
	const metadataOnly = [
		release("0.25.0", { assets: [{ name: "latest-mac.yml" }] }),
		release("0.24.0"),
	];
	assert.equal(selectWindowAnchor(metadataOnly).tag, "v0.24.0");
});

test("the version anchor is the newest tag of any kind, so no number is reused", () => {
	// The case this anchor exists for: the newest tag is one no user could run,
	// and the next version still has to be above it. Deriving from the window
	// anchor alone here would produce v0.23.3 — a tag that already exists.
	const held = [
		release("0.23.3", { prerelease: true, assets: [] }),
		release("0.23.2"),
	];
	assert.equal(selectWindowAnchor(held).tag, "v0.23.2");
	assert.equal(selectVersionAnchor(held).tag, "v0.23.3");
});

test("no anchor at all is a refusal, not a default", () => {
	assert.equal(
		selectWindowAnchor([release("0.1.0", { prerelease: true, assets: [] })]),
		null,
	);
	assert.equal(selectVersionAnchor([]), null);
	assert.ok(new BaselineError("x") instanceof Error);
});

test("the bump replaces the version line and nothing else", () => {
	const before =
		'{\n\t"name": "local-operator-ui",\n\t"version": "0.24.0",\n\t"private": true\n}\n';
	const after = bumpVersionText(before, "0.25.0");
	assert.match(after, /"version": "0\.25\.0",/);
	assert.equal(after.replace('"0.25.0"', '"0.24.0"'), before);
	assert.equal(isVersionOnlyChange(before, after), true);
	assert.deepEqual(changedLines(before, after), {
		removed: ['\t"version": "0.24.0",'],
		added: ['\t"version": "0.25.0",'],
	});
});

test("a bump that is not one version line is refused", () => {
	const before = '{\n\t"version": "0.24.0",\n\t"private": true\n}\n';
	assert.equal(
		isVersionOnlyChange(
			before,
			'{\n\t"version": "0.25.0",\n\t"private": false\n}\n',
		),
		false,
	);
	assert.equal(
		isVersionOnlyChange(before, '{\n\t"version": "0.25.0",\n}\n'),
		false,
	);
});

test("an ambiguous or malformed version surface is refused rather than guessed", () => {
	assert.throws(
		() =>
			bumpVersionText('{"version": "0.24.0", "version": "0.24.0"}', "0.25.0"),
		BumpError,
	);
	assert.throws(() => bumpVersionText('{"name": "x"}', "0.25.0"), /found 0/);
	assert.throws(
		() => bumpVersionText('{"version": "0.24.0"}', "v0.25.0"),
		/Not a plain/,
	);
});

test("the real package.json is bumpable in exactly one line", () => {
	// The file this workflow edits, not a fixture: a bump that reformats the
	// repository's own package.json would be a diff nobody reviewed.
	const path = new URL("../package.json", import.meta.url);
	const before = readFileSync(path, "utf8");
	const after = bumpVersionText(before, "9.9.9");
	assert.equal(isVersionOnlyChange(before, after), true);
	// The indentation is whatever the file already used: the assertion is that
	// the one changed line is the file's own version line with the value swapped.
	const version = JSON.parse(before).version;
	const originalLine = before
		.split("\n")
		.find((line) => line.includes('"version"'));
	assert.deepEqual(changedLines(before, after).added, [
		originalLine.replace(`"${version}"`, '"9.9.9"'),
	]);
	// Nothing else moved: putting the value back reproduces the file byte for
	// byte, so the commit is a one-line diff by construction.
	assert.equal(after.replace('"9.9.9"', `"${version}"`), before);
	assert.equal(after.split("\n").length, before.split("\n").length);
});
